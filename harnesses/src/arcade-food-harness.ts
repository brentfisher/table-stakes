import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ARCADE_FOOD_ASSETS,
  ARCADE_FOOD_MODEL_URLS,
  buildArcadeFoodProxy,
  disposeFoodObject,
  type ArcadeFoodAsset,
} from '../../client/src/scenes/FoodModels';
import dishesData from '../../shared/game-data/dishes.json';
import type { SceneHarness } from './harness-shell';

type Filter = 'all' | 'dish' | 'ingredient';
type DishDefinition = { id: string; name: string; ingredients: Record<string, number>; stationSteps: Array<{ station: string }> };
const DISHES = dishesData.dishes as unknown as DishDefinition[];

function detailFor(asset: ArcadeFoodAsset): string {
  if (asset.category === 'dish') {
    const dish = DISHES.find((item) => item.id === asset.id);
    if (!dish) return 'Finished menu item, ready for service.';
    const ingredients = Object.keys(dish.ingredients)
      .map((id) => (dishesData.ingredients as Record<string, { name: string }>)[id]?.name ?? id)
      .join(' · ');
    return `${ingredients} · ${dish.stationSteps.map((step) => step.station.toUpperCase()).join(' → ')}`;
  }
  const usedBy = DISHES.filter((dish) => asset.id in dish.ingredients).map((dish) => dish.name);
  return usedBy.length > 0 ? `Used by ${usedBy.join(' · ')}` : 'Individual pantry ingredient.';
}

