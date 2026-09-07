"""Adapt the supplied Copper & Thyme authoring script to the authoritative game layout.
Run: Blender --background --python assets/copper-and-thyme/build-game-scene.py
The source archive stays untouched. Export entity roots separately so live state can own them.
"""
import bpy, pathlib, json, math, textwrap
from mathutils import Matrix, Vector
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
source = (HERE / 'source-build_scene.py').read_text()
layout = json.loads((ROOT / 'shared/game-data/restaurant-layout.json').read_text())
ns = {'__file__': str(HERE / 'source-build_scene.py')}
exec(source[:source.index('# Architectural platform')], ns)
scene = ns['scene']
buckets = {}
def run(start, end, key):
    before = set(scene.objects)
    exec(source[source.index(start):source.index(end)], ns)
    buckets.setdefault(key, []).extend(set(scene.objects) - before)
    print('Captured', key, flush=True)
def capture(code, key):
    before = set(scene.objects)
    exec(code, ns)
    buckets.setdefault(key, []).extend(set(scene.objects) - before)
    print('Captured', key, flush=True)
run('# Architectural platform', '# Kitchen line', 'architecture')
run('# Kitchen line', '# Range and overhead', 'cabinets')
run('# Range and overhead', '# Ingredient station', 'station_grill')
run('# Ingredient station', '# Sink and faucet', 'station_prep')
run('# Sink and faucet', '# Tall double', 'dishwashing')
run('# Tall double', '# Back shelves', 'fridge')
run('# Back shelves', '# Service island', 'pantry')
run('# Service island', '# Plate and layered', 'service_pass')
# Functions are retained; the demo's permanently ready burgers are deliberately excluded.
exec(source[source.index('# Plate and layered'):source.index('for x in [-1.7,0,1.7]')], ns)
dining = source[source.index('# Dining:'):source.index('# Wall identity')]
loop = dining.index('for idx,')
exec(dining[:loop], ns)
body = textwrap.dedent(dining[dining.index('\n', loop)+1:])
for entity in layout['entities']:
    if entity['type'] != 'table': continue
    ns.update(x=0, y=0)
    code = body
    if entity['seats'] == 4:
        code += '\nchair(-1.15,0,math.pi/2);chair(1.15,0,-math.pi/2)\n'
    capture(code, entity['id'])
run('# Wall identity', '# Pendants', 'architecture')
# Floating ceiling pendants obscure the playable floor; keep the pass lamps only.
run('# Botanical details', '# Rounded arcade', 'plants')
# Distribute the original four cabinets over the four real kitchen stations.
centers = [(-4.8,'station_grill'),(-2.7,'station_prep'),(-.6,'station_oven'),(1.5,'station_plating')]
for obj in buckets.pop('cabinets'):
    key = min(centers, key=lambda c: abs(obj.location.x-c[0]))[1]
    buckets.setdefault(key, []).append(obj)
# A readable oven door and plating crockery use the source materials and construction helpers.
capture("box('Oven door',(-.6,3.22,1.03),(1.55,.08,.65),'Black');rod('Oven pull',(-1.2,3.13,1.28),(0,3.13,1.28),.035,'Steel')", 'station_oven')
capture("\nfor i in range(5):cyl('Plating crockery',(1.5,3.9,1.68+i*.045),.27,.035,'Ceramic')\n", 'station_plating')
# Entry and upgrade furniture remain explicit interactable entities, not decoration.
capture("box('Host cabinet',(0,0,.9),(1.1,.7,1.1),'Forest');box('Host top',(0,0,1.48),(1.2,.8,.08),'OakLight');box('Reservations',(0,0,1.54),(.6,.45,.04),'Linen')", 'host_stand')
capture("box('Terminal cabinet',(0,0,.9),(1,.8,1.1),'Forest');box('Terminal screen',(0,0,1.5),(.8,.6,.1),'Glow')", 'upgrade_terminal')
anchors = {'station_grill':(-4.8,3.9), 'station_prep':(-2.7,3.9), 'station_oven':(-.6,3.9),
           'station_plating':(1.5,3.9), 'dishwashing':(.8,3.9), 'pantry':(.35,4.4),
           'service_pass':(0,.9), 'host_stand':(0,0), 'upgrade_terminal':(0,0)}
entities = {e['id']:e for e in layout['entities']}
# Convert modifiers once, then transform vertices into final game space. Blender Y is -glTF Z.
for key, objects in buckets.items():
    root = bpy.data.objects.new(key, None)
    scene.collection.objects.link(root)
    entity = entities.get(key)
    if entity:
        gx, _, gz = entity['position']
        root.location = (gx, -gz, 0)
        root['layoutEntityId'] = key
    converted = []
    for obj in objects:
        if obj.type not in {'MESH','FONT'}: continue
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target='MESH')
        world = obj.matrix_world.copy()
        for v in obj.data.vertices:
            p = world @ v.co
            if entity:
                ax, ay = anchors.get(key,(0,0))
                sx = 16/6.55 if key == 'service_pass' else 1
                # Pass matches the existing 0.45 surface used by ready-food markers.
                sy = .45/(1.70-.34) if key == 'service_pass' else .72
                v.co = ((p.x-ax)*sx, -(p.y-ay), (p.z-.34)*sy)
            else:
                z = -8+(p.y+5)*11/6.5 if p.y <= 1.5 else 3+(p.y-1.5)*9/3.5
                if key == 'fridge': z = 10+(p.y-4.07)
                v.co = (p.x*9/7, -z, (p.z-.34)*.85)
        obj.matrix_world = Matrix.Identity(4)
        # Reflection into the game's +Z-back-of-house convention reverses winding.
        import bmesh
        bm = bmesh.new(); bm.from_mesh(obj.data)
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces)); bm.to_mesh(obj.data); bm.free()
        obj.parent = root
        converted.append(obj)
    # Preserve entity roots; batch their geometry by material for bounded draw calls.
    by_material = {}
    for o in converted:
        if len(o.data.materials): by_material.setdefault(o.data.materials[0], []).append(o)
    for material, same in by_material.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in same: o.select_set(True)
        bpy.context.view_layer.objects.active = same[0]
        bpy.ops.object.join()
        same[0].name = key+'_'+material.name
# Export only authored meshes/roots; no demo customers, camera, lights or game rules.
output = HERE / 'restaurant.glb'
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    if o.type in {'MESH','EMPTY'}: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,export_apply=True,export_yup=True)
print('GAME_SCENE_EXPORT', output, output.stat().st_size)
