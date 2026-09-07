"""Run inside Blender. Creates a new scene; does not edit existing scene objects.
Exported geometry uses simple glTF PBR materials; the harness adds tiled maps and lighting.
"""
import bpy, math, random, os
from mathutils import Vector
random.seed(17)
OUT=os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else '/Users/brent/Documents/Codex/2026-09-06/hlp/outputs/copper-and-thyme'
scene=bpy.data.scenes.new('Copper & Thyme · Restaurant')
bpy.context.window.scene=scene
M={}
def mat(name,color,metal=0,rough=.5,emit=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emit:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emit
 M[name]=m;return m
mat('Plaster',(0.73,.69,.58),rough=.86);mat('Brick',(0.72,.67,.55),rough=.85)
mat('Stone',(.4,.43,.41),rough=.8);mat('Grout',(.13,.16,.15),rough=.95)
mat('Oak',(.26,.115,.045),rough=.43);mat('OakLight',(.43,.245,.11),rough=.4)
mat('Walnut',(.10,.055,.026),rough=.45);mat('Forest',(.035,.15,.105),rough=.48)
mat('Brass',(.62,.36,.105),metal=.8,rough=.29);mat('Copper',(.58,.235,.08),metal=.82,rough=.28)
mat('Steel',(.48,.57,.57),metal=.86,rough=.28);mat('Black',(.019,.027,.027),metal=.25,rough=.5)
mat('Ceramic',(.88,.85,.74),rough=.23);mat('Linen',(.80,.74,.60),rough=.94)
mat('GlassGreen',(.06,.19,.095),metal=.3,rough=.17);mat('Wine',(.22,.024,.025),rough=.27)
mat('Leaf',(.12,.27,.055),rough=.67);mat('LeafLight',(.28,.40,.095),rough=.65)
mat('Soil',(.07,.045,.022),rough=1);mat('Terracotta',(.5,.22,.11),rough=.8)
mat('Tomato',(.68,.07,.025),rough=.35);mat('Bun',(.64,.30,.075),rough=.55)
mat('Cheese',(.95,.56,.045),rough=.5);mat('Patty',(.115,.041,.013),rough=.85)
mat('Skin',(.57,.32,.17),rough=.8);mat('Hair',(.05,.025,.012),rough=.9)
mat('Uniform',(.88,.87,.76),rough=.9);mat('Apron',(.045,.18,.14),rough=.9)
mat('Glow',(1,.65,.22),rough=.3,emit=3)
def finish(o,name,ma):
 o.name=name
 if ma:o.data.materials.append(M[ma])
 return o
def box(name,loc,scale,ma,bevel=.025):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=bevel;b.segments=3
  o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return finish(o,name,ma)
def uv(name,loc,scale,ma,seg=24):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=12,radius=1,location=loc);o=bpy.context.object;o.scale=scale
 for p in o.data.polygons:p.use_smooth=True
 return finish(o,name,ma)
def cyl(name,loc,r,depth,ma,r2=None):
 if r2 is None:bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=r,depth=depth,location=loc)
 else:bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=r,radius2=r2,depth=depth,location=loc)
 o=bpy.context.object
 for p in o.data.polygons:p.use_smooth=True
 b=o.modifiers.new('Edge highlight','BEVEL');b.width=.014;b.segments=2
 o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return finish(o,name,ma)
def rod(name,a,b,r,ma):
 a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,(b-a).length,ma);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def tor(name,loc,major,minor,ma,rot=None):
 bpy.ops.mesh.primitive_torus_add(major_segments=40,minor_segments=8,location=loc,major_radius=major,minor_radius=minor);o=bpy.context.object
 if rot:o.rotation_euler=rot
 for p in o.data.polygons:p.use_smooth=True
 return finish(o,name,ma)
