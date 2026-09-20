"""Deterministic Blender build: cast-pack.blend -> one game-ready GLB per cast character.

STORY-063. The sibling of `assets/chef-blaze/build_chef_blaze.py`, generalized from one hero to
three characters. Read that script first — this one deliberately reuses its walk-authoring
machinery (`world_axis_to_local` / `flex_phase` / `WALK_BONES`), its meters-via-node-scale trick,
and its anisotropy guard, and only the things that genuinely differ are re-explained here.

Run (one character per invocation — see `run_all` note at the bottom):

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        ~/asset-sources/table-stakes/chef-blaze-cast-assets/blender/cast-pack.blend \
        --python assets/cast/build_cast.py -- --character Monsieur

Why the source blend is NOT in this repo, unlike `chef-blaze.blend`
------------------------------------------------------------------
`cast-pack.blend` is 129 MiB. This repo has no Git LFS, so committing it would put a 129 MiB blob
in every clone's history permanently. STORY-060 committed the 49 MiB `chef-blaze.blend`; this is a
deliberate, documented departure from that precedent, not an oversight. The blend is expected at
`~/asset-sources/table-stakes/chef-blaze-cast-assets/blender/cast-pack.blend` (override with
`--source`), and this script verifies its SHA256 before building so a rebuild stays auditable
without the source in-tree. The delivery zip's `blender/chef-blaze.blend` is byte-identical to the
already-committed one (SHA256 cc55a94e…) — there is nothing new in it and it is not used here.

What differs from the Chef Blaze build
--------------------------------------
1. THREE CHARACTERS, ONE RIG VOCABULARY. All six armatures in `cast-pack.blend` (the three new
   characters, Chef Blaze, and the two reusable templates) were verified to carry IDENTICAL
   61-bone name sets, and every bone `WALK_BONES` drives is present on all of them. That is why the
   walk cycle generalizes by config rather than by per-character special-casing. If a future
   re-delivery changes a rig, `assert_walk_rig` fails loudly rather than authoring a silent
   half-walk.

2. BUDGETS COME FROM LIVE INSTANCE COUNTS, NOT FROM A HOUSE STYLE. Chef Blaze could afford 34,706
   triangles because exactly one "self" owner is ever live. Here the counts come from the game data:
   `shared/game-data/restaurant-layout.json` has 6 tables and a `staff.roster` of exactly one cook,
   one server and one host (and no upgrade in `upgrades.json` adds staff), while
   `customer-segments.json` caps `partySize` at 4. So Monsieur (host) and Vivienne (server) are
   ONE-instance characters and keep a hero-tier budget, whereas Aurelia is a diner — up to 6x4 = 24
   simultaneous instances — and is cut to ~8,000 triangles so a full dining room stays near 192,000
   triangles of skinned geometry rather than 833,000.

3. PER-PART DECIMATION, NOT ONE RATIO. Decimating a joined mesh at a single ratio destroys small
   high-frequency props (a monocle, an earring) long before it meaningfully cheapens a 540,000-
   triangle coat. Each part therefore gets its own TRIANGLE TARGET and the ratio is derived from the
   part's measured count. Monsieur's monocle chain is the extreme case: 115,200 triangles of
   tessellated links for an object a few pixels wide in-game.

4. THE OCCLUDED BASE BODY IS DROPPED. Every character parents a full `… | shared <male|female> body`
   mesh (141k-153k triangles) that sits entirely under the tailored outfit. It is invisible in the
   delivered renders and is excluded here. It is listed explicitly in `DROP` rather than filtered by
   a name heuristic, so a re-delivery that renames it fails the inventory assert instead of silently
   shipping 141k triangles of hidden geometry.

5. ANISOTROPY IS CLEARED DEFENSIVELY, NOT REACTIVELY. `docs/kb/model-asset-validation.md` documents
   the incident where Chef Blaze's hair material carried Principled `Anisotropic` 0.35, Blender
   emitted `KHR_materials_anisotropy`, the mesh shipped no TANGENTs, and `normalize(vec3(0))` NaN'd
   through the bloom pass — blacking out 42% of frames. These three characters were checked and
   carry NO anisotropy today. The clearing step is kept anyway: it costs nothing, and a re-delivery
   that adds a shiny hair shader must not be able to reintroduce a whole-screen bug.

6. FORWARD AXIS IS RE-VERIFIED, NOT INHERITED. Chef Blaze's +Z-forward contract was established
   empirically, and these characters came out of `assemble_cast.py`, a different pipeline, so it
   was not assumed to carry over. Two independent checks agree. Statically: all four rigs' rest-pose
   head-bone frames were dumped and are identical (bone-local Z maps to world -Y). Empirically: each
   export was re-imported and rendered with the camera placed on Blender -Y, and every character
   renders face-on from there — which is the same thing as saying forward is glTF +Z, since the
   importer maps glTF +Z to Blender -Y. That is `RestaurantScene.ts`'s existing avatar convention,
   so no corrective rotation is needed.

Known, deliberately un-fixed
----------------------------
The head modules of both female characters carry a front/rear projection seam that tears
horizontally across the mid-face (see STORY-063 for the full diagnosis — the packed source plates
are clean, so this is a projection defect, not a texture one). It is NOT repaired here. Whether it
is worth a projection rebuild depends on the on-screen face size at the real gameplay camera
distance, which is a measurement to take in the scene, not in this script.
"""

import bpy
import hashlib
import mathutils
import json
import math
import os
import sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SOURCE = os.path.expanduser(
    "~/asset-sources/table-stakes/chef-blaze-cast-assets/blender/cast-pack.blend"
)
SOURCE_SHA256 = "43bd1b4b406eef32ef837bc770aedd09d00537633bb596de1e75c0f79cd5f6a2"

WALK_FPS = 30
WALK_FRAMES = 30


def log(*args):
    print("[build_cast]", *args)