export const arcadeFoodHarness: SceneHarness = (() => {
  let renderer: THREE.WebGLRenderer | null = null;
  let controls: OrbitControls | null = null;
  let scene: THREE.Scene | null = null;
  let observer: ResizeObserver | null = null;
  let active: THREE.Group | null = null;
  let mountedRoot: HTMLElement | null = null;
  let errorListener: ((event: ErrorEvent) => void) | null = null;
  let rejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;

  return {
    id: 'arcade-food-library',
    title: 'Arcade Food Library',
    description: 'HTML catalogue and live Three.js preview for all eight dishes and eighteen pantry ingredients.',
    mount(container) {
      const root = document.createElement('section');
      root.className = 'food-library-preview';
      mountedRoot = root;

      const catalogue = document.createElement('aside');
      catalogue.className = 'food-library-catalogue';
      catalogue.innerHTML = '<div class="food-library-kicker">COPPER & THYME</div><h2>Arcade Food</h2><p>26 authored game assets</p>';
      const filters = document.createElement('nav');
      filters.className = 'food-library-filters';
      const list = document.createElement('div');
      list.className = 'food-library-list';
      catalogue.append(filters, list);

      const viewer = document.createElement('main');
      viewer.className = 'food-library-viewer';
      const canvasHost = document.createElement('div');
      canvasHost.className = 'food-library-canvas';
      const copy = document.createElement('div');
      copy.className = 'food-library-copy';
      const category = document.createElement('div');
      category.className = 'food-library-kicker';
      const name = document.createElement('h2');
      const description = document.createElement('p');
      const stats = document.createElement('p');
      stats.className = 'food-library-stats';
      const status = document.createElement('span');
      status.className = 'food-library-status';
      const download = document.createElement('a');
      download.className = 'food-library-download';
      download.textContent = 'Open GLB ↗';
      download.target = '_blank';
      copy.append(category, name, description, stats, status, download);
      viewer.append(canvasHost, copy);
      root.append(catalogue, viewer);
      container.appendChild(root);

      errorListener = (event) => {
        status.textContent = `Preview error: ${event.message}`;
        status.classList.remove('is-ready');
      };
      rejectionListener = (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
        status.textContent = `Preview error: ${reason}`;
        status.classList.remove('is-ready');
      };
      window.addEventListener('error', errorListener);
      window.addEventListener('unhandledrejection', rejectionListener);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x20150f);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      canvasHost.appendChild(renderer.domElement);

      const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.7;
      controls.minDistance = 0.3;
      controls.maxDistance = 5;
      controls.maxPolarAngle = Math.PI * 0.49;
      scene.add(new THREE.HemisphereLight(0xfff0d2, 0x6f8d80, 2.2));
      const key = new THREE.DirectionalLight(0xffdfad, 3);
      key.position.set(-1.2, 2, 1.4);
      key.castShadow = true;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xbde7ff, 1.2);
      fill.position.set(1.2, 0.8, -1);
      scene.add(fill);
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(0.42, 64),
        new THREE.ShadowMaterial({ opacity: 0.22 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.003;
      ground.receiveShadow = true;
      scene.add(ground);

      let selected = ARCADE_FOOD_ASSETS[0];
      let filter: Filter = 'all';
      let lastStatus = '';

      const resize = () => {
        if (!renderer) return;
        const width = Math.max(1, canvasHost.clientWidth);
        const height = Math.max(1, canvasHost.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize);
      observer.observe(canvasHost);
      resize();

      const select = (asset: ArcadeFoodAsset) => {
        selected = asset;
        if (active) {
          active.removeFromParent();
          disposeFoodObject(active);
        }
        active = buildArcadeFoodProxy(asset.id);
        scene?.add(active);
        category.textContent = asset.category === 'dish' ? 'READY FOR SERVICE' : 'FROM THE PANTRY';
        name.textContent = asset.name;
        description.textContent = detailFor(asset);
        const { x, y, z } = asset.dimensions;
        stats.textContent = `${Math.round(x * 100)} × ${Math.round(y * 100)} × ${Math.round(z * 100)} cm`;
        status.textContent = 'Loading authored GLB…';
        lastStatus = '';
        download.href = ARCADE_FOOD_MODEL_URLS[asset.id];
        const distance = Math.max(0.72, Math.max(x, y, z) * 2.5);
        camera.position.set(distance * 0.72, y * 0.55 + distance * 0.5, distance);
        controls?.target.set(0, y * 0.42, 0);
        controls?.update();
        renderList();
      };

      const renderList = () => {
        list.replaceChildren();
        ARCADE_FOOD_ASSETS.filter((asset) => filter === 'all' || asset.category === filter).forEach((asset) => {
          const button = document.createElement('button');
          button.className = 'food-library-item';
          button.classList.toggle('is-active', asset.id === selected.id);
          const number = String(ARCADE_FOOD_ASSETS.indexOf(asset) + 1).padStart(2, '0');
          button.innerHTML = `<span>${number}</span><strong>${asset.name}</strong><b>↗</b>`;
          button.onclick = () => select(asset);
          list.appendChild(button);
        });
      };

      (['all', 'dish', 'ingredient'] as Filter[]).forEach((value) => {
        const button = document.createElement('button');
        button.textContent = value === 'all' ? 'All 26' : value === 'dish' ? 'Dishes' : 'Pantry';
        button.classList.toggle('is-active', value === filter);
        button.onclick = () => {
          filter = value;
          filters.querySelectorAll('button').forEach((item) => item.classList.toggle('is-active', item === button));
          renderList();
        };
        filters.appendChild(button);
      });

      select(selected);
      renderer.setAnimationLoop(() => {
        if (!renderer || !scene || !controls) return;
        controls.update();
        const nextStatus = String(active?.userData.arcadeFoodStatus ?? 'loading');
        if (nextStatus !== lastStatus) {
          lastStatus = nextStatus;
          status.textContent = nextStatus === 'ready' ? 'Authored GLB loaded' : nextStatus === 'fallback' ? 'Model unavailable' : 'Loading authored GLB…';
          status.classList.toggle('is-ready', nextStatus === 'ready');
        }
        renderer.render(scene, camera);
      });
    },
    dispose() {
      observer?.disconnect();
      observer = null;
      if (errorListener) window.removeEventListener('error', errorListener);
      if (rejectionListener) window.removeEventListener('unhandledrejection', rejectionListener);
      errorListener = null;
      rejectionListener = null;
      renderer?.setAnimationLoop(null);
      controls?.dispose();
      if (scene) {
        disposeFoodObject(scene);
        scene.clear();
      }
      renderer?.dispose();
      renderer = null;
      controls = null;
      scene = null;
      active = null;
      mountedRoot?.remove();
      mountedRoot = null;
    },
  };
})();
