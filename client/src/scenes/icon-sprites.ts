// Canvas-drawn glyph sprites for the PRD §14 3D indicators that need a legible symbol rather
// than only a color (role icons, task icons, the ingredient-shortage glyph, the food-ready
// glyph, table-state badges). A `THREE.Sprite` always faces the camera, which is what keeps a
// small icon readable from the close high-angle camera without the geometry-facing tricks a
// flat plane would need.
//
// BUILD THE TEXTURE ONCE PER GLYPH, REUSE IT FOREVER. The canvas draw (measuring text, filling
// a rounded rect, etc.) only has to happen once per distinct glyph string — customers alone can
// churn dozens of times a match, and re-rasterizing a canvas texture on every `upsert` would be
// exactly the per-entity allocation this file exists to avoid (see `RestaurantScene.ts`'s own
// `setCarrying` comment on the same discipline for plates). Coloring is done PER SPRITE via
// `material.color`, tinting a shared white-ink-on-transparent texture, so many differently
// colored sprites can still share one rasterized texture.

import * as THREE from 'three';

const textureCache = new Map<string, THREE.CanvasTexture>();

/** Rasterize one glyph (a short string, typically 1-2 characters or a simple symbol) as white
 * ink on a transparent square canvas. Cached by the glyph string alone — color is applied later
 * by the sprite material, not baked into the canvas. */
