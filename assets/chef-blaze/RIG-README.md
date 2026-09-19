# Chef Blaze

Open **chef-blaze.blend** in Blender 5.2 or newer. The file contains a million-triangle character sculpt, separate fitted eye details and facial-hair strands, packed PBR textures, a humanoid armature, a breathing animation, and a lit studio with a render camera. The character follows the supplied Chef Blaze references: chef's hat and coat, red neckerchief, handlebar mustache and goatee, flame trousers, and black boots.

## Animate the character

1. Select **CHEF BLAZE | Humanoid Animation Rig** and enter **Pose Mode**. Enable viewport **Overlays** to see the bones; overlays are initially hidden for a clean view.
2. Use the **Body**, **Fingers**, and **IK controls** bone collections to find controls. The rig starts in FK mode; rotate the body and finger bones normally.
3. For IK, open the rig object's **Custom Properties**. Set `arm_IK_L`, `arm_IK_R`, `leg_IK_L`, or `leg_IK_R` to `1`. Move the corresponding `CTRL_hand_IK` or `CTRL_foot_IK` bone and its elbow/knee pole. Set the property back to `0` for FK. Targets outside limb reach cannot be reached; FK/IK switching has no automatic pose matching.
4. Play frames **1–120** for the supplied breathing loop at 30 fps. Frame 1 is the neutral pose. Duplicate or replace the action to create another animation.

The character is 7.3 Blender units tall including the hat. Scale the armature and its child meshes together for another project.

## Rendering and materials

`chef-blaze-hero.png` is the final studio preview. `chef-blaze-pose.png` demonstrates a combined limb and head pose. The scene uses Cycles and AgX. Color, normal, and metallic/roughness maps are embedded in the blend file; no external texture downloads are required.

The main sculpt has 1,000,000 triangles; fitted eyes and facial-hair geometry bring the complete character to 1,091,556 triangles. This is a dense hero asset for rendering and animation; efficient gameplay use needs retopology and texture baking. Facial features follow the head, with a fixed expression. Fingers have approximate skeletal fitting and should be checked for each new animation, particularly extreme curls.

## Validation and construction

Body weights were normalized, and lower-arm/hand assignments were corrected using connected mesh geometry to eliminate cross-influence from the torso and legs. Validation included root translation, head/limb/finger rotations, reachable arm/leg IK targets, and a rendered bent-arm, finger, head, and leg pose. All 668,911 character vertices have normalized deformation weights; no used textures are missing or unpacked. The file is saved in its neutral pose.

The asset was reconstructed from the supplied reference with Rodin Gen-2.5 High, then refined, rigged, lit, and checked through the running Blender MCP connection. The earlier procedural versions are retained as workspace checkpoints, outside this deliverable folder.
