// Isometric canvas renderer + touch/mouse camera. 1 world unit = 1 art pixel.
//
// Crispness: the canvas backing store is exactly CSS size × devicePixelRatio and
// the zoom is always a whole number of *device* pixels per art pixel (`k`), with
// smoothing off — so every art pixel is an exact block of device pixels, even mid-pinch.
import { TileRuleEngine, hash32 } from './core.js';

const HW = 16, HH = 8; // half tile width/height (32x16 diamonds)
export const iso = (x, y) => ({ x: (x - y) * HW, y: (x + y) * HH });
export function tileAt(wx, wy) {
  const fx = wx / HW, fy = wy / HH;
  return { x: Math.round((fx + fy) / 2), y: Math.round((fy - fx) / 2) };
}
const toGrid = (wx, wy) => ({ x: (wx / HW + wy / HH) / 2, y: (wy / HH - wx / HW) / 2 });

export class ForestView {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.app = app;
    this.cam = { x: 0, y: 0 };
    this.visuals = [];
    this.objects = [];
    this.drawn = [];
    this.effects = [];
    this.firstSeen = new Map();
    this.edgeCache = new Map();
    this.engineFor = null;
    this.pointers = new Map();
    this.resize();
    this.k = Math.round((window.innerWidth < 600 ? 2 : 3) * this.dpr);
    this.installInput();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  }

  get sprites() { return this.app.sprites; }
  get game() { return this.app.game; }
  /** CSS pixels per art pixel. */
  get zoom() { return this.k / this.dpr; }
  get minK() { return Math.max(1, Math.round(this.dpr)); }
  get maxK() { return Math.round(8 * this.dpr); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    // CSS size derived from the backing size so the browser never resamples it.
    this.canvas.style.width = w / dpr + 'px';
    this.canvas.style.height = h / dpr + 'px';
    if (this.k) this.k = Math.min(this.maxK, Math.max(this.minK, this.k));
  }

  centerOn(tile) { const p = iso(tile.x, tile.y); this.cam = { x: p.x, y: p.y }; this.clamp(); }

  /** Keep the camera centre over the map (the edge forest fills the rest of the screen). */
  clamp() {
    const s = this.game.state.size;
    const m = this.app.content.tuning.visuals.cameraMarginTiles ?? 2;
    const g = toGrid(this.cam.x, this.cam.y);
    const gx = Math.min(Math.max(g.x, m), s.width - 1 - m);
    const gy = Math.min(Math.max(g.y, m), s.height - 1 - m);
    this.cam = { x: (gx - gy) * HW, y: (gx + gy) * HH };
  }

  setK(k, anchorScreen) {
    k = Math.min(this.maxK, Math.max(this.minK, Math.round(k)));
    if (k === this.k) return;
    if (anchorScreen) {
      // Zoom around a screen point so pinches feel anchored.
      const before = this.screenToWorld(anchorScreen.x, anchorScreen.y);
      this.k = k;
      const after = this.screenToWorld(anchorScreen.x, anchorScreen.y);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
    } else {
      this.k = k;
    }
    this.clamp();
  }

  // ---------------------------------------------------------- data sync

  /** Recompute tile visuals from the latest stats and rebuild the object list. */
  sync() {
    const g = this.game;
    const s = g.state;
    if (this.engineFor !== s.forestID + s.size.width) {
      this.engineFor = s.forestID + s.size.width;
      this.engine = new TileRuleEngine(this.app.content.tileRules, this.app.content.tuning.visuals.maxDecorationsPerTile, s.seed);
      this.visuals = [];
      this.firstSeen.clear();
      this.edgeCache.clear();
      this.centerOn({ x: Math.floor(s.size.width / 2), y: Math.floor(s.size.height / 2) });
    }
    const field = g.field(g.now());
    const overlay = this.app.ui.statOverlay;
    for (let y = 0; y < s.size.height; y++) {
      for (let x = 0; x < s.size.width; x++) {
        const stats = field.statsAt(x, y);
        const v = this.engine.visual(stats, x, y);
        if (overlay) v.overlay = overlayColor(stats);
        this.visuals[y * s.size.width + x] = v;
      }
    }
    this.rebuildObjects();
  }

  edgeVisual(x, y) {
    const key = x + ',' + y;
    let v = this.edgeCache.get(key);
    if (!v) {
      const edge = this.app.content.tuning.visuals.edge;
      v = edge ? this.engine.edgeVisual(x, y, this.game.state.size, edge) : { ground: 'tile.grass.a', overlays: [], decorations: [] };
      if (this.edgeCache.size > 20000) this.edgeCache.clear();
      this.edgeCache.set(key, v);
    }
    return v;
  }

  rebuildObjects() {
    const g = this.game, s = g.state, now = g.now();
    const objs = [];
    for (let y = 0; y < s.size.height; y++) {
      for (let x = 0; x < s.size.width; x++) {
        const v = this.visuals[y * s.size.width + x];
        if (!v) continue;
        const c = iso(x, y);
        v.decorations.forEach((d, i) => objs.push({
          sprite: d.sprite, x: c.x + d.dx, y: c.y + d.dy, flip: d.flip, z: x + y + 0.1 + i * 0.01 + d.dy * 0.001,
          phase: hash32(x, y, i) % 1000 / 250,
        }));
      }
    }
    for (const sp of s.spawns) {
      const def = this.app.content.items[sp.itemID];
      if (!def) continue;
      const c = iso(sp.tile.x, sp.tile.y);
      objs.push({ sprite: def.sprite, x: c.x, y: c.y, z: sp.tile.x + sp.tile.y + 0.5, tile: sp.tile, kind: 'spawn', key: sp.id, bob: true, phase: hash32(sp.tile.x, sp.tile.y) % 1000 / 100 });
    }
    for (const seed of s.plantedSeeds) {
      const stages = this.app.content.items[seed.seedItemID]?.growthSprites || ['__missing'];
      const p = g.seedProgress(seed, now);
      const idx = p >= 1 ? stages.length - 1 : Math.min(stages.length - 2, Math.floor(p * Math.max(1, stages.length - 1)));
      const c = iso(seed.tile.x, seed.tile.y);
      objs.push({ sprite: stages[Math.max(0, idx)], x: c.x, y: c.y, z: seed.tile.x + seed.tile.y + 0.45, tile: seed.tile, kind: 'seed', key: seed.id, phase: 0 });
    }
    for (const p of g.activePlacements) {
      const cr = g.creature(p.creatureID);
      if (!cr) continue;
      const art = this.app.art(cr);
      const c = iso(p.tile.x, p.tile.y);
      if (!this.firstSeen.has(p.id)) this.firstSeen.set(p.id, performance.now());
      objs.push({ sprite: art.sprite, variant: art.variant, x: c.x, y: c.y, z: p.tile.x + p.tile.y + 0.6, tile: p.tile, kind: 'creature', key: p.id, glimmer: cr.isGlimmer, phase: hash32(p.tile.x, p.tile.y) % 1000 / 300 });
    }
    // Spawns that vanished get a little "picked" pop.
    const keys = new Set(objs.filter((o) => o.key).map((o) => o.key));
    for (const o of this.objects) {
      if (o.kind === 'spawn' && !keys.has(o.key)) this.effects.push({ ...o, start: performance.now() });
    }
    this.objects = objs;
  }

  // ---------------------------------------------------------- drawing

  transform() {
    const scale = this.k;
    const ox = Math.round(this.canvas.width / 2 - this.cam.x * scale);
    const oy = Math.round(this.canvas.height / 2 - this.cam.y * scale);
    return { scale, ox, oy };
  }

  screenToWorld(sx, sy) {
    const { scale, ox, oy } = this.transform();
    return { x: (sx * this.dpr - ox) / scale, y: (sy * this.dpr - oy) / scale };
  }

  draw(time) {
    const ctx = this.ctx;
    const t = time / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1f3a1c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.engine) return;

    const { scale, ox, oy } = this.transform();
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.imageSmoothingEnabled = false;
    const view = {
      minX: -ox / scale - 24, maxX: (this.canvas.width - ox) / scale + 24,
      minY: -oy / scale - 16, maxY: (this.canvas.height - oy) / scale + 40,
    };
    const size = this.game.state.size;
    const W = size.width;

    // Every tile that could be on screen, in back-to-front order (map + edge forest).
    const corners = [toGrid(view.minX, view.minY), toGrid(view.maxX, view.minY), toGrid(view.minX, view.maxY), toGrid(view.maxX, view.maxY)];
    const gx0 = Math.floor(Math.min(...corners.map((c) => c.x))) - 1, gx1 = Math.ceil(Math.max(...corners.map((c) => c.x))) + 1;
    const gy0 = Math.floor(Math.min(...corners.map((c) => c.y))) - 1, gy1 = Math.ceil(Math.max(...corners.map((c) => c.y))) + 1;
    const visible = [];
    const edgeObjs = [];
    for (let d = gx0 + gy0; d <= gx1 + gy1; d++) {
      for (let x = Math.max(gx0, d - gy1); x <= Math.min(gx1, d - gy0); x++) {
        const y = d - x;
        const c = iso(x, y);
        if (c.x < view.minX || c.x > view.maxX || c.y < view.minY || c.y > view.maxY) continue;
        const inside = x >= 0 && y >= 0 && x < size.width && y < size.height;
        const v = inside ? this.visuals[y * W + x] : this.edgeVisual(x, y);
        if (!v) continue;
        visible.push([x, y, c, v]);
        if (!inside) for (const dd of v.decorations) edgeObjs.push({ sprite: dd.sprite, x: c.x + dd.dx, y: c.y + dd.dy, flip: dd.flip, z: x + y + 0.1, phase: 0 });
      }
    }

    // Ground + overlays + tint
    for (const [x, y, c, v] of visible) {
      const phase = ((x * 7 + y * 3) % 10) / 10;
      this.blit(v.ground, null, c.x, c.y, t + phase);
      for (const o of v.overlays) this.blit(o.sprite, null, c.x, c.y, t + phase, o.flip);
      const tint = v.overlay || v.tint;
      if (tint) {
        ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3]})`;
        diamond(ctx, c);
        ctx.fill();
      }
    }

    // Selection + influence rings (between ground and objects)
    const ui = this.app.ui;
    if (ui.selectedTile) {
      const c = iso(ui.selectedTile.x, ui.selectedTile.y);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1;
      diamond(ctx, c);
      ctx.fill();
      ctx.stroke();
    }
    for (const p of this.ringPlacements()) {
      const c = iso(p.tile.x, p.tile.y);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, p.radius * HW * Math.SQRT2, p.radius * HH * Math.SQRT2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Objects (depth sorted): map objects on screen + edge trees.
    const now = performance.now();
    const drawn = this.objects.filter((o) => o.x >= view.minX && o.x <= view.maxX && o.y >= view.minY && o.y <= view.maxY).concat(edgeObjs);
    drawn.sort((a, b) => a.z - b.z);
    this.drawn = drawn;
    for (const o of drawn) {
      let y = o.y;
      let alpha = 1;
      if (o.bob && (t + o.phase) % 4 < 0.3) y -= 1;
      if (o.kind === 'creature') {
        const age = (now - (this.firstSeen.get(o.key) || 0)) / 300;
        if (age < 1) { y -= Math.round(12 * (1 - age)); alpha = age; }
      }
      ctx.globalAlpha = alpha;
      this.blit(o.sprite, o.variant, o.x, y, t + o.phase, o.flip);
      ctx.globalAlpha = 1;
      if (o.glimmer) this.sparkles(o.x, y, t + o.phase);
    }

    // Effects: collected spawns float up and fade.
    this.effects = this.effects.filter((e) => now - e.start < 300);
    for (const e of this.effects) {
      const k = (now - e.start) / 300;
      ctx.globalAlpha = 1 - k;
      this.blit(e.sprite, e.variant, e.x, e.y - Math.round(10 * k), t);
      ctx.globalAlpha = 1;
    }
  }

  blit(id, variant, x, y, t, flip = false) {
    const frames = this.sprites.frames(id, variant);
    const f = frames[frames.length > 1 ? this.sprites.frameIndex(id, t) : 0];
    const a = this.sprites.anchor(id);
    if (flip) {
      this.ctx.save();
      this.ctx.translate(Math.round(x), 0);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(f.canvas, Math.round(-a.x), Math.round(y - a.y));
      this.ctx.restore();
    } else {
      this.ctx.drawImage(f.canvas, Math.round(x - a.x), Math.round(y - a.y));
    }
  }

  sparkles(x, y, t) {
    const ctx = this.ctx;
    const pts = [[-7, -14], [6, -12], [-4, -4], [8, -5]];
    pts.forEach(([dx, dy], i) => {
      if (Math.floor(t * 2 + i) % 3 !== 0) return;
      ctx.fillStyle = i % 2 ? '#fff6b0' : '#ffffff';
      ctx.fillRect(Math.round(x + dx), Math.round(y + dy), 1, 1);
    });
  }

  ringPlacements() {
    const ui = this.app.ui, g = this.game;
    if (ui.selectedCreatureID) {
      const p = g.activePlacement(ui.selectedCreatureID);
      return p ? [p] : [];
    }
    if (ui.mode && ui.mode.type === 'place') return g.activePlacements;
    return [];
  }

  // ---------------------------------------------------------- input

  /** Frontmost interactive object under a world point (pixel-accurate), else the tile. */
  hitTest(w) {
    for (let i = this.drawn.length - 1; i >= 0; i--) {
      const o = this.drawn[i];
      if (!o.kind) continue;
      const f = this.sprites.frames(o.sprite, o.variant)[0];
      const a = this.sprites.anchor(o.sprite);
      const px = Math.floor(w.x - (o.x - a.x)), py = Math.floor(w.y - (o.y - a.y));
      if (px < -1 || py < -1 || px > f.w || py > f.h) continue;
      // Generous: accept a hit within 1px of an opaque pixel.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx, qy = py + dy;
        if (qx >= 0 && qy >= 0 && qx < f.w && qy < f.h && f.alpha[qy * f.w + qx] > 0) return o.tile;
      }
    }
    return tileAt(w.x, w.y);
  }

  installInput() {
    const el = this.canvas;
    let moved = false, startDist = 0, startK = this.k, last = null, downAt = 0;
    const mid = () => {
      const ps = [...this.pointers.values()];
      return { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2, d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) };
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) { moved = false; last = { x: e.clientX, y: e.clientY }; downAt = performance.now(); }
      if (this.pointers.size === 2) { const m = mid(); startDist = m.d; startK = this.k; last = m; moved = true; }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        if (!moved && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) return;
        moved = true;
        this.cam.x -= (e.clientX - last.x) / this.zoom;
        this.cam.y -= (e.clientY - last.y) / this.zoom;
        last = { x: e.clientX, y: e.clientY };
        this.clamp();
      } else if (this.pointers.size === 2) {
        const m = mid();
        this.cam.x -= (m.x - last.x) / this.zoom;
        this.cam.y -= (m.y - last.y) / this.zoom;
        this.setK(startK * (m.d / Math.max(1, startDist)), m);
        last = m;
        this.clamp();
      }
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const wasPinch = this.pointers.size === 2;
      this.pointers.delete(e.pointerId);
      if (wasPinch) {
        const rest = [...this.pointers.values()][0];
        if (rest) last = { ...rest };
        return;
      }
      if (!moved && e.type === 'pointerup' && performance.now() - downAt < 600) {
        const w = this.screenToWorld(e.clientX, e.clientY);
        this.app.handleTap(this.hitTest(w));
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setK(e.deltaY < 0 ? this.k * 1.25 + 1 : this.k / 1.25 - 1, { x: e.clientX, y: e.clientY });
    }, { passive: false });
  }
}

function diamond(ctx, c) {
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - HH); ctx.lineTo(c.x + HW, c.y); ctx.lineTo(c.x, c.y + HH); ctx.lineTo(c.x - HW, c.y);
  ctx.closePath();
}

function overlayColor(stats) {
  const colors = {
    damp: [50, 100, 255], glow: [100, 255, 255], bloom: [255, 115, 190],
    verdure: [80, 230, 80], stone: [165, 165, 180], depth: [115, 50, 155],
  };
  let r = 0, g = 0, b = 0, total = 0, max = 0;
  for (const k in colors) {
    const v = stats[k] || 0;
    r += colors[k][0] * v; g += colors[k][1] * v; b += colors[k][2] * v; total += v;
    max = Math.max(max, v);
  }
  if (total < 0.5) return [0, 0, 0, 0.55];
  return [Math.round(r / total), Math.round(g / total), Math.round(b / total), Math.min(0.9, 0.35 + max / 150)];
}
