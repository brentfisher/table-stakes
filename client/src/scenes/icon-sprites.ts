// Canvas-drawn glyph sprites for the PRD §14 3D indicators that need a legible symbol rather
// than only a color (role icons, task icons, the ingredient-shortage glyph, the food-ready
// glyph, table-state badges). A `THREE.Sprite` always faces the camera, which is what keeps a
// small icon readable from the fixed high-angle camera (`CameraController`'s default height 24,
// distance 21) without the geometry-facing tricks a flat plane would need.
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
 * path, never allocating a new texture or material. */
export function setGlyphSpriteColor(sprite: THREE.Sprite, colorHex: number): void {
  (sprite.material as THREE.SpriteMaterial).color.setHex(colorHex);
}
