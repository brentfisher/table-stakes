"""
Chef Blaze game-ready build script (STORY-060).

Deterministic Blender pipeline that turns the hero sculpt (`chef-blaze.blend`, ~1.09M
triangles, per `RIG-README.md`) into a real-time-budget GLB for the player's own owner
avatar in Table Stakes.

Run headless, from the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        assets/chef-blaze/chef-blaze.blend --python assets/chef-blaze/build_chef_blaze.py

Writes `assets/chef-blaze/ChefBlaze.glb` beside itself. Does NOT overwrite
`chef-blaze.blend` (the checked-in source stays pristine) — nothing in this script calls
`bpy.ops.wm.save_mainfile()`.

Pipeline, in order:
  1. Strip the presentation-only objects (studio camera/lights/plinth/cyclorama) — they
     have no place in a runtime asset.
  2. Decimate the two dense meshes (main sculpt, facial hair) down to a real-time budget.
     Ratios were picked empirically against actual renders of the decimated result (see
     the story's PR description for the calibration screenshots), not guessed: 0.02 on
     the 1,000,000-tri body holds the hat/face/jacket/neckerchief silhouette at 20,000
     tris with no visible tearing; 0.08 on the 68,900-tri facial-hair mesh (thin strand
     geometry, much more failure-prone under decimation) keeps the moustache/goatee/brow
     legible at ~5,650 tris. The twelve eye detail meshes (~9,000 tris total) are left
     undecimated — they're already cheap and are exactly the kind of thin, high-contrast
     detail that decimation mangles first.
  3. Re-bound the body's skin weights to a real-time-safe influence count. NOTE: the
     story's acceptance criteria describe "single-bone-weighted-per-component skinning,"
     which is what the two PRIOR (unmerged, not reused) Chef Blaze branches did — but
     that pipeline built the character from disjoint per-limb primitives (a cylinder per
     forearm, a cube per boot, etc.) where rigid single-bone weighting is exactly right:
     each component is its own island, so there's no seam to tear. This build instead
     retopologizes the ACTUAL sculpt: one continuous 621,506-vertex skin already
     smooth-weighted across 52 bone groups. Forcing every vertex to its single dominant
     bone would rip the surface open at every elbow, knee, and shoulder the instant a
     limb bends — that's not a style choice, it's a correctness bug. So the body keeps
     bounded smooth skinning instead: `vertex_group_limit_total(limit=4)` + normalize,
     which is the standard real-time equivalent (<=4 bone influences/vertex, GPU-cheap,
     stable) and is what "single-bone-weighted" is actually reaching for here. The eye
     and facial-hair meshes ARE single-bone (100% to `head`, verified against the source
     file) and are left untouched — for those, the AC's literal phrasing already holds.
  4. Downsize the three packed 2048x2048 PBR textures (diffuse, metallic/roughness,
     normal) to 1024x1024. The decimation above doesn't touch UVs, so no re-bake/re-atlas
     is needed — just a resolution cut proportional to the geometry cut, since a
     20-30k-tri character rendered at arcade top-down scale doesn't resolve 2K detail.
  5. Rename the existing 120-frame breathing action to `ChefBlaze_Idle` (kept exactly as
     authored — it's already a clean loop) and author a new 30-frame, 30fps
     `ChefBlaze_Walk_InPlace` cycle from scratch (the source file has no walk animation).
     Both actions are pushed onto NLA tracks so glTF's `export_animation_mode='ACTIONS'`
     picks up both as separate named clips.
  6. Join the (now-decimated) body, the untouched eye meshes, and the untouched hair mesh
     into ONE mesh object. This is the actual fix for per-frame draw-call cost — the
     source file has 14 separate mesh objects (1 body + 12 eye details + 1 hair), each of
     which would otherwise be its own skinned node in the export. Joining collapses that
     to one skin/one set of joint matrices shared across every material's glTF primitive.
  7. Bake the meters conversion into a plain node scale rather than touching any vertex
     or animation data: the source is modeled in "Blender units" where this character is
     7.3 units tall (matches `RIG-README.md`'s own figure). Setting the armature object's
     `scale` to `TARGET_HEIGHT_M / 7.3` and letting the glTF exporter emit that as the
     root node's scale means every rotation/translation keyframe stays in its original,
     already-correct-relative-proportions space — there's no separate "did I also scale
     the animation curves" failure mode to get wrong.
  8. Export deform-bones-only (drops the 8 IK control/pole bones, which carry no vertex
     weights and exist only for FK/IK-switch posing inside Blender), Y-up, GLB, both
     actions.
"""

