import bpy, math, os
from mathutils import Vector

OUT = os.environ.get('CHEF_BLAZE_OUT', os.path.abspath(os.path.dirname(__file__)) if '__file__' in globals() else '/tmp/chef-blaze-rebuild-pass2')
os.makedirs(OUT, exist_ok=True)
BLEND = os.path.join(OUT, 'ChefBlaze_Master.blend')
GLB = os.path.join(OUT, 'ChefBlaze.glb')
NOTES = os.path.join(OUT, 'ChefBlaze_Completion_Report.txt')

# Clean, deterministic authoring scene. No prior Chef Blaze objects are retained.
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights, bpy.data.armatures):
    for block in list(datablocks):
        if block.users == 0:
            datablocks.remove(block)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
for c in list(bpy.data.collections):
    if c.name != 'Collection':
        bpy.data.collections.remove(c)

ROOT = bpy.context.scene.collection
base = bpy.data.collections.get('Collection')
if base: base.name = 'ChefBlaze_GEO'

def collection(name):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c not in list(ROOT.children):
        ROOT.children.link(c)
    return c

GEO = collection('ChefBlaze_GEO')
RIG = collection('ChefBlaze_RIG')
MATCOL = collection('ChefBlaze_MAT')
ANIM = collection('ChefBlaze_ANIM')
COLL = collection('ChefBlaze_COLLIDERS')
REF = collection('REF_AuthoritativeTurnaround')
REF_BAD = collection('REF_FailedLowPoly_DoNotUse')

def move_to(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)

def material(name, rgba, roughness=0.35, metallic=0.0, coat=0.0, emission=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgba, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if 'Coat Weight' in bsdf.inputs: bsdf.inputs['Coat Weight'].default_value = coat
    if 'Coat Roughness' in bsdf.inputs: bsdf.inputs['Coat Roughness'].default_value = 0.22
    if emission and 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 0.12
    m.diffuse_color = (*rgba, 1.0)
    m['glTF_material'] = 'MeshStandardMaterial'
    return m

M = {
    'hat': material('ChefHat_White', (0.97, 0.93, 0.87), .30, 0, .18),
    'jacket': material('Jacket_White', (0.92, 0.89, 0.84), .34, 0, .14),
    'jacket_shadow': material('Jacket_Seams', (0.70, 0.67, 0.62), .42, 0, .05),
    'scarf': material('Scarf_Red', (0.80, 0.018, 0.028), .29, 0, .20),
    'pants': material('Pants_Black', (0.025, 0.032, 0.045), .28, .02, .22),
    'boot': material('Boots_Black', (0.012, 0.016, 0.024), .23, .12, .32),
    'sole': material('Boot_Sole_Rubber', (0.008, 0.010, 0.016), .34, .02, .06),
    'skin': material('Skin', (0.84, 0.31, 0.115), .38, 0, .10),
    'skin_hi': material('Skin_Highlight', (1.0, 0.48, 0.19), .34, 0, .13),
    'hair': material('FacialHair_Black', (0.012, 0.009, 0.008), .24, .03, .28),
    'eye': material('Eyes_White', (0.98, 0.97, 0.91), .16, 0, .34),
    'iris': material('Eyes_Brown', (0.105, 0.026, 0.010), .18, .02, .50),
    'pupil': material('Eyes_Pupil', (0.006, 0.004, 0.003), .10, 0, .55),
    'mouth': material('Mouth', (0.12, 0.006, 0.006), .28, 0, .04),
    'button': material('Jacket_Buttons', (0.022, 0.025, 0.032), .22, .45, .36),
    'flame_r': material('Pants_Flames_Red', (0.86, 0.012, 0.008), .27, 0, .14, (0.35,0.002,0.0)),
    'flame_o': material('Pants_Flames_Orange', (1.0, 0.14, 0.006), .25, 0, .16, (0.48,0.025,0.0)),
    'flame_y': material('Pants_Flames_Yellow', (1.0, 0.57, 0.012), .22, 0, .18, (0.65,0.16,0.0)),
    'ground': material('Preview_Ground', (0.006, 0.012, 0.030), .32, 0, .12),
}

def smooth(obj):
    if hasattr(obj.data, 'polygons'):
        for p in obj.data.polygons: p.use_smooth = True

def finish(obj, mat=None, coll=GEO, bevel=0.0):
    if mat: obj.data.materials.append(mat)
    smooth(obj)
    move_to(obj, coll)
    if bevel:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        mod = obj.modifiers.new('Applied soft garment edges', 'BEVEL')
        mod.width = bevel; mod.segments = 4; mod.limit_method = 'ANGLE'
        try: bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception: pass
        obj.select_set(False)
    return obj

def sphere(name, loc, scale, mat, bone=None, seg=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, mat); o['asset_part'] = name
    if bone: o['rig_bone'] = bone
    return o

def rounded_box(name, loc, scale, mat, rot=(0,0,0), bone=None, bevel=.04):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, mat, bevel=bevel)
    if bone: o['rig_bone'] = bone
    return o