# --------------------------------------------------------------------------------------
# Character configuration
# --------------------------------------------------------------------------------------
# `parts` maps an object name to its TRIANGLE TARGET after decimation (None = keep as-is,
# for meshes already small enough that decimating only costs silhouette).
#
# Heights are the measured render-visible extents in `cast-pack.blend`, in Blender units,
# feet at z~0. The measurement method was validated against Chef Blaze, which measures
# 7.300 — exactly the "7.3 Blender units tall including the hat" its own RIG-README.md
# states. `target_height_m` is then derived from the primitive each model replaces in
# `RestaurantScene.ts`, the same way build_chef_blaze.py derived 1.86 m from the owner's
# CapsuleGeometry rather than picking a number independently:
#   - workers  CapsuleGeometry(0.3, 0.7) centred at y=0.8  -> spans 0.15..1.45  -> 1.45 m
#   - diners   CapsuleGeometry(0.18, 0.2) at y=0.45 + head sphere r=0.17 at y=0.82 -> ~1.0 m
#     Aurelia is exported STANDING at worker scale; STORY-066 authors the seated pose and
#     re-derives her scale against the seated silhouette. Exporting her standing here keeps
#     this script's three characters uniform and leaves the seated problem in one place.
CHARACTERS = {
    "Monsieur": {
        "rig": "MONSIEUR | French maître d’ | FK IK animation rig",
        "out": "Monsieur.glb",
        "clip_prefix": "Monsieur",
        "source_height_bu": 6.7064,
        "target_height_m": 1.45,
        "texture_max_dim": 1024,
        "bake_texture_size": 1024,
        "role_note": "host worker — exactly one live instance, so hero-tier budget",
        "parts": {
            "MONSIEUR | French maître d’ | tailored outfit": 16000,
            "MONSIEUR | French maître d’ | removable head and hair": 11000,
            "MONSIEUR | French maître d’ | hands": 4000,
            "MONSIEUR | French maître d’ | footwear": 3000,
            "MONSIEUR | detachable monocle chain": 1000,
            "MONSIEUR | removable gold monocle": 600,
        },
        "drop": ["MONSIEUR | French maître d’ | shared male body"],
    },
    "Vivienne": {
        "rig": "VIVIENNE | luxury concierge | FK IK animation rig",
        "out": "Vivienne.glb",
        "clip_prefix": "Vivienne",
        "source_height_bu": 6.7378,
        "target_height_m": 1.45,
        "texture_max_dim": 1024,
        "bake_texture_size": 1024,
        "role_note": "server worker — exactly one live instance, so hero-tier budget",
        "parts": {
            "VIVIENNE | luxury concierge | tailored outfit": 16000,
            "VIVIENNE | luxury concierge | removable head and hair": 12000,
            "VIVIENNE | luxury concierge | hands": 4000,
            "VIVIENNE | luxury concierge | footwear": 2500,
            "VIVIENNE | pearl drop earring L": 250,
            "VIVIENNE | pearl drop earring R": 250,
        },
        "drop": ["VIVIENNE | luxury concierge | shared female body"],
    },
    "Aurelia": {
        "rig": "AURELIA | affluent patron | FK IK animation rig",
        "out": "Aurelia.glb",
        "clip_prefix": "Aurelia",
        "source_height_bu": 6.5470,
        # SEATED, and therefore sized against the seated silhouette rather than a standing one.
        # `upsertCustomer` draws each diner as a CapsuleGeometry(0.18, 0.2) torso at y=0.45 plus a
        # SphereGeometry(0.17) head at y=0.82, so the primitive she replaces tops out at 0.99 m.
        # Unlike the two workers, this height is NOT derived from `source_height_bu` — a seated
        # figure's floor-to-crown height has no fixed relationship to its standing height. The
        # build measures the POSED mesh instead (`posed_z_extent`) and scales from that.
        "seated": True,
        "target_height_m": 0.99,
        # Half the texture budget of the other two: she renders at up to 24 instances and at
        # the smallest on-screen size in the scene (a seated diner across the dining room).
        "texture_max_dim": 512,
        "bake_texture_size": 512,
        "role_note": "seated diner — up to 24 live instances (6 tables x partySize 4)",
        "parts": {
            "AURELIA | affluent patron | tailored outfit": 3600,
            "AURELIA | affluent patron | removable head and hair": 3000,
            "AURELIA | affluent patron | hands": 800,
            "AURELIA | affluent patron | footwear": 600,
        },
        # The earrings are ~3,072 triangles EACH — 77% of this character's entire 8,000-triangle
        # budget for two props a couple of pixels wide on a seated diner. Dropped, not decimated:
        # a 250-triangle pearl reads as a grey blob, which is worse than no earring. Monsieur and
        # Vivienne keep theirs because they can afford them.
        "drop": [
            "AURELIA | affluent patron | shared female body",
            "AURELIA | pearl drop earring L",
            "AURELIA | pearl drop earring R",
            "AURELIA | removable pearl necklace",
        ],
    },
}

# Objects that exist to light/stage the delivered renders, or to serve as reusable authoring
# libraries, and must never reach a GLB. Matched by exact name or by prefix.
SCAFFOLD_PREFIXES = (
    "LIBRARY | ", "DISPLAY | ", "Display ", "Display | ", "BASE | ", "TEMPLATE | ",
    "CAMERA | ", "Key | ", "Fill | ", "Rim | ", "Face | ",
)
SCAFFOLD_NAMES = ("Studio cyclorama", "Display plinth", "Icosphere")


