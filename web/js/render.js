// Top-down canvas renderer + touch/mouse camera. 1 world unit = 1 art pixel; tiles are 16x16.
//
// The clearing is fitted into the space between the HUD bars at a whole number of device pixels per art
// pixel (crisp), and everything beyond it is a shrub treeline, so the screen edges are always framed by
// hedge. Pinch to zoom in; pan is clamped to the clearing. Each garden tile shows its soil (grass for
// plain, the school's ground tile otherwise); objects (the Old Log, scenery, decor, finds, plants) are
// drawn sorted by their feet; then the time-of-day light, tree shadows and fireflies.
import { Game, hash32, decorVariant } from './core.js';

export const TS = 16;
const FOOT = 5; // objects stand a little below the tile centre
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
export const centre = (x, y) => ({ x: x * TS + TS / 2, y: y * TS + TS / 2 });
export const tileAt = (wx, wy) => ({ x: Math.floor(wx / TS), y: Math.floor(wy / TS) });
const GRASS = ['tile.grass.a', 'tile.grass.b', 'tile.grass.c'];

export class ForestView {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.app = app;
    this.cam = { x: 0, y: 0 };
    this.objects = [];
    this.drawn = [];
    this.effects = [];
    this.edgeCache = new Map();
    this.groundSince = new Map();
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
   * Furthest zoom-out, in whole device pixels: the whole clearing (plus a thin treeline border) fits
   * the play area both ways.
   */
  fitK() {
    if (!this.app.game) return Math.round(2 * this.dpr);
    const a = this.area(), b = this.bounds;
    // The whole clearing fits on screen both ways (it grows one side at a time, so it can be wide or
    // tall); round down so whole pixels never crop its border. Any spare room shows more treeline.
    const kw = Math.floor(this.dpr * window.innerWidth / b.w);
    const kh = Math.floor(this.dpr * a.h / b.h);
    return Math.max(1, Math.min(kw, kh));
  }

  fit() {
    if (!this.app.game) return;
    const fk = this.fitK();
    if (!this.k || this.k < fk || this.fittedK === this.k) this.k = fk;
    this.fittedK = fk;
    this.clamp();
  }

  centerOn(tile) { const p = centre(tile.x, tile.y); this.cam = { x: p.x, y: p.y }; this.clamp(); }
  /** A brief, eased camera move to a tile (instant with reduced motion). */
  panTo(tile, seconds = 1.2) {
    if (reducedMotion() || !(seconds > 0)) { this.centerOn(tile); return; }
    const p = centre(tile.x, tile.y);
    this.camAnim = { from: { ...this.cam }, to: { x: p.x, y: p.y }, start: performance.now(), ms: seconds * 1000 };
  }

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

  /** Re-reads the garden: re-fits when a new garden loads or the clearing grows, then rebuilds the objects. */
  sync() {
    const s = this.game.state;
    const id = s.forestID + s.size.width + 'x' + s.size.height;
    if (this.gardenFor !== id) {
      this.gardenFor = id;
      this.edgeCache.clear();
      this.groundSince.clear();
      this.k = 0;
      this.fit();
      this.cam = { x: this.rect.x + this.mapW / 2, y: this.rect.y + this.mapH / 2 };
    }
    const ck = JSON.stringify(s.clearing);
    if (this.clearingKey !== ck) {
      if (this.clearingKey) { this.k = 0; this.fit(); }
      this.clearingKey = ck;
      this.edgeCache.clear();
    }
    this.rebuildObjects();
  }