def text(name,body,loc,size,ma,rot=(math.pi/2,0,0)):
 cu=bpy.data.curves.new(name,'FONT');cu.body=body;cu.align_x='CENTER';cu.size=size;cu.extrude=.002
 o=bpy.data.objects.new(name,cu);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=rot;cu.materials.append(M[ma]);return o
# Architectural platform and perimeter
box('Floating foundation',(0,0,-.3),(15.6,12,.6),'Walnut',.13)
box('Pavement',(0,0,.025),(15.5,11.9,.15),'Stone',.06)
box('Interior foundation',(0,0,.18),(14,10,.20),'Grout')
# Warm parquet dining room, individual staggered planks
for row in range(18):
 y=-4.8+row*.35
 for col in range(8):
  x=-6.6+col*1.8+(row%2)*.9
  if x>6.8:continue
  box('Parquet',(x,y,.303),(min(1.77,2*(7-x)),.332,.05),'OakLight' if random.random()<.35 else 'Oak',.006)
# Kitchen tile with real grout recesses
for i in range(20):
 for j in range(5):box('Kitchen tile',(-6.65+i*.7,1.75+j*.7,.315),(.685,.685,.065),'Stone',.007)
box('Back wall',(0,5,2.25),(14.35,.25,4.05),'Plaster',.03)
box('Left wall',(-7,0,2.25),(.25,10,4.05),'Plaster',.03)
# Brick coursing on left wall; shallow relief
for iz in range(23):
 for iy in range(17):
  y=-4.9+iy*.60+(iz%2)*.30
  if y<5:box('Limewashed brick',(-6.852,y,.4+iz*.17),(.035,.57,.145),'Brick',.006)
# Paneled back wall, copper rim
box('Back wainscot',(0,4.81,.94),(14,.11,1.2),'Forest')
for x in range(-6,7):
 box('Panel stile',(x,4.71,.95),(.05,.045,1.08),'Brass',.004)
box('Chair rail',(0,4.70,1.56),(14,.1,.065),'Walnut')
box('Back coping',(0,5,4.31),(14.5,.45,.16),'Walnut')
box('Left coping',(-7,0,4.31),(.45,10.3,.16),'Walnut')
# Cutaway front + right sill emphasizes a dollhouse
box('Front sill',(0,-5,.45),(14.3,.22,.25),'Plaster')
box('Right sill',(7,0,.45),(.22,10,.25),'Plaster')
for x in [-5.6,-2.9,0,2.9,5.6]:
 box('Front panel',(x,-5.06,.37),(2.4,.1,.25),'Forest',.01)
# Left tall window frames, dark glazing recess with mullions
for y in [-3.25,-.55,2.3]:
 box('Window recess',(-6.81,y,2.66),(.05,1.75,2.32),'Black')
 box('Window blue glass',(-6.77,y,2.66),(.02,1.60,2.17),'GlassGreen',0)
 for dy in [-.86,0,.86]:box('Window mullion',(-6.68,y+dy,2.66),(.14,.055,2.38),'Black',.01)
 for z in [1.49,2.28,3.1,3.84]:box('Window crossbar',(-6.68,y,z),(.14,1.8,.05),'Black',.005)
 box('Window ledge',(-6.57,y,1.46),(.42,2,.11),'Walnut')
# Kitchen line across back
for x in [-4.8,-2.7,-.6,1.5]:
 box('Kitchen cabinet',(x,3.98,.91),(2,1.45,1.20),'Forest',.035)
 box('Steel worktop',(x,3.93,1.55),(2.05,1.58,.13),'Steel')
 for dx in [-.49,.49]:
  box('Cabinet face',(x+dx,3.232,.93),(.93,.055,1.02),'Forest',.03)
  rod('Cabinet handle',(x+dx-.18,3.16,1.23),(x+dx+.18,3.16,1.23),.024,'Brass')
 for dx in [-.8,.8]:cyl('Adjustable foot',(x+dx,3.6,.37),.04,.2,'Steel')