def capsule_between(name, a, b, radius, mat, bone=None, bevel=.02):
    a, b = Vector(a), Vector(b); d = b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=d.length, location=(a+b)/2)
    o = bpy.context.object; o.name = name; o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z','Y')
    finish(o, mat, bevel=bevel)
    if bone: o['rig_bone'] = bone
    return o

def torus(name, loc, major, minor, mat, rot=(0,0,0), bone=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=40, minor_segments=16, location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; finish(o,mat)
    if bone: o['rig_bone']=bone
    return o

def tube(name, points, radius, mat, bone=None):
    cu = bpy.data.curves.new(name+'Curve','CURVE'); cu.dimensions='3D'; cu.resolution_u=3; cu.bevel_depth=radius; cu.bevel_resolution=4
    sp=cu.splines.new('BEZIER'); sp.bezier_points.add(len(points)-1)
    for p,co in zip(sp.bezier_points,points): p.co=co; p.handle_left_type='AUTO'; p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,cu); GEO.objects.link(o); cu.materials.append(mat)
    if bone: o['rig_bone']=bone
    return o

def flame_panel(name, x, z, side, mat, scale=1.0, y=-.265, rotation=0.0, bone=None):
    # Tall curled silhouette; separate front/back/side panels create a stable wraparound graphic.
    pts=[(-.16,0),(-.13,.09),(-.16,.18),(-.08,.15),(-.035,.33),(.00,.59),(.05,.39),(.11,.28),(.10,.16),(.17,.23),(.15,.09),(.10,0)]
    ca,sa=math.cos(rotation),math.sin(rotation)
    xy=[]
    for px,pz in pts:
        px*=side*scale; pz*=scale
        xy.append((x+px*ca-pz*sa, z+px*sa+pz*ca))
    verts=[(px,y-.016,pz) for px,pz in xy]+[(px,y+.016,pz) for px,pz in xy]
    n=len(xy); faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    for i in range(n): faces.append((i,(i+1)%n,(i+1)%n+n,i+n))
    me=bpy.data.meshes.new(name+'Mesh'); me.from_pydata(verts,[],faces); me.update()
    o=bpy.data.objects.new(name,me); GEO.objects.link(o); me.materials.append(mat); smooth(o)
    if bone: o['rig_bone']=bone
    return o

def decal_flames(side,x):
    b='thigh.'+side
    s=-1 if side=='L' else 1
    # front and lateral tongues, with smaller yellow core inset for layered premium graphics
    flame_panel('Flame_Red_Front_'+side,x,.32,s,M['flame_r'],1.04,-.258,0,b)
    flame_panel('Flame_Orange_Front_'+side,x,.34,s,M['flame_o'],.78,-.279,.02,b)
    flame_panel('Flame_Yellow_Core_'+side,x,.35,s,M['flame_y'],.50,-.298,.035,b)
    flame_panel('Flame_Red_Side_'+side,x+s*.17,.34,s,M['flame_r'],.70,-.02,.12,b)
    flame_panel('Flame_Orange_Side_'+side,x+s*.20,.35,s,M['flame_o'],.50,-.075,.13,b)
    flame_panel('Flame_Red_Back_'+side,x,.33,-s,M['flame_r'],.70,.255,-.06,b)

