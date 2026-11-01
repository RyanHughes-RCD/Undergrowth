// Sprite registry: decodes data sprites (palette + index rows + frames) into canvases.
import { parseHex } from './core.js';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOOKUP = (() => {
  const m = { '.': 0 };
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET[i]] = i;
  return m;
})();

export const MISSING = '__missing';

const MISSING_SPRITE = {
  id: MISSING, size: [8, 8], anchor: [4, 8], palette: ['transparent', '#1a001a', '#ff00ff'],
  frames: [{ rows: ['11111111', '12222221', '12211221', '12221221', '12212221', '12222221', '12212221', '11111111'] }],
};

export class SpriteRegistry {
  constructor(sprites, palettes) {
    this.sprites = new Map();
    this.palettes = new Map();
    this.cache = new Map();
    this.register(MISSING_SPRITE);
    for (const p of palettes || []) this.palettes.set(p.id, p);
    for (const s of sprites || []) this.register(s);
  }

  register(sprite) {
    this.sprites.set(sprite.id, sprite);
    for (const k of [...this.cache.keys()]) if (k.startsWith(sprite.id + '|')) this.cache.delete(k);
  }

  sprite(id) { return this.sprites.get(id) || this.sprites.get(MISSING); }
  has(id) { return this.sprites.has(id); }

  size(id) { const s = this.sprite(id); return { w: s.size[0], h: s.size[1] }; }
  anchor(id) {
    const s = this.sprite(id);
    return s.anchor && s.anchor.length === 2 ? { x: s.anchor[0], y: s.anchor[1] } : { x: s.size[0] / 2, y: s.size[1] };
  }
  durations(id) { return this.sprite(id).frames.map((f) => f.duration ?? 0.25); }

  palette(sprite) {
    const list = sprite.palette || (sprite.paletteRef && this.palettes.get(sprite.paletteRef)?.colors) || ['transparent', '#ff00ff'];
    return list.map((c) => parseHex(c) || [255, 0, 255, 255]);
  }

  /**
   * Decoded frames as { canvas, alpha } for a sprite + variant.
   * variant: { swap: { "2": "#rrggbb" }, silhouette: [r,g,b] }
   */
  frames(id, variant) {
    const key = id + '|' + (variant ? JSON.stringify(variant) : '');
    let out = this.cache.get(key);
    if (out) return out;
    const s = this.sprite(id);
    const pal = this.palette(s);
    if (variant && variant.swap) {
      for (const k in variant.swap) {
        const i = parseInt(k, 10), c = parseHex(variant.swap[k]);
        if (c && i >= 0 && i < pal.length) pal[i] = c;
      }
    }
    const [w, h] = s.size;
    out = s.frames.map((f) => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(w, h);
      const alpha = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const row = f.rows[y] || '';
        for (let x = 0; x < w; x++) {
          const idx = LOOKUP[row[x]] || 0;
          if (idx <= 0 || idx >= pal.length) continue;
          let c = pal[idx];
          if (c[3] === 0) continue;
          if (variant && variant.silhouette) c = [...variant.silhouette, c[3]];
          const o = (y * w + x) * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c[3];
          alpha[y * w + x] = c[3];
        }
      }
      ctx.putImageData(img, 0, 0);
      return { canvas, alpha, w, h };
    });
    this.cache.set(key, out);
    return out;
  }

  /** Frame index at time `t` seconds (with an optional phase offset). */
  frameIndex(id, t) {
    const d = this.durations(id);
    if (d.length <= 1) return 0;
    const total = d.reduce((a, b) => a + b, 0) || 1;
    let r = ((t % total) + total) % total;
    for (let i = 0; i < d.length; i++) { if (r < d[i]) return i; r -= d[i]; }
    return d.length - 1;
  }

  /** A crisp, CSS-scaled canvas element for the UI. */
  element(id, variant, scale = 3, className = '', animate = false) {
    const frames = this.frames(id, variant);
    const f = frames[0];
    const c = document.createElement('canvas');
    c.width = f.w; c.height = f.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(f.canvas, 0, 0);
    c.style.width = f.w * scale + 'px';
    c.style.height = f.h * scale + 'px';
    c.className = 'px ' + className;
    if (animate && frames.length > 1) {
      // Step through the sprite's own frames while the element is on screen.
      const start = performance.now();
      let shown = 0;
      const step = (now) => {
        if (!c.isConnected && now - start > 1000) return;
        const i = this.frameIndex(id, (now - start) / 1000);
        if (i !== shown) { shown = i; ctx.clearRect(0, 0, f.w, f.h); ctx.drawImage(frames[i].canvas, 0, 0); }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    return c;
  }
}