# Range and overhead hood
box('Range body',(-4.65,3.9,1.10),(2.1,1.45,.8),'Steel')
box('Oven glass',(-4.65,3.16,.99),(1.52,.035,.45),'Black')
rod('Oven handle',(-5.32,3.10,1.30),(-3.98,3.10,1.30),.03,'Steel')
for x in [-5.2,-4.25]:
 for y in [3.55,4.2]:
  tor('Gas burner',(x,y,1.66),.24,.024,'Black')
  for a in range(4):
   t=a*math.pi/2;rod('Burner grate',(x+math.cos(t)*.08,y+math.sin(t)*.08,1.69),(x+math.cos(t)*.33,y+math.sin(t)*.33,1.69),.019,'Black')
for x in [-5.3,-4.85,-4.4,-3.95]:
 o=cyl('Control knob',(x,3.09,1.47),.07,.065,'Black');o.rotation_euler.x=math.pi/2
box('Extractor lip',(-4.65,4,3.18),(2.7,1.9,.18),'Copper',.07)
box('Extractor canopy',(-4.65,4.23,3.53),(2.25,1.37,.58),'Copper',.18)
box('Flue',(-4.65,4.65,4.02),(.8,.55,.56),'Copper')
for x in [-5.4,-4.65,-3.9]:box('Hood filter',(x,3.75,3.08),(.56,.95,.025),'Black',.01)
def pot(x,y,z,r=.27):
 cyl('Copper saucepan',(x,y,z+.17),r,.32,'Copper');cyl('Pot interior',(x,y,z+.34),r*.9,.012,'Black');tor('Rolled pot lip',(x,y,z+.34),r,.016,'Steel');rod('Pot handle',(x+r,y,z+.2),(x+r+.36,y,z+.22),.04,'Black')
pot(-5.2,4.2,1.7);pot(-4.25,3.55,1.7,.23)
# Ingredient station
for i,ma in enumerate(['Leaf','Tomato','Cheese','LeafLight']):
 x=-2.9+i*.47
 box('Gastronorm rim',(x,3.7,1.65),(.43,.62,.065),'Steel',.04)
 box('Ingredient well',(x,3.7,1.68),(.35,.53,.03),'Black',.02)
 for k in range(8):uv('Fresh ingredient',(x+random.uniform(-.12,.12),3.7+random.uniform(-.2,.2),1.73),(.08,.08,.04),ma,16)
# Sink and faucet
box('Sink inset',(.8,3.85,1.63),(1.15,.87,.04),'Black',.12)
box('Sink basin',(.8,3.85,1.64),(.98,.70,.045),'Steel',.12)
rod('Faucet upright',(.8,4.43,1.65),(.8,4.43,2.15),.035,'Steel');rod('Faucet spout',(.8,4.43,2.15),(.8,4.12,2.15),.035,'Steel')
# Tall double refrigerator
box('Fridge',(5.74,4.07,1.91),(1.65,1.53,3.14),'Steel',.08)
for x in [5.34,6.14]:
 box('Fridge door',(x,3.26,1.97),(.77,.085,2.89),'Steel',.035)
 rod('Fridge pull',(x-.2,3.17,1.70),(x-.2,3.17,2.35),.035,'Black')
# Back shelves, plates, jars and herbs
for z in [2.18,2.94,3.67]:
 box('Open shelf',(.35,4.5,z),(5.6,.60,.11),'Walnut')
 for x in [-2.15,2.85]:rod('Shelf bracket',(x,4.72,z-.26),(x,4.26,z),.025,'Brass')
 for i in range(11):
  x=-2.07+i*.48
  if i%3==0:
   for j in range(5):cyl('Stacked crockery',(x,4.40,z+.09+j*.04),.17,.03,'Ceramic')
  else:
   cyl('Pantry jar',(x,4.4,z+.24),.12,.32,'GlassGreen' if i%2 else 'Ceramic')
   cyl('Jar lid',(x,4.4,z+.41),.125,.05,'Brass')