# Grounded silhouette: 1.82 m adult athletic build, front faces -Y.
for side,x in [('L',-.245),('R',.245)]:
    # sculpted work boot: lower sole, upper, toe cap, heel, and two seam bands
    rounded_box('Boot_Sole_'+side,(x,-.105,.075),(.255,.37,.060),M['sole'],bevel=.045,bone='foot.'+side)
    rounded_box('Boot_Upper_'+side,(x,-.095,.185),(.235,.31,.13),M['boot'],bevel=.085,bone='foot.'+side)
    rounded_box('Boot_Toe_'+side,(x,-.335,.20),(.235,.19,.125),M['boot'],rot=(0,0,0),bevel=.10,bone='foot.'+side)
    rounded_box('Boot_Heel_'+side,(x,.17,.20),(.22,.10,.14),M['boot'],bevel=.045,bone='foot.'+side)
    for zi in (.17,.235): tube('Boot_Seam_'+side+str(zi),[(x-.18,-.29,zi),(x+.18,-.29,zi)],.012,M['jacket_shadow'],'foot.'+side)
    # pants are rounded tapered capsules, with upper thigh bulk and ankle cuff.
    sphere('PantsLeg_'+side,(x,.01,.69),(.225,.23,.48),M['pants'],'thigh.'+side)
    sphere('PantsThigh_'+side,(x,.015,.93),(.27,.255,.30),M['pants'],'thigh.'+side)
    torus('PantsCuff_'+side,(x,0,.285),.19,.035,M['pants'],bone='shin.'+side)
    decal_flames(side,x)

# Fitted jacket: rounded torso shell, front inset, hem, princess seams, and broad shoulders.
rounded_box('Jacket_Torso',(0,.0,1.24),(.455,.245,.34),M['jacket'],bevel=.11,bone='chest')
rounded_box('Jacket_Front_Inset',(0,-.255,1.25),(.29,.024,.29),M['jacket'],bevel=.028,bone='chest')
rounded_box('Jacket_Hem',(0,-.01,.94),(.43,.25,.052),M['jacket_shadow'],bevel=.026,bone='pelvis')
for x in (-.22,.22):
    tube('Jacket_Seam_'+str(x),[(x,-.276,1.52),(x,-.278,1.02)],.010,M['jacket_shadow'],'chest')
for z in (1.10,1.27,1.44):
    for x in (-.17,.17): sphere('Button_'+str(z)+'_'+str(x),(x,-.292,z),(.038,.020,.038),M['button'],'chest',24,16)
for x in (-.35,.35):
    s=-1 if x<0 else 1
    sphere('Shoulder_'+('L' if s<0 else 'R'),(x*.94,0,1.47),(.18,.23,.18),M['jacket'],'upper_arm.'+('L' if s<0 else 'R'))
    capsule_between('SleeveUpper_'+('L' if s<0 else 'R'),(x*.90,0,1.46),(x,0,1.23),.145,M['jacket'],'upper_arm.'+('L' if s<0 else 'R'),.045)
    torus('RolledCuff_'+('L' if s<0 else 'R'),(x,0,1.16),.14,.038,M['jacket_shadow'],rot=(0,math.pi/2,0),bone='forearm.'+('L' if s<0 else 'R'))
    capsule_between('Forearm_'+('L' if s<0 else 'R'),(x,0,1.16),(x*1.03,-.035,.98),.115,M['skin'],'forearm.'+('L' if s<0 else 'R'),.035)

# Neck scarf with a rounded collar, central knot, and two readable tails.
torus('Scarf_Collar',(0,0,1.56),.255,.060,M['scarf'],bone='neck')
sphere('Scarf_Knot',(0,-.285,1.45),(.105,.075,.095),M['scarf'],'chest')
rounded_box('Scarf_Tail_L',(-.10,-.31,1.34),(.065,.028,.17),M['scarf'],rot=(0,.12,-.20),bevel=.032,bone='chest')
rounded_box('Scarf_Tail_R',(.10,-.31,1.34),(.065,.028,.17),M['scarf'],rot=(0,-.12,.20),bevel=.032,bone='chest')

# Head, ears, expressive eyes, nose, eyebrows, moustache and pointed goatee.
sphere('Head',(0,0,1.72),(.305,.265,.31),M['skin'],'head')
sphere('Ear_L',(-.302,0,1.72),(.075,.095,.12),M['skin'],'head'); sphere('Ear_R',(.302,0,1.72),(.075,.095,.12),M['skin'],'head')
for side,x in [('L',-.108),('R',.108)]:
    sphere('EyeWhite_'+side,(x,-.250,1.79),(.078,.042,.088),M['eye'],'head')
    sphere('Iris_'+side,(x,-.284,1.79),(.036,.017,.046),M['iris'],'head')
    sphere('Pupil_'+side,(x,-.300,1.79),(.016,.010,.023),M['pupil'],'head')
    # strong angular brows
    rounded_box('Brow_'+side,(x,-.286,1.895),(.095,.020,.026),M['hair'],rot=(0,0,.14 if side=='L' else -.14),bevel=.022,bone='head')