# --------------------------------------------------------------------------------------
# Walk cycle — see build_chef_blaze.py for the derivation of every constant below
# --------------------------------------------------------------------------------------
WALK_BONES = {
    "thigh.L": 0.45, "thigh.R": 0.45,
    "shin.L": 0.35, "shin.R": 0.35,        # additive knee bend, phase-shifted below
    "foot.L": 0.16, "foot.R": 0.16,
    "upper_arm.L": 0.55, "upper_arm.R": 0.55,
    "forearm.L": 0.42, "forearm.R": 0.42,
}
# NOTE ON SIGNS — these differ from `build_chef_blaze.py`, deliberately.
#
# That script pairs each bone with the OPPOSITE amp on the other side (thigh.L +0.45, thigh.R
# -0.45), which reads like a mirrored rig. These rigs are not mirrored: the same signed angle
# rotates a left and a right bone in the SAME physical direction, verified by posing one clip and
# reading both thigh tails back out of the exported GLB.
#
# With opposite amps AND opposite phases the two cancel — thigh.R's -0.45 multiplies
# `leg_phase["R"]`, which is itself the negation of `leg_phase["L"]` — so both thighs receive an
# identical value every frame and the legs swing IN UNISON. Measured on the first export of this
# character: at frame 8 of 30, thigh.L and thigh.R tails were both at y=+3.202, i.e. the same
# place. That is a hop, not a walk, and it is invisible in a still.
#
# Matching amps let the opposite phases do the work, which is what produces a contralateral gait.
# The arm amps are positive for the same reason: `PHASE_SOURCE` already sends each arm the
# opposite side's phase, so a positive amp swings it against its own-side leg.
PHASE_SOURCE = {
    "thigh.L": "L", "shin.L": "L", "foot.L": "L",
    "thigh.R": "R", "shin.R": "R", "foot.R": "R",
    "upper_arm.L": "R", "forearm.L": "R",
    "upper_arm.R": "L", "forearm.R": "L",
}
PELVIS_BOB_M = 0.13
PELVIS_ROT_AMP = 0.12
CHEST_ROT_AMP = 0.11
WORLD_X = Vector((1.0, 0.0, 0.0))
EXTRA_WALK_BONES = ("pelvis", "spine.chest")


def world_axis_to_local(pose_bone, world_axis):
    """Convert a world axis into a pose bone's own rest-local frame, so a rotation reads as
    "around world X" no matter how that individual bone's rest orientation is rolled. Relies on
    the rest matrix being orthonormal, so its inverse is its transpose. Verbatim from
    build_chef_blaze.py — see that script for why a plain local-X rotation does not work
    uniformly across this rig (the arms carry enough rest roll to swing off-axis)."""
    rest3 = pose_bone.bone.matrix_local.to_3x3()
    return (rest3.transposed() @ world_axis).normalized()


def set_axis_angle(pose_bone, world_axis, angle):
    pose_bone.rotation_mode = "AXIS_ANGLE"
    axis = world_axis_to_local(pose_bone, world_axis)
    pose_bone.rotation_axis_angle = (angle, axis.x, axis.y, axis.z)


def assert_walk_rig(arm):
    """Fail loudly if a re-delivered rig no longer carries every bone the walk cycle drives.
    Authoring a walk against a partially-matching rig produces a character that slides along
    with one arm twitching, which is a far more expensive thing to debug than a build error."""
    names = {b.name for b in arm.data.bones}
    missing = [b for b in list(WALK_BONES) + list(EXTRA_WALK_BONES) if b not in names]
    assert not missing, (
        f"{arm.name} is missing walk bones {missing} — cast-pack.blend's rig vocabulary changed; "
        "re-check WALK_BONES against the new skeleton before trusting this build."
    )


def author_walk(arm, clip_name):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.pose.select_all(action="DESELECT")

    action = bpy.data.actions.new(clip_name)
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action

    for frame in range(1, WALK_FRAMES + 1):
        # Frame 30 repeats frame 1's phase exactly rather than continuing the sine, so the loop
        # point is exact instead of off by 1/29th of a cycle.
        t = 0.0 if frame == WALK_FRAMES else (frame - 1) / (WALK_FRAMES - 1)
        leg = {"L": math.sin(2 * math.pi * t), "R": math.sin(2 * math.pi * t + math.pi)}
        ankle = {"L": math.sin(2 * math.pi * t + math.pi / 2),
                 "R": math.sin(2 * math.pi * t + math.pi / 2 + math.pi)}
        # Knees and elbows are one-way hinges: a signed sine would hyperextend them backward for
        # half of every cycle, so the drive is clamped to its non-negative half. WALK_BONES already
        # carries the per-side sign, and multiplying by a >=0 drive preserves it.
        flex = {"L": max(0.0, ankle["L"]), "R": max(0.0, ankle["R"])}

        for bone_name, amp in WALK_BONES.items():
            pb = arm.pose.bones[bone_name]
            side = PHASE_SOURCE[bone_name]
            if bone_name.startswith(("shin", "forearm")):
                drive = flex[side]
            elif bone_name.startswith("foot"):
                drive = ankle[side]
            else:
                drive = leg[side]
            set_axis_angle(pb, WORLD_X, amp * drive)
            pb.keyframe_insert(data_path="rotation_axis_angle", frame=frame)

        pelvis = arm.pose.bones["pelvis"]
        bob = math.sin(2 * math.pi * t * 2)  # two bobs per stride, one per footfall
        pelvis.location = (0.0, PELVIS_BOB_M * abs(bob), 0.0)  # pelvis local +Y is world up
        set_axis_angle(pelvis, WORLD_X, PELVIS_ROT_AMP * leg["L"])
        pelvis.keyframe_insert(data_path="location", frame=frame)
        pelvis.keyframe_insert(data_path="rotation_axis_angle", frame=frame)

        chest = arm.pose.bones["spine.chest"]
        set_axis_angle(chest, WORLD_X, -CHEST_ROT_AMP * leg["L"])
        chest.keyframe_insert(data_path="rotation_axis_angle", frame=frame)

    arm.animation_data.action = None
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"authored {clip_name}: {WALK_FRAMES} frames @ {WALK_FPS} fps")
    return action