function glyphTexture(glyph: string): THREE.CanvasTexture {
  const cached = textureCache.get(glyph);
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  // A filled circle backing keeps every glyph legible against any background it floats over
  // (a bright dining floor, a dark station) — white so the sprite's own tint color shows
  // through evenly rather than fighting a baked-in shade.
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1b1f24';
  ctx.font = `bold ${glyph.length > 1 ? 26 : 34}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, size / 2, size / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  textureCache.set(glyph, texture);
  return texture;
}

/** A new sprite instance using (and, if needed, lazily creating) the shared texture for
 * `glyph`. Each call returns its OWN `Sprite`/`SpriteMaterial` so callers can independently set
 * `.color`, `.visible` and `.scale` per entity without touching any other sprite showing the
 * same glyph — the texture is the only thing shared. */
export function createGlyphSprite(glyph: string, colorHex: number, scale = 0.5): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: glyphTexture(glyph),
    color: colorHex,
    depthTest: false, // always readable, never clipped behind a table or station mesh
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale, scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Recolor an existing glyph sprite created by `createGlyphSprite` — the per-frame/per-snapshot
 * path, never allocating a new texture or material. Works equally on a `createLabelSprite`
 * sprite below: both are plain `SpriteMaterial`s, this only ever touches `.color`. */
export function setGlyphSpriteColor(sprite: THREE.Sprite, colorHex: number): void {
  (sprite.material as THREE.SpriteMaterial).color.setHex(colorHex);
}

const labelTextureCache = new Map<string, THREE.CanvasTexture>();
// Bumped 1.5x (was 256x88 / fontSize 34) — the wayfinding placards (table numbers, station
// names, PICKUP/PANTRY/UPGRADES/etc.) were reported hard to read from normal camera distance.
// Raster resolution scales with the world-space size increase in `buildWayfinding` below so
// text stays crisp rather than just magnifying a lower-res texture.
const LABEL_TEXTURE_WIDTH = 384;
const LABEL_TEXTURE_HEIGHT = 132;

/** STORY-030. `glyphTexture` above only fits a 1-2 character symbol in a circle — PRD §5.2's
 * ready-food chips need real short WORDS ("READY", "GOING COLD", "T04"), which need a wider
 * pill-shaped chip, not a circle. Same discipline as `glyphTexture` otherwise: white ink/fill
 * baked once per distinct STRING, cached, and tinted per instance via `setGlyphSpriteColor` —
 * see that function's own updated comment. */
function labelTexture(text: string): THREE.CanvasTexture {
  const cached = labelTextureCache.get(text);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = LABEL_TEXTURE_WIDTH;
  canvas.height = LABEL_TEXTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.clearRect(0, 0, LABEL_TEXTURE_WIDTH, LABEL_TEXTURE_HEIGHT);
  const radius = LABEL_TEXTURE_HEIGHT / 2 - 6;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(6, 6, LABEL_TEXTURE_WIDTH - 12, LABEL_TEXTURE_HEIGHT - 12, radius);
  ctx.fill();

  ctx.fillStyle = '#1b1f24';
  // A single size fits every PRD §5.2 label this ships with ("READY", "GOING COLD", "T04",
  // "T12") — all short enough at this chip width; a future longer label would need its own
  // measurement pass, not a concern for this story's fixed vocabulary.
  let fontSize = 51;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  // Destination names and restaurant identity share this chip style with ready-food labels.
  // Fit their text inside the backing instead of clipping longer names such as UPGRADES.
  while (ctx.measureText(text).width > LABEL_TEXTURE_WIDTH - 42 && fontSize > 24) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, LABEL_TEXTURE_WIDTH / 2, LABEL_TEXTURE_HEIGHT / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  labelTextureCache.set(text, texture);
  return texture;
}

/** A new sprite instance showing short WORD text (unlike `createGlyphSprite`'s single symbol)
 * on a rounded chip — PRD §5.2 "compact state label"/"target table chip". `scale` sets the
 * chip's height in world units; width follows the texture's own aspect ratio so the chip never
 * stretches. */
export function createLabelSprite(text: string, colorHex: number, scale = 0.5): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: labelTexture(text),
    color: colorHex,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  const aspect = LABEL_TEXTURE_WIDTH / LABEL_TEXTURE_HEIGHT;
  sprite.scale.set(scale * aspect, scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// --- STORY-057: large 2D dish pictures for the kitchen order queue board ("expo rail") --------
//
// Report: "the expo rail shows the items when you click it. I would rather the entire back wall
// have 2d pictures of the dishes we need to make largely" — corrected premise (see
// `RestaurantScene.ts#upsertQueueBoardDish`'s own header): the board already had an ALWAYS-VISIBLE
// display, just a small one built from `buildDishProxy`'s real-scale 3D models (5x2 grid on a
// 3.4-unit board). This replaces that grid with big, flat, at-a-glance-legible 2D cards — same
// "rasterize once per distinct key, cache forever, never re-draw on a hot path" discipline every
// other function in this file already documents, keyed by `dishId` (a fixed ~8-entry catalogue,
// `shared/game-data/dishes.json`) rather than by an arbitrary string, since a dish's picture never
// changes shape once drawn.
//
// NOT AN ELABORATE ILLUSTRATION PIPELINE (deliberately, per this story's own scope note): no art
// asset exists for any dish as a 2D image (checked `shared/game-data/dishes.json` — no icon/image
// field; `FoodModels.ts`/`food-preview-renderer.ts` are both 3D-model-only, the former loading
// GLBs, the latter turntable-previewing them into a DOM canvas via a shared WebGL context — neither
// produces a flat picture usable as a texture here). So each card is drawn from data already on
// hand: a per-dish accent color (`DISH_PICTURE_ACCENTS` below, `RestaurantScene.ts`) tinting a
// circular "plate" with the dish's initials, plus its full name — "a colored shape + a short
// label/glyph", the story's own explicit bar, not a hand-illustrated icon set.
const dishPictureTextureCache = new Map<string, THREE.CanvasTexture>();
const DISH_PICTURE_WIDTH = 300;
const DISH_PICTURE_HEIGHT = 360;

/** `name`/`accentHex` are read only on first draw for a given `dishId` — see the cache-forever
 * comment above. `dishId` alone is the cache key (not `name`, unlike `labelTexture`) because the
 * catalogue is fixed and small; keying by `dishId` also means a future dish with a name collision
 * against an existing one (unlikely, but `labelTexture`'s own key IS its text) can never share a
 * mis-drawn texture. */
function dishPictureTexture(dishId: string, name: string, accentHex: number): THREE.CanvasTexture {
  const cached = dishPictureTextureCache.get(dishId);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = DISH_PICTURE_WIDTH;
  canvas.height = DISH_PICTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.clearRect(0, 0, DISH_PICTURE_WIDTH, DISH_PICTURE_HEIGHT);

  // Card backing — one neutral cream tone for every dish (not tinted per-dish), so the accent
  // circle below is the one thing that varies and reads as "this dish's own color" rather than
  // competing with a colored card edge.
  ctx.fillStyle = '#faf3e6';
  ctx.strokeStyle = '#2a2620';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(6, 6, DISH_PICTURE_WIDTH - 12, DISH_PICTURE_HEIGHT - 12, 22);
  ctx.fill();
  ctx.stroke();

  // The "picture": a big colored disc (the plate/dish silhouette, simplified to its most legible
  // shape at a glance-from-across-the-kitchen distance) plus a 1-2 letter monogram baked in
  // white ink — same white-ink-on-color-fill idea `glyphTexture` already uses, just bigger.
  ctx.fillStyle = `#${accentHex.toString(16).padStart(6, '0')}`;
  ctx.beginPath();
  ctx.arc(DISH_PICTURE_WIDTH / 2, 150, 108, 0, Math.PI * 2);
  ctx.fill();

  const initials = name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 86px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, DISH_PICTURE_WIDTH / 2, 154);

  // Full dish name below the disc — same shrink-to-fit loop `labelTexture` uses, so a longer
  // name (e.g. "Chicken Sandwich") never clips past the card's own edge.
  ctx.fillStyle = '#241f18';
  let fontSize = 38;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  const upperName = name.toUpperCase();
  while (ctx.measureText(upperName).width > DISH_PICTURE_WIDTH - 28 && fontSize > 18) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  }
  ctx.fillText(upperName, DISH_PICTURE_WIDTH / 2, DISH_PICTURE_HEIGHT - 44);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  dishPictureTextureCache.set(dishId, texture);
  return texture;
}

