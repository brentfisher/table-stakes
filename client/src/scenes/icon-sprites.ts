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
const LABEL_TEXTURE_WIDTH = 256;
const LABEL_TEXTURE_HEIGHT = 88;

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
  const radius = LABEL_TEXTURE_HEIGHT / 2 - 4;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(4, 4, LABEL_TEXTURE_WIDTH - 8, LABEL_TEXTURE_HEIGHT - 8, radius);
  ctx.fill();

  ctx.fillStyle = '#1b1f24';
  // A single size fits every PRD §5.2 label this ships with ("READY", "GOING COLD", "T04",
  // "T12") — all short enough at this chip width; a future longer label would need its own
  // measurement pass, not a concern for this story's fixed vocabulary.
  let fontSize = 34;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  // Destination names and restaurant identity share this chip style with ready-food labels.
  // Fit their text inside the backing instead of clipping longer names such as UPGRADES.
  while (ctx.measureText(text).width > LABEL_TEXTURE_WIDTH - 28 && fontSize > 16) {
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
