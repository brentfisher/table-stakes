import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import {
  disposeFoodObject,
  loadArcadeFoodObject,
} from '../scenes/FoodModels';

export function FoodModelPreview({
  assetId,
  label,
  compact = false,
}: {
  assetId: string;
  label: string;
  compact?: boolean;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      canvas.dataset.failed = 'true';
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.set(2.7, 2.4, 3.6);
    camera.lookAt(0, 0.65, 0);
    scene.add(new THREE.HemisphereLight(0xf2fbff, 0x52606a, 2.1));
    const key = new THREE.DirectionalLight(0xffead0, 2.8);
    key.position.set(-3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6ad7e9, 1.8);
    rim.position.set(4, 2, -3);
    scene.add(rim);

    const turntable = new THREE.Group();
    scene.add(turntable);
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.28, 0.14, 48),
      new THREE.MeshStandardMaterial({ color: 0x243744, metalness: 0.25, roughness: 0.45 }),
    );
    stand.position.y = -0.08;
    turntable.add(stand);

    let model: THREE.Object3D | null = null;
    let disposed = false;
    let frame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void loadArcadeFoodObject(assetId).then((loaded) => {
      if (disposed) {
        disposeFoodObject(loaded);
        return;
      }
      const box = new THREE.Box3().setFromObject(loaded);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = (compact ? 1.25 : 1.65) / Math.max(size.x, size.y, size.z, 0.001);
      loaded.scale.multiplyScalar(scale);
      loaded.position.set(-center.x * scale, 0.02 - box.min.y * scale, -center.z * scale);
      model = loaded;
      turntable.add(loaded);
      canvas.dataset.ready = 'true';
    }).catch(() => { canvas.dataset.failed = 'true'; });

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      if (canvas.width !== Math.round(width * renderer.getPixelRatio())
        || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };
    const render = (time: number) => {
      resize();
      if (!reducedMotion) turntable.rotation.y = time * 0.00022;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (model) disposeFoodObject(model);
      stand.geometry.dispose();
      (stand.material as THREE.Material).dispose();
      renderer.dispose();
    };
  }, [assetId, compact]);

  return <canvas ref={canvasRef} className="food-model-preview" aria-label={`${label} 3D preview`} />;
}