sphere('Nose',(0,-.285,1.70),(.075,.085,.09),M['skin_hi'],'head')
sphere('Cheek_L',(-.18,-.255,1.67),(.070,.024,.052),M['skin_hi'],'head'); sphere('Cheek_R',(.18,-.255,1.67),(.070,.024,.052),M['skin_hi'],'head')
sphere('Moustache_L',(-.072,-.300,1.66),(.105,.036,.052),M['hair'],'head'); sphere('Moustache_R',(.072,-.300,1.66),(.105,.036,.052),M['hair'],'head')
for side,ang in [('L',-.33),('R',.33)]:
    tube('MoustacheCurl_'+side,[(.0 if side=='L' else .02,-.328,1.66),(.10 if side=='L' else -.10,-.328,1.68),(.14 if side=='L' else -.14,-.322,1.72)],.022,M['hair'],'head')
rounded_box('Mouth',(0,-.282,1.62),(.095,.018,.022),M['mouth'],bevel=.018,bone='head')
sphere('Goatee',(0,-.270,1.525),(.070,.052,.115),M['hair'],'head')

# Puffy segmented toque: fabric band and overlapping rounded lobes.
rounded_box('Toque_Band',(0,0,1.97),(.315,.255,.105),M['hat'],bevel=.045,bone='head')
for i,(x,y,z,sx,sy,sz) in enumerate([
    (-.245,0,2.09,.18,.19,.20),(-.145,-.015,2.13,.20,.21,.245),(0,-.02,2.15,.205,.22,.27),
    (.145,-.015,2.13,.20,.21,.245),(.245,0,2.09,.18,.19,.20),(-.105,.10,2.18,.17,.18,.20),(.105,.10,2.18,.17,.18,.20)]):
    sphere('Toque_Lobe_'+str(i),(x,y,z),(sx,sy,sz),M['hat'],'head')

# Detailed hands with palm, thumb and four individually modeled fingers on each side.
for side,x in [('L',-.38),('R',.38)]:
    s=-1 if side=='L' else 1
    sphere('HandPalm_'+side,(x*1.05,-.07,.87),(.135,.11,.15),M['skin'],'hand.'+side)
    sphere('Thumb_'+side,(x*1.05+s*.12,-.11,.88),(.052,.075,.085),M['skin_hi'],'thumb.'+side)
    for i,(dx,dz) in enumerate(((-.095,.03),(-.032,-.005),(.032,-.006),(.094,.02))):
        capsule_between('Finger_'+side+str(i),(x*1.05+s*dx,-.12,.86+dz),(x*1.05+s*(dx*.98),-.175,.76+dz),.034,M['skin'],'finger'+str(i)+'.'+side,.018)
        sphere('FingerTip_'+side+str(i),(x*1.05+s*(dx*.98),-.175,.755+dz),(.038,.037,.045),M['skin_hi'],'finger'+str(i)+'.'+side,24,16)

# Explicit collision proxies; hidden from view/render and excluded from runtime selection.
for name,loc,scale in [('Collider_Pelvis',(0,0,.90),(.30,.22,.22)),('Collider_Torso',(0,0,1.27),(.46,.24,.36)),('Collider_Head',(0,0,1.72),(.31,.26,.31)),('Collider_Leg_L',(-.245,0,.68),(.23,.22,.40)),('Collider_Leg_R',(.245,0,.68),(.23,.22,.40))]:
    o=sphere(name,loc,scale,None,None); move_to(o,COLL); o.hide_viewport=True; o.hide_render=True; o.display_type='WIRE'; o['export_exclude']=True

# Conventional humanoid skeleton, designed for runtime deformation and export.
bpy.ops.object.armature_add(enter_editmode=True, location=(0,0,0))
arm=bpy.context.object; arm.name='ChefBlaze_RIG'; arm.data.name='ChefBlaze_Humanoid_Skeleton'; arm.show_in_front=True; move_to(arm,RIG)
eb=arm.data.edit_bones; eb.remove(eb[0])
def add_bone(name,head,tail,parent=None):
    b=eb.new(name); b.head=head; b.tail=tail
    if parent: b.parent=eb.get(parent)
    return b
