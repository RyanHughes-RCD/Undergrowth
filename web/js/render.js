// Isometric canvas renderer + touch/mouse camera. 1 world unit = 1 art pixel.
import { TileRuleEngine, hash32 } from './core.js';

const HW = 16, HH = 8; // half tile width/height (32x16 diamonds)
export const iso = (x, y) => ({ x: (x - y) * HW, y: (x + y) * HH });
export function tileAt(wx, wy) {
  const fx = wx / HW, fy = wy / HH;
  return { x: Math.round((fx + fy) / 2), y: Math.round((fy - fx) / 2) };
}

export class ForestView {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.zoom = window.innerWidth < 600 ? 2 : 3;
    this.cam = { x: 0, y: 0 };
    this.visuals = [];
    this.order = [];
    this.objects = [];
    this.effects = [];
    this.firstSeen = new Map();
    this.engineFor = null;
    this.dirty = true;
    this.pointers = new Map();
    this.installInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get sprites() { return this.app.sprites; }
  get game() { return this.app.game; }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.dirty = true;
  }

  centerOn(tile) { const p = iso(tile.x, tile.y); this.cam = { x: p.x, y: p.y }; this.clamp(); }

  worldBounds() {
    const { width: w, height: h } = this.game.state.size;
    return { minX: -(h - 1) * HW - HW, maxX: (w - 1) * HW + HW, minY: -HH, maxY: (w + h - 2) * HH + HH + 8 };
  }

  clamp() {
    const b = this.worldBounds();
    this.cam.x = Math.min(Math.max(this.cam.x, b.minX), b.maxX);
    this.cam.y = Math.min(Math.max(this.cam.y, b.minY), b.maxY);
  }

  // ---------------------------------------------------------- data sync

  /** Recompute tile visuals from the latest stats and rebuild the draw list. */
  sync() {
    const g = this.game;
    const s = g.state;
    if (this.engineFor !== s.forestID) {
      this.engineFor = s.forestID;
      this.engine = new TileRuleEngine(this.app.content.tileRules, this.app.content.tuning.visuals.maxDecorationsPerTile, s.seed);
      this.visuals = [];
      this.firstSeen.clear();
      const tiles = [];
      for (let y = 0; y < s.size.height; y++) for (let x = 0; x < s.size.width; x++) tiles.push({ x, y });
      tiles.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);
      this.order = tiles;
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
    this.dirty = true;
  }

  rebuildObjects() {
    const g = this.game, s = g.state, now = g.now();
    const objs = [];
    for (const t of this.order) {
      const v = this.visuals[t.y * s.size.width + t.x];
      if (!v) continue;
      const c = iso(t.x, t.y);
      v.decorations.forEach((d, i) => objs.push({
        sprite: d.sprite, x: c.x + d.dx, y: c.y + d.dy, flip: d.flip, z: t.x + t.y + 0.1 + i * 0.01 + d.dy * 0.001,
        phase: hash32(t.x, t.y, i) % 1000 / 250,
      }));
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
    objs.sort((a, b) => a.z - b.z);
    this.objects = objs;
  }

  // ---------------------------------------------------------- drawing

  transform() {
    const scale = this.zoom * this.dpr;
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
    ctx.fillStyle = '#171f17';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.order.length) return;

    const { scale, ox, oy } = this.transform();
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.imageSmoothingEnabled = false;
    const view = {
      minX: -ox / scale - 40, maxX: (this.canvas.width - ox) / scale + 40,
      minY: -oy / scale - 40, maxY: (this.canvas.height - oy) / scale + 40,
    };
    const W = this.game.state.size.width;

    // Ground
    for (const tile of this.order) {
      const c = iso(tile.x, tile.y);
      if (c.x < view.minX || c.x > view.maxX || c.y < view.minY || c.y > view.maxY) continue;
      const v = this.visuals[tile.y * W + tile.x];
      if (!v) continue;
      this.blit(v.ground, null, c.x, c.y, t + ((tile.x * 7 + tile.y * 3) % 10) / 10);
      const tint = v.overlay || v.tint;
      if (tint) {
        ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3]})`;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - HH); ctx.lineTo(c.x + HW, c.y); ctx.lineTo(c.x, c.y + HH); ctx.lineTo(c.x - HW, c.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Selection + influence rings (between ground and objects)
    const ui = this.app.ui;
    if (ui.selectedTile) {
      const c = iso(ui.selectedTile.x, ui.selectedTile.y);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - HH); ctx.lineTo(c.x + HW, c.y); ctx.lineTo(c.x, c.y + HH); ctx.lineTo(c.x - HW, c.y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    for (const p of this.ringPlacements()) {
      const c = iso(p.tile.x, p.tile.y);
      const rx = p.radius * HW * Math.SQRT2, ry = p.radius * HH * Math.SQRT2;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1 / this.zoom * 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Objects (depth sorted)
    const now = performance.now();
    for (const o of this.objects) {
      if (o.x < view.minX || o.x > view.maxX || o.y < view.minY || o.y > view.maxY) continue;
      let y = o.y;
      let alpha = 1;
      if (o.bob && (t + o.phase) % 4 < 0.3) y -= 1;
      if (o.kind === 'creature') {
        const age = (now - (this.firstSeen.get(o.key) || 0)) / 300;
        if (age < 1) { y -= Math.round(12 * (1 - age)); alpha = age; }
        // Little idle hop rhythm comes from the 2-frame animation.
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
    if (this.effects.length) this.dirty = true;
  }

  blit(id, variant, x, y, t, flip = false) {
    const frames = this.sprites.frames(id, variant);
    const f = frames[frames.length > 1 ? this.sprites.frameIndex(id, t) : 0];
    const a = this.sprites.anchor(id);
    if (flip) {
      this.ctx.save();
      this.ctx.translate(x, 0);
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
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (!o.kind) continue;
      const frames = this.sprites.frames(o.sprite, o.variant);
      const f = frames[0];
      const a = this.sprites.anchor(o.sprite);
      const px = Math.floor(w.x - (o.x - a.x)), py = Math.floor(w.y - (o.y - a.y));
      if (px < 0 || py < 0 || px >= f.w || py >= f.h) continue;
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
    let moved = false, startDist = 0, startZoom = 3, last = null, downAt = 0;
    const mid = () => {
      const ps = [...this.pointers.values()];
      return { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2, d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) };
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) { moved = false; last = { x: e.clientX, y: e.clientY }; downAt = performance.now(); }
      if (this.pointers.size === 2) { const m = mid(); startDist = m.d; startZoom = this.zoom; last = m; moved = true; }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        if (!moved && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) return;
        moved = true;
        this.cam.x -= dx / this.zoom; this.cam.y -= dy / this.zoom;
        last = { x: e.clientX, y: e.clientY };
      } else if (this.pointers.size === 2) {
        const m = mid();
        this.zoom = Math.min(8, Math.max(1, startZoom * (m.d / Math.max(1, startDist))));
        this.cam.x -= (m.x - last.x) / this.zoom; this.cam.y -= (m.y - last.y) / this.zoom;
        last = m;
      }
      this.clamp();
      this.dirty = true;
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const wasPinch = this.pointers.size === 2;
      this.pointers.delete(e.pointerId);
      if (wasPinch) {
        this.zoom = Math.min(8, Math.max(1, Math.round(this.zoom)));
        const rest = [...this.pointers.values()][0];
        if (rest) last = { ...rest };
        this.dirty = true;
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
      this.zoom = Math.min(8, Math.max(1, this.zoom + (e.deltaY < 0 ? 1 : -1)));
      this.dirty = true;
    }, { passive: false });
  }
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