# Service island separating dining and kitchen
box('Service island',(0,.9,.93),(6.3,1.28,1.25),'Forest',.06)
for x in [-2.7,-1.8,-.9,0,.9,1.8,2.7]:box('Island fluting',(x,.245,.95),(.045,.025,1.08),'Brass',.005)
box('Marble pass',(0,.9,1.62),(6.55,1.48,.16),'Ceramic',.055)
for x in [-2.85,2.85]:rod('Pass upright',(x,1.37,1.70),(x,1.37,2.58),.03,'Brass')
box('Pass shelf',(0,1.37,2.6),(6.4,.46,.07),'Brass')
for x in [-2,-.7,.7,2]:
 cyl('Heat lamp',(x,1.28,2.42),.21,.23,'Copper',.1);cyl('Heat lamp diffuser',(x,1.28,2.3),.18,.015,'Glow')
# Plate and layered burger detail
def plate(x,y,z):
 cyl('Porcelain plate',(x,y,z),.29,.035,'Ceramic');tor('Plate rim',(x,y,z+.022),.265,.016,'Ceramic')
def burger(x,y,z):
 plate(x,y,z);cyl('Bun heel',(x,y,z+.07),.19,.08,'Bun');uv('Lettuce frill',(x,y,z+.12),(.215,.21,.035),'LeafLight')
 cyl('Seared patty',(x,y,z+.16),.19,.075,'Patty');o=box('Cheddar',(x,y,z+.205),(.35,.35,.025),'Cheese',.01);o.rotation_euler.z=.4
 uv('Brioche crown',(x,y,z+.25),(.195,.195,.095),'Bun')
 for k in range(14):
  a=random.random()*math.tau;r=random.random()*.15;uv('Sesame',(x+math.cos(a)*r,y+math.sin(a)*r,z+.32-r*.14),(.012,.005,.004),'Ceramic',12)
for x in [-1.7,0,1.7]:burger(x,.7,1.73)
# Dining: sculpted bentwood chairs and linen runners
def chair(x,y,angle):
 parts=set(scene.objects)
 for dx in [-.22,.22]:
  for dy in [-.2,.2]:rod('Chair leg',(x+dx*1.15,y+dy*1.15,.34),(x+dx,y+dy,.94),.035,'Walnut')
 box('Seat cushion',(x,y,1.00),(.62,.60,.16),'Forest',.08)
 box('Curved upholstered back',(x,y+.255,1.39),(.65,.13,.62),'Forest',.09)
 for dx in [-.31,.31]:rod('Back upright',(x+dx,y+.24,.84),(x+dx,y+.24,1.72),.026,'Brass')
 for o in set(scene.objects)-parts:
  p=o.location-Vector((x,y,0));p.rotate(__import__('mathutils').Matrix.Rotation(angle,3,'Z'));o.location=Vector((x,y,0))+p;o.rotation_euler.z+=angle
for idx,(x,y) in enumerate([(-4.3,-2.7),(-1.45,-2.6),(1.6,-2.7),(4.55,-2.5)]):
 box('Bistro tabletop',(x,y,1.35),(1.8,1.4,.13),'OakLight',.08)
 cyl('Table pedestal',(x,y,.85),.09,.9,'Brass');cyl('Table foot',(x,y,.37),.45,.07,'Black')
 box('Linen runner',(x,y,1.423),(.70,1.40,.015),'Linen',.008)
 for dy in [-.38,.38]:
  plate(x,y+dy,1.45)
  rod('Silver fork',(x-.38,y+dy-.12,1.45),(x-.38,y+dy+.12,1.45),.01,'Steel')
  rod('Silver knife',(x+.37,y+dy-.12,1.45),(x+.37,y+dy+.12,1.45),.012,'Steel')
  cyl('Wine stem',(x+.55,y+dy,1.54),.012,.18,'Brass');uv('Wine goblet',(x+.55,y+dy,1.66),(.08,.08,.10),'GlassGreen')
 cyl('Bud vase',(x,y,1.54),.055,.18,'Terracotta');rod('Flower stem',(x,y,1.62),(x+.04,y,1.88),.007,'Leaf');uv('Flower',(x+.04,y,1.88),(.075,.065,.04),'Cheese')
 chair(x,y-.99,math.pi);chair(x,y+.99,0)