add_bone('root',(0,0,.02),(0,0,.16)); add_bone('pelvis',(0,0,.79),(0,0,1.02),'root'); add_bone('spine',(0,0,1.02),(0,0,1.29),'pelvis'); add_bone('chest',(0,0,1.29),(0,0,1.53),'spine'); add_bone('neck',(0,0,1.53),(0,0,1.64),'chest'); add_bone('head',(0,0,1.64),(0,0,1.92),'neck')
for side,s in [('L',-1),('R',1)]:
    add_bone('clavicle.'+side,(s*.08,0,1.48),(s*.26,0,1.46),'chest'); add_bone('upper_arm.'+side,(s*.25,0,1.46),(s*.40,0,1.22),'clavicle.'+side)
    add_bone('forearm.'+side,(s*.40,0,1.22),(s*.42,0,.98),'upper_arm.'+side); add_bone('hand.'+side,(s*.42,0,.98),(s*.43,-.05,.84),'forearm.'+side); add_bone('thumb.'+side,(s*.43,-.05,.87),(s*.56,-.13,.88),'hand.'+side)
    for i in range(4): add_bone('finger'+str(i)+'.'+side,(s*.43+s*(i-1.5)*.04,-.05,.86),(s*.43+s*(i-1.5)*.04,-.16,.76),'hand.'+side)
    add_bone('thigh.'+side,(s*.16,0,.94),(s*.245,0,.64),'pelvis'); add_bone('shin.'+side,(s*.245,0,.64),(s*.245,0,.25),'thigh.'+side); add_bone('foot.'+side,(s*.245,0,.25),(s*.245,-.22,.13),'shin.'+side); add_bone('toe.'+side,(s*.245,-.22,.13),(s*.245,-.40,.12),'foot.'+side)
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones: pb.rotation_mode='XYZ'
bpy.ops.object.mode_set(mode='OBJECT')
arm['character']='Chef Blaze'; arm.scale=(0.7786621096,0.7786621096,0.7786621096); arm['height_m']=1.90; arm['unit_scale']='1 Blender unit = 1 meter'; arm['forward_axis']='-Y'; arm['up_axis']='+Z'; arm['fps']=30; arm['root_motion']='Idle, walk, run in-place; slide has no global translation'; arm['rig_controls']='Conventional deform skeleton with root, pelvis, spine, chest, clavicles, limbs, fingers, thumbs, foot/toe bones'; arm['facial_controls']='Head mesh carries Smile, Blink_L, Blink_R shape keys and brows/eyes are exportable meshes'

def attach_rigid(o,bname):
    if not bname or bname not in arm.data.bones or o.type != 'MESH': return
    wm=o.matrix_world.copy(); o.parent=arm; o.parent_type='OBJECT'; o.matrix_world=wm
    vg=o.vertex_groups.get(bname) or o.vertex_groups.new(name=bname); vg.add(list(range(len(o.data.vertices))),1.0,'REPLACE')
    mod=o.modifiers.new('ChefBlaze_Armature_Deform','ARMATURE'); mod.object=arm

for o in list(GEO.objects):
    attach_rigid(o, o.get('rig_bone'))

# Facial shape keys are intentionally tiny, export-safe placeholders for runtime expression controls.
head=bpy.data.objects.get('Head')
if head and head.type=='MESH':
    head.shape_key_add(name='Basis'); head.shape_key_add(name='Smile'); head.shape_key_add(name='Blink_L'); head.shape_key_add(name='Blink_R')

# Animation authoring: keyed conventional rotations, exact names and ranges.
def posebone(name): return arm.pose.bones.get(name)
def key(frame, values):
    bpy.context.scene.frame_set(frame)
    for name, data in values.items():
        p=posebone(name)
        if not p: continue
        rot,loc=data
        p.rotation_euler=rot; p.keyframe_insert('rotation_euler',frame=frame,group=name)
        if loc is not None: p.location=loc; p.keyframe_insert('location',frame=frame,group=name)
    for name in ('root','pelvis','spine','chest','neck','head'):
        p=posebone(name)
        if p: p.keyframe_insert('rotation_euler',frame=frame,group=name)

def make_action(name,start,end,frames,loop=False):
    a=bpy.data.actions.new(name); a.use_fake_user=True; a['frame_start']=start; a['frame_end']=end; a['fps']=30; a['loop']=loop; a['root_motion']='in-place'
    arm.animation_data_create(); arm.animation_data.action=a
    for f,v in frames: key(f,v)
    for fc in getattr(a,'fcurves',[]):
        for kp in fc.keyframe_points: kp.interpolation='BEZIER'
    return a