# --------------------------------------------------------------------------------------
# Seated pose — STORY-066
# --------------------------------------------------------------------------------------
# `cast-pack.blend` ships one action per character, a standing breathing loop, and nothing else.
# Aurelia is a DINER: `RestaurantScene#upsertCustomer` seats up to four of her around a table, so
# a standing model is not "close enough" — it would float through the tabletop. This authors the
# pose the source does not have, the same way `build_chef_blaze.py` authored a walk cycle its own
# source file lacked.
#
# SIGN CONVENTION. Every angle below is about WORLD X, converted into each bone's own rest frame
# by `world_axis_to_local` (see `build_chef_blaze.py` for why a plain local-X rotation does not
# work uniformly across this rig). Forward for these characters is Blender -Y, so a negative angle
# flexes a hip forward and a positive angle bends the knee back down under it.
#
# The left and right sides take the SAME sign. These rigs are not mirrored — verified by posing a
# clip and reading both thigh tails back out of the exported GLB — so a matching sign moves both
# limbs the same way, which is what sitting needs. See `WALK_BONES` for why the opposite-amp
# convention inherited from `build_chef_blaze.py` is wrong here.
SEATED_POSE = {
    "thigh.L": -1.48, "thigh.R": -1.48,   # hips flexed ~85 degrees: thighs forward, near level
    "shin.L": 1.42, "shin.R": 1.42,       # knees bent back down so the shins hang vertically
    "foot.L": 0.18, "foot.R": 0.18,       # ankles just off neutral so the soles sit flat
    # Arms kept close to rest. The pack concedes weak elbow deformation, and it is real: flexing
    # the forearm 0.55 rad tears the sleeve open at both elbows. A diner's arms are near the table
    # anyway, so a stronger pose buys little and costs a lot here.
    "upper_arm.L": -0.14, "upper_arm.R": -0.14,
    "forearm.L": 0.26, "forearm.R": 0.26,
}

# GUARD. The obvious check — "a seated figure is shorter than a standing one" — is the wrong
# invariant for this construction and was tried first. Flexing the hips and knees does not lower
# the head: the pelvis stays at its standing height and only the FEET rise, so the crown-to-lowest
# span shrinks by far less than intuition suggests (measured: ~94% of standing, not the ~65% a
# real seated person gives). What the pose actually guarantees is that both feet leave the floor,
# so that is what is asserted.
#
# It discriminates exactly the failure worth catching. With the `.R` groups unmirrored, one foot
# stays planted and `z_min` sits at 0.011 bu — 0.2% of standing height. With both legs folding it
# rises to ~0.40 bu, about 6%. The threshold sits between them.
SEATED_MIN_FOOT_LIFT_FRACTION = 0.03


def assert_seated(posed_z_min, standing_height):
    fraction = posed_z_min / standing_height
    assert fraction > SEATED_MIN_FOOT_LIFT_FRACTION, (
        f"seated pose did not lift both feet: lowest posed point is {posed_z_min:.3f} bu, "
        f"{fraction:.1%} of standing height {standing_height:.3f} bu (expected > "
        f"{SEATED_MIN_FOOT_LIFT_FRACTION:.0%}). A leg still reaching the floor usually means the "
        f"`.R` deform groups are empty (see `mirror_side_weights`) or SEATED_POSE's L/R signs "
        f"are not mirrored."
    )


SEATED_BREATH_BONE = "spine.chest"
SEATED_BREATH_AMP = 0.035
SEATED_FRAMES = 120  # matches the source breathing loops' own length at 30fps (4 s)


def author_seated_idle(arm, clip_name):
    """A held seated pose with a shallow chest rise. The source breathing loop is NOT reused:
    it keyframes the spine against a STANDING rest pose, so layering it over flexed hips and
    knees fights the pose rather than adding to it."""
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")

    action = bpy.data.actions.new(clip_name)
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action

    for frame in range(1, SEATED_FRAMES + 1):
        # Frame SEATED_FRAMES repeats frame 1's phase exactly so the loop point is seamless,
        # same trick the walk cycle uses.
        t = 0.0 if frame == SEATED_FRAMES else (frame - 1) / (SEATED_FRAMES - 1)
        for bone_name, angle in SEATED_POSE.items():
            pb = arm.pose.bones[bone_name]
            set_axis_angle(pb, WORLD_X, angle)
            pb.keyframe_insert(data_path="rotation_axis_angle", frame=frame)
        chest = arm.pose.bones[SEATED_BREATH_BONE]
        set_axis_angle(chest, WORLD_X, SEATED_BREATH_AMP * math.sin(2 * math.pi * t))
        chest.keyframe_insert(data_path="rotation_axis_angle", frame=frame)

    arm.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"authored {clip_name}: {SEATED_FRAMES} frames @ {WALK_FPS} fps (seated, held pose + breath)")
    return action