  /** A clearing tile's ground: its soil (plain = grass, a school = that school's ground tile). */
  /**
   * A clearing tile's ground key for drawGround: its sprite (grass, a school's soil at its maturity level, or
   * water), which corners are clipped (NW NE SE SW: a corner clips unless a tile beside it is the same kind
   * of ground), and what shows through the clipped corners (the ground most common around it).
   */
  ground(x, y) {
    const g = this.game, h = hash32(x, y, 0x5011);
    const kindAt = (t) => (!g.inClearing(t) ? '' : g.isWet(t) ? 'water' : g.soilAt(t) || '');
    const spriteFor = (k, t, hh) => (k === 'water' ? `tile.water.${hh & 1 ? 'a' : 'b'}` : k ? `tile.${k}.${Math.max(1, g.soilLevel(t))}${hh & 1 ? 'a' : 'b'}` : GRASS[hh % GRASS.length]);
    const me = kindAt({ x, y });
    if (!me) return GRASS[h % GRASS.length];
    if (me === 'water') return this.waterGround(x, y, h, kindAt, spriteFor);
    const same = (dx, dy) => kindAt({ x: x + dx, y: y + dy }) === me;
    const n = same(0, -1), e = same(1, 0), so = same(0, 1), w = same(-1, 0);
    const mask = [!n && !w, !n && !e, !so && !e, !so && !w].map((b) => (b ? '1' : '0')).join('');
    const count = {};
    let pick = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = { x: x + dx, y: y + dy }, o = kindAt(t);
      if (o === me) continue;
      count[o] = (count[o] || 0) + 1;
      if (!pick || count[o] > count[pick.k] || (count[o] === count[pick.k] && o < pick.k)) pick = { k: o, t };
    }
    const under = pick ? spriteFor(pick.k, pick.t, h >>> 1) : GRASS[h % GRASS.length];
    return `${spriteFor(me, { x, y }, h)}|${mask}|${under}`;
  }

  /** Draws a ground key from ground(): a plain tile, or soil over grass with its open corners faded. */
  drawGround(key, x, y) {
    if (key.startsWith('W|')) { this.drawWaterGround(key, x, y); return; }
    const [id, mask, under] = key.split('|');
    if (!mask) { this.blit(id, null, x, y, 0); return; }
    this.blit(under, null, x, y, 0);
    if (mask === '0000') { this.blit(id, null, x, y, 0); return; }
    const a = this.sprites.anchor(id);
    this.ctx.drawImage(this.softTile(id, mask), Math.round(x - a.x), Math.round(y - a.y));
  }

  /**
   * A soil tile with some corners clipped into the ground (mask: NW NE SE SW, '1' = clip). Each clipped
   * corner is rounded off a little (tuning.visuals.softCorners): full soil inside a circle of `radius` px
   * centred that far in from the corner, fading out over `soft` px beyond it in `steps` steps. Cached.
   */
  softTile(id, mask) {
    const k = id + '|' + mask;
    this.softCache = this.softCache || new Map();
    let c = this.softCache.get(k);
    if (c) return c;
    const src = this.sprites.frames(id)[0];
    c = document.createElement('canvas');
    c.width = src.w; c.height = src.h;
    const cx = c.getContext('2d');
    cx.drawImage(src.canvas, 0, 0);
    const img = cx.getImageData(0, 0, c.width, c.height), W = c.width, H = c.height;
    const sc = this.app.content.tuning.visuals.softCorners || {};
    const r = sc.radius ?? 4, soft = sc.soft ?? 2, steps = sc.steps ?? 2;
    const corners = [[0, 0], [W, 0], [W, H], [0, H]];
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      let alpha = 1;
      corners.forEach(([qx, qy], i) => {
        if (mask[i] !== '1') return;
        const ox = qx ? qx - r : r, oy = qy ? qy - r : r;                       // the rounding circle's centre
        const inX = qx ? px + 0.5 > ox : px + 0.5 < ox, inY = qy ? py + 0.5 > oy : py + 0.5 < oy;
        if (!inX || !inY) return;                                               // not in this corner's quarter
        const d = Math.hypot(px + 0.5 - ox, py + 0.5 - oy);
        const k2 = 1 - (d - (r - soft)) / soft;                                 // 1 inside, 0 at the corner side
        alpha = Math.min(alpha, Math.max(0, Math.min(1, k2)));
      });
      if (alpha < 1) img.data[(py * W + px) * 4 + 3] *= Math.round(alpha * steps) / steps;
    }
    cx.putImageData(img, 0, 0);
    this.softCache.set(k, c);
    return c;
  }

  /**
   * A small thing growing on a school-soil tile (detail.<school>.a/b): a tuft of grass on Verdure, wildflowers
   * on Bloom and so on. Whether a tile has one is hashed from the tile and its soil, with a chance that rises
   * with maturity (tuning.visuals.soilDetails), so it stays put and older soil grows busier. Hidden under
   * anything standing on the tile.
   */
  drawSoilDetail(x, y, c) {
    const g = this.game, t = { x, y }, school = g.soilAt(t);
    if (!school) return;
    const chance = ((this.app.content.tuning.visuals.soilDetails || {}).chance || [])[g.soilLevel(t) - 1] || 0;
    const hh = hash32(x, y, school.length, 0xde7a);
    if (hh / 4294967296 >= chance) return;
    if (g.plantAt(t) || g.decorAt(t) || g.sceneryAt(t) || g.landmarkAt(t) || g.landscapeAt(t) || g.forageAt(t) || g.tinAt(t)) return;
    const id = `detail.${school}.${(hh >>> 3) & 1 ? 'a' : 'b'}`;
    this.blit(id, null, c.x + ((hh >>> 8) % 7) - 3, c.y + 5 - ((hh >>> 12) % 4), 0, ((hh >>> 16) & 1) === 1);
  }

  /** Today's water level (Low, Normal, High, Flood), re-read once a minute. */
  waterLevelNow() {
    const g = this.game, minute = Math.floor(Date.now() / 60000), pin = g.state.dev && g.state.dev.waterLevel;
    if (this.levelAt !== minute || this.levelPin !== pin) {
      this.levelAt = minute; this.levelPin = pin;
      try { this.level = g.waterLevelOn(Game.dayNumber(g.now())); } catch (_) { this.level = { index: 1, inset: 1, cross: 0 }; }
    }
    return this.level;
  }

  /**
   * A water tile's ground key: its sprite, which sides are bank (N E S W), which corners are a point of land
   * inside a bend (NW NE SE SW), today's inset (how far the water sits in from the bank) and the ground
   * that shows on the bank (the most common land around it).
   */
  waterGround(x, y, h, kindAt, spriteFor) {
    const wet = (dx, dy) => kindAt({ x: x + dx, y: y + dy }) === 'water';
    const n = wet(0, -1), e = wet(1, 0), so = wet(0, 1), w = wet(-1, 0);
    const sides = [n, e, so, w].map((b) => (b ? '0' : '1')).join('');
    const pts = [n && w && !wet(-1, -1), n && e && !wet(1, -1), so && e && !wet(1, 1), so && w && !wet(-1, 1)].map((b) => (b ? '1' : '0')).join('');
    const count = {};
    let pick = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || wet(dx, dy)) continue;
      const t = { x: x + dx, y: y + dy }, o = kindAt(t);
      count[o] = (count[o] || 0) + 1;
      if (!pick || count[o] > count[pick.k] || (count[o] === count[pick.k] && o < pick.k)) pick = { k: o, t };
    }
    const under = pick ? spriteFor(pick.k, pick.t, h >>> 1) : GRASS[h % GRASS.length];
    return `W|${spriteFor('water', { x, y }, h)}|${sides}|${pts}|${this.waterLevelNow().inset ?? 1}|${under}`;
  }

  drawWaterGround(key, x, y) {
    const [, id, sides, pts, inset, under] = key.split('|');
    this.blit(under, null, x, y, 0);
    const a = this.sprites.anchor(id);
    this.ctx.drawImage(this.waterTile(id, sides, pts, Number(inset)), Math.round(x - a.x), Math.round(y - a.y));
  }

  /**
   * The water sprite cut to today's level. Each pixel's distance from dry land (the bank sides, rounded at
   * outer corners, and the points of land inside bends) decides it: nearer than inset - 1 it's bank (clear,
   * the ground shows), the next pixel is a dark wet edge, and the rest is water. Cached.
   */
  waterTile(id, sides, pts, inset) {
    const k = [id, sides, pts, inset].join('|');
    this.waterCache = this.waterCache || new Map();
    let c = this.waterCache.get(k);
    if (c) return c;
    const src = this.sprites.frames(id)[0], W = src.w, H = src.h;
    c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.drawImage(src.canvas, 0, 0);
    const img = cx.getImageData(0, 0, W, H), R = 3, edge = Math.max(0, inset);
    const open = sides.split('').map((b) => b === '1'), pt = pts.split('').map((b) => b === '1');
    const corners = [[0, 0], [W, 0], [W, H], [0, H]];
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const fx = px + 0.5, fy = py + 0.5;
      let d = Infinity;
      if (open[0]) d = Math.min(d, fy);
      if (open[1]) d = Math.min(d, W - fx);
      if (open[2]) d = Math.min(d, H - fy);
      if (open[3]) d = Math.min(d, fx);
      corners.forEach(([qx, qy], i) => {
        const sideA = i === 0 || i === 1 ? open[0] : open[2], sideB = i === 1 || i === 2 ? open[1] : open[3];
        if (sideA && sideB) {                                         // an outer corner: round it off
          const ox = qx ? qx - edge - R : edge + R, oy = qy ? qy - edge - R : edge + R;
          const inX = qx ? fx > ox : fx < ox, inY = qy ? fy > oy : fy < oy;
          if (inX && inY) d = Math.min(d, edge + R - Math.hypot(fx - ox, fy - oy));
        }
        if (pt[i]) d = Math.min(d, Math.hypot(fx - qx, fy - qy) - 0.5);   // a point of land in a bend
      });
      const o = (py * W + px) * 4;
      if (d < edge - 1) img.data[o + 3] = 0;                           // bank: the ground shows
      else if (d < edge) { img.data[o] = 22; img.data[o + 1] = 40; img.data[o + 2] = 44; img.data[o + 3] = 200; }  // wet edge
    }
    cx.putImageData(img, 0, 0);
    this.waterCache.set(k, c);
    return c;
  }

  /**
   * Over the water: gentle waves, little crests that rise, drift a pixel side to side and fade, a few per
   * tile, livelier the higher the water; a blinking glint; and at Flood a sheet of water spilling over the
   * banks. Holds still with reduced motion.
   */
  drawWater(ctx, view, t) {
    const g = this.game, water = g.state.water;
    if (!water.length) return;
    const lv = this.waterLevelNow(), inset = lv.inset ?? 1, still = reducedMotion();
    const crests = [2, 3, 4, 5][lv.index] ?? 3, pace = [0.5, 0.7, 1, 1.4][lv.index] ?? 0.7;
    const m = Math.max(0, inset) + 2;
    for (const k of water) {
      const [x, y] = k.split(',').map(Number);
      const px = x * TS, py = y * TS;
      if (px > view.maxX + TS || px < view.minX - TS * 2 || py > view.maxY + TS || py < view.minY - TS * 2) continue;
      if (inset < 0) {                                                  // flood: water over the bank
        ctx.fillStyle = 'rgba(58,118,168,0.55)';
        const s = -inset;
        if (!g.isWet({ x, y: y - 1 })) ctx.fillRect(px, py - s, TS, s);
        if (!g.isWet({ x, y: y + 1 })) ctx.fillRect(px, py + TS, TS, s);
        if (!g.isWet({ x: x - 1, y })) ctx.fillRect(px - s, py, s, TS);
        if (!g.isWet({ x: x + 1, y })) ctx.fillRect(px + TS, py, s, TS);
      }
      for (let i = 0; i < crests; i++) {
        const hb = hash32(x, y, i, 0x7a5e);
        const cxp = px + m + (hb % Math.max(1, TS - 2 * m - 3)), cyp = py + m + 1 + ((hb >>> 8) % Math.max(1, TS - 2 * m - 1));
        const ph = ((hb >>> 16) % 1000) / 159;
        const a = still ? 0.45 : 0.5 + 0.5 * Math.sin(t * pace * 1.6 + ph);
        if (a < 0.15) continue;
        const dx = still ? 0 : Math.round(Math.sin(t * pace * 0.7 + ph * 1.3));
        ctx.fillStyle = `rgba(200,232,250,${(0.75 * a).toFixed(2)})`;
        ctx.fillRect(cxp + dx + 1, cyp - 1, 2, 1);                       // the crest
        ctx.fillStyle = `rgba(127,176,212,${(0.6 * a).toFixed(2)})`;
        ctx.fillRect(cxp + dx, cyp, 1, 1); ctx.fillRect(cxp + dx + 3, cyp, 1, 1);
      }
      const hb = hash32(x, y, 0x61);
      if (!still && ((t * 0.7 + (hb % 100) / 37) % 3) < 0.25) {
        ctx.fillStyle = 'rgba(232,248,255,0.9)';
        ctx.fillRect(px + m + (hb % Math.max(1, TS - 2 * m)), py + m + ((hb >> 8) % Math.max(1, TS - 2 * m)), 1, 1);
      }
    }
  }

  /** A tile outside the clearing: the treeline floor with a shrub (tuning.visuals.edge). */
  edgeVisual(x, y) {
    const k = x + ',' + y;
    let v = this.edgeCache.get(k);
    if (!v) {
      const edge = this.app.content.tuning.visuals.edge || { ground: ['tile.grass.a'], decorations: [] };
      const h = hash32(x, y, 0xed9e);
      v = { ground: edge.ground[h % edge.ground.length], decorations: [] };
      if (edge.decorations.length && hash32(h, 1) / 4294967296 < (edge.baseDensity ?? 1)) {
        const h3 = hash32(h, 2);
        v.decorations.push({ sprite: edge.decorations[h3 % edge.decorations.length], dx: ((h3 >>> 8) % 5) - 2, dy: ((h3 >>> 16) % 3) - 1, flip: ((h3 >>> 24) & 1) === 1 });
      }
      if (this.edgeCache.size > 20000) this.edgeCache.clear();
      this.edgeCache.set(k, v);
    }
    return v;
  }

  /** Everything standing in the garden, as drawable objects (sorted by their feet when drawn). */
  rebuildObjects() {
    const g = this.game, s = g.state, now = g.now();
    const objs = [];
    const at = (t) => { const c = centre(t.x, t.y); return { x: c.x, y: c.y + FOOT }; };
    // Landmarks: a wide one (the Old Log stump, two tiles) is drawn centred across its footprint.
    for (const l of s.landmarks || []) {
      const def = g.landmarkDef(l.id);
      if (!def) continue;
      const [fw, fh] = g.landmarkFootprint(l);
      const pos = at({ x: l.tile.x, y: l.tile.y + fh - 1 });
      objs.push({ sprite: def.sprite, x: pos.x + (fw - 1) * TS / 2, y: pos.y, tile: l.tile, kind: 'landmark', key: l.id, still: true, sortY: pos.y - TS });
    }
    // Landscape pieces: drawn across their footprint, standing on its bottom row. Flat ones (water, paths,
    // rings) go under everything else on their tiles.
    for (const p of s.landscape || []) {
      const def = g.landscapeDef(p.defID);
      if (!def) continue;
      const [fw, fh] = def.size, st = g.landscapeStage(p, now);
      const pos = at({ x: p.tile.x, y: p.tile.y + fh - 1 });
      const flat = def.kind === 'water' || def.ground || def.look === 'ring';
      // A crop plant with its crop waiting: its grown sprite with the fruit overlay on top, sparkling.
      // Crop plants may be mirrored (p.flip, chosen when placed); the overlay follows.
      const crop = g.cropState(p, now), ripe = !!(crop && crop.ready), flip = !!p.flip;
      const overlay = ripe ? g.landscapeSprite(def.id, 'fruit') : null;
      objs.push({ sprite: g.landscapeSprite(def.id, st.stage), x: pos.x + (fw - 1) * TS / 2, y: pos.y, tile: p.tile, kind: 'landscape', key: p.id, still: true, flip,
        after: overlay ? (c, x, y) => this.blit(overlay, null, x, y, 0, flip) : null,
        glimmer: ripe, phase: ripe ? hash32(p.tile.x, p.tile.y, 9) % 1000 / 250 : 0, sortY: flat ? p.tile.y * TS - 1 : pos.y - 1 });
    }
    for (const d of s.scenery || []) objs.push({ sprite: d.sprite, ...at(d.tile), tile: d.tile, kind: 'scenery', key: 'sc' + d.tile.x + ',' + d.tile.y, flip: d.flip, still: true });
    for (const d of s.decor.placed) {
      const def = g.decorDef(d.decorID);
      if (!def) continue;
      objs.push({ sprite: def.sprite, variant: decorVariant(def, d.color), ...at(d.tile), tile: d.tile, kind: 'decor', key: d.id, phase: hash32(d.tile.x, d.tile.y, 5) % 1000 / 250, sortY: g.decorKind(def).ground ? at(d.tile).y - TS : undefined });
    }
    for (const f of s.forage.finds) {
      const def = this.app.content.items[f.itemID];
      if (def) objs.push({ sprite: def.sprite, ...at(f.tile), tile: f.tile, kind: 'forage', key: f.id, still: true, bob: true, phase: hash32(f.tile.x, f.tile.y) % 1000 / 100 });
    }
    if (s.tin) objs.push({ sprite: this.app.content.tuning.start?.tin?.sprite || 'relic.unknown', ...at(s.tin.tile), tile: s.tin.tile, kind: 'tin', key: 'tin', glimmer: true, phase: 0 });
    for (const o of this.extraObjects(now, at)) objs.push(o);
    // Picked things get a little pop as they leave.
    const keys = new Set(objs.map((o) => o.key));
    for (const o of this.objects) if ((o.kind === 'forage' || o.kind === 'plant') && !keys.has(o.key)) this.effects.push({ ...o, start: performance.now() });
    this.objects = objs;
  }

  /** Plants (by growth stage) and anything later systems add. */
  extraObjects(now, at) {
    const g = this.game, out = [];
    for (const p of g.state.plants) {
      const stage = g.stageOf(p, now), ready = stage === 'ready';
      out.push({ sprite: this.plantSprite(p, now), variant: ready ? this.plantVariant(p) : null, ...at(p.tile), tile: p.tile, kind: 'plant', key: p.id,
        still: !ready, glimmer: ready, bob: ready, phase: hash32(p.tile.x, p.tile.y, 7) % 1000 / 250 });
    }
    return out.concat(this.moreObjects(now, at));
  }
  /**
   * Residents on their patches: about in their own time of day (wandering), resting otherwise. They never
   * take a tile. And an offering waiting on the Stump, sitting on its top.
   */
  moreObjects(now, at) {
    const g = this.game, out = [], phase = g.dayPhase(now);
    for (const def of g.residents()) {
      const t = g.residentTile(def, now);
      if (!t) continue;
      const awake = def.likes.time === phase, p = at(t);
      out.push({ sprite: def.sprite, x: p.x + 3, y: p.y - 2, tile: t, kind: 'resident', key: def.id, wander: awake, still: !awake, phase: hash32(t.x, t.y, 17) % 1000 / 160, sortY: p.y + 1 });
    }
    const st = g.stump, tr = g.tributeState(now);
    if (st && tr && tr.phase === 'waiting') {
      const it = this.app.content.items[tr.item], p = at({ x: st.tile.x, y: st.tile.y + 1 });
      if (it) out.push({ sprite: it.sprite, variant: it.variant || null, x: p.x + TS / 2, y: p.y - 15, tile: st.tile, kind: 'landmark', key: 'tribute', still: true, sortY: p.y - TS + 1 });
    }
    return out;
  }

  /** A plant's sprite for its stage: seed and sprout (shared), its own bud, then the plant itself. */
  plantSprite(p, now) {
    const g = this.game, def = g.plantDef(p.plantID), item = def && this.app.content.items[def.item];
    const stage = g.stageOf(p, now);
    if (stage === 'seed') return 'seed.stage.planted';
    if (stage === 'sprout') return 'seed.stage.sprout';
    if (stage === 'bud') return 'plant.bud.' + (def ? def.item.split('.')[1] : '');
    return item ? item.sprite : '__missing';
  }
  /** A colour variety's palette swap (later), else none. */
  plantVariant(p) { const v = p.variety && this.game.varietyDef ? this.game.varietyDef(p.variety) : null; return v ? v.variant : null; }

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
    if (!this.gardenFor) return;
    this.measure();
    if (this.camAnim) {
      const a = this.camAnim, k = Math.min(1, (performance.now() - a.start) / a.ms), e = k * k * (3 - 2 * k);
      this.cam = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e };
      this.clamp();
      if (k >= 1) this.camAnim = null;
    }
    const { scale, ox, oy } = this.transform();
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.imageSmoothingEnabled = false;
    const view = { minX: -ox / scale, maxX: (this.canvas.width - ox) / scale, minY: -oy / scale, maxY: (this.canvas.height - oy) / scale };
    const g = this.game, size = g.state.size;
    const nowMs = performance.now();
    const fadeMs = (this.app.content.tuning.visuals.overlayFadeSeconds || 0) * 1000;

    // Ground: every tile on screen (clearing + treeline), plus a margin for tall shrubs.
    const x0 = Math.floor(view.minX / TS) - 1, x1 = Math.floor(view.maxX / TS) + 1;
    const y0 = Math.floor(view.minY / TS) - 1, y1 = Math.floor(view.maxY / TS) + 2;
    const edgeObjs = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const inside = x >= 0 && y >= 0 && x < size.width && y < size.height && g.inClearing({ x, y });
        const c = centre(x, y);
        if (!inside) {
          const v = this.edgeVisual(x, y);
          this.blit(v.ground, null, c.x, c.y, 0);
          for (const d of v.decorations) edgeObjs.push({ sprite: d.sprite, x: c.x + d.dx, y: c.y + TS / 2 + d.dy, flip: d.flip, still: true });
          continue;
        }
        // A soil change fades in over overlayFadeSeconds, from the ground it replaced.
        const ground = this.ground(x, y), k = x + ',' + y, prev = this.groundSince.get(k);
        if (!prev || prev.ground !== ground) this.groundSince.set(k, { ground, from: prev ? prev.ground : null, at: prev ? nowMs : 0 });
        const gs = this.groundSince.get(k);
        const fade = fadeMs > 0 && gs.from ? Math.min(1, (nowMs - gs.at) / fadeMs) : 1;
        if (fade < 1) { this.drawGround(gs.from, c.x, c.y); ctx.globalAlpha = fade; }
        this.drawGround(ground, c.x, c.y);
        ctx.globalAlpha = 1;
        this.drawSoilDetail(x, y, c);
      }
    }
    this.drawWater(ctx, view, t);
    this.drawUnderlay(ctx, view, t);

    // Highlight pulses (expansion, morning, valid planting tiles).
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
    const ui = this.app.ui;
    ctx.lineWidth = 1;
    if (ui.selectedTile) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(ui.selectedTile.x * TS, ui.selectedTile.y * TS, TS, TS);
      ctx.strokeRect(ui.selectedTile.x * TS + 0.5, ui.selectedTile.y * TS + 0.5, TS - 1, TS - 1);
    }

    // Objects (sorted by their feet): everything in the garden on screen, plus the shrub treeline.
    const pad = 32;
    const drawn = this.objects.filter((o) => o.x >= view.minX - pad && o.x <= view.maxX + pad && o.y >= view.minY - pad && o.y <= view.maxY + pad * 2).concat(edgeObjs);
    drawn.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y) || a.x - b.x);
    this.drawn = drawn;
    const still = reducedMotion();
    for (const o of drawn) {
      let x = o.x, y = o.y;
      if (o.bob && !still && (t + (o.phase || 0)) % 4 < 0.3) y -= 1;
      if (o.wander && !still) {
        const k = (t * 0.35 + (o.phase || 0)) % (Math.PI * 2);
        x += Math.round(Math.sin(k) * 5); y += Math.round(Math.sin(k * 2) * 1.5);
      }
      o.drawX = x; o.drawY = y;
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      this.blit(o.sprite, o.variant, x, y, o.still ? 0 : t + (o.phase || 0), o.wander && !still ? Math.cos((t * 0.35 + (o.phase || 0)) % (Math.PI * 2)) < 0 : o.flip);
      ctx.globalAlpha = 1;
      if (o.glimmer) this.sparkles(x, y, t + (o.phase || 0));
      if (o.after) o.after(ctx, x, y, t);
    }

    // Atmosphere: time-of-day tint, then the canopy's shade and light; fireflies on top.
    const L = this.lighting();
    this.drawAmbient(ctx, view, L);
    this.drawCanopy(ctx, view, t, L);
    this.drawOverlay(ctx, view, t, L);
    this.drawFireflies(ctx, view, t, L);
    this.drawDust(ctx);

    // Effects: picked things float up and fade.
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.start < 300);
    for (const e of this.effects) {
      const k = (now - e.start) / 300;
      ctx.globalAlpha = 1 - k;
      this.blit(e.sprite, e.variant, e.x, e.y - Math.round(10 * k), t);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Under objects: while planting or spreading soil, the tiles that would take it glow softly, so the
   * soil rules show themselves (a seed only lights its own soil and plain ground).
   */
  drawUnderlay(ctx) {
    const m = this.app.ui.mode, g = this.game;
    if (m && m.type === 'landscape') { this.drawPlaceable(ctx, m.itemID); return; }
    if (!m || m.type !== 'plant') return;
    const item = this.app.content.items[m.itemID];
    if (!item) return;
    const pulse = 0.55 + 0.25 * Math.sin(performance.now() / 300);
    const c = g.clearing;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const t = { x, y };
      // Planting: its own soil glows brightly, plain ground faintly (it grows there, but slowly).
      const chk = m.type === 'plant' ? g.canPlantPacket(m.itemID, t) : null;
      const ok = chk.ok;
      if (!ok) continue;
      const k = chk && chk.factor < 1 ? 0.45 : 1;
      ctx.fillStyle = `rgba(255,246,190,${0.12 * pulse * k})`;
      ctx.fillRect(x * TS, y * TS, TS, TS);
      ctx.strokeStyle = `rgba(255,246,190,${0.7 * pulse * k})`;
      ctx.strokeRect(x * TS + 1.5, y * TS + 1.5, TS - 3, TS - 3);
    }
  }
  /**
   * While placing a landscape piece: every tile you could tap to put it there glows (its footprint is
   * centred on the tap). Worked out once per piece and garden state, not every frame.
   */
  drawPlaceable(ctx, itemID) {
    const g = this.game, it = this.app.content.items[itemID], def = it && g.landscapeDef(it.landscape);
    if (!def) return;
    const k = [itemID, g.state.landscape.length, g.state.plants.length, g.state.decor.placed.length, g.state.water.length, JSON.stringify(g.clearing)].join('|');
    if (!this._placeable || this._placeable.k !== k) {
      const tiles = [], c = g.clearing;
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (g.canPlaceLandscape(def.id, { x, y }).ok) tiles.push({ x, y });
      this._placeable = { k, tiles };
    }
    const pulse = 0.55 + 0.25 * Math.sin(performance.now() / 300);
    for (const t of this._placeable.tiles) {
      ctx.fillStyle = `rgba(190,255,200,${0.12 * pulse})`;
      ctx.fillRect(t.x * TS, t.y * TS, TS, TS);
      ctx.strokeStyle = `rgba(190,255,200,${0.6 * pulse})`;
      ctx.strokeRect(t.x * TS + 1.5, t.y * TS + 1.5, TS - 3, TS - 3);
    }
  }
  /** Rain falling on rainy and stormy days: short slanted streaks, more and faster in a storm. Still with reduced motion. */
  drawRain(ctx, view, t) {
    const g = this.game, w = g.weatherOn(Game.dayNumber(g.now()));
    if (w.id !== 'rain' && w.id !== 'storm') return;
    const storm = w.id === 'storm', n = storm ? 140 : 70, still = reducedMotion();
    const W = view.maxX - view.minX, H = view.maxY - view.minY;
    ctx.save();
    ctx.globalAlpha = storm ? 0.45 : 0.3;
    ctx.fillStyle = '#c8dcf4';
    for (let i = 0; i < n; i++) {
      const hx = hash32(i, 77) / 4294967296, hy = hash32(i, 78) / 4294967296;
      const fall = still ? 0 : (t * (storm ? 160 : 110) + hy * H) % H;
      const x = Math.round(view.minX + ((hx * W + fall * 0.35) % W)), y = Math.round(view.minY + (still ? hy * H : fall));
      ctx.fillRect(x, y, 1, 3); ctx.fillRect(x - 1, y + 3, 1, 2);
    }
    ctx.restore();
  }

  /** Over the lit scene: rain on rainy days, and lanterns glowing at dusk and night (decor kinds with glow). */
  drawOverlay(ctx, view, t) {
    this.drawRain(ctx, view, t);
    const g = this.game, phase = g.dayPhase(g.now());
    if (phase !== 'dusk' && phase !== 'night') return;
    const strength = phase === 'night' ? 1 : 0.6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of g.state.decor.placed) {
      const def = g.decorDef(d.decorID);
      if (!def || !g.decorKind(def).glow) continue;
      const c = centre(d.tile.x, d.tile.y), y = c.y - 4;
      if (c.x < view.minX - 40 || c.x > view.maxX + 40 || y < view.minY - 40 || y > view.maxY + 40) continue;
      const flicker = 0.9 + 0.1 * Math.sin(t * 3 + d.tile.x);
      const grad = ctx.createRadialGradient(c.x, y, 1, c.x, y, 26);
      grad.addColorStop(0, `rgba(255,214,140,${0.35 * strength * flicker})`);
      grad.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(c.x - 26, y - 26, 52, 52);
    }
    ctx.restore();
  }

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

  highlight(tiles, seconds, color = '255,236,140') {
    this.highlights = (this.highlights || []).concat([{ tiles, until: performance.now() + seconds * 1000, color }]);
  }

  // ---------------------------------------------------------- input

  /** Frontmost interactive object under a world point (pixel-accurate), else the tile. */
  hitTest(w) {
    for (let i = this.drawn.length - 1; i >= 0; i--) {
      const o = this.drawn[i];
      if (!o.kind) continue;
      // A landmark marked tapFootprint (the well) answers only on its own tiles: a tap on the roof above them
      // falls through to whatever is underneath.
      if (o.kind === 'landmark' && (this.game.landmarkDef(o.key) || {}).tapFootprint) {
        const t = tileAt(w.x, w.y), l = this.game.landmarkAt(t);
        if (!l || l.id !== o.key) continue;
      }
      // Landscape pieces answer only on their own tiles (a canopy over the row above lets taps through).
      // Their own tiles are the whole hit area, so a mirrored piece needs no pixel test.
      if (o.kind === 'landscape') { const lp = this.game.landscapeAt(tileAt(w.x, w.y)); if (!lp || lp.id !== o.key) continue; return { ...o.tile, hitKind: o.kind, hitKey: o.key }; }
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