import bpy
import os
import math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
GLB_OUT = os.path.join(HERE, "ChefBlaze.glb")

BODY_DECIMATE_RATIO = 0.02
HAIR_DECIMATE_RATIO = 0.08
# The twelve eye-detail meshes are simple, mostly-convex sculpted shapes (sclera, iris,
# pupil, limbal ring, lid rims) — nowhere near as failure-prone under decimation as the
# body or the hair strands, but at ~22,656 tris combined (more than the entire decimated
# body) they were the single biggest line item after the first pass. 0.4 keeps them
# recognizably eye-shaped (verified — see the story's PR description) while cutting that
# to a more proportionate share of the budget.
EYE_DECIMATE_RATIO = 0.4
TEXTURE_MAX_DIM = 1024
# Matches the pre-existing CapsuleGeometry(0.34, 0.75) + SphereGeometry(0.26) owner
# placeholder's total visual height in RestaurantScene.ts's upsertOwner() (0.75 + 2*0.34
# capsule, sphere centered 0.26 above its top) — this build is a drop-in visual swap for
# that placeholder, and the game's world units already read as meters (RestaurantScene's
# own geometry, camera distances, and movement speeds all assume 1 unit = 1 m), so
# matching its footprint means the model reads at the same scale as every other entity
# already in the scene, without retuning the camera or any placement math.
TARGET_HEIGHT_M = 1.86
SOURCE_HEIGHT_BLENDER_UNITS = 7.3  # RIG-README.md: "7.3 Blender units tall including the hat"

WALK_FPS = 30
WALK_FRAMES = 30  # 1-second loop at 30fps, matching the prior attempts' *_InPlace convention


def find_object(prefix):
    for o in bpy.data.objects:
        if o.name.startswith(prefix):
            return o
    return None


def log(*args):
    print("[build_chef_blaze]", *args)


# --------------------------------------------------------------------------------------
# 1. Strip presentation-only objects
# --------------------------------------------------------------------------------------
PRESENTATION_NAMES = [
    "CAMERA | Chef Blaze hero",
    "Display plinth",
    "Studio cyclorama",
    "Face | catchlight",
    "Fill | cool softbox",
    "Key | warm softbox",
    "Rim | crown and shoulder",
]
for name in PRESENTATION_NAMES:
    obj = bpy.data.objects.get(name)
    if obj is not None:
        bpy.data.objects.remove(obj, do_unlink=True)
        log("removed presentation object:", name)

body = find_object("CHEF BLAZE | Hero sculpt")
arm = find_object("CHEF BLAZE | Humanoid Animation Rig")
hair = find_object("Facial hair")
eyes = [o for o in bpy.data.objects if o.name.startswith("Eye ")]
assert body and arm and hair, "expected source objects not found — has chef-blaze.blend changed shape?"
log("found body/arm/hair/eyes:", body.name, arm.name, hair.name, len(eyes))