def posed_z_extent(mesh_obj):
    """World-space Z range of the mesh as the ARMATURE ACTUALLY DEFORMS IT, not its rest bounding
    box. `bound_box` is computed from rest vertex data and does not move when the pose changes, so
    using it here would size the character against a standing silhouette it no longer has."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh_obj.evaluated_get(depsgraph)
    # `evaluated.data` IS the modifier-evaluated mesh. `to_mesh()` is for converting non-mesh
    # objects and hands back undeformed data for a mesh, which reads as "the pose did nothing".
    zs = [(evaluated.matrix_world @ v.co).z for v in evaluated.data.vertices]
    return min(zs), max(zs)


# --------------------------------------------------------------------------------------
# Mesh helpers
# --------------------------------------------------------------------------------------
def tri_count(obj):
    return sum(max(len(p.vertices) - 2, 1) for p in obj.data.polygons)


def mirror_side_weights(obj):
    """Populate the empty `.R` deform groups by mirroring the `.L` ones across X.

    THE DEFECT THIS EXISTS FOR. Every `.R` vertex group in `cast-pack.blend` is present but
    carries ZERO weight — `thigh.R`, `shin.R`, `foot.R`, `upper_arm.R`, `forearm.R`, `hand.R` and
    the whole right finger chain all sum to 0.0 across all three characters. The `.L` groups are
    correct and cover only the left limb (verified by their x spans), so the right arm and right
    leg have no deform bone of their own: they are carried entirely by `pelvis`/`spine`, welded
    rigidly to the torso.

    The pack's own validation reports "zero unweighted character vertices", and that is true —
    every vertex does have some weight. It just does not imply every deform bone has any, which is
    the property that actually matters. Without this fix a walk cycle swings the left arm and left
    leg while the right side stays rigid, and a seated pose folds one leg while the other stays
    straight. Both look like an animation bug rather than a rigging one, which is what makes it
    expensive to chase.

    METHOD. For each vertex, find the nearest vertex to its mirror position (-x, y, z) via a
    KD-tree, and copy that partner's `.L` weight into this vertex's `.R` group. Spatial matching
    rather than topological: these are volumetric reconstructions, so the two sides are near- but
    not exactly-symmetric and have no guaranteed mirrored vertex ordering. Run on the DENSE mesh
    before decimation — decimation is not symmetric, so matching quality collapses afterwards.

    Only fills groups that are actually empty, so a corrected re-delivery is left alone.
    """
    groups = {g.name: g for g in obj.vertex_groups}
    pairs = [(n, n[:-2] + ".R") for n in groups if n.endswith(".L") and n[:-2] + ".R" in groups]
    totals = {g.name: 0.0 for g in obj.vertex_groups}
    for vertex in obj.data.vertices:
        for entry in vertex.groups:
            totals[obj.vertex_groups[entry.group].name] += entry.weight
    todo = [(l, r) for l, r in pairs if totals[r] == 0.0 and totals[l] > 0.0]
    if not todo:
        log(f"  {obj.name}: .R groups already weighted, no mirror needed")
        return

    size = len(obj.data.vertices)
    tree = mathutils.kdtree.KDTree(size)
    for vertex in obj.data.vertices:
        tree.insert(vertex.co, vertex.index)
    tree.balance()

    left_weights = {}
    for left_name, _ in todo:
        index = groups[left_name].index
        weights = {}
        for vertex in obj.data.vertices:
            for entry in vertex.groups:
                if entry.group == index and entry.weight > 0.0:
                    weights[vertex.index] = entry.weight
                    break
        left_weights[left_name] = weights

    partner = [0] * size
    for vertex in obj.data.vertices:
        mirrored = mathutils.Vector((-vertex.co.x, vertex.co.y, vertex.co.z))
        _, index, _ = tree.find(mirrored)
        partner[vertex.index] = index

    filled = 0
    for left_name, right_name in todo:
        weights = left_weights[left_name]
        right_group = groups[right_name]
        for vertex in obj.data.vertices:
            weight = weights.get(partner[vertex.index])
            if weight:
                right_group.add([vertex.index], weight, "REPLACE")
                filled += 1
    log(f"  {obj.name}: mirrored {len(todo)} empty .R groups from .L ({filled} assignments)")


def decimate_to(obj, target_tris):
    """Decimate to a TRIANGLE TARGET rather than a fixed ratio — parts in this cast span
    3,072 to 539,562 triangles, so one shared ratio would either shred the earrings or leave
    the coat untouched."""
    current = tri_count(obj)
    if target_tris is None or current <= target_tris:
        log(f"  kept {obj.name}: {current} tris (target {target_tris})")
        return current
    mod = obj.modifiers.new("Cast_Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = target_tris / current
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after = tri_count(obj)
    log(f"  decimated {obj.name}: {current} -> {after} tris (target {target_tris})")
    return after


def bound_skin_weights(obj):
    """Cap influences at 4 per vertex and renormalize. Required for real-time skinning, and the
    renormalize also removes the zero-sum weight rows `npm run check:models` fails on (a
    zero-sum row collapses its vertex onto the model origin)."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_albedo(obj, size, name):
    """Bake every material's evaluated base colour into ONE texture on ONE new UV layout.

    This is the step that makes these characters usable from any angle, and it exists because of
    a hard mismatch between how the cast was authored and what glTF can represent.

    Each costume material in `cast-pack.blend` is a FRONT plate and a REAR plate fed into a
    Mix node whose factor comes from a per-vertex attribute (`costume_rear`) — the projection
    switch `docs/CAST-PACK-README.md` describes. glTF's PBR model has no concept of "mix two
    images by a vertex attribute": a base-colour slot takes one texture and one UV set. Blender's
    exporter therefore keeps whichever image it can map — the front plate — and silently DROPS the
    rear one. No warning is emitted and the GLB validates cleanly.

    The symptom is unmistakable once you look for it: rendering the exported Monsieur from behind
    shows his bow tie, waistcoat, watch chain and moustache again, mirrored round to his back,
    because every triangle now samples the front plate. It is invisible in a front-on turnaround,
    which is exactly how it survived into the delivered renders.

    Baking sidesteps the whole problem. Cycles evaluates the real node graph — mix factor, vertex
    attribute and both plates — and writes the result into a flat image, which glTF represents
    natively. A Smart UV Project is generated first rather than reusing the authored
    "Generated front rear projection" UVs, because those were built for a front/rear projection
    pair and the two sets deliberately overlap: front and rear texels share coordinates and are
    told apart only by the attribute. Baking into overlapping islands would fight itself. The new
    layout is guaranteed non-overlapping, so front and rear each get their own texels.

    Baked as DIFFUSE with direct and indirect passes OFF (colour only) rather than EMIT: the mix
    is wired to Emission Color on the costume materials, but the gold monocle/chain materials are
    plain Principled surfaces with no emission, and an EMIT bake would render those pure black.
    A colour-only diffuse bake is correct for every material in the cast.

    Side effect worth having: the result is ONE material and ONE texture, so the mesh also drops
    from two primitives to one.
    """
    scene = bpy.context.scene
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # The UV layer must be created in OBJECT mode — `uv_layers.new()` returns None in EDIT mode,
    # which surfaces later as an unrelated-looking AttributeError.
    uv = obj.data.uv_layers.new(name="bake_uv")
    assert uv is not None, "could not add a bake UV layer (mesh already at Blender's 8-layer cap?)"
    # Blender does NOT guarantee the requested name: UV layers live in the same attribute
    # namespace as the mesh's generic attributes, and this mesh already carries a `costume_rear`
    # attribute from the authored projection, so the new layer can come back named something else
    # entirely. Capture the name it actually got — hardcoding "bake_uv" in the cleanup below
    # deletes the layer that was just baked into and keeps the authored one, which produces a
    # correctly-baked texture sampled through the wrong coordinates.
    bake_uv_name = uv.name
    obj.data.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"  built non-overlapping bake UVs ({len(obj.data.uv_layers)} layers, active={uv.name})")

    target = bpy.data.images.new(name, width=size, height=size, alpha=False)
    # Point every material at the bake target and make that node active, which is how Cycles
    # chooses where to write.
    for material in obj.data.materials:
        if material is None or not material.node_tree:
            continue
        node = material.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = target
        node.select = True
        material.node_tree.nodes.active = node

    prev_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1          # a colour-only diffuse bake is deterministic; 1 is enough
    scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = 8      # bleed past island edges so mip levels cannot sample background
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    bpy.ops.object.bake(type="DIFFUSE")
    scene.render.engine = prev_engine
    log(f"  baked albedo -> {size}x{size}")

    # Collapse to a single material that samples the baked image, and drop the now-unused
    # authored UV layers so the GLB ships one UV set.
    baked = bpy.data.materials.new(f"{name}_Baked")
    baked.use_nodes = True
    bsdf = baked.node_tree.nodes["Principled BSDF"]
    tex = baked.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = target
    baked.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    # Flat-ish response: these are painted-texture characters, and a specular highlight on a
    # baked albedo reads as grease rather than fabric.
    bsdf.inputs["Roughness"].default_value = 0.72
    bsdf.inputs["Metallic"].default_value = 0.0

    obj.data.materials.clear()
    obj.data.materials.append(baked)
    for layer in [l.name for l in obj.data.uv_layers if l.name != bake_uv_name]:
        obj.data.uv_layers.remove(obj.data.uv_layers[layer])
    assert [l.name for l in obj.data.uv_layers] == [bake_uv_name]
    log(f"  collapsed to 1 material / 1 UV set ({bake_uv_name})")