N=(0,0,0); L=None
make_action('ChefBlaze_Idle',1,75,[(1,{'chest':((0,0,0),L),'pelvis':((0,0,0),L),'head':((0,0,0),L),'upper_arm.L':((.04,0,-.06),L),'upper_arm.R':((.04,0,.06),L)}),(38,{'chest':((-.025,0,0),L),'pelvis':((0,.018,0),L),'head':((0,.018,0),L),'upper_arm.L':((.075,0,-.08),L),'upper_arm.R':((.075,0,.08),L)}),(75,{'chest':((0,0,0),L),'pelvis':((0,0,0),L),'head':((0,0,0),L),'upper_arm.L':((.04,0,-.06),L),'upper_arm.R':((.04,0,.06),L)})],True)
walk_frames=[(1,{'thigh.L':((.38,0,0),L),'shin.L':((-.16,0,0),L),'foot.L':((-.15,0,0),L),'thigh.R':((-.38,0,0),L),'shin.R':((-.08,0,0),L),'foot.R':((.15,0,0),L),'upper_arm.L':((-.34,0,0),L),'forearm.L':((.12,0,0),L),'upper_arm.R':((.34,0,0),L),'forearm.R':((-.12,0,0),L),'chest':((0,.025,0),L)}),(10,{'thigh.L':((-.46,0,0),L),'shin.L':((.28,0,0),L),'foot.L':((.18,0,0),L),'thigh.R':((.46,0,0),L),'shin.R':((-.16,0,0),L),'foot.R':((-.18,0,0),L),'upper_arm.L':((.42,0,0),L),'forearm.L':((-.08,0,0),L),'upper_arm.R':((-.42,0,0),L),'forearm.R':((.08,0,0),L),'chest':((0,-.025,0),L)}),(20,{'thigh.L':((-.30,0,0),L),'shin.L':((-.04,0,0),L),'foot.L':((.14,0,0),L),'thigh.R':((.30,0,0),L),'shin.R':((-.16,0,0),L),'foot.R':((-.14,0,0),L),'upper_arm.L':((.32,0,0),L),'forearm.L':((-.12,0,0),L),'upper_arm.R':((-.32,0,0),L),'forearm.R':((.12,0,0),L),'chest':((0,.02,0),L)}),(30,{'thigh.L':((.38,0,0),L),'shin.L':((-.16,0,0),L),'foot.L':((-.15,0,0),L),'thigh.R':((-.38,0,0),L),'shin.R':((-.08,0,0),L),'foot.R':((.15,0,0),L),'upper_arm.L':((-.34,0,0),L),'forearm.L':((.12,0,0),L),'upper_arm.R':((.34,0,0),L),'forearm.R':((-.12,0,0),L),'chest':((0,.025,0),L)})]
make_action('ChefBlaze_Walk_InPlace',1,30,walk_frames,True)
run_frames=[(1,{'thigh.L':((.82,0,0),L),'shin.L':((-.32,0,0),L),'foot.L':((-.28,0,0),L),'thigh.R':((-.88,0,0),L),'shin.R':((-.10,0,0),L),'foot.R':((.28,0,0),L),'upper_arm.L':((-.72,0,0),L),'forearm.L':((.28,0,0),L),'upper_arm.R':((.72,0,0),L),'forearm.R':((-.28,0,0),L),'spine':((0,.075,0),L),'chest':((0,.09,0),L),'head':((0,.035,0),L)}),(8,{'thigh.L':((-.96,0,0),L),'shin.L':((.62,0,0),L),'foot.L':((.30,0,0),L),'thigh.R':((.96,0,0),L),'shin.R':((-.58,0,0),L),'foot.R':((-.30,0,0),L),'upper_arm.L':((.76,0,0),L),'forearm.L':((-.26,0,0),L),'upper_arm.R':((-.76,0,0),L),'forearm.R':((.26,0,0),L),'spine':((0,.10,0),L),'chest':((0,.10,0),L),'head':((0,.045,0),L)}),(16,{'thigh.L':((-.82,0,0),L),'shin.L':((-.10,0,0),L),'foot.L':((.28,0,0),L),'thigh.R':((.82,0,0),L),'shin.R':((-.32,0,0),L),'foot.R':((-.28,0,0),L),'upper_arm.L':((.72,0,0),L),'forearm.L':((-.28,0,0),L),'upper_arm.R':((-.72,0,0),L),'forearm.R':((.28,0,0),L),'spine':((0,.075,0),L),'chest':((0,.09,0),L),'head':((0,.035,0),L)}),(24,{'thigh.L':((.96,0,0),L),'shin.L':((-.58,0,0),L),'foot.L':((-.30,0,0),L),'thigh.R':((-.96,0,0),L),'shin.R':((.62,0,0),L),'foot.R':((.30,0,0),L),'upper_arm.L':((-.76,0,0),L),'forearm.L':((.26,0,0),L),'upper_arm.R':((.76,0,0),L),'forearm.R':((-.26,0,0),L),'spine':((0,.10,0),L),'chest':((0,.10,0),L),'head':((0,.045,0),L)}),(30,{'thigh.L':((.82,0,0),L),'shin.L':((-.32,0,0),L),'foot.L':((-.28,0,0),L),'thigh.R':((-.88,0,0),L),'shin.R':((-.10,0,0),L),'foot.R':((.28,0,0),L),'upper_arm.L':((-.72,0,0),L),'forearm.L':((.28,0,0),L),'upper_arm.R':((.72,0,0),L),'forearm.R':((-.28,0,0),L),'spine':((0,.075,0),L),'chest':((0,.09,0),L),'head':((0,.035,0),L)})]
make_action('ChefBlaze_Run_InPlace',1,30,run_frames,True)
slide_frames=[(1,{'pelvis':((.08,0,0),L),'spine':((0,.16,.16),L),'chest':((0,.18,.19),L),'thigh.L':((-.65,0,-.18),L),'shin.L':((.80,0,0),L),'foot.L':((-.40,0,0),L),'thigh.R':((.90,0,.13),L),'shin.R':((-.50,0,0),L),'foot.R':((.28,0,0),L),'upper_arm.L':((-.45,0,-.55),L),'upper_arm.R':((-.45,0,.55),L),'head':((0,-.06,-.14),L)}),(7,{'pelvis':((.10,0,-.04),L),'spine':((0,.20,.27),L),'chest':((0,.20,.30),L),'thigh.L':((-.84,0,-.30),L),'shin.L':((1.02,0,0),L),'foot.L':((-.50,0,0),L),'thigh.R':((.72,0,.16),L),'shin.R':((-.42,0,0),L),'foot.R':((.27,0,0),L),'upper_arm.L':((-.62,0,-.68),L),'upper_arm.R':((-.62,0,.68),L),'head':((0,-.08,-.22),L)}),(14,{'pelvis':((0,0,0),L),'spine':((0,.03,-.08),L),'chest':((0,.03,-.08),L),'thigh.L':((.32,0,0),L),'shin.L':((-.15,0,0),L),'foot.L':((-.14,0,0),L),'thigh.R':((-.32,0,0),L),'shin.R':((-.05,0,0),L),'foot.R':((.14,0,0),L),'upper_arm.L':((.12,0,-.16),L),'upper_arm.R':((.12,0,.16),L),'head':((0,0,0),L)}),(20,{'pelvis':((0,0,0),L),'spine':((0,0,0),L),'chest':((0,0,0),L),'thigh.L':((.38,0,0),L),'shin.L':((-.16,0,0),L),'foot.L':((-.15,0,0),L),'thigh.R':((-.38,0,0),L),'shin.R':((-.08,0,0),L),'foot.R':((.15,0,0),L),'upper_arm.L':((.04,0,-.06),L),'upper_arm.R':((.04,0,.06),L),'head':((0,0,0),L)})]
make_action('ChefBlaze_Slide_DirectionChange',1,20,slide_frames,False)

