# Chef Blaze · polished turnaround rebuild

Chef Blaze is a fresh, arcade-ready character authored from the supplied polished four-angle turnaround. The earlier blockout render is deliberately excluded from the runtime package; the Blender source keeps it only in `REF_FailedLowPoly_DoNotUse` so it cannot be mistaken for a modeling reference.

## Runtime files

- `ChefBlaze.glb` — glTF 2.0 binary with one conventional humanoid skin and four named actions.
- `ChefBlaze_Master.blend` — source scene with presentation lights, camera, references, collections, rig, materials, and animation.
- `three-demo.html` — standalone Three.js viewer with orbit controls, restrained bloom, shadows, and clip switching.
- `previews/` — front, three-quarter, side, and back PNG captures for story requirements.
- `target-turnaround.png` — authoritative supplied design target.
- `build_chef_blaze.py` — deterministic Blender/MCP authoring script used to create the scene.
- `manifest.json` — machine-readable asset and animation metadata.

## Technical report

- Blender source: 5.2.x, meters, Z-up; glTF export uses Y-up conversion. Character faces `-Y` in Blender.
- Authored runtime height: approximately **1.87 m** including toque and boots (target range 1.75–1.90 m).
- Preview render: Blender Eevee, 800×900 PNG, navy studio world, warm key + cool fill/rim, soft contact shadow.
- Geometry: 93 runtime mesh objects plus 8 curve details; approximately 35,110 source mesh vertices and 69,868 triangulated faces before glTF conversion. The GLB is about 6.3 MB.
- Materials: glTF-compatible Principled materials with coat/specular tuning; no external texture files are required. Layered red/orange/yellow flame panels wrap front, sides, and rear of both pant legs.
- Rig: 32-bone deform skeleton with `root`, pelvis/spine/chest/neck/head, clavicles, upper/lower arms, hands, four fingers and thumb per hand, thigh/shin/foot/toe chains. Garment and accessory parts use rigid single-bone weights for reliable browser playback. The head includes `Smile`, `Blink_L`, and `Blink_R` shape keys.
- Root motion: idle, walk, and run are in-place. Slide is a non-looping in-place direction-change pose; world translation remains game-code owned.
- FPS and clips: 30 FPS.
  - `ChefBlaze_Idle`: frames 1–75, loop.
  - `ChefBlaze_Walk_InPlace`: frames 1–30, loop.
  - `ChefBlaze_Run_InPlace`: frames 1–30, loop.
  - `ChefBlaze_Slide_DirectionChange`: frames 1–20, non-looping.

## Three.js integration

```js
const gltf = await new GLTFLoader().loadAsync('./ChefBlaze.glb');
scene.add(gltf.scene);
const mixer = new THREE.AnimationMixer(gltf.scene);
const clips = Object.fromEntries(gltf.animations.map((clip) => [clip.name, clip]));
const idle = mixer.clipAction(clips.ChefBlaze_Idle).play();

function playClip(name) {
  const next = mixer.clipAction(clips[name]);
  next.reset();
  next.setLoop(name === 'ChefBlaze_Slide_DirectionChange' ? THREE.LoopOnce : THREE.LoopRepeat);
  next.clampWhenFinished = name === 'ChefBlaze_Slide_DirectionChange';
  next.crossFadeFrom(idle, 0.18, true).play();
  idle = next;
}
```

The included demo is served over HTTP so module imports and GLB loading work consistently. Start any static server from the repository root, then open `assets/chef-blaze/three-demo.html`.