/** A new sprite instance for one dish's big picture card — `scale` sets the card's HEIGHT in
 * world units, width follows the texture's own portrait aspect ratio (same convention
 * `createLabelSprite` uses). Unlike `createGlyphSprite`/`createLabelSprite`, color is baked
 * into the texture itself (each dish's accent is permanent, not a per-instance tint), so the
 * sprite material's own `.color` is left at its default white — there is nothing to recolor
 * per instance the way a badge sprite's severity color changes. */
export function createDishPictureSprite(dishId: string, name: string, accentHex: number, scale = 1.6): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: dishPictureTexture(dishId, name, accentHex),
    depthTest: false, // same "always readable, never clipped" choice `createGlyphSprite` documents
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  const aspect = DISH_PICTURE_WIDTH / DISH_PICTURE_HEIGHT;
  sprite.scale.set(scale * aspect, scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** STORY-053. Swaps a `createLabelSprite` sprite's TEXT in place, for the rare label whose text
 * changes after creation — `RestaurantScene#upsertReadyDish`'s staged "WAITING ON N" chip is the
 * first one: a sibling ticket finishing lowers N over a single ticket's own on-pass lifetime,
 * unlike READY/GOING COLD's two fixed strings, which are built once and only ever toggled by
 * visibility. Goes through the SAME `labelTexture` cache `createLabelSprite` reads, so this is a
 * cache hit (a map lookup, not a new canvas draw) for any count already seen this session. */
export function setLabelSpriteText(sprite: THREE.Sprite, text: string): void {
  const material = sprite.material as THREE.SpriteMaterial;
  const next = labelTexture(text);
  if (material.map === next) return;
  material.map = next;
  material.needsUpdate = true;
}