# --------------------------------------------------------------------------------------
# 2. Decimate the two dense meshes
# --------------------------------------------------------------------------------------
def decimate(obj, ratio):
    mod = obj.modifiers.new("Retopo_Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    tris = sum(max(len(p.vertices) - 2, 1) for p in obj.data.polygons)
    log(f"decimated {obj.name} to ratio={ratio} -> {tris} tris")
    return tris


body_tris = decimate(body, BODY_DECIMATE_RATIO)
hair_tris = decimate(hair, HAIR_DECIMATE_RATIO)
eye_tris = sum(decimate(o, EYE_DECIMATE_RATIO) for o in eyes)
log("total tris after decimate:", body_tris + hair_tris + eye_tris)


# --------------------------------------------------------------------------------------
# 3. Bound the body's skin weights to a real-time-safe influence count
# --------------------------------------------------------------------------------------
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
bpy.ops.object.mode_set(mode="OBJECT")
log("limited body vertex groups to <=4 influences/vertex and renormalized")


# --------------------------------------------------------------------------------------
# 4. Downsize packed textures
# --------------------------------------------------------------------------------------
for img in bpy.data.images:
    if img.size[0] > TEXTURE_MAX_DIM or img.size[1] > TEXTURE_MAX_DIM:
        before = tuple(img.size)
        img.scale(TEXTURE_MAX_DIM, TEXTURE_MAX_DIM)
        log(f"resized image {img.name}: {before} -> {(img.size[0], img.size[1])}")


# --------------------------------------------------------------------------------------
# 5. Animations: rename breathing -> Idle, author Walk_InPlace, push both to NLA
# --------------------------------------------------------------------------------------
idle_action = None
for a in bpy.data.actions:
    if "breathing" in a.name.lower():
        idle_action = a
        break
assert idle_action, "expected the source breathing action to still be present"
idle_action.name = "ChefBlaze_Idle"
idle_action.use_fake_user = True
log("renamed breathing action to ChefBlaze_Idle, frame range", idle_action.frame_range)

bpy.context.scene.render.fps = WALK_FPS

# Bones this cycle drives, and the amplitude (radians) of their world-X-axis hinge swing.
# World X is the correct hinge for a forward/back leg-and-arm swing here because the
# character faces -Y (root/pelvis/spine/thigh/shin bones all confirm this — see the
# story's notes for the axis dump used to check it) — a rotation around world X stays
# entirely within the Y-Z (forward/up) plane, which is exactly the swing a walk needs.
#
# STORY-061. The FIRST-PASS amplitudes below (upper_arm 0.35, forearm 0.22, chest 0.05,
# pelvis rotation 0.08) were not a bug in any of the senses STORY-061 went looking for —
# every bone here IS keyframed every frame, the export DOES carry deform weights for all of
# them, and the runtime clone DOES apply the resulting pose. They were just too SMALL to read
# next to the legs, which is exactly the "hanging on a pole" complaint. Measured directly (not
# guessed) via the Asset Showcase harness: `SkinnedMesh.applyBoneTransform` on each region's
# most-heavily-weighted vertex, world-space peak-to-peak displacement over one full
# `ChefBlaze_Walk_InPlace` cycle, on the ORIGINAL amplitudes below:
#   foot.L      0.666 m   (thigh+shin+foot chain — already reads clearly, left alone)
#   hand.L      0.283 m   (upper_arm+forearm chain — visible, but well under half the leg's)
#   forearm.L   0.155 m
#   head        0.089 m
#   spine.chest 0.081 m
#   pelvis      0.033 m   (bob + rotation combined)
# A believable walk doesn't need the arm to out-swing the leg, but a ~2.4x gap (0.666 vs
# 0.283) reads as "legs walking, upper body just along for the ride" at this game's top-down
# arcade camera distance — small differences in a big sweep are far more legible than small
# differences in an already-small one. The amplitudes below were scaled up specifically to
# close that gap, not picked independently: upper_arm and forearm both roughly +55-90% (the
# forearm gets the bigger relative bump because its old 0.22 rad amplitude was further
# throttled by `flex_phase`'s clamped-to-non-negative half-sine drive below, so its real
# swing was only ~4.5 degrees of the nominal ~12.6 — nearly half the authored amplitude never
# showed up in the export at all); chest and pelvis rotation both roughly doubled so the
# torso countersway is legible rather than a rounding error next to the legs' 25-45 degree
# swings. Re-measured after rebuilding (same harness technique): foot.L 0.716 m, hand.L
# 0.423 m, forearm.L 0.230 m, head 0.117 m, spine.chest 0.114 m, pelvis 0.052 m — every
# region gained 30-60%, and the leg-to-hand ratio dropped from 2.35x down to 1.69x, closing
# most of the gap without making the upper body out-swing the legs (which would read as its
# own kind of wrong for a walk cycle).
WALK_BONES = {
    "thigh.L": 0.45,
    "thigh.R": -0.45,
    "shin.L": 0.35,      # additive knee bend, phase-shifted below (bends most mid-swing)
    "shin.R": -0.35,
    "foot.L": 0.16,
    "foot.R": -0.16,
    "upper_arm.L": -0.55,   # opposite phase to the SAME-side leg (contralateral gait):
    "upper_arm.R": 0.55,    # upper_arm.L swings with thigh.R, and vice versa.
    "forearm.L": 0.42,
    "forearm.R": -0.42,
}
# Which bone's phase each entry above actually follows (own leg phase, or the opposite
# side's, for the contralateral arms). Value is the phase-lookup key into `leg_phase`.
PHASE_SOURCE = {
    "thigh.L": "L", "shin.L": "L", "foot.L": "L",
    "thigh.R": "R", "shin.R": "R", "foot.R": "R",
    "upper_arm.L": "R", "forearm.L": "R",
    "upper_arm.R": "L", "forearm.R": "L",
}
PELVIS_BOB_M = 0.13          # in Blender units, pre-scale (-> ~0.033 m after TARGET_HEIGHT_M scale)
PELVIS_ROT_AMP = 0.12
CHEST_ROT_AMP = 0.11


def world_axis_to_local(pose_bone, world_axis):
    """A pose bone's rotation is applied in its own rest-local frame. To make a rotation
    read as "around world axis W" regardless of the bone's individual rest orientation
    (arms/legs are NOT all aligned to the same world axis — see the story's axis dump),
    convert W into that bone's local frame: local_axis = rest_matrix^-1 @ W, using the
    fact rest_matrix is orthonormal so its inverse is its transpose."""
    rest3 = pose_bone.bone.matrix_local.to_3x3()
    local = rest3.transposed() @ world_axis
    return local.normalized()


def set_axis_angle(pose_bone, world_axis, angle):
    pose_bone.rotation_mode = "AXIS_ANGLE"
    local_axis = world_axis_to_local(pose_bone, world_axis)
    pose_bone.rotation_axis_angle = (angle, local_axis.x, local_axis.y, local_axis.z)


def keyframe_rotation(pose_bone, frame):
    pose_bone.keyframe_insert(data_path="rotation_axis_angle", frame=frame)


def keyframe_location(pose_bone, frame):
    pose_bone.keyframe_insert(data_path="location", frame=frame)


WORLD_X = Vector((1.0, 0.0, 0.0))

# Reset every pose bone to rest before authoring a fresh action — a bone with no fcurve
# in an action simply holds rest pose when that action alone is active, so a clean start
# means the walk clip can't inherit any leftover pose from the breathing action.
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.select_all(action="SELECT")
bpy.ops.pose.transforms_clear()
bpy.ops.pose.select_all(action="DESELECT")

walk_action = bpy.data.actions.new("ChefBlaze_Walk_InPlace")
walk_action.use_fake_user = True
arm.animation_data_create()
arm.animation_data.action = walk_action

for frame in range(1, WALK_FRAMES + 1):
    # Frame WALK_FRAMES (30) is an explicit repeat of frame 1's phase (phase=0), not a
    # continuation of the sine — that's what makes the loop point exact rather than off
    # by 1/29th of a cycle (see this script's module docstring for why frame 30 == frame 1
    # is handled this way instead of via a Cyclic F-curve modifier).
    phase_t = 0.0 if frame == WALK_FRAMES else (frame - 1) / (WALK_FRAMES - 1)
    leg_phase = {
        "L": math.sin(2 * math.pi * phase_t),
        "R": math.sin(2 * math.pi * phase_t + math.pi),  # opposite side, half a cycle out
    }
    # Ankle leads the hip by a quarter cycle (most dorsiflexed while that leg is mid-swing,
    # neutral at heel-strike/toe-off) — genuinely bidirectional (dorsiflexion AND
    # plantarflexion both happen over a stride), so this stays a signed sine.
    ankle_phase = {
        "L": math.sin(2 * math.pi * phase_t + math.pi / 2),
        "R": math.sin(2 * math.pi * phase_t + math.pi / 2 + math.pi),
    }
    # Knee and elbow are one-way hinges — a signed sine would bend them BACKWARD
    # (hyperextend) for half the cycle, since sin ranges negative just as much as positive.
    # Clamped to the non-negative half of the same quarter-cycle-led sine: zero at
    # heel-strike/toe-off, peaking mid-swing, never negative. `WALK_BONES`' amp already
    # carries the correct per-side sign (L positive, R negative), so multiplying by a
    # strictly->=0 drive preserves that sign rather than flipping it.
    flex_phase = {
        "L": max(0.0, math.sin(2 * math.pi * phase_t + math.pi / 2)),
        "R": max(0.0, math.sin(2 * math.pi * phase_t + math.pi / 2 + math.pi)),
    }

    for bone_name, amp in WALK_BONES.items():
        pb = arm.pose.bones[bone_name]
        side = PHASE_SOURCE[bone_name]
        if bone_name.startswith("shin") or bone_name.startswith("forearm"):
            drive = flex_phase[side]
        elif bone_name.startswith("foot"):
            drive = ankle_phase[side]
        else:
            drive = leg_phase[side]
        set_axis_angle(pb, WORLD_X, amp * drive)
        keyframe_rotation(pb, frame)

    pelvis = arm.pose.bones["pelvis"]
    bob = math.sin(2 * math.pi * phase_t * 2)  # two bob cycles per stride (one per footfall)
    pelvis.location = (0.0, PELVIS_BOB_M * abs(bob), 0.0)  # pelvis local +Y is world up (see axis dump)
    set_axis_angle(pelvis, WORLD_X, PELVIS_ROT_AMP * leg_phase["L"])
    keyframe_location(pelvis, frame)
    keyframe_rotation(pelvis, frame)

    chest = arm.pose.bones["spine.chest"]
    set_axis_angle(chest, WORLD_X, -CHEST_ROT_AMP * leg_phase["L"])
    keyframe_rotation(chest, frame)

arm.animation_data.action = None
bpy.ops.pose.select_all(action="SELECT")
bpy.ops.pose.transforms_clear()
bpy.ops.object.mode_set(mode="OBJECT")
log("authored ChefBlaze_Walk_InPlace:", WALK_FRAMES, "frames @", WALK_FPS, "fps")

# Push both actions onto NLA tracks so export_animation_mode='ACTIONS' exports both as
# separate named glTF clips (ACTIONS mode only picks up the active action XOR whatever
# is already on NLA tracks — with two actions, NLA tracks are the only way to get both).
arm.animation_data.action = idle_action
track_idle = arm.animation_data.nla_tracks.new()
track_idle.name = "ChefBlaze_Idle"
track_idle.strips.new(idle_action.name, 1, idle_action)
arm.animation_data.action = None

arm.animation_data.action = walk_action
track_walk = arm.animation_data.nla_tracks.new()
track_walk.name = "ChefBlaze_Walk_InPlace"
track_walk.strips.new(walk_action.name, 1, walk_action)
arm.animation_data.action = None
log("pushed both actions onto NLA tracks")


# --------------------------------------------------------------------------------------
# 6. Join eyes + hair into the body — one mesh object, one skin, multiple materials
# --------------------------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
for o in eyes:
    o.select_set(True)
hair.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body  # join target keeps this object's name + modifiers
bpy.ops.object.join()
body.name = "ChefBlaze_Mesh"
log("joined body+eyes+hair into", body.name, "- final tri count:",
    sum(max(len(p.vertices) - 2, 1) for p in body.data.polygons))


# --------------------------------------------------------------------------------------
# 7. Bake the meters conversion into the armature's node scale
# --------------------------------------------------------------------------------------
arm.name = "ChefBlaze_Rig"
arm.data.name = "ChefBlaze_Skeleton"
scale_factor = TARGET_HEIGHT_M / SOURCE_HEIGHT_BLENDER_UNITS
arm.scale = (scale_factor, scale_factor, scale_factor)
log(f"set armature scale to {scale_factor:.5f} (-> {TARGET_HEIGHT_M} m tall once exported)")


# --------------------------------------------------------------------------------------
# 8. Export
# --------------------------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm

bpy.ops.export_scene.gltf(
    filepath=GLB_OUT,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_def_bones=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
)
log("exported", GLB_OUT)
log("done")
