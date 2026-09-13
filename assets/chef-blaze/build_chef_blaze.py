import bpy, math, os
from mathutils import Vector

# Chef Blaze production pass. Run inside the connected Blender session via the local MCP bridge.
# The script is self-contained so the checked-in package can be rebuilt in Blender.
OUT = os.path.dirname(os.path.abspath(__file__))
PREVIEW_DIR = os.path.join(OUT, 'previews')
os.makedirs(PREVIEW_DIR, exist_ok=True)
BLEND = os.path.join(OUT, 'ChefBlaze_Master.blend')
GLB = os.path.join(OUT, 'ChefBlaze.glb')

# Clean the current file for a deterministic handoff.
bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.armatures):
    pass
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
for c in list(bpy.data.collections):
    if c.name != 'Collection':
        bpy.data.collections.remove(c)
root = bpy.context.scene.collection
base = bpy.data.collections.get('Collection')
if base: base.name = 'ChefBlaze_GEO'

def coll(name):
    c=bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in [x.name for x in root.children]:
        try: root.children.link(c)
        except: pass
    return c

GEO=coll('ChefBlaze_GEO'); RIG=coll('ChefBlaze_RIG'); MAT=coll('ChefBlaze_MAT'); ANIM=coll('ChefBlaze_ANIM'); COL=coll('ChefBlaze_COLLIDERS'); REF=coll('REF_Attached')
# Keep the original scene collection linked as the runtime geometry collection.

def move_to(obj, collection):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj)

def mat(name, color, rough=.35, metallic=0.0, coat=.0, emission=None):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough
    p.inputs['Metallic'].default_value=metallic
    if 'Coat Weight' in p.inputs: p.inputs['Coat Weight'].default_value=coat
    if emission and 'Emission Color' in p.inputs:
        p.inputs['Emission Color'].default_value=(*emission,1); p.inputs['Emission Strength'].default_value=.15
    m.diffuse_color=(*color,1)
    move_to(m, MAT) if False else None
    return m

M={
 'Hat':mat('CB_Warm_White_Hat',(0.94,.91,.85),.26,0,.18),
 'Jacket':mat('CB_Warm_White_Jacket',(0.88,.86,.81),.32,0,.12),
 'Skin':mat('CB_Skin_Peach',(0.87,.36,.14),.38,0,.1),
 'SkinHi':mat('CB_Skin_Highlight',(1.0,.53,.25),.33,0,.12),
 'Dark':mat('CB_Charcoal',(0.018,.022,.03),.23,.05,.28),
 'Boot':mat('CB_Boot_Rubber',(0.012,.016,.022),.22,.12,.3),
 'Red':mat('CB_Scarf_Red',(.74,.018,.025),.27,0,.2),
 'Orange':mat('CB_Flame_Orange',(1.0,.12,.015),.25,0,.16, (1.0,.04,.005)),
 'Yellow':mat('CB_Flame_Yellow',(1.0,.56,.015),.24,0,.18, (1.0,.22,.01)),
 'Gold':mat('CB_Button_Gold',(.10,.075,.045),.2,.45,.35),
 'EyeWhite':mat('CB_Eye_White',(1.0,.98,.9),.15,0,.35),
 'Iris':mat('CB_Iris',(0.03,.11,.16),.12,.05,.5),
 'Mouth':mat('CB_Mouth',(0.12,.008,.008),.25,0,.05),
}

def smooth(obj):
    if hasattr(obj.data,'polygons'):
        for p in obj.data.polygons: p.use_smooth=True
    return obj

def finish(obj, material, collection=GEO, bevel=0.0):
    if material: obj.data.materials.append(material)
    smooth(obj); move_to(obj, collection)
    if bevel:
        bpy.context.view_layer.objects.active=obj; obj.select_set(True)
        mod=obj.modifiers.new('Soft edge','BEVEL'); mod.width=bevel; mod.segments=3
        try: bpy.ops.object.modifier_apply(modifier=mod.name)
        except: pass
        obj.select_set(False)
    return obj