def nearest_pot(value):
    """Round to the nearest power of two. Kept POT because these GLBs mipmap in the restaurant
    scene, and a NPOT mip chain is the kind of thing that works on the dev machine and falls over
    on someone else's driver."""
    value = max(1, int(value))
    lower = 1 << (value.bit_length() - 1)
    upper = lower << 1
    return lower if (value - lower) <= (upper - value) else upper


def fit_texture(size, cap):
    """Cap a texture's LONGEST side at `cap` while preserving its aspect ratio.

    The cast plates are full-body portrait projections (726x1455, 575x1444, 572x1464), not the
    square 2048x2048 maps build_chef_blaze.py dealt with. Forcing them to cap x cap the way that
    script does would UPSCALE the short side — spending memory to invent detail — while throwing
    away half the long side's real detail. It would not distort the mapping (UVs are normalized, so a
    non-uniform image rescale still samples correctly), which is exactly why the mistake is easy to
    miss by eye: it costs quality and memory silently rather than looking wrong."""
    w, h = size
    longest = max(w, h)
    if longest <= cap:
        return (nearest_pot(w), nearest_pot(h))
    factor = cap / longest
    return (nearest_pot(w * factor), nearest_pot(h * factor))


def clear_anisotropy(mesh_obj):
    """See module docstring point 5 — defensive, currently a no-op for all three characters."""
    cleared = []
    for material in mesh_obj.data.materials:
        if material is None or not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            socket = node.inputs.get("Anisotropic")
            if socket is not None and socket.default_value != 0.0:
                cleared.append(f"{material.name} ({socket.default_value:.3f})")
                socket.default_value = 0.0
    log("zeroed Anisotropic on:", ", ".join(cleared) if cleared else "(none found — expected)")


# --------------------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------------------
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = {"character": None, "source": DEFAULT_SOURCE, "skip_sha": False}
    i = 0
    while i < len(argv):
        if argv[i] == "--character":
            args["character"] = argv[i + 1]; i += 2
        elif argv[i] == "--source":
            args["source"] = os.path.expanduser(argv[i + 1]); i += 2
        elif argv[i] == "--skip-sha":
            args["skip_sha"] = True; i += 1
        else:
            i += 1
    return args


def verify_source(path, skip):
    """Verify the out-of-repo source blend before building. Without the blend in git, this hash
    is the only thing tying a shipped GLB to a known scene."""
    if not os.path.exists(path):
        raise SystemExit(
            f"\n[build_cast] source blend not found: {path}\n"
            "  cast-pack.blend is deliberately NOT committed (129 MiB, no Git LFS in this repo).\n"
            "  Extract it from the delivery zip to that path, or pass --source <path>.\n"
            "  See assets/cast/README_ThreeJS.md.\n"
        )
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != SOURCE_SHA256:
        msg = (f"source blend SHA256 mismatch\n  expected {SOURCE_SHA256}\n  actual   {actual}")
        if not skip:
            raise SystemExit(f"\n[build_cast] {msg}\n  Pass --skip-sha to build anyway.\n")
        log("WARNING:", msg, "(--skip-sha)")
    else:
        log("source SHA256 verified:", actual)
    return actual


