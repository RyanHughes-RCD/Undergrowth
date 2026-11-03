// Top-down canvas renderer + touch/mouse camera. 1 world unit = 1 art pixel; tiles are 16x16.
//
// The forest is fitted into the space between the HUD bars at a whole number of device
// pixels per art pixel (crisp), and everything beyond the map is a shrub treeline, so the
// screen edges are always framed by hedge. Pinch to zoom in; pan is clamped to the map.
import { TileRuleEngine, hash32, decorVariant } from './core.js';

export const TS = 16;
const FOOT = 5; // objects stand a little below the tile centre
export const centre = (x, y) => ({ x: x * TS + TS / 2, y: y * TS + TS / 2 });
export const tileAt = (wx, wy) => ({ x: Math.floor(wx / TS), y: Math.floor(wy / TS) });
/** How far a solid landmark's no-walk box reaches past its tiles (art px): its sprite overhangs a little. landmarks.json "solidPad" [side, top, bottom] overrides it. */
const SOLID_MARGIN = { side: 3, top: 3, bottom: 2 };
const inBox = (r, x, y, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad;

/** True if the segment (ax, ay)→(bx, by) passes through the inside of box r (Liang–Barsky clip). */
function segmentHitsBox(r, ax, ay, bx, by) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - r.x0], [dx, r.x1 - ax], [-dy, ay - r.y0], [dy, r.y1 - ay]]) {
    if (p === 0) { if (q <= 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-6;
}

/** 0..1 breathing level for a pulsing overlay: min..1 over `seconds`, offset by `wave` per tile. */
export function breathe(t, p, x, y) {
  const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / Math.max(0.5, p.seconds || 5) + (x + y) * (p.wave || 0));
  const lo = p.min ?? 0.2;
  return lo + (1 - lo) * k * k * (3 - 2 * k);
}

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
    this.roam = new Map(); // creature wander state by placement id
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
  /** The open clearing in world px (the camera frames this; everything else is treeline). */
  get rect() {
    const c = this.game.state.clearing;
    return { x: c.x0 * TS, y: c.y0 * TS, w: (c.x1 - c.x0 + 1) * TS, h: (c.y1 - c.y0 + 1) * TS };
  }
  get mapW() { return this.rect.w; }
  get mapH() { return this.rect.h; }

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
    // Only the permanent HUD (name bar, nav), so popping cards don't make the forest jump.
    const top = document.querySelector('.name-btn');
    const bottom = document.querySelector('.nav');
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

  /** The furthest the camera may see: the clearing plus a thin treeline border (visuals.viewBorderTiles). */
  get bounds() {
    const r = this.rect;
    const b = (this.app.content.tuning.visuals.viewBorderTiles ?? 0.5) * TS;
    return { x: r.x - b, y: r.y - b, w: r.w + b * 2, h: r.h + b * 2 };
  }

  /**
   * Furthest zoom-out, in whole device pixels: the bounds fill the full screen width
   * (and the play area's height), so you never see past the treeline border.
   */
  fitK() {
    if (!this.app.game) return Math.round(2 * this.dpr);
    const a = this.area(), b = this.bounds;
    // Width: round down so the border on both sides stays in view (whole pixels can't hit it exactly).
    const kw = Math.floor(this.dpr * window.innerWidth / b.w);
    const kh = Math.ceil(this.dpr * a.h / b.h - 0.01);
    return Math.max(1, kw, kh);
  }

  fit() {
    if (!this.app.game) return;
    const fk = this.fitK();
    if (!this.k || this.k < fk || this.fittedK === this.k) this.k = fk;
    this.fittedK = fk;
    this.clamp();
  }

  centerOn(tile) { const p = centre(tile.x, tile.y); this.cam = { x: p.x, y: p.y }; this.clamp(); }

  /**
   * Keep the view inside the bounds: across the full screen width, and down the play area
   * (so every row can be brought out from under the HUD).
   */
  clamp() {
    if (!this.app.game) return;
    const a = this.area();
    const hw = window.innerWidth / 2 / this.zoom, hh = a.h / 2 / this.zoom;
    const r = this.bounds;
    const clampAxis = (v, lo, size, half) => (size <= half * 2 ? lo + size / 2 : Math.min(Math.max(v, lo + half), lo + size - half));
    this.cam.x = clampAxis(this.cam.x, r.x, r.w, hw);
    this.cam.y = clampAxis(this.cam.y, r.y, r.h, hh);
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
    const now = g.now();
    if (this.engineFor !== s.forestID + s.size.width + 'x' + s.size.height) {
      this.engineFor = s.forestID + s.size.width + 'x' + s.size.height;
      this.engine = new TileRuleEngine(this.app.content.tileRules, this.app.content.tuning.visuals.maxDecorationsPerTile, s.seed, this.app.content.tuning.visuals.intensityStages);
      this.visuals = [];
      this.firstSeen.clear();
      this.edgeCache.clear();
      this.k = 0;
      this.fit();
      this.cam = { x: this.rect.x + this.mapW / 2, y: this.rect.y + this.mapH / 2 };
    }
    const ck = JSON.stringify(s.clearing);
    if (this.clearingKey !== ck) {
      // The clearing grew: re-fit (the treeline steps back); keep looking at the same spot.
      if (this.clearingKey) { this.k = 0; this.fit(); }
      this.clearingKey = ck;
      this.edgeCache.clear();
    }
    const field = g.field(g.now());
    const overlay = this.app.ui.statOverlay;
    // Dev view: where wild spawns are likely to land (the same weights spawnTick uses).
    this.heat = null;
    if (this.app.ui.spawnHeatmap) {
      const loc = g.spawnLocations(g.now(), field);
      const max = loc.tiles.reduce((m, x) => Math.max(m, x.weight), 1);
      this.heat = { tiles: loc.tiles, max, min: (this.app.content.tuning.spawns.locationWeighting || {}).base ?? 1 };
    }
    const overrides = g.groundOverrides(field);
    for (let y = 0; y < s.size.height; y++) {
      for (let x = 0; x < s.size.width; x++) {
        const stats = field.statsAt(x, y);
        // Shares, elevation and time-of-day Glow/Bloom drive the look (see tileRules.json).
        const vs = g.visualStats(stats, now);
        const v = this.engine.visual(vs, x, y);
        v.elev = vs.elev / 100;
        v.pool = vs.combos.includes('pool');
        v.moss = vs.combos.includes('moss');
        v.meadow = vs.combos.includes('meadow');
        v.glowVis = vs.glowVis;
        v.bloomVis = vs.bloomVis;
        const forced = overrides.get(x + ',' + y);
        if (forced) { v.ground = forced; v.overlays = []; }
        if (overlay) v.overlay = overlayColor(stats);
        // Remember when each overlay/ground first appeared so changes fade in instead of popping.
        const prev = this.visuals[y * s.size.width + x];
        const nowMs = performance.now();
        v.since = {};
        for (const o of v.overlays) v.since[o.sprite] = prev ? (prev.since?.[o.sprite] ?? nowMs) : 0;
        v.groundSince = prev && prev.ground !== v.ground ? nowMs : (prev ? prev.groundSince : 0);
        v.prevGround = prev && prev.ground !== v.ground ? prev.ground : (prev ? prev.prevGround : null);
        this.visuals[y * s.size.width + x] = v;
      }
    }
    this.visualsKey = (this.visualsKey || 0) + 1;
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
    const field = g.field(now);
    const objs = [];
    const at = (t) => { const c = centre(t.x, t.y); return { x: c.x, y: c.y + FOOT }; };
    for (let y = 0; y < s.size.height; y++) {
      for (let x = 0; x < s.size.width; x++) {
        const v = this.visuals[y * s.size.width + x];
        if (!v || !g.inClearing({ x, y }) || g.landmarkAt({ x, y })) continue;
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
      // How it shows depends on the tile: buried (loose soil), hidden in tall grass (a rustling clump),
      // a geode exposed on rock (the bare crystal), or on the surface (geodes half-sunk in a dirt mound).
      const view = g.spawnView(sp, now, field.statsAt(sp.tile.x, sp.tile.y));
      const sprite = view === 'buried' ? 'spawn.buried.a' : view === 'hidden' ? 'spawn.rustle.a' : view === 'exposed' ? def.sprite : (def.worldSprite || def.sprite);
      objs.push({ sprite, ...at(sp.tile), tile: sp.tile, kind: 'spawn', key: sp.id, still: view !== 'hidden' && view !== 'buried', rustle: view === 'hidden', dig: view === 'buried', view, phase: hash32(sp.tile.x, sp.tile.y) % 1000 / 100,
        flip: !!def.flipInWorld && (hash32(sp.tile.x, sp.tile.y, 3) & 1) === 1 });
    }
    // Landmarks: a wide one (the Old Log stump, two tiles) is drawn centred across its footprint, and
    // a solid one is an obstacle creatures walk around (this.solids, in feet coordinates).
    this.solids = [];
    for (const l of s.landmarks || []) {
      const def = (this.app.content.landmarks || []).find((d) => d.id === l.id);
      if (!def) continue;
      const [fw, fh] = g.landmarkFootprint(l);
      const pos = at({ x: l.tile.x, y: l.tile.y + fh - 1 });
      // A ground-level one (the Fairy Ring) is drawn under everything that stands on it.
      objs.push({ sprite: def.sprite, x: pos.x + (fw - 1) * TS / 2, y: pos.y, sortY: def.ground ? pos.y - TS * 4 : undefined, tile: l.tile, kind: 'landmark', key: l.id, phase: 0 });
      if (def.solid) {
        const [side, top, bottom] = def.solidPad || [SOLID_MARGIN.side, SOLID_MARGIN.top, SOLID_MARGIN.bottom];
        this.solids.push({ x0: l.tile.x * TS - side, x1: (l.tile.x + fw) * TS + side, y0: l.tile.y * TS + top, y1: (l.tile.y + fh) * TS + bottom });
      }
    }
    // The opening grotto's scenery (mossy rocks, ferns) along the clearing's edge.
    for (const d of s.scenery || []) objs.push({ sprite: d.sprite, ...at(d.tile), tile: d.tile, kind: 'scenery', key: 'sc' + d.tile.x + ',' + d.tile.y, flip: d.flip, phase: 0, still: true });
    // Nests: the nest, with its egg on top (it wobbles once it's ready to hatch).
    for (const n of s.nests || []) {
      const egg = this.app.content.items[n.eggID];
      const pos = at(n.tile);
      objs.push({ sprite: 'egg.nest', ...pos, tile: n.tile, kind: 'nest', key: n.id + ':nest', phase: 0, still: true });
      if (egg) objs.push({ sprite: egg.sprite, x: pos.x, y: pos.y - 2, sortY: pos.y + 0.01, tile: n.tile, kind: 'nest', key: n.id, phase: hash32(n.tile.x, n.tile.y, 9) % 1000 / 250, dig: g.nestProgress(n, now) >= 1 });
      objs.push({ sprite: 'egg.nest.front', ...pos, sortY: pos.y + 0.02, tile: n.tile, kind: 'nest', key: n.id + ':front', phase: 0, still: true });
    }
    // Buried school seeds: a mound with a sprout in the school's colour.
    for (const b of g.buriedSeeds()) {
      const def = this.app.content.items[b.seed];
      objs.push({ sprite: (def && def.marker) || 'seed.stage.planted', ...at(b.tile), tile: b.tile, kind: 'buriedSeed', key: b.id, phase: hash32(b.tile.x, b.tile.y, 11) % 1000 / 250 });
    }
    // Decor props from the Old Log (purely visual), in their chosen colour.
    for (const d of (s.decor && s.decor.placed) || []) {
      const def = g.decorDef(d.decorID);
      if (!def) continue;
      objs.push({ sprite: def.sprite, variant: decorVariant(def, d.color), ...at(d.tile), tile: d.tile, kind: 'decor', key: d.id, phase: hash32(d.tile.x, d.tile.y, 5) % 1000 / 250 });
    }
    for (const seed of s.plantedSeeds) {
      const stages = g.seedStages(seed);
      const p = g.seedProgress(seed, now);
      const idx = p >= 1 ? stages.length - 1 : Math.min(stages.length - 2, Math.floor(p * Math.max(1, stages.length - 1)));
      objs.push({ sprite: stages[Math.max(0, idx)], ...at(seed.tile), tile: seed.tile, kind: 'seed', key: seed.id, phase: 0 });
    }
    for (const p of g.activePlacements) {
      const cr = g.creature(p.creatureID);
      if (!cr) continue;
      const art = this.app.art(cr);
      if (!this.firstSeen.has(p.id)) this.firstSeen.set(p.id, performance.now());
      objs.push({ sprite: art.sprite, variant: art.variant, ...at(p.tile), tile: p.tile, kind: 'creature', key: p.id, glimmer: cr.isGlimmer, phase: hash32(p.tile.x, p.tile.y) % 1000 / 300, roam: Math.max(0.5, this.game.stats.reach(p.radius) - 0.5) * TS });
    }
    for (const v of s.visitors || []) {
      const def = this.app.content.creatures[v.speciesID];
      if (!def) continue;
      objs.push({ sprite: def.sprite, ...at(v.tile), tile: v.tile, kind: 'visitor', key: v.id, bob: true, glimmer: true, phase: hash32(v.tile.x, v.tile.y) % 1000 / 100 });
    }
    for (const k of [...this.roam.keys()]) if (!objs.some((o) => o.key === k)) this.roam.delete(k);
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
    const nowMs = performance.now();

    // Every tile on screen (map + treeline), plus a margin for tall shrubs.
    const x0 = Math.floor(view.minX / TS) - 1, x1 = Math.floor(view.maxX / TS) + 1;
    const y0 = Math.floor(view.minY / TS) - 1, y1 = Math.floor(view.maxY / TS) + 2;
    const edgeObjs = [];
    const Lw = this.lighting();
    if (this.visuals && this.visuals.length) this.updateLilyPads();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const inside = x >= 0 && y >= 0 && x < size.width && y < size.height && this.game.inClearing({ x, y });
        const v = inside ? this.visuals[y * W + x] : this.edgeVisual(x, y);
        if (!v) continue;
        const c = centre(x, y);
        const phase = ((x * 7 + y * 3) % 10) / 10;
        const fadeMs = (this.app.content.tuning.visuals.overlayFadeSeconds || 0) * 1000;
        const fadeIn = (since) => (fadeMs > 0 && since ? Math.min(1, (nowMs - since) / fadeMs) : 1);
        if (v.prevGround && fadeIn(v.groundSince) < 1) {
          this.blit(v.prevGround, null, c.x, c.y, t + phase);
          ctx.globalAlpha = fadeIn(v.groundSince);
        }
        this.blit(v.ground, null, c.x, c.y, t + phase);
        ctx.globalAlpha = 1;
        for (const o of v.overlays) {
          ctx.globalAlpha = fadeIn(v.since && v.since[o.sprite]);
          // Pulsing layers (tileRules "pulse"): opacity breathes slowly, rolling across tiles as a wave.
          if (o.pulse) ctx.globalAlpha *= breathe(t, o.pulse, x, y);
          this.blit(o.sprite, null, c.x, c.y, t + phase, o.flip);
        }
        ctx.globalAlpha = 1;
        const tint = v.overlay || v.tint;
        if (tint) {
          ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3]})`;
          ctx.fillRect(x * TS, y * TS, TS, TS);
        }
        if (inside && v.pool) {
          ctx.drawImage(this.waterTile(x, y), x * TS, y * TS);
          this.waterSparkles(ctx, x, y, t, Lw);
          const pad = this.lilyPads && this.lilyPads.get(y * W + x);
          if (pad) this.blit(pad.sprite, null, c.x + pad.dx, c.y + pad.dy, 0, pad.flip);
        }
        if (!inside) {
          for (const d of v.decorations) edgeObjs.push({ sprite: d.sprite, x: c.x + d.dx, y: c.y + TS / 2 + d.dy, flip: d.flip, phase: 0 });
        }
      }
    }

    this.drawElevation(ctx, x0, y0, x1, y1);
    this.drawSplashes(ctx);

    if (this.heat) {
      // Cool, faint for ordinary tiles; warm and strong where effects pull spawns in.
      const { tiles, max, min } = this.heat;
      for (const x of tiles) {
        const k = max > min ? (x.weight - min) / (max - min) : 0;
        const r = Math.round(60 + 195 * k), gg = Math.round(120 + 80 * k * (1 - k) * 2), bb = Math.round(255 * (1 - k));
        ctx.fillStyle = `rgba(${r},${gg},${bb},${0.12 + 0.5 * k})`;
        ctx.fillRect(x.tile.x * TS, x.tile.y * TS, TS, TS);
      }
    }

    // Highlight pulses (blend celebration, first-uncommon hint).
    this.highlights = (this.highlights || []).filter((hl) => nowMs < hl.until);
    for (const hl of this.highlights) {
      const pulse = 0.25 + 0.25 * Math.sin(nowMs / 180);
      ctx.fillStyle = `rgba(${hl.color},${pulse})`;
      ctx.strokeStyle = `rgba(${hl.color},0.9)`;
      for (const tl of hl.tiles) {
        ctx.fillRect(tl.x * TS, tl.y * TS, TS, TS);
        ctx.strokeRect(tl.x * TS + 0.5, tl.y * TS + 0.5, TS - 1, TS - 1);
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
    const sortY = (o) => (o.roam && this.roam.has(o.key) ? this.roam.get(o.key).y : o.sortY ?? o.y);
    drawn.sort((a, b) => sortY(a) - sortY(b) || a.x - b.x);
    this.drawn = drawn;
    for (const o of drawn) {
      let y = o.y;
      let alpha = 1;
      if (o.bob && (t + o.phase) % 4 < 0.3) y -= 1;
      let x = o.x;
      let flip = o.flip;
      let ft = o.still ? 0 : t + o.phase;
      if (o.dig) {
        // Buried: something stirs under the mound every few seconds (a hop and a puff of crumbs).
        const cyc = (t + o.phase) % 3.8;
        ft = cyc < 0.5 ? 0.3 : 0;
        if (cyc < 0.5) { y -= cyc < 0.25 ? 1 : 0; x += Math.round(Math.sin(t * 40) * 0.6); }
      }
      if (o.rustle) {
        // Hidden in tall grass: still most of the time, with a short rustle every few seconds.
        const cyc = (t + o.phase) % 3.4;
        ft = cyc < 0.6 ? t : 0;
        if (cyc < 0.6) x += Math.round(Math.sin(t * 30));
      }
      if (o.roam) {
        const w = this.roamStep(o, now);
        x = w.x; y = w.y + (w.hopY || 0); flip = w.flip;
        if (w.moving && Math.floor((t + o.phase) * 6) % 2 === 0) y -= 1; // little hop while walking
      }
      if (o.kind === 'creature') {
        const age = (now - (this.firstSeen.get(o.key) || 0)) / 300;
        if (age < 1) { y -= Math.round(12 * (1 - age)); alpha = age; }
      }
      o.drawX = x; o.drawY = y;
      ctx.globalAlpha = alpha;
      this.blit(o.sprite, o.variant, x, y, ft, flip);
      ctx.globalAlpha = 1;
      if (o.glimmer) this.sparkles(x, y, t + o.phase);
    }

    this.socialTick(now);
    this.drawSocialFx(ctx, now);

    // Atmosphere: time-of-day tint, then the canopy's shade and light; glows and fireflies on top.
    const L = this.lighting();
    this.drawAmbient(ctx, view, L);
    this.drawCanopy(ctx, view, t, L);
    this.drawGlowLight(ctx, x0, y0, x1, y1, t);
    this.drawBugs(ctx, view, t);
    this.drawFireflies(ctx, view, t, L);
    this.drawPetals(ctx, view, t);
    this.drawDust(ctx);

    // Tutorial pointer: a bouncing arrow and a soft ring on the thing to tap.
    const target = this.game.inTutorial ? this.game.tutorialTarget() : null;
    if (target) {
      const c = centre(target.x, target.y);
      const bounce = Math.round(Math.abs(Math.sin(t * 4)) * 3);
      ctx.strokeStyle = 'rgba(255,240,170,0.9)';
      ctx.beginPath();
      ctx.arc(c.x, c.y + 2, 9 + Math.sin(t * 4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff0aa';
      const ay = c.y - 22 - bounce;
      for (let i = 0; i < 4; i++) ctx.fillRect(c.x - 3 + i, ay + i, 7 - i * 2, 1);
      ctx.fillRect(c.x - 1, ay - 4, 2, 4);
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

  /**
   * Creatures wander inside their influence radius around the tile they were placed on:
   * walk to a random spot, pause, repeat. Purely visual; their stats still come from the tile.
   */
  roamStep(o, now) {
    let w = this.roam.get(o.key);
    const home = { x: o.x, y: o.y };
    if (!w || w.homeX !== home.x || w.homeY !== home.y) {
      w = { homeX: home.x, homeY: home.y, x: home.x, y: home.y, tx: home.x, ty: home.y, wait: now + 600 + Math.random() * 2000, last: now, flip: false, moving: false };
      this.roam.set(o.key, w);
    }
    const dt = Math.min(0.1, (now - w.last) / 1000);
    w.last = now;
    w.hopY = 0;
    if (w.script) {
      if (now < w.script.end) { this.runScript(o, w, now, dt); return w; }
      // Done: back to ordinary wandering after a short pause, from wherever it is now.
      w.script = null; w.tx = w.x; w.ty = w.y; w.wait = now + 600 + Math.random() * 1400;
    }
    if (this.blockedAt(w.tx, w.ty)) { w.tx = w.x; w.ty = w.y; }   // its spot is under a solid landmark now
    const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy);
    w.moving = false;
    if (now < w.wait) return w;
    if (d < 0.5) {
      // Arrived: rest a moment, then pick a new spot inside the radius (and inside the clearing).
      const r = this.rect, pad = 6;
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * o.roam;
        const nx = home.x + Math.cos(a) * rr, ny = home.y + Math.sin(a) * rr;
        if (nx > r.x + pad && nx < r.x + r.w - pad && ny > r.y + pad && ny < r.y + r.h - 1 && !this.blockedAt(nx, ny)) { w.tx = nx; w.ty = ny; break; }
      }
      w.wait = now + 1500 + Math.random() * 4000;
      return w;
    }
    this.moveToward(w, w.tx, w.ty, 7, dt, now);
    return w;
  }

  /** True if a creature's feet at (x, y) would be inside a solid landmark (the Old Log stump). */
  blockedAt(x, y) { return (this.solids || []).some((r) => inBox(r, x, y, 1)); }

  /**
   * Where to head next on the way to (tx, ty) without walking through a solid landmark: the target
   * itself when the way is clear, else the corner of the obstacle that makes the shortest detour.
   * A target inside an obstacle is moved to its nearest edge; a creature caught inside steps out.
   */
  steer(w, tx, ty) {
    for (const r of this.solids || []) {
      if (inBox(r, w.x, w.y)) {
        // Step out the nearest side (only happens if something moved under it).
        const opts = [[r.x0 - 0.5, w.y], [r.x1 + 0.5, w.y], [w.x, r.y0 - 0.5], [w.x, r.y1 + 0.5]];
        [w.x, w.y] = opts.reduce((a, b) => (Math.hypot(a[0] - w.x, a[1] - w.y) <= Math.hypot(b[0] - w.x, b[1] - w.y) ? a : b));
      }
      if (inBox(r, tx, ty)) {
        const opts = [[r.x0 - 1, ty], [r.x1 + 1, ty], [tx, r.y0 - 1], [tx, r.y1 + 1]];
        [tx, ty] = opts.reduce((a, b) => (Math.hypot(a[0] - tx, a[1] - ty) <= Math.hypot(b[0] - tx, b[1] - ty) ? a : b));
      }
    }
    for (const r of this.solids || []) {
      if (!segmentHitsBox(r, w.x, w.y, tx, ty)) continue;
      // Shortest way round: start, the box's four corners (just outside it) and the target, joined
      // wherever the straight line misses the box; head for the first corner on that path.
      const e = 1.5;
      const pts = [[w.x, w.y], [r.x0 - e, r.y0 - e], [r.x1 + e, r.y0 - e], [r.x1 + e, r.y1 + e], [r.x0 - e, r.y1 + e], [tx, ty]];
      const n = pts.length, distTo = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
      distTo[0] = 0;
      for (let k = 0; k < n; k++) {
        let u = -1;
        for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || distTo[i] < distTo[u])) u = i;
        if (u < 0 || distTo[u] === Infinity) break;
        done[u] = true;
        for (let v = 0; v < n; v++) {
          if (done[v] || segmentHitsBox(r, pts[u][0], pts[u][1], pts[v][0], pts[v][1])) continue;
          if (v > 0 && v < n - 1 && Math.hypot(pts[v][0] - w.x, pts[v][1] - w.y) < 0.3) continue;   // the corner it's standing on
          const d = distTo[u] + Math.hypot(pts[v][0] - pts[u][0], pts[v][1] - pts[u][1]);
          if (d < distTo[v]) { distTo[v] = d; prev[v] = u; }
        }
      }
      let hop = n - 1;
      while (prev[hop] > 0) hop = prev[hop];
      if (prev[hop] === 0) return { tx, ty, wx: pts[hop][0], wy: pts[hop][1] };
    }
    return { tx, ty, wx: tx, wy: ty };
  }

  /** One movement step toward (tx, ty) at `speed` art px/s, around solid landmarks; splashes when wading. Returns true on arrival. */
  moveToward(w, tx0, ty0, speed, dt, now) {
    const { tx, ty, wx, wy } = this.steer(w, tx0, ty0);
    if (Math.hypot(tx - w.x, ty - w.y) < 0.6) { w.moving = false; return true; }
    const dx = wx - w.x, dy = wy - w.y, d = Math.hypot(dx, dy);
    if (d < 0.01) { w.moving = false; return false; }
    const step = Math.min(d, speed * dt);
    w.x += (dx / d) * step; w.y += (dy / d) * step;
    if (Math.abs(dx) > 0.5) w.flip = dx < 0;
    w.moving = true;
    // Wading: splash on entering a pool tile, then every few steps while moving through it.
    const tl = tileAt(w.x, w.y - 2);
    const tk = tl.x + ',' + tl.y;
    if (this.poolAt(tl.x, tl.y)) {
      const every = ((this.game.combo('pool').splash || {}).everySeconds ?? 0.65) * 1000;
      if (w.wadeTile !== tk || now - (w.splashAt || 0) > every) { this.splashAt(w.x, w.y - 1); w.splashAt = now; }
    }
    w.wadeTile = tk;
    return false;
  }

  /** Keep a point inside a creature's own wandering circle (so moments never break its radius). */
  clampToHome(o, x, y) {
    const hx = o.x, hy = o.y, lim = Math.max(2, o.roam - 2);
    const dx = x - hx, dy = y - hy, d = Math.hypot(dx, dy);
    return d <= lim ? { x, y } : { x: hx + dx / d * lim, y: hy + dy / d * lim };
  }

  /**
   * A short social moment between two nearby creatures (renderer only: positions, never stats).
   * heart: meet in the middle and a heart floats up. hop: hop together, facing. chase: one runs at
   * the other, which scampers off. visit: one walks over and pauses; the other faces it. face: both
   * stop and look at each other. reward: both go to where a bonus seed/geode turned up. Every
   * script ends on its timer, then normal wandering resumes.
   */
  runScript(o, w, now, dt) {
    const sc = w.script, pw = this.roam.get(sc.partner);
    const px = pw ? pw.x : w.x, py = pw ? pw.y : w.y;
    const face = () => { if (Math.abs(px - w.x) > 0.5) w.flip = px < w.x; };
    const meet = (gap) => { const mx = (w.x + px) / 2, my = (w.y + py) / 2, side = w.x <= px ? -1 : 1; return this.clampToHome(o, mx + side * gap, my); };
    w.moving = false;
    switch (sc.type) {
      case 'heart': {
        const m = sc.meet || (sc.meet = meet(5));
        if (this.moveToward(w, m.x, m.y, 10, dt, now) || now > sc.start + 2200) {
          face();
          if (sc.lead && !sc.hearted) { sc.hearted = true; this.socialFx('heart', (w.x + px) / 2, Math.min(w.y, py) - 14, now); }
        }
        break;
      }
      case 'hop': {
        face();
        const k = (now - sc.start) / 380;
        if (k < 3) w.hopY = -Math.round(Math.abs(Math.sin(k * Math.PI)) * 3);
        break;
      }
      case 'chase': {
        const tgt = this.clampToHome(o, px, py);
        this.moveToward(w, tgt.x, tgt.y, 15, dt, now);
        break;
      }
      case 'flee': {
        const ax = w.x - px, ay = w.y - py, d = Math.hypot(ax, ay) || 1;
        const tgt = this.clampToHome(o, w.x + ax / d * 12, w.y + ay / d * 12);
        if (this.moveToward(w, tgt.x, tgt.y, 13, dt, now)) face();
        break;
      }
      case 'visit': {
        const m = sc.meet || (sc.meet = meet(7));
        if (this.moveToward(w, m.x, m.y, 9, dt, now)) face();
        break;
      }
      case 'face': face(); break;
      case 'reward': {
        const tgt = sc.meet || (sc.meet = this.clampToHome(o, sc.tx + (sc.lead ? -5 : 5), sc.ty));
        if (this.moveToward(w, tgt.x, tgt.y, 11, dt, now) || now > sc.start + 2600) {
          w.flip = sc.tx < w.x;
          if (sc.lead && now > (sc.fxAt || 0)) {
            sc.fxAt = now + 320;
            if (sc.kind === 'geode') this.dust = (this.dust || []).concat([{ x: sc.tx, y: sc.ty, start: now }]);
            else this.socialFx('sprout', sc.tx, sc.ty - 6, now);
          }
        }
        break;
      }
      default: break;
    }
  }

  socialFx(kind, x, y, now) {
    this.social = (this.social || []).filter((f) => now - f.start < 1500);
    if (this.social.length < 12) this.social.push({ kind, x: Math.round(x), y: Math.round(y), start: now });
  }

  /** Hearts and sprout sparkles from social moments (pixel shapes, rising and fading). */
  drawSocialFx(ctx, now) {
    if (!this.social || !this.social.length) return;
    this.social = this.social.filter((f) => now - f.start < 1400);
    for (const f of this.social) {
      const k = (now - f.start) / 1400;
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
      const x = f.x, y = Math.round(f.y - k * 10);
      if (f.kind === 'heart') {
        ctx.fillStyle = '#1b1420';
        for (const [dx, dy, w] of [[-3, -1, 7], [-3, 0, 7], [-2, 1, 5], [-1, 2, 3], [0, 3, 1]]) ctx.fillRect(x + dx, y + dy, w, 1);
        ctx.fillRect(x - 2, y - 2, 2, 1); ctx.fillRect(x + 1, y - 2, 2, 1);
        ctx.fillStyle = '#ff6a8a';
        for (const [dx, dy, w] of [[-2, -1, 2], [1, -1, 2], [-2, 0, 5], [-1, 1, 3], [0, 2, 1]]) ctx.fillRect(x + dx, y + dy, w, 1);
        ctx.fillStyle = '#ffd0dc'; ctx.fillRect(x - 2, y - 1, 1, 1);
      } else {
        ctx.fillStyle = '#b8ec8a';
        for (const [dx, dy] of [[0, -2], [0, 2], [-2, 0], [2, 0], [0, 0]]) ctx.fillRect(x + dx, y + dy, 1, 1);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Picks an occasional cosmetic moment between two visible creatures whose reach overlaps, with a
   * cooldown per pair and random spacing (interactions.cosmetic), so it never looks scripted.
   */
  socialTick(now) {
    const cfg = (this.app.content.tuning.interactions || {}).cosmetic;
    if (!cfg) return;
    if (!this.nextSocial) this.nextSocial = now + 3000;
    if (now < this.nextSocial) return;
    const [a0, a1] = cfg.everySeconds || [5, 12];
    this.nextSocial = now + (a0 + Math.random() * (a1 - a0)) * 1000;
    const cs = (this.drawn || []).filter((o) => o.kind === 'creature' && o.roam && this.roam.get(o.key) && !this.roam.get(o.key).script);
    this.socialCd = this.socialCd || new Map();
    const pairs = [];
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const A = cs[i], B = cs[j], key = [A.key, B.key].sort().join('|');
      if ((this.socialCd.get(key) || 0) > now) continue;
      if (Math.hypot(A.x - B.x, A.y - B.y) < A.roam + B.roam + TS) pairs.push([A, B, key]);
    }
    if (!pairs.length) return;
    const [A, B, key] = pairs[Math.floor(Math.random() * pairs.length)];
    const [c0, c1] = cfg.pairCooldownSeconds || [35, 80];
    this.socialCd.set(key, now + (c0 + Math.random() * (c1 - c0)) * 1000);
    const weights = cfg.weights || { heart: 1 };
    const total = Object.values(weights).reduce((x, y) => x + y, 0);
    let r = Math.random() * total, type = 'heart';
    for (const [k, v] of Object.entries(weights)) { if (r < v) { type = k; break; } r -= v; }
    const dur = { heart: 3600, hop: 1300, chase: 2300, visit: 2600, face: 1600 }[type] || 2000;
    const wa = this.roam.get(A.key), wb = this.roam.get(B.key);
    const second = { chase: 'flee', visit: 'face' }[type] || type;
    wa.script = { type, partner: B.key, start: now, end: now + dur, lead: true };
    wb.script = { type: second, partner: A.key, start: now, end: now + dur, lead: false };
    this.lastSocial = { type, a: A.key, b: B.key, at: now };
  }

  /** A bonus seed/geode from the game: both creatures go to the spot and dig or tend it. */
  playInteraction(e) {
    const now = performance.now();
    const c = centre(e.tile.x, e.tile.y);
    const wa = this.roam.get(e.a), wb = this.roam.get(e.b);
    if (wa) wa.script = { type: 'reward', kind: e.kind, partner: e.b, tx: c.x, ty: c.y + 4, start: now, end: now + 3400, lead: true };
    if (wb) wb.script = { type: 'reward', kind: e.kind, partner: e.a, tx: c.x, ty: c.y + 4, start: now, end: now + 3400, lead: false };
    if (!wa && !wb) this.socialFx('sprout', c.x, c.y, now);
  }

  /**
   * Elevation (Shimmer up, Spirit down; visuals.elevation): a raised tile casts a rock face onto the
   * tile below it and gets a lit lip where the ground in front of it is lower; a sunken tile gets a
   * shadowed back wall where the ground behind it is higher.
   */
  drawElevation(ctx, x0, y0, x1, y1) {
    const cfg = this.app.content.tuning.visuals.elevation || {};
    if (cfg.enabled === false) return;
    const thr = cfg.threshold ?? 0.15, W = this.game.state.size.width;
    const el = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= this.game.state.size.height || !this.game.inClearing({ x, y })) return null;
      const v = this.visuals[y * W + x];
      return v ? v.elev || 0 : null;
    };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const e = el(x, y);
        if (e == null) continue;
        const below = el(x, y + 1), above = el(x, y - 1);
        if (e > thr && below != null && e - below > thr) {
          // Rock face hanging down over the lower tile.
          const h = Math.max(1, Math.min(TS - 2, Math.round((e - below) * (cfg.facePx ?? 7))));
          ctx.fillStyle = cfg.faceColor || '#5e5e68';
          ctx.fillRect(x * TS, (y + 1) * TS, TS, h);
          ctx.fillStyle = cfg.faceDark || '#3a3a44';
          ctx.fillRect(x * TS, (y + 1) * TS + h - 1, TS, 1);
          for (let i = 2; i < TS; i += 5) ctx.fillRect(x * TS + i, (y + 1) * TS + 1, 1, Math.max(1, h - 2));
        }
        if (e > thr && above != null && e - above > thr) {
          ctx.fillStyle = cfg.lipColor || '#c8c8d0';
          ctx.fillRect(x * TS, y * TS, TS, 1);
        }
        if (e < -thr && above != null && above - e > thr) {
          // Back wall of a hollow, in shadow.
          const h = Math.max(1, Math.min(TS - 2, Math.round((above - e) * (cfg.pitPx ?? 6))));
          ctx.fillStyle = cfg.pitColor || 'rgba(14,8,18,0.55)';
          ctx.fillRect(x * TS, y * TS, TS, h);
        }
      }
    }
  }

  /** Is this tile part of a pool (Spore + Spirit combo)? */
  poolAt(x, y) {
    const W = this.game.state.size.width;
    if (x < 0 || y < 0 || x >= W || y >= this.game.state.size.height || !this.game.inClearing({ x, y })) return false;
    const v = this.visuals[y * W + x];
    return !!(v && v.pool);
  }

  /**
   * Shallow water, autotiled: each quarter of the tile looks at its side and corner neighbours, so
   * a lone pool tile is a rounded puddle and neighbouring pools join seamlessly (with small rounded
   * notches on inside corners). Cached per neighbour pattern; two shimmer frames.
   */
  waterTile(x, y) {
    const n = (dx, dy) => (this.poolAt(x + dx, y + dy) ? 1 : 0);
    const mask = [n(0, -1), n(1, 0), n(0, 1), n(-1, 0), n(-1, -1), n(1, -1), n(1, 1), n(-1, 1)].join('');
    const key = x + ',' + y + ':' + mask;            // per tile: the shoreline is irregular but stable
    this.waterCache = this.waterCache || new Map();
    let c = this.waterCache.get(key);
    if (c) return c;
    if (this.waterCache.size > 4000) this.waterCache.clear();
    c = paintWaterTile(n, x, y, this.app.content.tuning.visuals.water || {});
    this.waterCache.set(key, c);
    return c;
  }

  /** Light glinting off the water: brief, unsynchronised specks, coloured for the time of day. */
  waterSparkles(ctx, x, y, t, L) {
    const every = Math.max(1, L.sparkleEvery || 5);
    for (let k = 0; k < 2; k++) {
      const hv = hash32(x, y, 31 + k);
      const period = every * (0.8 + (hv % 100) / 250);
      const cyc = (t + (hv % 1000) / 1000 * period) % period;
      if (cyc > 0.45) continue;
      const px = x * TS + 4 + (hv % 8), py = y * TS + 4 + ((hv >>> 8) % 8);
      ctx.fillStyle = L.sparkle || '#fff8d8';
      ctx.globalAlpha = 0.9;
      ctx.fillRect(px, py, 1, 1);
      if (cyc > 0.12 && cyc < 0.32) { ctx.globalAlpha = 0.55; ctx.fillRect(px - 1, py, 3, 1); ctx.fillRect(px, py - 1, 1, 3); }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Lily pads on connected pools of at least combos.pool.lilyPads.minTiles tiles. Each pool is one
   * feature: pads are chosen deterministically from its tiles (no duplicates, the same after a reload),
   * and recomputed only when the set of pool tiles changes.
   */
  updateLilyPads() {
    const W = this.game.state.size.width, H = this.game.state.size.height;
    const pools = [];
    for (let i = 0; i < W * H; i++) if (this.visuals[i] && this.visuals[i].pool && this.game.inClearing({ x: i % W, y: Math.floor(i / W) })) pools.push(i);
    const sig = pools.join(',');
    if (sig === this.poolSig) return;
    this.poolSig = sig;
    this.lilyPads = new Map();
    const cfg = this.game.combo('pool').lilyPads || {};
    const set = new Set(pools), seen = new Set();
    this.poolBodies = 0;
    for (const start of pools) {
      if (seen.has(start)) continue;
      const comp = [], stack = [start];
      seen.add(start);
      while (stack.length) {
        const i = stack.pop(); comp.push(i);
        const x = i % W, y = Math.floor(i / W);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, j = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(j) || !set.has(j)) continue;
          seen.add(j); stack.push(j);
        }
      }
      this.poolBodies++;
      if (comp.length < (cfg.minTiles ?? 6)) continue;
      const anchor = Math.min(...comp);
      if (hash32(anchor, comp.length, 404) / 4294967296 >= (cfg.chance ?? 0.75)) continue;
      const count = Math.min(cfg.maxPads ?? 5, 1 + Math.floor((comp.length - (cfg.minTiles ?? 6)) / (cfg.tilesPerExtraPad ?? 6)));
      const order = comp.slice().sort((a, b) => hash32(a, 7, 404) - hash32(b, 7, 404));
      for (const i of order.slice(0, count)) {
        const hv = hash32(i, 9, 404);
        const sprite = hv / 4294967296 < (cfg.flowerChance ?? 0.3) ? 'deco.lilypad.flower' : (hv & 1 ? 'deco.lilypad.a' : 'deco.lilypad.b');
        this.lilyPads.set(i, { sprite, dx: ((hv >>> 4) % 7) - 3, dy: ((hv >>> 8) % 5) - 2, flip: !!(hv & 2) });
      }
    }
  }

  /** A little splash where a creature wades (pooled, short-lived). */
  splashAt(x, y) {
    const cfg = this.game.combo('pool').splash || {};
    this.splashes = this.splashes || [];
    if (this.splashes.length >= (cfg.max ?? 24)) this.splashes.shift();
    this.splashes.push({ x: Math.round(x), y: Math.round(y), start: performance.now() });
  }

  drawSplashes(ctx) {
    if (!this.splashes || !this.splashes.length) return;
    const now = performance.now();
    this.splashes = this.splashes.filter((s) => now - s.start < 480);
    for (const s of this.splashes) {
      const k = (now - s.start) / 480;
      const r = 2 + k * 4;
      ctx.globalAlpha = 0.8 * (1 - k);
      ctx.fillStyle = '#c8e6ff';
      for (let i = 0; i < 12; i++) {                      // a ripple ring (flattened, top-down)
        const a = i / 12 * Math.PI * 2;
        ctx.fillRect(Math.round(s.x + Math.cos(a) * r), Math.round(s.y + Math.sin(a) * r * 0.5), 1, 1);
      }
      ctx.fillStyle = '#ffffff';                          // a few droplets hopping up and out
      for (const [dx, h] of [[-3, 4], [2, 5], [4, 3]]) {
        ctx.fillRect(Math.round(s.x + dx * (0.5 + k)), Math.round(s.y - h * 4 * k * (1 - k)), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Where bugs sit over mossy banks (Shimmer + Spore + Verdure combo): each connected patch of moss gets
   * one bug per tilesPerBug tiles (rounded, at least one), on tiles chosen by a stable hash.
   */
  bugTiles() {
    const cfg = this.game.combo('moss');
    if (this._bugTiles && this._bugTiles.visuals === this.visualsKey) return this._bugTiles.list;
    const W = this.game.state.size.width, H = this.game.state.size.height;
    const per = Math.max(1, cfg.tilesPerBug ?? 8), list = [];
    const seen = new Uint8Array(W * H);
    const isMoss = (x, y) => x >= 0 && y >= 0 && x < W && y < H && this.visuals[y * W + x] && this.visuals[y * W + x].moss && this.game.inClearing({ x, y });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (seen[i] || !isMoss(x, y)) continue;
      const patch = [], stack = [[x, y]];
      seen[i] = 1;
      while (stack.length) {
        const [px, py] = stack.pop();
        patch.push([px, py]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy, j = ny * W + nx;
          if (isMoss(nx, ny) && !seen[j]) { seen[j] = 1; stack.push([nx, ny]); }
        }
      }
      const n = Math.max(1, Math.round(patch.length / per));
      patch.sort((a, b) => hash32(a[0], a[1], 77) - hash32(b[0], b[1], 77));
      list.push(...patch.slice(0, n));
    }
    this._bugTiles = { visuals: this.visualsKey, list: list.slice(0, cfg.maxBugs ?? 40) };
    return this._bugTiles.list;
  }

  /** Bugs over mossy banks: little flitting beetles by day, fireflies at night. */
  drawBugs(ctx, view, t) {
    const cfg = this.game.combo('moss');
    if (cfg.tilesPerBug === 0) return;
    const night = this.game.isNight(this.game.now());
    const tiles = this.bugTiles();
    this.bugCount = tiles.length;
    for (const [x, y] of tiles) {
      if ((x + 1) * TS < view.minX || x * TS > view.maxX || (y + 1) * TS < view.minY || y * TS > view.maxY) continue;
      const h = hash32(x, y, 77);
      const ph = (h % 1000) / 160;
      const bx = x * TS + 8 + Math.sin(t * 0.9 + ph) * 5 + Math.sin(t * 2.3 + ph * 2) * 2;
      const by = y * TS + 6 + Math.cos(t * 0.7 + ph) * 4 + Math.sin(t * 3.1 + ph) * 1.5;
      const wing = Math.floor(t * 12 + ph) % 2;
      const X = Math.round(bx), Y = Math.round(by);
      if (night) {
        ctx.fillStyle = 'rgba(255,240,140,0.3)';
        ctx.fillRect(X - 1, Y - 1, 3, 3);
        ctx.fillStyle = '#fff3a8';
        ctx.fillRect(X, Y, 1, 1);
      } else {
        ctx.fillStyle = '#1e1624';                       // a little beetle: 2x2 body + head
        ctx.fillRect(X, Y, 2, 2);
        ctx.fillRect(X + (Math.sin(t + ph) > 0 ? 2 : -1), Y, 1, 1);
        ctx.fillStyle = '#c84a3a';                       // red shell
        ctx.fillRect(X, Y + 1, 1, 1);
        ctx.fillStyle = 'rgba(235,245,255,0.95)';        // flickering wings
        ctx.fillRect(X + (wing ? -1 : 2), Y - 1, 1, 1);
      }
    }
  }

  /** Glow light: a soft pixel halo on glowing tiles, strong at night, faint by day (deep tiles glow anyway). */
  drawGlowLight(ctx, x0, y0, x1, y1, t) {
    const cfg = this.app.content.tuning.visuals.glowLight;
    if (!cfg || cfg.enabled === false) return;
    if (!this.glowHalo) {
      const r = cfg.radius || 14, c = document.createElement('canvas');
      c.width = c.height = r * 2;
      const x = c.getContext('2d'), col = parseHexRGB(cfg.color || '#7cf2ff');
      for (let yy = 0; yy < r * 2; yy++) for (let xx = 0; xx < r * 2; xx++) {
        const d = Math.hypot(xx + 0.5 - r, yy + 0.5 - r) / r;
        if (d >= 1) continue;
        const a = Math.round((1 - d) * 4) / 4;   // stepped falloff, pixel style
        x.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
        x.fillRect(xx, yy, 1, 1);
      }
      this.glowHalo = c;
    }
    const W = this.game.state.size.width, r = this.glowHalo.width / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= this.game.state.size.height || !this.game.inClearing({ x, y })) continue;
      const v = this.visuals[y * W + x];
      if (!v || !(v.glowVis >= (cfg.minGlow ?? 6))) continue;
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.3 + x * 1.7 + y);
      ctx.globalAlpha = Math.min(cfg.maxAlpha ?? 0.5, v.glowVis * (cfg.alphaPerPoint ?? 0.0125)) * pulse;
      ctx.drawImage(this.glowHalo, x * TS + TS / 2 - r, y * TS + TS / 2 - r);
    }
    ctx.restore();
  }

  /** Petals drifting on the wind from blooming tiles (more while Bloom is open). */
  drawPetals(ctx, view, t) {
    const cfg = this.app.content.tuning.visuals.petals;
    if (!cfg || cfg.enabled === false) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.petalLast || now)) / 1000);
    this.petalLast = now;
    this.petals = (this.petals || []).filter((p) => now - p.born < p.life * 1000);
    const W = this.game.state.size.width, colors = cfg.colors || ['#ff9ccf', '#fff3c4', '#c58cff'];
    const x0 = Math.max(0, Math.floor(view.minX / TS)), x1 = Math.min(W - 1, Math.floor(view.maxX / TS));
    const y0 = Math.max(0, Math.floor(view.minY / TS)), y1 = Math.min(this.game.state.size.height - 1, Math.floor(view.maxY / TS));
    for (let y = y0; y <= y1 && this.petals.length < (cfg.max ?? 50); y++) for (let x = x0; x <= x1; x++) {
      const v = this.visuals[y * W + x];
      if (!v || !(v.bloomVis >= (cfg.minBloom ?? 12))) continue;
      if (Math.random() < v.bloomVis * (cfg.ratePerPoint ?? 0.0004) * dt * 60) {
        this.petals.push({ x: x * TS + Math.random() * TS, y: y * TS + Math.random() * TS, born: now, life: cfg.lifeSeconds ?? 5,
          c: colors[Math.floor(Math.random() * colors.length)], ph: Math.random() * 6 });
      }
    }
    const wx = cfg.windX ?? 8, wy = cfg.windY ?? 3;
    for (const p of this.petals) {
      p.x += (wx + Math.sin(t * 2 + p.ph) * 4) * dt;
      p.y += (wy + Math.cos(t * 1.6 + p.ph) * 2) * dt;
      const age = (now - p.born) / (p.life * 1000);
      ctx.globalAlpha = age < 0.15 ? age / 0.15 : age > 0.8 ? (1 - age) / 0.2 : 1;
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.sin(t * 5 + p.ph) > 0 ? 2 : 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /** A puff of soil where something was dug up. */
  dustAt(tile) { (this.dust = this.dust || []).push({ x: tile.x * TS + TS / 2, y: tile.y * TS + TS / 2 + FOOT, start: performance.now() }); }

  drawDust(ctx) {
    const now = performance.now();
    this.dust = (this.dust || []).filter((d) => now - d.start < 600);
    for (const d of this.dust) {
      const k = (now - d.start) / 600;
      ctx.globalAlpha = 1 - k;
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        ctx.fillStyle = i % 2 ? '#7a5232' : '#a37a4e';
        ctx.fillRect(Math.round(d.x + Math.cos(a) * (3 + 9 * k)), Math.round(d.y + Math.sin(a) * (2 + 5 * k) - 6 * k * (1 - k) * 4), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------- lighting + atmosphere

  /**
   * Lighting for the real local time (tuning.clock boundaries, tuning.visuals.lighting.states),
   * blended across clock.transitionMinutes around each boundary. Recomputed every
   * lighting.refreshSeconds and whenever the app resumes (this.lightAt = 0), not every frame.
   */
  lighting() {
    const cfg = this.app.content.tuning.visuals.lighting || {};
    const nowMs = performance.now();
    if (this.light && nowMs - this.lightAt < (cfg.refreshSeconds ?? 5) * 1000) return this.light;
    this.lightAt = nowMs;
    this.light = lightingAt(this.game, this.app.content.tuning, this.game.now());
    return this.light;
  }

  /** Whole-scene ambient tint (multiply): cool at night, soft warm at dawn and dusk, none by day. */
  drawAmbient(ctx, view, L) {
    if (!(L.ambientAlpha > 0)) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = L.ambientAlpha;
    ctx.fillStyle = L.ambient;
    ctx.fillRect(view.minX - 1, view.minY - 1, view.maxX - view.minX + 2, view.maxY - view.minY + 2);
    ctx.restore();
  }

  /**
   * Tree shadows (visuals.canopy). Built each frame for just the view at `res` buffer pixels per art
   * pixel (up to visuals.canopy.maxRes, never more than the screen shows), then drawn with smoothing,
   * so the shade has soft, smooth edges at any zoom. Light = flecks layer 1 + (offset, scaled, flipped) layer 2; shade covers the
   * rest, lifted in places by a large soft region layer. All world-anchored (stable when panning)
   * with only a slow, gentle sway.
   */
  drawCanopy(ctx, view, t, L) {
    const cfg = this.app.content.tuning.visuals.canopy;
    if (!cfg || cfg.enabled === false) return;
    if (!this.canopy) {
      this.canopy = { ready: 0 };
      const load = (src, key, alphaFn) => {
        const img = new Image();
        img.onload = () => {
          // Mask = luminance x alpha, so either an alpha mask or an opaque greyscale image works.
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < d.data.length; i += 4) {
            const m = ((d.data[i] + d.data[i + 1] + d.data[i + 2]) / 765) * (d.data[i + 3] / 255);
            d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
            d.data[i + 3] = Math.round(255 * alphaFn(m));
          }
          x.putImageData(d, 0, 0);
          this.canopy[key] = c;
          this.canopy.ready++;
        };
        img.src = src;
      };
      // Sunlight patches: the raw mask (the classic look), a firmer one (solid core, short soft rim:
      // visuals.canopy.edge) and the hot centres (visuals.canopy.hot) that get a warm glow.
      const ss = (e0, e1) => (m) => { const k = Math.min(1, Math.max(0, (m - e0) / Math.max(1e-6, e1 - e0))); return k * k * (3 - 2 * k); };
      const src = cfg.image || 'img/canopy.png';
      load(src, 'flecksRaw', (m) => m);
      load(src, 'flecks', ss(...(cfg.edge || [0.22, 0.55])));
      load(src, 'hot', ss(...(cfg.hot || [0.6, 0.95])));
      const reg = cfg.region || {};
      load(reg.image || 'img/canopy-region.png', 'region', (m) => m * (reg.strength ?? 0.4));
      return;
    }
    if (this.canopy.ready < 4) return;
    const C = this.canopy;
    const classic = !!this.app.canopyClassic;      // debug switch: the earlier, softer look
    const LC = classic ? { ...L, ...(L.classic || {}) } : L;
    const mask = classic ? C.flecksRaw : C.flecks;
    const R = Math.max(1, Math.min(cfg.maxRes || 3, Math.round(this.k || 1)));   // buffer px per art px
    const tex = cfg.texelsPerPx || 1;                                            // image px per art px
    const vx0 = Math.floor(view.minX) - 1, vy0 = Math.floor(view.minY) - 1;
    const ww = Math.ceil(view.maxX - view.minX) + 3, wh = Math.ceil(view.maxY - view.minY) + 3;
    const w = ww * R, h = wh * R;
    const buf = (key) => {
      let b = C[key + 'Buf'];
      if (!b) { b = C[key + 'Buf'] = document.createElement('canvas'); }
      if (b.width !== w || b.height !== h) { b.width = w; b.height = h; }
      const g = b.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, w, h);
      return [b, g];
    };
    const period = Math.max(1, cfg.swaySeconds || 23), a = (t / period) * Math.PI * 2, sw = cfg.swayPx || 0;
    const pat = (g, img, scale, ox, oy, flip, texels = tex) => {
      const p = g.createPattern(img, 'repeat');
      const k = scale * R / texels;
      p.setTransform(new DOMMatrix().translate((ox - vx0) * R, (oy - vy0) * R).scale(flip ? -k : k, k));
      return p;
    };
    // Light: the flecks, two layers unioned (additive) so the pattern is effectively aperiodic.
    const [lb, lg] = buf('light');
    const sec = cfg.second || {};
    const swayX = Math.sin(a) * sw, swayY = Math.sin(a * 0.7 + 1) * sw * 0.6;
    lg.fillStyle = pat(lg, mask, cfg.scale || 1, Math.sin(a) * sw, Math.sin(a * 0.7 + 1) * sw * 0.6, false);   // smooth sway, no pixel steps
    lg.fillRect(0, 0, w, h);
    if ((sec.alpha ?? 0.7) > 0) {                     // optional second layer (0 = off)
    lg.globalCompositeOperation = 'lighter';
    lg.globalAlpha = sec.alpha ?? 0.7;
    lg.fillStyle = pat(lg, mask, sec.scale || 1.37, (sec.offset || [0, 0])[0] + Math.sin(a * 0.8 + 2) * sw, (sec.offset || [0, 0])[1] + Math.cos(a * 0.6) * sw * 0.6, !!sec.flip);
    lg.fillRect(0, 0, w, h);
    }
    // Shade: everything except the light, with large regions lifted (clearings).
    const [sb, sg] = buf('shade');
    sg.fillStyle = LC.shadeColor;
    sg.fillRect(0, 0, w, h);
    sg.globalCompositeOperation = 'destination-out';
    sg.drawImage(lb, 0, 0);
    const reg = cfg.region || {};
    if ((reg.strength ?? 0.4) > 0) {                  // optional soft "clearings" layer (0 = off)
      sg.fillStyle = pat(sg, C.region, reg.scale || 2.6, (reg.offset || [0, 0])[0], (reg.offset || [0, 0])[1], false, 1);
      sg.fillRect(0, 0, w, h);
    }
    // Tint the light to the time of day (warm sun, silver moon).
    lg.globalCompositeOperation = 'source-in';
    lg.globalAlpha = 1;
    lg.fillStyle = LC.lightColor;
    lg.fillRect(0, 0, w, h);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = LC.shade;
    ctx.drawImage(sb, vx0, vy0, ww, wh);
    // Sunlight adds warm colour to the ground under it ("lighter", additive: a dim gold adds more red
    // than green, so grass turns sunny yellow-green and keeps its texture) instead of whitening it
    // (screen, the classic look, reads as haze).
    ctx.globalCompositeOperation = classic ? 'screen' : (cfg.lightBlend || 'lighter');
    ctx.globalAlpha = Math.min(1, LC.light);
    ctx.drawImage(lb, vx0, vy0, ww, wh);
    if (!classic && L.glow > 0) {
      // Hot spots: a soft warm glow only in the brightest centres.
      const [hb, hg] = buf('hot');
      hg.fillStyle = pat(hg, C.hot, cfg.scale || 1, swayX, swayY, false);
      hg.fillRect(0, 0, w, h);
      hg.globalCompositeOperation = 'source-in';
      hg.fillStyle = L.glowColor || L.lightColor;
      hg.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(1, L.glow);
      ctx.drawImage(hb, vx0, vy0, ww, wh);
    }
    ctx.restore();
    if (!classic) this.drawShafts(ctx, view, t, L);
  }

  /**
   * Light shafts (visuals.canopy.shafts): very soft diagonal beams slanting down from the canopy,
   * world-anchored, each drifting and breathing slowly. Strength per time of day: lighting "shafts".
   */
  drawShafts(ctx, view, t, L) {
    const s = (this.app.content.tuning.visuals.canopy || {}).shafts;
    const strength = L.shafts || 0;
    if (!s || s.enabled === false || strength <= 0.005) return;
    const th = -((s.angleDeg ?? 22) * Math.PI) / 180;           // beams lean down to the right
    const cos = Math.cos(th), sin = Math.sin(th);
    const cx = (view.minX + view.maxX) / 2, cy = (view.minY + view.maxY) / 2;
    const diag = Math.hypot(view.maxX - view.minX, view.maxY - view.minY) + 40;
    const uc = cx * cos + cy * sin;                             // view centre across the beams
    const spacing = s.spacing || 64, keep = s.keep ?? 0.6;
    const [r, g, b] = hex2rgb(L.shaftColor || L.lightColor || '#fff0c0');
    ctx.save();
    ctx.globalCompositeOperation = s.blend || 'screen';
    ctx.translate(cx, cy);
    ctx.rotate(th);
    const i0 = Math.floor((uc - diag / 2) / spacing) - 1, i1 = Math.ceil((uc + diag / 2) / spacing) + 1;
    for (let i = i0; i <= i1; i++) {
      const hv = hash32(i, 77, 31), f1 = (hv % 1000) / 1000, f2 = ((hv >>> 10) % 1000) / 1000;
      if (f1 > keep) continue;                                  // only some lanes have a beam
      const width = (s.width || 26) * (0.6 + 0.8 * f2);
      const u = i * spacing + Math.sin(t * (s.driftSpeed ?? 0.05) + i * 2.3) * (s.drift ?? 10) - uc;
      const pulse = 0.55 + 0.45 * Math.sin(t * (0.12 + 0.1 * f2) + i * 1.7);
      const a = strength * pulse * (0.6 + 0.4 * f1 / Math.max(0.01, keep));
      const grad = ctx.createLinearGradient(u - width / 2, 0, u + width / 2, 0);
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},${a.toFixed(3)})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(u - width / 2, -diag / 2, width, diag);
    }
    ctx.restore();
  }

  /**
   * Fireflies (night, a few at dusk/dawn): positions are a pure function of tile + time, so there
   * are no particle objects to leak, nothing runs while the app is hidden, and the population is
   * simply there again on return.
   */
  drawFireflies(ctx, view, t, L) {
    const amount = L.fireflies || 0;
    if (amount <= 0.01) return;
    const cfg = (this.app.content.tuning.visuals.lighting || {}).fireflies || {};
    const W = this.game.state.size.width, H = this.game.state.size.height;
    const x0 = Math.max(0, Math.floor(view.minX / TS) - 1), x1 = Math.min(W - 1, Math.floor(view.maxX / TS) + 1);
    const y0 = Math.max(0, Math.floor(view.minY / TS) - 1), y1 = Math.min(H - 1, Math.floor(view.maxY / TS) + 1);
    const p = (cfg.perTile ?? 0.07) * amount;
    let n = 0;
    ctx.save();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!this.game.inClearing({ x, y })) continue;
      const hv = hash32(x, y, 9091);
      if (hv / 4294967296 >= p || n >= (cfg.max ?? 60)) continue;
      n++;
      const ph = (hv % 10000) / 1000;
      const fx = x * TS + 8 + Math.sin(t * 0.31 + ph) * 12 + Math.sin(t * 0.83 + ph * 3) * 4;
      const fy = y * TS + 6 + Math.cos(t * 0.27 + ph * 2) * 9 + Math.sin(t * 1.1 + ph) * 3;
      const glow = Math.max(0, Math.sin(t * (0.9 + (hv % 7) / 10) + ph));       // gentle on/off pulse
      if (glow < 0.05) continue;
      const X = Math.round(fx), Y = Math.round(fy);
      ctx.globalAlpha = 0.28 * glow;
      ctx.fillStyle = '#e8ff8a';
      ctx.fillRect(X - 1, Y - 1, 3, 3);
      ctx.globalAlpha = 0.95 * glow;
      ctx.fillStyle = '#fbffd0';
      ctx.fillRect(X, Y, 1, 1);
    }
    ctx.restore();
  }

  blit(id, variant, x, y, t, flip = false) {
    const frames = this.sprites.frames(id, variant);
    const f = frames[frames.length > 1 && t ? this.sprites.frameIndex(id, t) : 0];
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
    if (ui.mode && (ui.mode.type === 'place' || ui.mode.type === 'devPlace')) return g.activePlacements;
    return [];
  }

  highlight(tiles, seconds, color = '255,236,140') {
    this.highlights = (this.highlights || []).concat([{ tiles, until: performance.now() + seconds * 1000, color }]);
  }

  // ---------------------------------------------------------- input

  /** Frontmost interactive object under a world point (pixel-accurate), else the tile. */
  hitTest(w) {
    for (let i = this.drawn.length - 1; i >= 0; i--) {
      const o = this.drawn[i];
      if (!o.kind) continue;
      const f = this.sprites.frames(o.sprite, o.variant)[0];
      const a = this.sprites.anchor(o.sprite);
      const ox = o.drawX ?? o.x, oy = o.drawY ?? o.y;
      const px = Math.floor(w.x - (ox - a.x)), py = Math.floor(w.y - (oy - a.y));
      if (px < -2 || py < -2 || px > f.w + 1 || py > f.h + 1) continue;
      // Generous: accept a hit within 2px of an opaque pixel (small sprites on phones).
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const qx = px + dx, qy = py + dy;
        if (qx >= 0 && qy >= 0 && qx < f.w && qy < f.h && f.alpha[qy * f.w + qx] > 0) return { ...o.tile, hitKind: o.kind, hitKey: o.key };
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
        // Placing/planting/using targets the tile under the finger; browsing prefers the sprite tapped.
        this.app.handleTap(this.app.ui.mode ? tileAt(w.x, w.y) : this.hitTest(w));
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
    spore: [50, 100, 255], glow: [100, 255, 255], bloom: [255, 115, 190],
    verdure: [80, 230, 80], shimmer: [183, 164, 224], spirit: [122, 122, 208],
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

function parseHexRGB(h) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(h || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

const hex2rgb = (h) => parseHexRGB(h);
const rgb2hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mixState = (a, b, k) => {
  const out = {};
  for (const key in a) {
    const va = a[key], vb = b[key] ?? va;
    if (typeof va === 'number') out[key] = va + (vb - va) * k;
    else if (typeof va === 'string' && va[0] === '#') { const ca = hex2rgb(va), cb = hex2rgb(vb); out[key] = rgb2hex(ca.map((v, i) => v + (cb[i] - v) * k)); }
    else out[key] = k < 0.5 ? va : vb;
  }
  return out;
};

/** Lighting parameters for local time t: the active state, blended with its neighbour near a boundary. */
export function lightingAt(game, tuning, t) {
  const S = (tuning.visuals.lighting || {}).states || {};
  const c = tuning.clock || {};
  const d = new Date(t), h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const bounds = [['dawn', c.dawnStartHour ?? 5], ['day', c.dayStartHour ?? 7], ['dusk', c.duskStartHour ?? 17], ['night', c.nightStartHour ?? 19]];
  const T = (c.transitionMinutes ?? 50) / 60;
  const phase = game.dayPhase(t);
  for (let i = 0; i < bounds.length; i++) {
    const [name, b] = bounds[i];
    let dh = h - b;
    if (dh > 12) dh -= 24;
    if (dh < -12) dh += 24;
    if (Math.abs(dh) < T / 2) {
      const prev = bounds[(i + bounds.length - 1) % bounds.length][0];
      const k = (dh + T / 2) / T;
      return { phase, ...mixState(S[prev] || {}, S[name] || {}, k) };
    }
  }
  return { phase, ...(S[phase] || {}) };
}

/**
 * Paints one 16x16 shallow-water tile. n(dx, dy) says whether a neighbour is water. Quarters of the
 * tile follow their side and corner neighbours (rounded alone, joined when connected); the shoreline
 * is a thin broken rim from a world-pixel hash at (x, y), so it is stable. Used by the forest and by
 * the Field Guide's Terrain illustrations.
 */
export function paintWaterTile(n, x, y, cfg = {}) {
  const mask = [n(0, -1), n(1, 0), n(0, 1), n(-1, 0), n(-1, -1), n(1, -1), n(1, 1), n(-1, 1)].join('');
  let c;
  const [N, E, S, Wn, NW, NE, SE, SW] = mask.split('').map(Number);
  const M = 2, R = 4;                                  // inset from the tile edge, corner radius
  const isWater = (px, py) => {
    if (px < 0 || py < 0 || px > 15 || py > 15) {      // outside: trust the neighbour's flag
      const dx = px < 0 ? -1 : px > 15 ? 1 : 0, dy = py < 0 ? -1 : py > 15 ? 1 : 0;
      return !!n(dx, dy);
    }
    const left = px < 8, top = py < 8;
    const h = left ? Wn : E, v = top ? N : S, d = top ? (left ? NW : NE) : (left ? SW : SE);
    const u = left ? 7.5 - px : px - 7.5, w = top ? 7.5 - py : py - 7.5;   // 0.5 .. 7.5 outward
    if (h && v) return d ? true : Math.hypot(8 - u, 8 - w) >= M + 0.5;
    if (h) return w <= 8 - M;
    if (v) return u <= 8 - M;
    const lim = 8 - M - R;
    if (u > lim && w > lim) return Math.hypot(u - lim, w - lim) <= R;
    return u <= 8 - M && w <= 8 - M;
  };
  const col = { water: cfg.water || '#3f6f94', deep: cfg.deep || '#2f5a80', light: cfg.light || '#6f9fc4' };
  const shore = cfg.shore || ['#4a3322', '#3a2c22', '#24461f'];
  c = document.createElement('canvas');
  c.width = c.height = TS;
  const g = c.getContext('2d');
  const near = (px, py, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if ((dx || dy) && isWater(px + dx, py + dy)) return true; return false; };
  for (let py = 0; py < TS; py++) for (let px = 0; px < TS; px++) {
    let fill = null;
    // A world-pixel hash keeps the shoreline irregular but identical every time it's drawn.
    const r = hash32(x * TS + px, y * TS + py, 51) / 4294967296;
    if (isWater(px, py)) {
      const deep = isWater(px - 3, py) && isWater(px + 3, py) && isWater(px, py - 3) && isWater(px, py + 3);
      fill = !isWater(px, py - 1) ? col.light : deep ? col.deep : col.water;
    } else if (isWater(px + 1, py) || isWater(px - 1, py) || isWater(px, py + 1) || isWater(px, py - 1)) {
      if (r > 0.18) fill = shore[r < 0.55 ? 0 : r < 0.8 ? 1 : 2];   // thin, broken shore of soil and mud
    } else if (r < 0.22 && near(px, py, 1)) {
      fill = shore[2];                                               // the odd tuft of dark, wet grass
    }
    if (fill) { g.fillStyle = fill; g.fillRect(px, py, 1, 1); }
  }
  return c;
}
