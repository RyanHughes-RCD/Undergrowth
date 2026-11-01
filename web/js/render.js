// Top-down canvas renderer + touch/mouse camera. 1 world unit = 1 art pixel; tiles are 16x16.
//
// The forest is fitted into the space between the HUD bars at a whole number of device
// pixels per art pixel (crisp), and everything beyond the map is a shrub treeline, so the
// screen edges are always framed by hedge. Pinch to zoom in; pan is clamped to the map.
import { TileRuleEngine, hash32 } from './core.js';

export const TS = 16;
const FOOT = 5; // objects stand a little below the tile centre
export const centre = (x, y) => ({ x: x * TS + TS / 2, y: y * TS + TS / 2 });
export const tileAt = (wx, wy) => ({ x: Math.floor(wx / TS), y: Math.floor(wy / TS) });

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
    this.insets = { top: 80, bottom: 170 };
    this.k = 0;
    this.resize();
    this.installInput();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  }

  get sprites() { return this.app.sprites; }
  get game() { return this.app.game; }
  /** CSS pixels per art pixel. */
  get zoom() { return this.k / this.dpr; }
  get mapW() { return this.game.state.size.width * TS; }
  get mapH() { return this.game.state.size.height * TS; }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    // CSS size derived from the backing size so the browser never resamples it.
    this.canvas.style.width = w / dpr + 'px';
    this.canvas.style.height = h / dpr + 'px';
    this.fit();
  }

  /** Measure the HUD so the forest sits between the top bar and the bottom controls. */
  measure() {
    // Only the permanent HUD (name bar, slots + nav), so popping cards don't make the forest jump.
    const top = document.querySelector('.name-btn');
    const bottom = document.querySelector('.slots');
    const insets = {
      top: top ? top.getBoundingClientRect().bottom + 4 : 80,
      bottom: bottom ? window.innerHeight - bottom.getBoundingClientRect().top + 4 : 170,
    };
    if (Math.abs(insets.top - this.insets.top) > 2 || Math.abs(insets.bottom - this.insets.bottom) > 2) {
      this.insets = insets;
      this.fit();
    }
  }

  /** Available play area in CSS px. */
  area() {
    const w = window.innerWidth, h = window.innerHeight;
    const top = Math.min(this.insets.top, h * 0.3), bottom = Math.min(this.insets.bottom, h * 0.4);
    return { x: 0, y: top, w, h: Math.max(100, h - top - bottom) };
  }

  /** Whole-device-pixel scale at which the entire map fits the play area. */
  fitK() {
    if (!this.app.game) return Math.round(2 * this.dpr);
    const a = this.area();
    const pad = 4;
    const k = Math.floor(this.dpr * Math.min((a.w - 8) / (this.mapW + pad), a.h / (this.mapH + pad)));
    return Math.max(1, k);
  }

  fit() {
    if (!this.app.game) return;
    const fk = this.fitK();
    if (!this.k || this.k < fk || this.fittedK === this.k) this.k = fk;
    this.fittedK = fk;
    this.clamp();
  }

  centerOn(tile) { const p = centre(tile.x, tile.y); this.cam = { x: p.x, y: p.y }; this.clamp(); }

  /** When the map fits, keep it centred; when zoomed in, keep the view over the map. */
  clamp() {
    if (!this.app.game) return;
    const a = this.area();
    const hw = a.w / 2 / this.zoom, hh = a.h / 2 / this.zoom;
    const clampAxis = (v, size, half) => (size <= half * 2 ? size / 2 : Math.min(Math.max(v, half), size - half));
    this.cam.x = clampAxis(this.cam.x, this.mapW, hw);
    this.cam.y = clampAxis(this.cam.y, this.mapH, hh);
  }

  setK(k, anchorScreen) {
    const minK = this.fitK();
    k = Math.min(minK * 4, Math.max(minK, Math.round(k)));
    if (k === this.k) return;
    if (anchorScreen) {
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
    if (this.engineFor !== s.forestID + s.size.width + 'x' + s.size.height) {
      this.engineFor = s.forestID + s.size.width + 'x' + s.size.height;
      this.engine = new TileRuleEngine(this.app.content.tileRules, this.app.content.tuning.visuals.maxDecorationsPerTile, s.seed);
      this.visuals = [];
      this.firstSeen.clear();
      this.edgeCache.clear();
      this.k = 0;
      this.fit();
      this.cam = { x: this.mapW / 2, y: this.mapH / 2 };
    }
    const field = g.field(g.now());
    const overlay = this.app.ui.statOverlay;
    const overrides = g.groundOverrides(field);
    for (let y = 0; y < s.size.height; y++) {
      for (let x = 0; x < s.size.width; x++) {
        const stats = field.statsAt(x, y);
        const v = this.engine.visual(stats, x, y);
        const forced = overrides.get(x + ',' + y);
        if (forced) { v.ground = forced; v.overlays = []; }
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
    const at = (t) => { const c = centre(t.x, t.y); return { x: c.x, y: c.y + FOOT }; };
    for (let y = 0; y < s.size.height; y++) {
      for (let x = 0; x < s.size.width; x++) {
        const v = this.visuals[y * s.size.width + x];
        if (!v) continue;
        const c = centre(x, y);
        v.decorations.forEach((d, i) => objs.push({
          sprite: d.sprite, x: c.x + Math.round(d.dx * 0.8), y: c.y + d.dy + 3, flip: d.flip,
          phase: hash32(x, y, i) % 1000 / 250,
        }));
      }
    }
    for (const sp of s.spawns) {
      const def = this.app.content.items[sp.itemID];
      if (!def) continue;
      objs.push({ sprite: def.sprite, ...at(sp.tile), tile: sp.tile, kind: 'spawn', key: sp.id, bob: true, phase: hash32(sp.tile.x, sp.tile.y) % 1000 / 100 });
    }
    for (const seed of s.plantedSeeds) {
      const stages = this.app.content.items[seed.seedItemID]?.growthSprites || ['__missing'];
      const p = g.seedProgress(seed, now);
      const idx = p >= 1 ? stages.length - 1 : Math.min(stages.length - 2, Math.floor(p * Math.max(1, stages.length - 1)));
      objs.push({ sprite: stages[Math.max(0, idx)], ...at(seed.tile), tile: seed.tile, kind: 'seed', key: seed.id, phase: 0 });
    }
    for (const p of g.activePlacements) {
      const cr = g.creature(p.creatureID);
      if (!cr) continue;
      const art = this.app.art(cr);
      if (!this.firstSeen.has(p.id)) this.firstSeen.set(p.id, performance.now());
      objs.push({ sprite: art.sprite, variant: art.variant, ...at(p.tile), tile: p.tile, kind: 'creature', key: p.id, glimmer: cr.isGlimmer, phase: hash32(p.tile.x, p.tile.y) % 1000 / 300 });
    }
    for (const v of s.visitors || []) {
      const def = this.app.content.creatures[v.speciesID];
      if (!def) continue;
      objs.push({ sprite: def.sprite, ...at(v.tile), tile: v.tile, kind: 'visitor', key: v.id, bob: true, glimmer: true, phase: hash32(v.tile.x, v.tile.y) % 1000 / 100 });
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
    const a = this.area();
    const scale = this.k;
    const cx = (a.x + a.w / 2) * this.dpr, cy = (a.y + a.h / 2) * this.dpr;
    return { scale, ox: Math.round(cx - this.cam.x * scale), oy: Math.round(cy - this.cam.y * scale) };
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
    this.measure();

    const { scale, ox, oy } = this.transform();
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.imageSmoothingEnabled = false;
    const view = { minX: -ox / scale, maxX: (this.canvas.width - ox) / scale, minY: -oy / scale, maxY: (this.canvas.height - oy) / scale };
    const size = this.game.state.size;
    const W = size.width;

    // Every tile on screen (map + treeline), plus a margin for tall shrubs.
    const x0 = Math.floor(view.minX / TS) - 1, x1 = Math.floor(view.maxX / TS) + 1;
    const y0 = Math.floor(view.minY / TS) - 1, y1 = Math.floor(view.maxY / TS) + 2;
    const edgeObjs = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const inside = x >= 0 && y >= 0 && x < size.width && y < size.height;
        const v = inside ? this.visuals[y * W + x] : this.edgeVisual(x, y);
        if (!v) continue;
        const c = centre(x, y);
        const phase = ((x * 7 + y * 3) % 10) / 10;
        this.blit(v.ground, null, c.x, c.y, t + phase);
        for (const o of v.overlays) this.blit(o.sprite, null, c.x, c.y, t + phase, o.flip);
        const tint = v.overlay || v.tint;
        if (tint) {
          ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3]})`;
          ctx.fillRect(x * TS, y * TS, TS, TS);
        }
        if (!inside) {
          for (const d of v.decorations) edgeObjs.push({ sprite: d.sprite, x: c.x + d.dx, y: c.y + TS / 2 + d.dy, flip: d.flip, phase: 0 });
        }
      }
    }

    // Selection + influence rings (between ground and objects)
    const ui = this.app.ui;
    ctx.lineWidth = 1;
    if (ui.selectedTile) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(ui.selectedTile.x * TS, ui.selectedTile.y * TS, TS, TS);
      ctx.strokeRect(ui.selectedTile.x * TS + 0.5, ui.selectedTile.y * TS + 0.5, TS - 1, TS - 1);
    }
    for (const p of this.ringPlacements()) {
      const c = centre(p.tile.x, p.tile.y);
      const r = Math.max(0.5, this.game.stats.reach(p.radius) - 0.5) * TS;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Objects (sorted by their feet): map objects on screen + the shrub treeline.
    const now = performance.now();
    const pad = 32;
    const drawn = this.objects.filter((o) => o.x >= view.minX - pad && o.x <= view.maxX + pad && o.y >= view.minY - pad && o.y <= view.maxY + pad * 2)
      .concat(edgeObjs);
    drawn.sort((a, b) => a.y - b.y || a.x - b.x);
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
      if (px < -2 || py < -2 || px > f.w + 1 || py > f.h + 1) continue;
      // Generous: accept a hit within 2px of an opaque pixel (small sprites on phones).
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const qx = px + dx, qy = py + dy;
        if (qx >= 0 && qy >= 0 && qx < f.w && qy < f.h && f.alpha[qy * f.w + qx] > 0) return o.tile;
      }
    }
    return tileAt(w.x, w.y);
  }

  installInput() {
    const el = this.canvas;
    let moved = false, startDist = 0, startK = 0, last = null, downAt = 0;
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
      this.setK(e.deltaY < 0 ? this.k + Math.max(1, Math.round(this.k * 0.25)) : this.k - Math.max(1, Math.round(this.k * 0.25)), { x: e.clientX, y: e.clientY });
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