def main():
    args = parse_args()
    name = args["character"]
    if name not in CHARACTERS:
        raise SystemExit(f"--character must be one of {sorted(CHARACTERS)}, got {name!r}")
    cfg = CHARACTERS[name]
    source_sha = verify_source(args["source"], args["skip_sha"])
    log(f"building {name} — {cfg['role_note']}")

    arm = bpy.data.objects.get(cfg["rig"])
    assert arm is not None, f"rig {cfg['rig']!r} not found — has cast-pack.blend changed shape?"
    assert_walk_rig(arm)

    # 1. Inventory: every render-visible child must be either a configured part or an explicit
    # drop. An unclassified mesh is a build error, not something to guess at — that is what stops
    # a re-delivery from silently shipping (or silently losing) a new module.
    visible = [c for c in arm.children if c.type == "MESH" and not c.hide_render]
    known = set(cfg["parts"]) | set(cfg["drop"])
    unknown = [o.name for o in visible if o.name not in known]
    assert not unknown, f"unclassified meshes under {name}: {unknown} — add them to parts or drop"

    for drop_name in cfg["drop"]:
        obj = bpy.data.objects.get(drop_name)
        if obj is not None:
            log(f"  dropped {drop_name} ({tri_count(obj)} tris)")
            bpy.data.objects.remove(obj, do_unlink=True)

    # 2. Remove every other character and all staging/library scaffolding, so `use_selection`
    # cannot pick up a neighbour and textures we downsize belong only to this character.
    for other, other_cfg in CHARACTERS.items():
        if other == name:
            continue
        other_arm = bpy.data.objects.get(other_cfg["rig"])
        if other_arm is not None:
            for child in list(other_arm.children):
                bpy.data.objects.remove(child, do_unlink=True)
            bpy.data.objects.remove(other_arm, do_unlink=True)
    for obj in list(bpy.data.objects):
        if obj.name in SCAFFOLD_NAMES or obj.name.startswith(SCAFFOLD_PREFIXES):
            bpy.data.objects.remove(obj, do_unlink=True)
        elif obj.name.startswith("CHEF BLAZE") or obj.name.startswith(("Eye ", "Facial hair")):
            bpy.data.objects.remove(obj, do_unlink=True)
    log("stripped other characters and staging scaffolding")

    # 3. Decimate each part to its own triangle target, then bound its skin weights.
    parts = [bpy.data.objects[n] for n in cfg["parts"] if n in bpy.data.objects]
    total = 0
    for obj in parts:
        # Mirror first, on the dense mesh: decimation destroys the left/right symmetry the
        # spatial match depends on (see `mirror_side_weights`).
        mirror_side_weights(obj)
        total += decimate_to(obj, cfg["parts"][obj.name])
        bound_skin_weights(obj)
    log(f"total after decimate: {total} tris")

    # 4. Downsize this character's packed textures.
    used = set()
    for obj in parts:
        for slot in obj.material_slots:
            if slot.material and slot.material.node_tree:
                for node in slot.material.node_tree.nodes:
                    if node.type == "TEX_IMAGE" and node.image:
                        used.add(node.image)
    cap = cfg["texture_max_dim"]
    for img in used:
        before = tuple(img.size)
        want = fit_texture(before, cap)
        if want != before:
            img.scale(*want)
            log(f"  resized {img.name}: {before} -> {tuple(img.size)}")
        else:
            log(f"  kept {img.name}: {before}")

    # 5. Join into one mesh object / one skin, matching ChefBlaze.glb's shape.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    target = parts[0]
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    target.name = f"{name}_Mesh"
    target.data.name = f"{name}_MeshData"
    # Aurelia decimates from ~596,000 triangles to 8,000 — a 75x cut, aggressive enough to leave
    # degenerate faces and loose edges behind. Blender's exporter notices ("Mesh ... is not valid,
    # and may be exported wrongly") but exports anyway, so the damage would reach the GLB as
    # zero-area triangles, which is exactly what `npm run check:models` case 3 (zero-length
    # normals -> normalize(0) -> NaN -> whole-screen black through the bloom pass) is there to
    # catch. Repair it here instead of shipping it and hoping the check fires.
    if target.data.validate(verbose=False):
        log(f"  repaired invalid geometry in {target.data.name} (degenerate faces / loose edges)")
    log(f"joined {len(parts)} parts into {target.name}: {tri_count(target)} tris, "
        f"{len(target.data.materials)} material slots")

    # 5b. Bake front+rear into one texture — see bake_albedo's docstring for why this is not
    # optional for these characters.
    bake_albedo(target, cfg["bake_texture_size"], f"{name}_Albedo")

    # 6. Animations: rename this character's breathing loop to Idle, author a walk, push both to
    # NLA tracks (ACTIONS export mode takes the active action XOR NLA tracks — with two clips,
    # NLA tracks are the only way to get both out).
    idle_action = None
    for action in bpy.data.actions:
        if name.upper() in action.name.upper() and "breathing" in action.name.lower():
            idle_action = action
            break
    assert idle_action is not None, f"no breathing action found for {name}"
    source_idle_range = tuple(idle_action.frame_range)
    idle_name = f"{cfg['clip_prefix']}_Idle"
    walk_name = f"{cfg['clip_prefix']}_Walk_InPlace"
    bpy.context.scene.render.fps = WALK_FPS
    seated = cfg.get("seated", False)

    if seated:
        # A seated diner has no walk, so none is authored and none is exported — shipping a walk
        # clip that must never play is dead weight and an invitation to play it by mistake. The
        # source breathing loop is discarded rather than renamed: it is keyed against a STANDING
        # rest pose (see `author_seated_idle`).
        clip_names = [idle_name]
        idle_action = author_seated_idle(arm, idle_name)
        walk_action = None
    else:
        idle_action.name = idle_name
        idle_action.use_fake_user = True
        log(f"renamed breathing action -> {idle_name}, frames {tuple(idle_action.frame_range)}")
        clip_names = [idle_name, walk_name]
        walk_action = author_walk(arm, walk_name)

    arm.animation_data.action = idle_action
    arm.animation_data.nla_tracks.new().strips.new(idle_name, 1, idle_action)
    arm.animation_data.action = None
    if walk_action is not None:
        arm.animation_data.action = walk_action
        arm.animation_data.nla_tracks.new().strips.new(walk_name, 1, walk_action)
        arm.animation_data.action = None

    # Drop every OTHER character's action before export. `export_animation_mode="ACTIONS"` emits
    # each action in `bpy.data.actions` that is applicable to the exported armature — and because
    # all six rigs in this scene share an identical 61-bone name set (the very property that lets
    # one walk cycle serve all three characters), every other character's breathing loop is
    # "applicable" to this one. Without this, each GLB shipped all five actions: its own two plus
    # three foreign 120-frame clips. Harmless to a `findByName` lookup, but it is dead weight in
    # every download and it makes the file's own animation list lie about what the character can do.
    keep = set(clip_names)
    for action in list(bpy.data.actions):
        if action.name not in keep:
            bpy.data.actions.remove(action)
    log(f"pruned foreign actions; kept {sorted(keep)}")

    # 7. Bake the Blender-units-to-meters conversion into the armature's node scale — no vertex
    # data and no animation curve is touched, exactly as build_chef_blaze.py does it.
    arm.name = f"{name}_Rig"
    arm.data.name = f"{name}_Skeleton"
    arm.location = (0.0, 0.0, 0.0)  # cast-pack.blend lines the characters up along X for the render

    if seated:
        # Measure the character AS SEATED. Flexing the hips and knees lifts the feet well off the
        # original floor (the pelvis stays put while the shins swing under it), so the posed figure
        # both is a different height than the standing one AND no longer has its lowest point at
        # z=0. Scale from the measured posed extent, then lift the root by the same amount the
        # feet sit above zero so the diner lands on the floor of its seat rather than hovering.
        # Measure the pose THE CLIP ACTUALLY PRODUCES, by making the seated action active and
        # stepping the scene to its first frame, rather than hand-setting the bones and measuring
        # that. The two can disagree: any action still assigned to the armature is re-applied on
        # every depsgraph evaluation and silently overwrites a manually-set pose, so a hand-set
        # measurement can describe a pose that never ships. Driving it from the clip means the
        # number used for scaling is the same pose three.js will play.
        previous_action = arm.animation_data.action if arm.animation_data else None
        arm.animation_data.action = idle_action
        bpy.context.scene.frame_set(int(idle_action.frame_range[0]))
        bpy.context.view_layer.update()
        z_min, z_max = posed_z_extent(target)
        arm.animation_data.action = previous_action
        posed_height = z_max - z_min
        assert_seated(z_min, cfg["source_height_bu"])
        scale = cfg["target_height_m"] / posed_height
        arm.scale = (scale, scale, scale)
        arm.location = (0.0, 0.0, -z_min * scale)
        log(f"seated posed extent {z_min:.3f}..{z_max:.3f} bu (h={posed_height:.3f}); "
            f"scale {scale:.5f} -> {cfg['target_height_m']} m seated, root lifted "
            f"{-z_min * scale:+.4f} m so the feet rest at y=0")
    else:
        scale = cfg["target_height_m"] / cfg["source_height_bu"]
        arm.scale = (scale, scale, scale)
        log(f"scale {scale:.5f} -> {cfg['target_height_m']} m tall; root moved to origin")

    # 8. Defensive anisotropy clear (see module docstring point 5).
    clear_anisotropy(target)

    # 9. Export.
    out_path = os.path.join(HERE, cfg["out"])
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_def_bones=True,      # drops the 9 IK control/pole bones, which carry no weights
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    size = os.path.getsize(out_path)
    log(f"exported {out_path} ({size} bytes, {tri_count(target)} tris)")

    # Emit the manifest from the build itself rather than hand-maintaining it, so the numbers in
    # it cannot drift from the binary they describe. `sourceSha256` is what makes a rebuild
    # auditable with the source blend deliberately outside the repo.
    manifest = {
        "asset": name,
        "version": "cast-1.0.0",
        "story": "STORY-063",
        "source": "cast-pack.blend — four-character cast pack, NOT committed to this repo",
        "sourceSha256": source_sha,
        "sourcePathDefault": DEFAULT_SOURCE.replace(os.path.expanduser("~"), "~"),
        "sourceHeightBlenderUnits": cfg["source_height_bu"],
        "roleNote": cfg["role_note"],
        "runtime": {
            "file": cfg["out"],
            "heightMeters": cfg["target_height_m"],
            "heightMeasuredFrom": "posed seated mesh" if seated else "standing rest mesh",
            "units": "meters",
            "upAxis": "+Z in Blender / +Y in glTF",
            "forwardAxis": "-Y in Blender / +Z in glTF — matches RestaurantScene.ts's existing "
                           "+Z-forward avatar convention, so no corrective rotation is needed",
            "forwardAxisVerifiedBy": "rest-pose head-bone frames dumped across all four rigs "
                                     "(identical), plus re-importing each export and rendering "
                                     "from Blender -Y, where every character renders face-on",
            "root": "(0, 0, 0)",
            "fps": WALK_FPS,
            "triangles": tri_count(target),
            "materialSlots": len(target.data.materials),
            "uvSets": [layer.name for layer in target.data.uv_layers],
            "bakedAlbedo": f"{cfg['bake_texture_size']}x{cfg['bake_texture_size']}",
            "fileSizeBytes": size,
            "skinning": "bounded smooth (<=4 influences/vertex, normalized)",
        },
        "posture": "seated" if seated else "standing",
        "animations": (
            [{"name": idle_name, "frames": SEATED_FRAMES, "fps": WALK_FPS, "loop": True,
              "rootMotion": "in-place",
              "source": "authored by build_cast.py — a held seated pose with a shallow chest "
                        "rise; cast-pack.blend ships no seated pose, and its standing breathing "
                        "loop is keyed against a standing rest pose so it is not reused"}]
            if seated else
            [{"name": idle_name, "frames": int(source_idle_range[1] - source_idle_range[0] + 1),
              "fps": WALK_FPS, "loop": True, "rootMotion": "in-place",
              "source": "the character's own authored breathing loop, renamed only"},
             {"name": walk_name, "frames": WALK_FRAMES, "fps": WALK_FPS, "loop": True,
              "rootMotion": "in-place",
              "source": "authored by build_cast.py — cast-pack.blend ships no walk animation"}]
        ),
        "knownLimitations": [
            "Side profile is weak: these are front/rear image-projected volumetric "
            "reconstructions, so the silhouette is shallow and the texture stretches into "
            "vertical streaks along the side transition band. Worst on a character crossing "
            "open floor in profile.",
            "Both female heads carry a front/rear projection seam tearing horizontally across "
            "the mid-face. The packed source plates are clean — this is a projection defect, "
            "not a texture one. See STORY-063.",
            "No facial animation rig is supplied by the source.",
        ],
        "build": {
            "script": "build_cast.py",
            "invocation": f"/Applications/Blender.app/Contents/MacOS/Blender --background "
                          f"<cast-pack.blend> --python assets/cast/build_cast.py -- "
                          f"--character {name}",
            "blenderVersion": "5.2.1 LTS",
            "deterministic": True,
            "overwritesSourceBlend": False,
        },
    }
    manifest_path = os.path.join(HERE, f"{name}.manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    log("wrote", manifest_path)
    log("source_sha256", source_sha)
    log("done")


main()