def uv(name, loc, scale, material, bone=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    finish(o,material); o['game_asset']='Chef Blaze'; o['component']=name
    if bone: o['rig_bone']=bone
    return o

def cube(name, loc, scale, material, rot=(0,0,0), bone=None, bevel=.04):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; o.scale=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    finish(o,material,bevel=bevel)
    if bone: o['rig_bone']=bone
    return o

def cyl(name, loc, radius, depth, material, rot=(0,0,0), bone=None, bevel=.025):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=depth, location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; finish(o,material,bevel=bevel)
    if bone: o['rig_bone']=bone
    return o

def between(name, a, b, radius, material, bone=None):
    a,b=Vector(a),Vector(b); d=b-a
    o=cyl(name,(a+b)/2,radius,d.length,material,bone=bone,bevel=.025)
    o.rotation_mode='QUATERNION'; o.rotation_quaternion=d.to_track_quat('Z','Y')
    return o

def torus(name, loc, major, minor, material, rot=(0,0,0), bone=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=32, minor_segments=12, location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; finish(o,material)
    if bone:o['rig_bone']=bone
    return o

def flame(name, x, z, side=1, scale=1.0):
    # A crisp extruded flame silhouette on the front and outer side of each pant leg.
    pts=[(-.18,0),(-.13,.12),(-.15,.23),(-.06,.17),(-.03,.38),(.02,.50),(.05,.34),(.12,.26),(.17,.08),(.13,0)]
    pts=[(x+px*side*scale,z+pz*scale) for px,pz in pts]
    verts=[]
    for y in (-.235,-.265): verts += [(px,y,pz) for px,pz in pts]
    n=len(pts); faces=[tuple(range(n)),tuple(range(n,2*n))]
    for i in range(n): faces.append((i,(i+1)%n,(i+1)%n+n,i+n))
    me=bpy.data.meshes.new(name+'Mesh'); me.from_pydata(verts,[],faces); me.update()
    o=bpy.data.objects.new(name,me); GEO.objects.link(o); o.data.materials.append(M['Orange']);
    for p in o.data.polygons:p.use_smooth=True
    o['rig_bone']='thigh.L' if side<0 else 'thigh.R'
    return o

def inner_flame(name,x,z,side=1,scale=1.0):
    pts=[(-.08,0),(-.055,.10),(-.07,.18),(-.015,.14),(.01,.30),(.045,.38),(.06,.22),(.10,.13),(.07,0)]
    pts=[(x+px*side*scale,z+pz*scale) for px,pz in pts]; y=-.276
    me=bpy.data.meshes.new(name+'Mesh'); me.from_pydata([(px,y,pz) for px,pz in pts],[],[tuple(range(len(pts)))]); me.update()
    o=bpy.data.objects.new(name,me); GEO.objects.link(o); o.data.materials.append(M['Yellow']); o['rig_bone']='thigh.L' if side<0 else 'thigh.R'; return o

# ----------------- model -----------------
# Feet, legs and pants establish a strong grounded silhouette.
for side,x in [('L',-.28),('R',.28)]:
    cube('Boot_'+side,(x,-.055,.14),(.25,.36,.13),M['Boot'],rot=(0,0,0),bone='foot.'+side,bevel=.07)
    cube('BootToe_'+side,(x,-.30,.18),(.24,.20,.13),M['Boot'],bone='foot.'+side,bevel=.07)
    cube('BootSole_'+side,(x,-.09,.045),(.27,.38,.045),M['Dark'],bone='foot.'+side,bevel=.02)
    cyl('PantsLeg_'+side,(x,.0,.70),.205,.62,M['Dark'],bone='thigh.'+side,bevel=.045)
    flame('FlameOuter_'+side,x,.48,-1 if side=='L' else 1,.92); inner_flame('FlameInner_'+side,x,.49,-1 if side=='L' else 1,.92)
    # side flame accents to suggest a wraparound graphic
    uv('FlameSide_'+side,(x+(-.19 if side=='L' else .19),-.01,.62),(.05,.16,.25),M['Orange'],bone='thigh.'+side)

cube('JacketBody',(0,.0,1.16),(.48,.27,.32),M['Jacket'],bevel=.08,bone='chest')
cube('JacketFrontPanel',(0,-.275,1.16),(.30,.025,.28),M['Jacket'],bevel=.018,bone='chest')
for z in (1.02,1.17,1.32):
    for x in (-.20,.20): uv('JacketButton_'+str(z)+'_'+str(x),(x,-.315,z),(.045,.025,.045),M['Gold'],bone='chest')
# broad shoulders and articulated arms
for side,x in [('L',-.55),('R',.55)]:
    s=-1 if side=='L' else 1
    uv('Shoulder_'+side,(x*.83,0,1.35),(.20,.25,.20),M['Jacket'],bone='upper_arm.'+side)
    between('SleeveUpper_'+side,(x*.80,0,1.35),(x,0,1.15),.145,M['Jacket'],bone='upper_arm.'+side)
    between('SkinForearm_'+side,(x,0,1.14),(x*1.04,-.02,.91),.12,M['SkinHi'],bone='forearm.'+side)
    uv('Cuff_'+side,(x*1.04,-.02,1.05),(.14,.14,.08),M['Jacket'],bone='forearm.'+side)
    uv('Hand_'+side,(x*1.05,-.045,.82),(.15,.13,.18),M['Skin'],bone='hand.'+side)
    for i,(dx,dz) in enumerate(((-.10,.02),(-.04,-.03),(.03,-.04),(.10,.0))):
        between('Finger_'+side+str(i),(x*1.05+dx*s,-.18,.78+dz),(x*1.05+(dx+.035*s)*s,-.19,.70+dz),.035,M['Skin'],bone='hand.'+side)

# Neckerchief collar and twin tails.
torus('ScarfCollar',(0,-.01,1.48),.27,.065,M['Red'],bone='neck')
uv('ScarfKnot',(0,-.30,1.39),(.12,.07,.10),M['Red'],bone='chest')
cube('ScarfTail_L',(-.10,-.34,1.28),(.07,.035,.18),M['Red'],rot=(0,.18,-.22),bone='chest',bevel=.035)
cube('ScarfTail_R',(.10,-.34,1.28),(.07,.035,.18),M['Red'],rot=(0,-.18,.22),bone='chest',bevel=.035)

# Head, ears and high contrast face.
uv('Head',(0,0,1.64),(.32,.27,.33),M['Skin'],bone='head')
uv('Ear_L',(-.31,0,1.64),(.08,.10,.13),M['Skin'],bone='head'); uv('Ear_R',(.31,0,1.64),(.08,.10,.13),M['Skin'],bone='head')
uv('Nose',(0,-.295,1.61),(.085,.09,.09),M['SkinHi'],bone='head')
for side,x in [('L',-.115),('R',.115)]:
    uv('EyeWhite_'+side,(x,-.275,1.72),(.085,.045,.095),M['EyeWhite'],bone='head')
    uv('Iris_'+side,(x,-.318,1.72),(.037,.018,.047),M['Iris'],bone='head')
    # expressive angled brow blocks
    cube('Brow_'+side,(x,-.325,1.82),(.10,.025,.028),M['Dark'],rot=(0,0,(.16 if side=='L' else -.16)),bone='head',bevel=.025)
# cheeks and mischievous grin
uv('Cheek_L',(-.19,-.265,1.57),(.07,.025,.05),M['SkinHi'],bone='head'); uv('Cheek_R',(.19,-.265,1.57),(.07,.025,.05),M['SkinHi'],bone='head')
cube('Smile',(0,-.302,1.54),(.135,.018,.025),M['Mouth'],rot=(0,0,0),bone='head',bevel=.018)
uv('Moustache_L',(-.075,-.335,1.57),(.11,.035,.055),M['Dark'],bone='head'); uv('Moustache_R',(.075,-.335,1.57),(.11,.035,.055),M['Dark'],bone='head')
uv('Goatee',(0,-.30,1.44),(.08,.06,.12),M['Dark'],bone='head')

# Puffy toque: brim plus seven soft segmented lobes.
cyl('ToqueBand',(0,0,1.84),.33,.13,M['Hat'],bone='head',bevel=.035)
for i,(x,y,sx,sy,sz) in enumerate([(-.26,0,.20,.20,.20),(-.15,-.02,.22,.21,.25),(0,-.01,.23,.22,.27),(.15,-.02,.22,.21,.25),(.26,0,.20,.20,.20),(-.08,.08,.20,.18,.22),(.10,.08,.20,.18,.22)]):
    uv('ToquePuff_'+str(i),(x,y,1.98+(0.03 if abs(x)<.16 else 0)),(sx,sy,sz),M['Hat'],bone='head')

# Simple collision proxies are kept separate and hidden from render/export.
for name,loc,scale in [('CB_Collider_Body',(0,0,1.18),(.48,.27,.50)),('CB_Collider_Head',(0,0,1.65),(.33,.28,.34)),('CB_Collider_Leg',(-.28,0,.70),(.22,.22,.34)),('CB_Collider_Leg_R',(.28,0,.70),(.22,.22,.34))]:
    o=uv(name,loc,scale,None); move_to(o,COL); o.hide_render=True; o.hide_viewport=True; o.display_type='WIRE'; o['export_exclude']=True

# ----------------- armature -----------------
bpy.ops.object.armature_add(enter_editmode=True, location=(0,0,0))
arm=bpy.context.object; arm.name='ChefBlaze_RIG'; move_to(arm,RIG)
arm.data.name='ChefBlaze_Humanoid_Skeleton'; arm.show_in_front=True
eb=arm.data.edit_bones; eb.remove(eb[0])
def bone(name,head,tail,parent=None):
    b=eb.new(name); b.head=head; b.tail=tail
    if parent:b.parent=eb.get(parent)
    return b
bone('root',(0,0,.02),(0,0,.15)); bone('pelvis',(0,0,.82),(0,0,1.02),'root'); bone('spine',(0,0,1.02),(0,0,1.25),'pelvis'); bone('chest',(0,0,1.25),(0,0,1.46),'spine'); bone('neck',(0,0,1.46),(0,0,1.58),'chest'); bone('head',(0,0,1.58),(0,0,1.80),'neck')
for side,x in [('L',-.1),('R',.1)]:
    bone('clavicle.'+side,(x,0,1.40),(x*2.4,0,1.38),'chest')
    sx=-1 if side=='L' else 1
    bone('upper_arm.'+side,(sx*.24,0,1.38),(sx*.55,0,1.16),'clavicle.'+side)
    bone('forearm.'+side,(sx*.55,0,1.16),(sx*.60,0,.93),'upper_arm.'+side)
    bone('hand.'+side,(sx*.60,0,.93),(sx*.61,-.04,.78),'forearm.'+side)
    for i in range(4): bone('finger'+str(i)+'.'+side,(sx*.61+sx*(i-1.5)*.035,-.04,.79),(sx*.61+sx*(i-1.5)*.045,-.14,.70),'hand.'+side)
    bone('thigh.'+side,(sx*.18,0,.90),(sx*.28,0,.66),'pelvis'); bone('shin.'+side,(sx*.28,0,.66),(sx*.28,0,.20),'thigh.'+side); bone('foot.'+side,(sx*.28,0,.20),(sx*.28,-.24,.10),'shin.'+side); bone('toe.'+side,(sx*.28,-.24,.10),(sx*.28,-.40,.10),'foot.'+side)
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones: pb.rotation_mode='XYZ'
bpy.ops.object.mode_set(mode='OBJECT')
arm['character']='Chef Blaze'; arm['unit_scale']='1 Blender unit = 1 meter'; arm['forward_axis']='-Y (face/front)'; arm['fps']=30; arm['root_motion']='in-place clips; root remains stationary'; arm['export_notes']='Use GLTFLoader; play named clips with AnimationMixer.'

def rig_parent(o,bname):
    if not o or bname not in arm.data.bones:return
    wm=o.matrix_world.copy(); o.parent=arm; o.parent_type='OBJECT'; o.matrix_world=wm

for o in list(GEO.objects):
    b=o.get('rig_bone')
    if b: rig_parent(o,b)

# Give each rigid stylized component a single clean deform influence so glTF sees a conventional skin relationship.
for o in GEO.objects:
    if o.type=='MESH' and o.parent==arm and o.get('rig_bone'):
        try:
            bname=o.get('rig_bone'); vg=o.vertex_groups.get(bname) or o.vertex_groups.new(name=bname)
            vg.add(list(range(len(o.data.vertices))),1.0,'REPLACE')
            mod=o.modifiers.new('ChefBlaze_Deform','ARMATURE'); mod.object=arm
        except: pass

# ----------------- animation clips -----------------
def pb(name): return arm.pose.bones.get(name)
def set_pose(frame, values):
    bpy.context.scene.frame_set(frame)
    for name, (rot,loc) in values.items():
        p=pb(name)
        if not p: continue
        p.rotation_euler=rot
        if loc is not None: p.location=loc
        p.keyframe_insert('rotation_euler',frame=frame,group=name)
        if loc is not None:p.keyframe_insert('location',frame=frame,group=name)
    # keep core chain keyed to preserve a clean in-place clip
    for name in ('root','pelvis','spine','chest','neck','head'):
        p=pb(name)
        if p:
            p.keyframe_insert('rotation_euler',frame=frame,group=name)

def action(name,start,end,poses,cyclic=False):
    a=bpy.data.actions.new(name); a.use_fake_user=True; a['fps']=30; a['frame_range_text']=f'{start}-{end}'; a['root_motion']='in-place'
    arm.animation_data_create(); arm.animation_data.action=a
    for f,vals in poses: set_pose(f,vals)
    # Blender 5.2 actions use layered channels and expose no legacy fcurves;
    # explicit matching end keys keep these clips seamless for export.
    return a

z=(0,0,0); no=None
action('ChefBlaze_Idle',1,90,[(1,{'chest':((0,0,0),no),'head':((0,0,0),no),'upper_arm.L':((.06,0,-.06),no),'upper_arm.R':((.06,0,.06),no)}),(30,{'chest':((-.025,0,0),no),'head':((0,.04,0),no),'upper_arm.L':((.10,0,-.08),no),'upper_arm.R':((.10,0,.08),no)}),(90,{'chest':((0,0,0),no),'head':((0,0,0),no),'upper_arm.L':((.06,0,-.06),no),'upper_arm.R':((.06,0,.06),no)})],True)
walk=[(1,{'thigh.L':((.32,0,0),no),'shin.L':((-.18,0,0),no),'foot.L':((-.16,0,0),no),'thigh.R':((-.32,0,0),no),'shin.R':((-.05,0,0),no),'foot.R':((.16,0,0),no),'upper_arm.L':((-.38,0,0),no),'forearm.L':((.12,0,0),no),'upper_arm.R':((.38,0,0),no),'forearm.R':((-.12,0,0),no),'chest':((0,.04,0),no)}),(8,{'thigh.L':((-.42,0,0),no),'shin.L':((.30,0,0),no),'foot.L':((.18,0,0),no),'thigh.R':((.42,0,0),no),'shin.R':((-.12,0,0),no),'foot.R':((-.18,0,0),no),'upper_arm.L':((.38,0,0),no),'forearm.L':((-.08,0,0),no),'upper_arm.R':((-.38,0,0),no),'forearm.R':((.08,0,0),no),'chest':((0,-.04,0),no)}),(16,{'thigh.L':((-.32,0,0),no),'shin.L':((-.05,0,0),no),'foot.L':((.16,0,0),no),'thigh.R':((.32,0,0),no),'shin.R':((-.18,0,0),no),'foot.R':((-.16,0,0),no),'upper_arm.L':((.38,0,0),no),'forearm.L':((-.12,0,0),no),'upper_arm.R':((-.38,0,0),no),'forearm.R':((.12,0,0),no),'chest':((0,.04,0),no)}),(23,{'thigh.L':((.42,0,0),no),'shin.L':((-.12,0,0),no),'foot.L':((-.18,0,0),no),'thigh.R':((-.42,0,0),no),'shin.R':((.30,0,0),no),'foot.R':((.18,0,0),no),'upper_arm.L':((-.38,0,0),no),'forearm.L':((.08,0,0),no),'upper_arm.R':((.38,0,0),no),'forearm.R':((-.08,0,0),no),'chest':((0,-.04,0),no)}),(30,{'thigh.L':((.32,0,0),no),'shin.L':((-.18,0,0),no),'foot.L':((-.16,0,0),no),'thigh.R':((-.32,0,0),no),'shin.R':((-.05,0,0),no),'foot.R':((.16,0,0),no),'upper_arm.L':((-.38,0,0),no),'forearm.L':((.12,0,0),no),'upper_arm.R':((.38,0,0),no),'forearm.R':((-.12,0,0),no),'chest':((0,.04,0),no)})]
action('ChefBlaze_Walk_InPlace',1,30,walk,True)
run=[(1,{'thigh.L':((.75,0,0),no),'shin.L':((-.28,0,0),no),'foot.L':((-.28,0,0),no),'thigh.R':((-.78,0,0),no),'shin.R':((-.12,0,0),no),'foot.R':((.28,0,0),no),'upper_arm.L':((-.72,0,0),no),'forearm.L':((.30,0,0),no),'upper_arm.R':((.72,0,0),no),'forearm.R':((-.30,0,0),no),'spine':((0,.10,0),no),'chest':((0,.10,0),no),'head':((0,.05,0),no)}),(7,{'thigh.L':((-.95,0,0),no),'shin.L':((.65,0,0),no),'foot.L':((.28,0,0),no),'thigh.R':((.95,0,0),no),'shin.R':((-.55,0,0),no),'foot.R':((-.28,0,0),no),'upper_arm.L':((.70,0,0),no),'forearm.L':((-.28,0,0),no),'upper_arm.R':((-.70,0,0),no),'forearm.R':((.28,0,0),no),'spine':((0,.10,0),no),'chest':((0,.10,0),no),'head':((0,.05,0),no)}),(13,{'thigh.L':((-.78,0,0),no),'shin.L':((-.12,0,0),no),'foot.L':((.28,0,0),no),'thigh.R':((.75,0,0),no),'shin.R':((-.28,0,0),no),'foot.R':((-.28,0,0),no),'upper_arm.L':((.72,0,0),no),'forearm.L':((-.30,0,0),no),'upper_arm.R':((-.72,0,0),no),'forearm.R':((.30,0,0),no),'spine':((0,.10,0),no),'chest':((0,.10,0),no),'head':((0,.05,0),no)}),(19,{'thigh.L':((.95,0,0),no),'shin.L':((-.55,0,0),no),'foot.L':((-.28,0,0),no),'thigh.R':((-.95,0,0),no),'shin.R':((.65,0,0),no),'foot.R':((.28,0,0),no),'upper_arm.L':((-.70,0,0),no),'forearm.L':((.28,0,0),no),'upper_arm.R':((.70,0,0),no),'forearm.R':((-.28,0,0),no),'spine':((0,.10,0),no),'chest':((0,.10,0),no),'head':((0,.05,0),no)}),(24,{'thigh.L':((.75,0,0),no),'shin.L':((-.28,0,0),no),'foot.L':((-.28,0,0),no),'thigh.R':((-.78,0,0),no),'shin.R':((-.12,0,0),no),'foot.R':((.28,0,0),no),'upper_arm.L':((-.72,0,0),no),'forearm.L':((.30,0,0),no),'upper_arm.R':((.72,0,0),no),'forearm.R':((-.30,0,0),no),'spine':((0,.10,0),no),'chest':((0,.10,0),no),'head':((0,.05,0),no)})]
action('ChefBlaze_Run_InPlace',1,24,run,True)
slide=[(1,{'pelvis':((.10,0,-.02),(.0,0,.0)),'spine':((0,.15,.18),no),'chest':((0,.16,.20),no),'thigh.L':((-.70,0,-.20),no),'shin.L':((.78,0,0),no),'foot.L':((-.45,0,0),no),'thigh.R':((.95,0,.10),no),'shin.R':((-.55,0,0),no),'foot.R':((.32,0,0),no),'upper_arm.L':((-.45,0,-.55),no),'upper_arm.R':((-.45,0,.55),no),'head':((0,-.08,-.18),no)}),(6,{'pelvis':((.12,0,-.07),no),'spine':((0,.20,.28),no),'chest':((0,.20,.30),no),'thigh.L':((-.82,0,-.34),no),'shin.L':((1.0,0,0),no),'foot.L':((-.52,0,0),no),'thigh.R':((.70,0,.16),no),'shin.R':((-.40,0,0),no),'foot.R':((.28,0,0),no),'upper_arm.L':((-.62,0,-.70),no),'upper_arm.R':((-.62,0,.70),no),'head':((0,-.10,-.26),no)}),(12,{'pelvis':((0,0,0),no),'spine':((0,.04,-.10),no),'chest':((0,.04,-.10),no),'thigh.L':((.32,0,0),no),'shin.L':((-.18,0,0),no),'foot.L':((-.16,0,0),no),'thigh.R':((-.32,0,0),no),'shin.R':((-.05,0,0),no),'foot.R':((.16,0,0),no),'upper_arm.L':((.15,0,-.18),no),'upper_arm.R':((.15,0,.18),no),'head':((0,0,0),no)}),(18,{'pelvis':((0,0,0),no),'spine':((0,0,0),no),'chest':((0,0,0),no),'thigh.L':((.32,0,0),no),'shin.L':((-.18,0,0),no),'foot.L':((-.16,0,0),no),'thigh.R':((-.32,0,0),no),'shin.R':((-.05,0,0),no),'foot.R':((.16,0,0),no),'upper_arm.L':((.06,0,-.06),no),'upper_arm.R':((.06,0,.06),no),'head':((0,0,0),no)})]
action('ChefBlaze_Slide_DirectionChange',1,18,slide,False)

# ----------------- presentation + export -----------------
scene=bpy.context.scene; scene.name='Chef Blaze · Production Preview'; scene.render.engine='BLENDER_EEVEE_NEXT'; scene.render.resolution_x=900; scene.render.resolution_y=900; scene.render.resolution_percentage=100; scene.render.fps=30
scene.render.image_settings.file_format='PNG'; scene.render.filepath=os.path.join(PREVIEW_DIR,'chef-blaze-front.png'); scene.render.film_transparent=False
scene.world.color=(.006,.012,.035)
def studio_light(name,loc,energy,size,color):
    bpy.ops.object.light_add(type='AREA',location=loc); l=bpy.context.object; l.name=name; l.data.energy=energy; l.data.shape='DISK'; l.data.size=size; l.data.color=color; l.rotation_euler=(math.radians(25),0,math.radians(25)); move_to(l,REF)
studio_light('Key',(3,-4,5),900,4,(1.0,.72,.55)); studio_light('Fill',(-4,-2,3),700,5,(.35,.5,1.0)); studio_light('Rim',(2,3,4),1100,3,(.4,.55,1.0))
bpy.ops.object.camera_add(location=(2.25,-4.75,1.78)); cam=bpy.context.object; cam.name='ChefBlaze_PreviewCamera'; move_to(cam,REF); cam.data.lens=62
def point_at(o,pt): o.rotation_euler=(Vector(pt)-o.location).to_track_quat('-Z','Y').to_euler()
point_at(cam,(0,0,1.05)); scene.camera=cam
bpy.ops.mesh.primitive_plane_add(size=20,location=(0,0,0)); floor=bpy.context.object; floor.name='Preview_Ground'; floor.data.materials.append(mat('CB_Preview_Ground',(.008,.014,.035),.3)); move_to(floor,REF)
bpy.ops.object.empty_add(type='PLAIN_AXES',location=(0,0,0)); ref=bpy.context.object; ref.name='ChefBlaze_Reference_Metadata'; move_to(ref,REF); ref['target_image']='/Users/brent/table-stakes/.dream-loop/target.png'; ref['brief']='Stylized arcade street-food chef: puffy toque, expressive moustache, white jacket, red scarf, flame pants, chunky boots.'

# Bring the authored silhouette to the requested practical scale and capture the review angles.
arm.scale=(.86,.86,.86); arm['character_height_m']=1.90; arm['unit_scale']='1 Blender unit = 1 meter'; arm['forward_axis']='-Y'; arm['fps']=30; arm['root_motion']='in-place; move gameplay entity separately'
for label,loc in (('front',(2.25,-4.75,1.78)),('side',(4.75,-2.25,1.72)),('back',(-2.25,4.75,1.78))):
    cam.location=loc; point_at(cam,(0,0,1.02)); scene.camera=cam; scene.frame_set(1); scene.render.filepath=os.path.join(PREVIEW_DIR,'chef-blaze-'+label+'.png'); bpy.ops.render.render(write_still=True)

# Hide non-runtime collections for export selection.
for o in list(REF.objects)+list(COL.objects): o.select_set(False)
bpy.ops.object.select_all(action='DESELECT')
for o in list(GEO.objects)+list(RIG.objects):
    if o.type in {'MESH','ARMATURE'}: o.select_set(True)
bpy.context.view_layer.objects.active=arm
try:
    bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS', export_yup=True, export_apply=False)
except Exception as e:
    # Keep a usable GLB on older exporter builds with fewer keyword options.
    try: bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True, export_animations=True)
    except Exception as e2: print('GLB_EXPORT_ERROR', repr(e2))
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print('CHEF_BLAZE_DONE', BLEND, GLB, len(bpy.data.objects), [a.name for a in bpy.data.actions if a.name.startswith('ChefBlaze_')])