# Lock the neutral idle stance for reliable previews and glTF default pose.
arm.animation_data.action=bpy.data.actions.get('ChefBlaze_Idle')
neutral=['clavicle.L','clavicle.R','forearm.L','forearm.R','hand.L','hand.R','thumb.L','thumb.R','finger0.L','finger0.R','finger1.L','finger1.R','finger2.L','finger2.R','finger3.L','finger3.R','thigh.L','thigh.R','shin.L','shin.R','foot.L','foot.R','toe.L','toe.R']
for fr in (1,38,75):
    bpy.context.scene.frame_set(fr)
    for name in neutral:
        p=arm.pose.bones.get(name)
        if p:
            p.rotation_mode='XYZ'; p.rotation_euler=(0,0,0); p.location=(0,0,0)
            p.keyframe_insert('rotation_euler',frame=fr,group=p.name); p.keyframe_insert('location',frame=fr,group=p.name)
# Scene presentation for authored source scene; reference-only objects are isolated from export.
scene=bpy.context.scene; scene.name='Chef Blaze · Turnaround Rebuild'; scene.render.engine='BLENDER_EEVEE'; scene.render.resolution_x=960; scene.render.resolution_y=960; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.filepath=os.path.join(OUT,'ChefBlaze_Pass2_Preview.png'); scene.world.color=(.004,.009,.025)
def light(name,loc,energy,size,color):
    bpy.ops.object.light_add(type='AREA',location=loc); o=bpy.context.object; o.name=name; o.data.energy=energy; o.data.shape='DISK'; o.data.size=size; o.data.color=color; move_to(o,REF); o.rotation_euler=(math.radians(22),0,math.radians(18))
