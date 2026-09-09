import * as THREE from 'three';

import dishesData from '../../shared/game-data/dishes.json';
import layoutData from '../../shared/game-data/restaurant-layout.json';
import { buildReadyUpPayload, READY_UP_STAGES } from '../../shared/game-logic/ready-up-menu.js';
import { selectableAddons, selectableMains, type Dish } from '../../shared/schemas/setup-rules.js';
import { disposeFoodObject, loadArcadeFoodObject } from '../../client/src/scenes/FoodModels';
import type { SceneHarness } from './harness-shell';

const DISHES = dishesData.dishes as unknown as Dish[];
const INGREDIENTS = dishesData.ingredients as Record<string, { name: string; unitCost: number }>;
const MAINS = selectableMains(DISHES, layoutData as unknown);
const EXTRAS = selectableAddons(DISHES, layoutData as unknown);
const DISH_BY_ID = new Map(DISHES.map((dish) => [dish.id, dish]));

export const readyUpMenuHarness: SceneHarness = (() => {
  let root: HTMLElement | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let activeModel: THREE.Object3D | null = null;
  let animationFrame = 0;
  let clickListener: ((event: MouseEvent) => void) | null = null;
  let stageIndex = 0;
  let mainIds = MAINS.slice(0, 3).map((dish) => dish.id);
  let extraIds = [EXTRAS[0]?.id].filter((id): id is string => Boolean(id));
  let focusId = mainIds[0];
  const prices = Object.fromEntries(DISHES.map((dish) => [dish.id, dish.suggestedPrice]));

  const disposeScene = () => {
    cancelAnimationFrame(animationFrame);
    if (activeModel) disposeFoodObject(activeModel);
    activeModel = null;
    renderer?.dispose();
    renderer = null;
  };

  const mountScene = (canvas: HTMLCanvasElement, assetId: string) => {
    const nextRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer = nextRenderer;
    nextRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    nextRenderer.outputColorSpace = THREE.SRGBColorSpace;
    nextRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xf5fbff, 0x53636e, 2.1));
    const light = new THREE.DirectionalLight(0xffead0, 3);
    light.position.set(-3, 6, 4);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 30);
    camera.position.set(2.8, 2.5, 3.8);
    camera.lookAt(0, 0.7, 0);
    const group = new THREE.Group();
    scene.add(group);
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(1.28, 1.42, 0.16, 48),
      new THREE.MeshStandardMaterial({ color: 0x263848, metalness: 0.25, roughness: 0.42 }),
    );
    stand.position.y = -0.08;
    group.add(stand);

    void loadArcadeFoodObject(assetId).then((loaded) => {
      if (renderer !== nextRenderer) { disposeFoodObject(loaded); return; }
      const box = new THREE.Box3().setFromObject(loaded);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = 1.9 / Math.max(size.x, size.y, size.z, 0.001);
      loaded.scale.multiplyScalar(scale);
      loaded.position.set(-center.x * scale, 0.03 - box.min.y * scale, -center.z * scale);
      activeModel = loaded;
      group.add(loaded);
    });

    const draw = (time: number) => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      nextRenderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      group.rotation.y = time * 0.00022;
      nextRenderer.render(scene, camera);
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
  };

  const render = () => {
    if (!root) return;
    disposeScene();
    const stage = READY_UP_STAGES[stageIndex];
    const chosen = [...mainIds, ...extraIds].map((id) => DISH_BY_ID.get(id)).filter(Boolean) as Dish[];
    const payload = buildReadyUpPayload({
      mainIds, extraIds, prices, dishes: DISHES, ingredients: INGREDIENTS, layout: layoutData,
    });
    const choices = stage === 'mains' ? MAINS : stage === 'extras' ? EXTRAS : chosen;
    const focus = DISH_BY_ID.get(focusId) ?? choices[0];
    const inventory = Object.entries(payload.startingInventory);
    const title = stage === 'mains' ? 'Choose your mains' : stage === 'extras' ? 'Choose your extras' : 'Set your prices';
    const detail = stage === 'mains' ? 'Pick exactly three dishes that define your restaurant.' : stage === 'extras' ? 'Add up to two extras, or continue without them.' : 'Balance value and margin, then ready up.';

    root.innerHTML = `
      <header class="ready-harness-top">
        <b>T/S <small>TABLE STAKES</small></b>
        <nav>${READY_UP_STAGES.map((item, index) => `<button data-stage="${index}" class="${index === stageIndex ? 'is-current' : index < stageIndex ? 'is-complete' : ''}"><span>${index < stageIndex ? '✓' : `0${index + 1}`}</span>${item}</button>`).join('')}</nav>
        <strong>1:24 <small>RIVAL CHOOSING</small></strong>
      </header>
      <section class="ready-harness-heading"><span>0${stageIndex + 1} / OPENING LINEUP · STADIUM DISTRICT</span><h2>${title}</h2><p>${detail}</p></section>
      <section class="ready-harness-body">
        <div class="ready-harness-hero"><canvas></canvas><span>LIVE 3D PREVIEW</span><strong>${focus?.name ?? 'Opening lineup'}</strong><small>${focus?.tags.join(' · ') ?? 'Select an inventory item to inspect it'}</small></div>
        <div class="ready-harness-options">
          ${stage === 'prices' ? chosen.map((dish) => `<button data-focus="${dish.id}" class="${dish.id === focus?.id ? 'is-selected' : ''}"><span><strong>${dish.name}</strong><small>$${dish.baseCost.toFixed(2)} plate cost · Competitive</small></span><b>$${prices[dish.id].toFixed(2)}</b></button>`).join('') : choices.map((dish, index) => {
            const selected = (stage === 'mains' ? mainIds : extraIds).includes(dish.id);
            return `<button data-toggle="${dish.id}" class="${selected ? 'is-selected' : ''}"><em>0${index + 1}</em><span><strong>${dish.name}</strong><small>${dish.tags.slice(0, 3).join(' · ')}</small></span><b>${selected ? '✓' : '+'}</b></button>`;
          }).join('')}
          ${stage === 'prices' ? `<div class="ready-harness-stock"><span>OPENING PANTRY · AUTO STOCKED</span><div>${inventory.slice(0, 8).map(([id, units]) => `<button data-focus="${id}">${INGREDIENTS[id].name}<b>${units}u</b></button>`).join('')}</div></div>` : ''}
        </div>
      </section>
      <footer class="ready-harness-footer"><button data-back ${stageIndex === 0 ? 'disabled' : ''}>← BACK</button><div><strong>${stage === 'mains' ? `${mainIds.length} OF 3 MAINS SELECTED` : stage === 'extras' ? `${extraIds.length} OF 2 EXTRAS SELECTED` : `${chosen.length} DISHES PRICED`}</strong><small>Choices stay saved between stages.</small></div><button data-next>${stageIndex === 2 ? 'CONFIRM & READY ✓' : 'CONFIRM & NEXT →'}</button></footer>`;
    const canvas = root.querySelector('canvas');
    if (canvas && (focus?.id ?? focusId)) mountScene(canvas, focus?.id ?? focusId);
  };

  return {
    id: 'ready-up-menu',
    title: 'Ready-up Menu',
    description: 'Interactive HTML and Three.js preview of the three-stage mains, extras, and pricing flow.',
    mount(container) {
      root = document.createElement('section');
      root.className = 'ready-up-harness';
      container.appendChild(root);
      clickListener = (event) => {
        const button = (event.target as HTMLElement).closest('button');
        if (!button || button.disabled) return;
        if (button.dataset.stage) stageIndex = Number(button.dataset.stage);
        if (button.hasAttribute('data-back')) stageIndex = Math.max(0, stageIndex - 1);
        if (button.hasAttribute('data-next')) stageIndex = Math.min(2, stageIndex + 1);
        const id = button.dataset.toggle;
        if (id) {
          focusId = id;
          const list = stageIndex === 0 ? mainIds : extraIds;
          const limit = stageIndex === 0 ? 3 : 2;
          const next = list.includes(id) ? list.filter((item) => item !== id) : list.length < limit ? [...list, id] : list;
          if (stageIndex === 0) mainIds = next; else extraIds = next;
        }
        if (button.dataset.focus) focusId = button.dataset.focus;
        render();
      };
      root.addEventListener('click', clickListener);
      render();
    },
    dispose() {
      disposeScene();
      if (root && clickListener) root.removeEventListener('click', clickListener);
      root?.replaceChildren();
      root = null;
      clickListener = null;
    },
  };
})();