# Wall identity plaque
box('Identity plaque',(3.65,4.78,3.07),(1.45,.10,1.02),'Forest')
text('Logo','C & T',(3.65,4.715,3.12),.30,'Brass');text('Logo sub','EST. 2026',(3.65,4.71,2.85),.095,'Ceramic')
# Pendants with rounded copper shades
for x in [-4.3,-1.45,1.6,4.55]:
 rod('Pendant cable',(x,-2.6,3.08),(x,-2.6,4.8),.012,'Black')
 cyl('Pendant shade',(x,-2.6,3.15),.35,.34,'Copper',.12)
 tor('Shade hem',(x,-2.6,2.99),.35,.018,'Brass');uv('Warm bulb',(x,-2.6,3.04),(.13,.13,.13),'Glow')
# Botanical details: curved leaf mesh, many leaves per plant
leafmesh=bpy.data.meshes.new('Botanical leaf');leafmesh.from_pydata([(0,0,0),(.12,.15,.025),(.08,.34,.0),(0,.46,.06),(-.08,.34,0),(-.12,.15,.025),(0,.22,.065)],[],[(0,1,6),(1,2,6),(2,3,6),(3,4,6),(4,5,6),(5,0,6)]);leafmesh.update()
def plant(x,y,z,s=1):
 cyl('Planter',(x,y,z+.22*s),.24*s,.44*s,'Terracotta',.32*s);cyl('Potting soil',(x,y,z+.445*s),.29*s,.015,'Soil')
 for k in range(24):
  a=k*2.4;h=random.uniform(.3,.95)*s
  tip=(x+math.cos(a)*.19*s,y+math.sin(a)*.19*s,z+.44*s+h)
  rod('Botanical stem',(x,y,z+.44*s),tip,.009*s,'Leaf')
  o=bpy.data.objects.new('Botanical leaf',leafmesh.copy());scene.collection.objects.link(o);o.location=tip;o.rotation_euler=(random.uniform(.3,1.3),0,a);o.scale=(s,s,s);o.data.materials.append(M['LeafLight' if k%3==0 else 'Leaf'])
for x,y,s in [(-6.1,-4.1,1.1),(6.15,-4.1,1.1),(-6,1.1,.85),(3.8,4,.55)]:plant(x,y,.34,s)
for x in [-5.5,-2.8,0,2.8,5.5]:
 box('Street planter',(x,-5.56,.42),(1.65,.65,.45),'Stone',.05)
 for dx in [-.5,0,.5]:plant(x+dx,-5.56,.57,.44)
