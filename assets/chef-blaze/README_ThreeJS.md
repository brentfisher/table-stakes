# Chef Blaze character package

Chef Blaze is an original street-food chef hero built for the Table Stakes arcade game. The character uses a friendly oversized toque, expressive moustached face, crisp double-breasted jacket, red neckerchief, flame-wrapped pants, and chunky kitchen boots. Materials are Principled PBR with soft bevels and saturated toy-like highlights so the silhouette stays readable in a Three.js scene.

## Files

- `ChefBlaze.glb` — runtime mesh, armature, materials, and four animation clips.
- `ChefBlaze_Master.blend` — editable Blender source with presentation camera, lights, metadata, and named collections.
- `build_chef_blaze.py` — deterministic Blender/MCP build script; writes the package beside itself.
- `three-demo.html` — standalone GLTFLoader + AnimationMixer preview with orbit controls and restrained bloom.
- `previews/chef-blaze-front.png`, `chef-blaze-side.png`, `chef-blaze-back.png` — review renders from the master scene.
- `target-turnaround.png` — visual brief used for the generated target design.

## Runtime contract

- Units are meters; the authored character is approximately 1.90 m including the toque.
- Blender is Z-up and Chef Blaze faces `-Y`; the glTF export is Y-up. Keep the imported root at `(0, 0, 0)` and move the gameplay entity separately.
- The four clips are authored at 30 FPS and are in-place: `ChefBlaze_Idle` (1–90), `ChefBlaze_Walk_InPlace` (1–30), `ChefBlaze_Run_InPlace` (1–24), and `ChefBlaze_Slide_DirectionChange` (1–18).
- Component meshes use single-bone weights for stable browser draw calls and clear arcade posing. The rig includes root, spine/chest, neck/head, clavicles, arms, hands/fingers, legs/feet, hat secondary motion, scarf tails, and facial control bones.

## Three.js

```js
const gltf = await new GLTFLoader().loadAsync('/assets/chef-blaze/ChefBlaze.glb');
const mixer = new THREE.AnimationMixer(gltf.scene);
const run = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'ChefBlaze_Run_InPlace'));
run.reset().fadeIn(0.12).play();
// in your render loop: mixer.update(clock.getDelta());
```

Enable `renderer.outputColorSpace = THREE.SRGBColorSpace`, ACES filmic tone mapping, and shadows. `three-demo.html` shows the complete setup, including a small `UnrealBloomPass` and cross-fading buttons for all clips.

## Rebuilding through Blender MCP

With Blender running and the local MCP bridge listening on `localhost:9876`, send the contents of `build_chef_blaze.py` as an `execute` request (`strict_json: true`) using the bridge's null-byte-delimited JSON protocol. The script creates the collections `ChefBlaze_GEO`, `ChefBlaze_RIG`, `ChefBlaze_MAT`, `ChefBlaze_ANIM`, `ChefBlaze_COLLIDERS`, and `REF_Attached`, then renders the three preview angles and exports the GLB.
