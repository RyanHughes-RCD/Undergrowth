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
      // a geode exposed on rock (the bare stone), or on the surface (geodes half-sunk in a dirt mound).
      const view = g.spawnView(sp, now, field.statsAt(sp.tile.x, sp.tile.y));
      const sprite = view === 'buried' ? 'spawn.buried.a' : view === 'hidden' ? 'spawn.rustle.a' : view === 'exposed' ? def.sprite : (def.worldSprite || def.sprite);
      objs.push({ sprite, ...at(sp.tile), tile: sp.tile, kind: 'spawn', key: sp.id, still: view !== 'hidden', rustle: view === 'hidden', view, phase: hash32(sp.tile.x, sp.tile.y) % 1000 / 100,
        flip: !!def.flipInWorld && (hash32(sp.tile.x, sp.tile.y, 3) & 1) === 1 });
    }
    for (const l of s.landmarks || []) {
      const def = (this.app.content.landmarks || []).find((d) => d.id === l.id);
      if (!def) continue;
      objs.push({ sprite: def.sprite, ...at(l.tile), tile: l.tile, kind: 'landmark', key: l.id, phase: 0 });
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
    const sortY = (o) => (o.roam && this.roam.has(o.key) ? this.roam.get(o.key).y : o.y);
    drawn.sort((a, b) => sortY(a) - sortY(b) || a.x - b.x);
    this.drawn = drawn;
    for (const o of drawn) {
      let y = o.y;
      let alpha = 1;
      if (o.bob && (t + o.phase) % 4 < 0.3) y -= 1;
      let x = o.x;
      let flip = o.flip;
      let ft = o.still ? 0 : t + o.phase;
      if (o.rustle) {
        // Hidden in tall grass: still most of the time, with a short rustle every few seconds.
        const cyc = (t + o.phase) % 3.4;
        ft = cyc < 0.6 ? t : 0;
        if (cyc < 0.6) x += Math.round(Math.sin(t * 30));
      }
      if (o.roam) {
        const w = this.roamStep(o, now);
        x = w.x; y = w.y; flip = w.flip;
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
    const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy);
    w.moving = false;
    if (now < w.wait) return w;
    if (d < 0.5) {
      // Arrived: rest a moment, then pick a new spot inside the radius (and inside the clearing).
      const r = this.rect, pad = 6;
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * o.roam;
        const nx = home.x + Math.cos(a) * rr, ny = home.y + Math.sin(a) * rr;
        if (nx > r.x + pad && nx < r.x + r.w - pad && ny > r.y + pad && ny < r.y + r.h - 1) { w.tx = nx; w.ty = ny; break; }
      }
      w.wait = now + 1500 + Math.random() * 4000;
      return w;
    }
    const speed = 7; // art px per second
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
    return w;
  }

  /**
   * Elevation (Stone up, Depth down; visuals.elevation): a raised tile casts a rock face onto the
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

  /** Is this tile part of a pool (Damp + Depth combo)? */
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
    const cfg = this.app.content.tuning.visuals.water || {};
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

  /** Bugs drawn to mossy banks (Stone + Damp + Verdure combo): little flitting specks; fireflies at night. */
  drawBugs(ctx, view, t) {
    const cfg = this.game.combo('moss');
    if (!(cfg.bugsPerTile > 0)) return;
    const W = this.game.state.size.width;
    const x0 = Math.max(0, Math.floor(view.minX / TS)), x1 = Math.min(W - 1, Math.floor(view.maxX / TS));
    const y0 = Math.max(0, Math.floor(view.minY / TS)), y1 = Math.min(this.game.state.size.height - 1, Math.floor(view.maxY / TS));
    const night = this.game.isNight(this.game.now());
    let drawn = 0;
    this.bugCount = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const v = this.visuals[y * W + x];
      if (!v || !v.moss || !this.game.inClearing({ x, y })) continue;
      const h = hash32(x, y, 77);
      if (h / 4294967296 >= cfg.bugsPerTile || drawn >= (cfg.maxBugs ?? 40)) continue;
      drawn++;
      this.bugCount = drawn;
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
   * Tree shadows (visuals.canopy). Built each frame at one-buffer-pixel-per-art-pixel for just the
   * view, then drawn scaled with no smoothing, so it stays crisp at any zoom and costs the same
   * whatever the zoom. Light = flecks layer 1 + (offset, scaled, flipped) layer 2; shade covers the
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
      load(cfg.image || 'img/canopy.png', 'flecks', (m) => m);
      const reg = cfg.region || {};
      load(reg.image || 'img/canopy-region.png', 'region', (m) => m * (reg.strength ?? 0.4));
      return;
    }
    if (this.canopy.ready < 2) return;
    const C = this.canopy;
    const vx0 = Math.floor(view.minX) - 1, vy0 = Math.floor(view.minY) - 1;
    const w = Math.ceil(view.maxX - view.minX) + 3, h = Math.ceil(view.maxY - view.minY) + 3;
    const buf = (key) => {
      let b = C[key + 'Buf'];
      if (!b) { b = C[key + 'Buf'] = document.createElement('canvas'); }
      if (b.width !== w || b.height !== h) { b.width = w; b.height = h; }
      const g = b.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, w, h);
      return [b, g];
    };
    const period = Math.max(1, cfg.swaySeconds || 23), a = (t / period) * Math.PI * 2, sw = cfg.swayPx || 0;
    const pat = (g, img, scale, ox, oy, flip) => {
      const p = g.createPattern(img, 'repeat');
      p.setTransform(new DOMMatrix().translate(ox - vx0, oy - vy0).scale(flip ? -scale : scale, scale));
      return p;
    };
    // Light: the flecks, two layers unioned (additive) so the pattern is effectively aperiodic.
    const [lb, lg] = buf('light');
    const sec = cfg.second || {};
    lg.fillStyle = pat(lg, C.flecks, cfg.scale || 1, Math.round(Math.sin(a) * sw), Math.round(Math.sin(a * 0.7 + 1) * sw * 0.6), false);
    lg.fillRect(0, 0, w, h);
    lg.globalCompositeOperation = 'lighter';
    lg.globalAlpha = sec.alpha ?? 0.7;
    lg.fillStyle = pat(lg, C.flecks, sec.scale || 1.37, (sec.offset || [0, 0])[0] + Math.round(Math.sin(a * 0.8 + 2) * sw), (sec.offset || [0, 0])[1] + Math.round(Math.cos(a * 0.6) * sw * 0.6), !!sec.flip);
    lg.fillRect(0, 0, w, h);
    // Shade: everything except the light, with large regions lifted (clearings).
    const [sb, sg] = buf('shade');
    sg.fillStyle = L.shadeColor;
    sg.fillRect(0, 0, w, h);
    sg.globalCompositeOperation = 'destination-out';
    sg.drawImage(lb, 0, 0);
    const reg = cfg.region || {};
    sg.fillStyle = pat(sg, C.region, reg.scale || 2.6, (reg.offset || [0, 0])[0], (reg.offset || [0, 0])[1], false);
    sg.fillRect(0, 0, w, h);
    // Tint the light to the time of day (warm sun, silver moon).
    lg.globalCompositeOperation = 'source-in';
    lg.globalAlpha = 1;
    lg.fillStyle = L.lightColor;
    lg.fillRect(0, 0, w, h);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = L.shade;
    ctx.drawImage(sb, vx0, vy0);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = L.light;
    ctx.drawImage(lb, vx0, vy0);
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