# Rounded arcade chef + patrons, separate named roots for animation
characters=[]
def person(name,x,y,z=0,angle=0,chef=False,shirt='Apron'):
 before=set(scene.objects)
 for dx in [-.13,.13]:
  box('Shoe',(x+dx,y-.065,z+.42),(.20,.35,.17),'Black',.06)
  rod('Trouser leg',(x+dx,y,z+.47),(x+dx,y,z+.92),.10,'Black')
 uv('Torso',(x,y,z+1.12),(.29,.19,.37),'Uniform' if chef else shirt)
 box('Apron bib',(x,y-.18,z+1.10),(.36,.04,.45),'Apron',.06)
 uv('Head',(x,y,z+1.63),(.19,.18,.235),'Skin')
 uv('Nose',(x,y-.18,z+1.63),(.05,.05,.06),'Skin')
 for dx in [-.07,.07]:uv('Eyes',(x+dx,y-.165,z+1.69),(.018,.012,.022),'Black',12)
 if chef:
  cyl('Chef hat band',(x,y,z+1.84),.195,.13,'Uniform')
  for dx,dy in [(-.1,0),(.1,0),(0,.08),(0,-.08)]:uv('Chef toque',(x+dx,y+dy,z+1.97),(.14,.14,.16),'Uniform')
 else:uv('Hair',(x,y+.015,z+1.80),(.2,.18,.10),'Hair')
 for dx in [-.30,.30]:
  rod('Upper sleeve',(x+dx*.8,y,z+1.33),(x+dx*1.2,y-.07,z+1.06),.085,'Uniform' if chef else shirt)
  rod('Forearm',(x+dx*1.2,y-.07,z+1.06),(x+dx,y-.29,z+1.08),.06,'Skin')
 root=bpy.data.objects.new(name,None);scene.collection.objects.link(root);root.location=(x,y,z)
 bpy.context.view_layer.update()
 for o in set(scene.objects)-before-{root}:
  o.parent=root;o.matrix_parent_inverse=root.matrix_world.inverted()
 root.rotation_euler.z=angle;characters.append(root)
person('Chef',-4.7,2.45,chef=True,angle=math.pi)
person('Server',3.9,.30,chef=False,angle=-.3)
person('Guest',-4.3,-3.75,z=-.05,angle=math.pi,shirt='Wine')
# Blender camera and lighting for editable source
world=bpy.data.worlds.new('Restaurant daylight');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.36,.46,.57,1);world.node_tree.nodes['Background'].inputs[1].default_value=.4
ld=bpy.data.lights.new('Afternoon sun','AREA');lo=bpy.data.objects.new('Afternoon sun',ld);scene.collection.objects.link(lo);lo.location=(-3,-4,12);ld.energy=2300;ld.size=7;lo.rotation_euler=(Vector((0,0,0))-lo.location).to_track_quat('-Z','Y').to_euler()
for x in [-4.3,-1.45,1.6,4.55]:
 ld=bpy.data.lights.new('Pendant warmth','POINT');ld.energy=40;ld.color=(1,.65,.3);ld.shadow_soft_size=.4;lo=bpy.data.objects.new('Pendant warmth',ld);scene.collection.objects.link(lo);lo.location=(x,-2.6,2.95)
bpy.ops.object.camera_add(location=(17,-23,20));cam=bpy.context.object;cam.name='Dollhouse Camera';cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=22;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True;scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
# Consolidate static geometry per material, preserving individual character roots.
# This converts bevels to mesh before joining so the GLB keeps the edge highlights.
bpy.ops.object.select_all(action='DESELECT')
static=[o for o in scene.objects if o.type in {'MESH','FONT'} and o.parent is None]
for o in static:o.select_set(True)
bpy.context.view_layer.objects.active=static[0];bpy.ops.object.convert(target='MESH')
for ma in list(M.values()):
 objects=[o for o in scene.objects if o.type=='MESH' and o.parent is None and len(o.data.materials) and o.data.materials[0]==ma]
 if not objects:continue
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name='Architecture_'+ma.name
# Convert character bevels then join each character into one multi-material mesh
for root in characters:
 children=list(root.children);bpy.ops.object.select_all(action='DESELECT')
 for o in children:o.select_set(True)
 bpy.context.view_layer.objects.active=children[0];bpy.ops.object.convert(target='MESH');bpy.ops.object.join();children[0].name=root.name+'_Mesh'
os.makedirs(OUT+'/public/models',exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
 if o.type not in {'LIGHT','CAMERA'}:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT+'/public/models/restaurant.glb',export_format='GLB',use_selection=True,export_apply=True,export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/restaurant.blend',copy=True)
result={'scene':scene.name,'objects':len(scene.objects),'polygons':sum(len(o.data.polygons) for o in scene.objects if o.type=='MESH'),'glb':OUT+'/public/models/restaurant.glb'}