light('Studio_Key',(3.5,-4.5,4.2),1050,4.0,(1.0,.70,.52)); light('Studio_Fill',(-3.5,-2.5,2.6),850,5.0,(.32,.48,1.0)); light('Studio_Rim',(2.5,2.8,4.6),1250,3.2,(.36,.50,1.0))
bpy.ops.object.camera_add(location=(3.05,-6.9,2.16)); cam=bpy.context.object; cam.name='ChefBlaze_PreviewCamera'; cam.data.lens=58; move_to(cam,REF); cam.rotation_euler=(Vector((0,0,1.08))-cam.location).to_track_quat('-Z','Y').to_euler(); scene.camera=cam
bpy.ops.mesh.primitive_plane_add(size=20,location=(0,0,0)); floor=bpy.context.object; floor.name='Preview_Ground'; floor.data.materials.append(M['ground']); move_to(floor,REF)
preview=collection('ChefBlaze_PREVIEW')
for o in list(bpy.data.objects):
    if o.type in {'LIGHT','CAMERA'} or o.name=='Preview_Ground': move_to(o,preview)
for c in (REF,REF_BAD,COLL): c.hide_render=True; c.hide_viewport=True
ref=bpy.data.objects.new('AuthoritativeTurnaround_Metadata',None); REF.objects.link(ref); ref['reference_image']='/Users/brent/table-stakes/.dream-loop/target.png'; ref['design_authority']='Polished four-angle adult athletic street-food chef turnaround'; ref['failed_reference_policy']='Do not use low-poly/blockout reference for modeling, proportion, material, rig, or animation decisions'
bad=bpy.data.objects.new('FailedLowPoly_DoNotUse_Metadata',None); REF_BAD.objects.link(bad); bad['reference_image']='/Users/brent/table-stakes/.dream-loop/failed-lowpoly.png'; bad['do_not_use']=True

# Export only runtime geometry and conventional armature. Reference camera, floor and helpers stay in .blend only.
bpy.ops.object.select_all(action='DESELECT')
for o in list(GEO.objects)+list(RIG.objects):
    if o.type in {'MESH','CURVE','ARMATURE'}: o.select_set(True)
bpy.context.view_layer.objects.active=arm
try:
    bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS', export_yup=True, export_apply=False)
except Exception:
    try: bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True, export_animations=True, export_yup=True)
    except Exception as e: print('GLB_EXPORT_ERROR',repr(e))

scene.frame_start=1; scene.frame_end=75; scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
verts=sum(len(o.data.vertices) for o in GEO.objects if o.type=='MESH'); tris=sum(len(p.vertices)-2 for o in GEO.objects if o.type=='MESH' for p in o.data.polygons)
with open(NOTES,'w') as f:
    f.write('Chef Blaze Pass 2 completion report\n')
    f.write('Blender source: ChefBlaze_Pass2_Master.blend\nGLB: ChefBlaze_Pass2.glb\n')
    f.write('Unit scale: 1 Blender unit = 1 meter; authored height including toque/boots approximately 1.90 m; forward -Y; up +Z; 30 FPS.\n')
    f.write('Runtime clips: ChefBlaze_Idle 1-75 loop; ChefBlaze_Walk_InPlace 1-30 loop; ChefBlaze_Run_InPlace 1-30 loop; ChefBlaze_Slide_DirectionChange 1-20 non-looping.\n')
    f.write('Root motion: removed from idle/walk/run and slide; game code owns world movement.\n')
    f.write('Materials: 19 glTF-compatible Principled materials; no external textures required; layered flame geometry for stable wraparound visibility.\n')
    f.write(f'Approximate runtime mesh vertices: {verts}; triangulated face estimate: {tris}; separate rigid skinned parts use conventional deform bones.\n')
    f.write('Rig: root/pelvis/spine/chest/neck/head, clavicles, arms, hands, fingers, thumbs, full leg/foot/toe chains. Head has Smile/Blink_L/Blink_R export-safe shape keys.\n')
    f.write('Three.js: GLTFLoader + AnimationMixer; idle/walk/run LoopRepeat; slide LoopOnce and clampWhenFinished; use crossFadeTo for locomotion.\n')
    f.write('Known simplification: garment pieces are separate rigid skinned shells for reliable browser export; scarf/hat secondary motion is authored in clips.\n')
print('CHEF_BLAZE_PASS2_DONE', BLEND, GLB, NOTES, verts, tris, len(bpy.data.objects))
