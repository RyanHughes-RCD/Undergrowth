// Undergrowth web game — game logic (no DOM). Times are epoch milliseconds.
//
// A gardening game in a forest clearing: choose a seed packet, plant it on a tile, watch it grow through
// its stages in real time, harvest it, sell the produce, and plant again. This file holds the garden state
// and its rules: soil and plants, the clearing and treeline, the Old Log, the opening's seed tin, the
// foraging patch, the Bag, the Field Guide's discoveries, the Store/Old Log board and decor. Growth is
// computed from timestamps (see rebase), so time away counts and nothing needs catching up.

export const SCHOOLS = ['spore', 'glow', 'bloom', 'verdure', 'shimmer', 'spirit'];
export const RARITIES = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];
export const RARITY_NAMES = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', veryRare: 'Very rare', legendary: 'Legendary' };
export const rarityIndex = (r) => Math.max(0, RARITIES.indexOf(r));
export const schoolName = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Plain');

/**
 * Save versions. 7 = the garden: everything before it (creatures, relic fields, wild spawns) is archived
 * on load and a fresh garden starts, keeping the Field Guide's discoveries (see Game.fromSave).
 */
export const SAVE_VERSION = 9;
/** Where an older save is kept when a fresh garden replaces it: <save key>.archive.v<version>. */
export const archiveKey = (saveKey, version) => `${saveKey}.archive.v${version}`;

// ---------------------------------------------------------------- utilities

/** Seedable RNG (mulberry32). State lives on `holder.rng` so it is saved with the garden. */
export class RNG {
  constructor(holder) { this.h = holder; }
  next() {
    this.h.rng = (this.h.rng + 0x6d2b79f5) >>> 0;
    let t = this.h.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p) { return p >= 1 ? true : p <= 0 ? false : this.next() < p; }
  int(lo, hi) { return hi <= lo ? lo : lo + Math.floor(this.next() * (hi - lo + 1)); }
  pick(list) { return list.length ? list[this.int(0, list.length - 1)] : null; }
  uuid() {
    let s = '';
    for (let i = 0; i < 4; i++) s += Math.floor(this.next() * 0x100000000).toString(16).padStart(8, '0');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
  }
}

/** Deterministic 32-bit hash, so anything chosen from it is stable across reloads. */
export function hash32(...vals) {
  let h = 0x811c9dc5;
  for (const v of vals) {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** A number in [0, 1) from a hash of the values. */
export const hashUnit = (...vals) => hash32(...vals) / 4294967296;

export function parseHex(s) {
  if (!s) return null;
  s = s.trim().toLowerCase();
  if (s === 'transparent' || s === 'clear') return [0, 0, 0, 0];
  if (s[0] !== '#') return null;
  const d = s.slice(1);
  if (d.length !== 6 && d.length !== 8) return null;
  const n = (i) => parseInt(d.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), d.length === 8 ? n(6) : 255];
}

/**
 * A placed decor prop's colour: cosmetics.json "colors" lists named colours (the first is the art's
 * own). Any other colour swaps the prop's main palette indices 2 (dark), 3 (mid) and 4 (light).
 */
export function decorVariant(def, colorIndex = 0) {
  const c = def && def.colors && def.colors[colorIndex];
  if (!c || !colorIndex) return null;
  const [r, g, b] = parseHex(c.color);
  const tone = (k) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))).toString(16).padStart(2, '0')).join('');
  return { swap: { 2: tone(-0.35), 3: c.color, 4: tone(0.3) } };
}

/** A garden name from its most common soil (Content/nameParts.json), stable for a given seed. */
export function gardenName(parts, counts, seed) {
  const pick = (list, salt) => (list && list.length ? list[hash32(seed, hashStr(salt)) % list.length] : null);
  const ranked = Object.entries(counts).filter(([k, n]) => parts.stats[k] && n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!ranked.length) return pick(parts.quietNames, 'quiet') || 'Quiet Clearing';
  const first = ranked[0][0];
  const adjective = pick(parts.stats[first].adjectives, 'adj-' + first) || '';
  const placeSchool = ranked.length > 1 ? ranked[1][0] : first;
  const place = pick(parts.stats[placeSchool].places, 'place-' + placeSchool) || pick(parts.defaultPlaces, 'place') || 'Garden';
  return `${adjective} ${place}`.trim();
}

/** HSL (0-1) → [r, g, b] (0-255). */
export function hslToRgb(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
const rgbHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
/**
 * A colour variety's palette swap: every vivid, non-green colour in the sprite (greens too with `leaves`)
 * takes the variety's hue, keeping its lightness, so shading and outlines stay.
 */
export function varietySwap(palette, hue, leaves = false) {
  const swap = {};
  (palette || []).forEach((c, i) => {
    const rgb = parseHex(c);
    if (!rgb || rgb[3] === 0 || i < 2) return;
    const [r, g, b] = rgb.map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (l < 0.14) return;
    const d = max - min, sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = ((h * 60) + 360) % 360;
    const green = sat > 0.15 && h > 70 && h < 170;
    if (green && !leaves) return;
    const [nr, ng, nb] = hslToRgb(hue / 360, Math.max(sat, 0.45), l);
    swap[i] = rgbHex(nr, ng, nb);
  });
  return Object.keys(swap).length ? { swap } : null;
}

export const SIDES = ['top', 'bottom', 'left', 'right'];
/** Plant and blind-packet tiers, weakest first. Epic and Legendary plants are the catalogue's Very rare and Legendary finds. */
export const PLANT_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const TIER_NAMES = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
/** Visitor tiers, easiest to keep first. */
export const VISITOR_TIERS = ['early', 'settled', 'mystical'];
/** The Stump's landmark id (landmarks.json): found by the first Room to grow, it takes offerings. */
export const STUMP = 'landmark.stump';
/** The wishing well's landmark id: found by the second Room to grow, it takes handfuls of what you've grown. */
export const WELL = 'landmark.well';
/** A blind seed packet's id: seeds.<school>.<tier>. */
export const blindPacketID = (school, tier) => `seeds.${school}.${tier}`;
const sameTile = (a, b) => a.x === b.x && a.y === b.y;
const key = (t) => t.x + ',' + t.y;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export class GameError extends Error {}

// ---------------------------------------------------------------- game

export class Game {
  constructor(content, state) {
    this.content = content;
    this.state = state;
    this.t = content.tuning;
    this.rng = new RNG(state);
    this.discovered = new Set(state.discovered || []);
    /** One-shot notifications for the UI. Not saved. */
    this.events = [];
    this.defaults();
    this.fitToGrid();
    this.placeLandmarks();
    if ((state.revealCount || 0) > 0 && !this.stump) this.placeStump(null);
    if ((state.revealCount || 0) > 1 && !this.well) this.placeLandmark2x2(WELL, null);
  }

  /** Fields every garden has (older version-7 saves may lack newer ones). */
  defaults() {
    const s = this.state;
    s.inventory = s.inventory || {};
    s.scenery = s.scenery || [];
    s.landmarks = s.landmarks || [];
    s.forage = s.forage || { finds: [], slot: null };
    s.forage.finds = s.forage.finds || [];
    s.offerings = s.offerings || {};
    s.offerings.delivered = s.offerings.delivered || {};
    s.offerings.bought = s.offerings.bought || {};
    s.unlocks = { expansions: 0, ...(s.unlocks || {}) };
    s.decor = s.decor || {};
    s.decor.owned = s.decor.owned || {};
    s.decor.placed = s.decor.placed || [];
    s.revealed = s.revealed || {};
    s.counters = s.counters || {};
    s.opening = s.opening || { done: false };
    s.debugTimeOffset = s.debugTimeOffset || 0;
    s.soil = s.soil || {};                 // "x,y" -> school; plain soil isn't stored
    s.plants = s.plants || [];
    s.coins = s.coins || 0;
    s.morning = s.morning || { lastSurpriseDay: null };
    s.guests = s.guests || {};             // visitors: interest, mementos left (series), notes, home while resident
    s.visitorNews = s.visitorNews || [];   // mementos, arrivals and departures since the player last looked
    s.tribute = s.tribute || null;         // the offering on the Stump
    s.wellBuffs = s.wellBuffs || [];       // the wishing well's blessings in force: { schools, from, until, mult }
    // Before mementos, visitors left tracks and were befriended with a tap. A befriended one has already
    // shown itself: it moves in at its next visit if it can stay.
    delete s.guestTracks;
    for (const [id, g] of Object.entries(s.guests)) {
      if (!('befriended' in g) && !('known' in g)) continue;
      const def = (this.content.visitorList || []).find((v) => v.id === id);
      if (g.befriended && def) { g.series = (def.mementos || []).length; g.gifted = g.befriended; }
      for (const k of ['befriended', 'known', 'present', 'presDay', 'presCount', 'visits']) delete g[k];
    }
    s.collections = s.collections || {};   // school -> time completed
    s.water = s.water || [];               // "x,y" of every water tile, the source pool included
    s.pool = s.pool || null;               // top-left tile of the 2x2 pool the river rises from
    s.soilLevel = s.soilLevel || {};       // "x,y" -> maturity 1..max of a school soil tile
    s.dug = s.dug || 0;
    if (s.tideAt == null && s.nightDay != null) s.tideAt = s.nightDay * 4;   // nightly saves: the last tide was that midnight's
    delete s.nightDay; delete s.lastNight;
  }

  /** A fresh garden. `discovered` carries Field Guide entries over (from an archived older save). */
  static newGarden(content, now, seed = null, discovered = []) {
    const s = (seed == null ? Math.floor(Math.random() * 0xffffffff) : seed) >>> 0;
    const t = content.tuning;
    const W = t.grid.width, H = t.grid.height;
    const c = t.clearing || {};
    const cw = Math.min(W, c.startWidth || W), ch = Math.min(H, c.startHeight || H);
    const x0 = Math.floor((W - cw) / 2), y0 = Math.floor((H - ch) / 2);
    const state = {
      version: SAVE_VERSION, forestID: '', seed: s, rng: s, size: { width: W, height: H },
      createdAt: now, lastUpdated: now, lastRealSeen: Date.now(), customName: null,
      clearing: { x0, y0, x1: x0 + cw - 1, y1: y0 + ch - 1 },
      inventory: {}, discovered: [...new Set(discovered)], debugTimeOffset: 0,
      coins: (t.garden && t.garden.startCoins) || 0,
    };
    const g = new Game(content, state);
    state.forestID = g.rng.uuid();
    g.placePool();
    g.generateStreams();
    g.state.tideAt = Game.tideNumber(now);
    g.placeScenery();
    g.placeTin();
    g.state.forage.slot = g.forageSlot(now);
    g.events = [];
    return g;
  }

  /**
   * Opens a saved garden. A save from before the garden (version < 7) can't be carried over: it is
   * returned in `archived` (the caller keeps it under archiveKey) and a fresh garden starts with the
   * old save's Field Guide discoveries. Returns { game, archived }.
   */
  static fromSave(content, saved, now) {
    if (!saved || typeof saved.version !== 'number') return { game: Game.newGarden(content, now), archived: null };
    if (saved.version === 7) return { game: Game.migrate7(content, saved, now), archived: null };
    if (saved.version === 8) return { game: Game.migrate8(content, saved, now), archived: null };
    if (saved.version < SAVE_VERSION) {
      const g = Game.newGarden(content, now, null, saved.discovered || []);
      if (saved.dev) g.state.dev = { ...saved.dev };
      g.state.archivedFrom = { version: saved.version, at: now };
      g.events.push({ type: 'freshGarden', version: saved.version, kept: g.discovered.size });
      return { game: g, archived: saved };
    }
    return { game: new Game(content, saved), archived: null };
  }

  /**
   * Version 7 gardens had the Old Log at the centre. The pool takes its place (the emptiest 2x2 block
   * around it) and its streams are cut around what's already there; soil already laid counts as Settled.
   */
  static migrate7(content, saved, now) {
    const log = (saved.landmarks || []).find((l) => l.id === 'landmark.old-log');
    saved.landmarks = (saved.landmarks || []).filter((l) => l.id !== 'landmark.old-log');
    saved.version = SAVE_VERSION;
    const g = new Game(content, saved);
    for (const k of Object.keys(g.state.soil)) g.state.soilLevel[k] = g.state.soilLevel[k] || 2;
    g.poolAround(log ? log.tile : g.source);
    g.generateStreams();
    g.state.tideAt = Game.tideNumber(now);
    if (!g.state.opening.done && !g.state.tin) g.placeTin();
    return g;
  }

  /**
   * Version 8 gardens had the spring (a landmark) at the head of the streams. It becomes the 2x2 pool: the
   * emptiest block of four tiles around the spring's tile turns to water, whatever was on it.
   */
  static migrate8(content, saved, now) {
    const spring = (saved.landmarks || []).find((l) => l.id === 'landmark.spring');
    saved.landmarks = (saved.landmarks || []).filter((l) => l.id !== 'landmark.spring');
    saved.version = SAVE_VERSION;
    const g = new Game(content, saved);
    if (!g.state.pool) g.poolAround(spring ? spring.tile : g.source);
    return g;
  }

  /** Makes the pool from the emptiest in-clearing 2x2 block that includes tile `t`. */
  poolAround(t) {
    let best = null;
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const tl = { x: t.x + ox, y: t.y + oy }, tiles = this.poolTiles(tl);
      if (!tiles.every((u) => this.inClearing(u))) continue;
      const cost = tiles.reduce((a, u) => a + (this.waterAt(u) ? 0 : this.isFree(u) ? (this.soilAt(u) ? 1.5 : 1) : 5), 0);
      if (!best || cost < best.cost) best = { tl, cost };
    }
    if (!best) return;
    this.state.pool = best.tl;
    for (const u of this.poolTiles(best.tl)) this.makeWater(u);
  }

  toJSON() { return { ...this.state, discovered: [...this.discovered] }; }
  takeEvents() { const e = this.events; this.events = []; return e; }

  // ---- time
  now(real = Date.now()) { return real + this.state.debugTimeOffset; }
  debugSkip(seconds) { this.state.debugTimeOffset += seconds * 1000; }
  static dayNumber(t) { return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / DAY); }
  gardenDay(now) { return Math.floor((now - this.state.createdAt) / DAY) + 1; }
  get clock() { return this.t.clock || {}; }
  /** dawn, day, dusk or night by the local clock (tuning.clock). */
  dayPhase(t) {
    const c = this.clock, d = new Date(t), h = d.getHours() + d.getMinutes() / 60;
    const dawn = c.dawnStartHour ?? 5, day = c.dayStartHour ?? 7, dusk = c.duskStartHour ?? 17, night = c.nightStartHour ?? 19;
    if (h >= dawn && h < day) return 'dawn';
    if (h >= day && h < dusk) return 'day';
    if (h >= dusk && h < night) return 'dusk';
    return 'night';
  }
  isNight(t) { return this.dayPhase(t) === 'night'; }

  /** Brings the garden up to `now`. Returns a small report for the UI. */
  advance(now) {
    const report = { forage: this.forageTick(now), tides: this.tideTick(now) };
    this.expireBuffs(now);
    this.visitorTick(now);   // (the tides have already run the checks up to each one)
    this.updateBeauty(now);
    this.state.lastUpdated = Math.max(this.state.lastUpdated || 0, now);
    return report;
  }

  // ---- grid, clearing, landmarks
  get clearing() { return this.state.clearing; }
  inBounds(t) { return t.x >= 0 && t.y >= 0 && t.x < this.state.size.width && t.y < this.state.size.height; }
  inClearing(t) { const c = this.state.clearing; return t.x >= c.x0 && t.x <= c.x1 && t.y >= c.y0 && t.y <= c.y1; }
  clearingTiles() {
    const c = this.state.clearing, out = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) out.push({ x, y });
    return out;
  }
  get fullyOpen() { const c = this.clearing, s = this.state.size; return c.x0 <= 0 && c.y0 <= 0 && c.x1 >= s.width - 1 && c.y1 >= s.height - 1; }

  /** If the configured map size changed since this garden was saved, resize it, keeping what fits. */
  fitToGrid() {
    const s = this.state, g = this.t.grid;
    if (s.size.width === g.width && s.size.height === g.height) return;
    s.size = { width: g.width, height: g.height };
    const c = s.clearing;
    s.clearing = { x0: Math.max(0, c.x0), y0: Math.max(0, c.y0), x1: Math.min(g.width - 1, c.x1), y1: Math.min(g.height - 1, c.y1) };
    const inside = (x) => this.inClearing(x.tile);
    s.scenery = s.scenery.filter(inside);
    s.decor.placed = s.decor.placed.filter(inside);
    s.forage.finds = s.forage.finds.filter(inside);
  }

  landmarkDef(id) { return (this.content.landmarks || []).find((l) => l.id === id) || null; }
  /** [w, h] tiles a landmark covers (landmarks.json "footprint"), from its tile rightward and down. */
  landmarkFootprint(l) { const f = (this.landmarkDef(l.id) || {}).footprint; return Array.isArray(f) ? f : [1, 1]; }
  landmarkTiles(l) {
    const [w, h] = this.landmarkFootprint(l), out = [];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: l.tile.x + dx, y: l.tile.y + dy });
    return out;
  }
  landmarkAt(t) { return this.state.landmarks.find((l) => this.landmarkTiles(l).some((u) => sameTile(u, t))) || null; }

  /** Puts data-defined landmarks (none at present) on the map, once, and keeps their tiles clear. */
  placeLandmarks() {
    const ids = new Set((this.content.landmarks || []).map((d) => d.id));
    this.state.landmarks = this.state.landmarks.filter((l) => ids.has(l.id));
    for (const def of this.content.landmarks || []) {
      if (def.discovery || this.state.landmarks.some((l) => l.id === def.id)) continue;   // some are found later
      const c = this.state.clearing;
      const tile = def.position && typeof def.position === 'object' ? { ...def.position } : { x: Math.floor((c.x0 + c.x1) / 2), y: Math.floor((c.y0 + c.y1) / 2) };
      if (def.inGuide !== false) this.discover('landmark:' + def.id.replace(/^landmark\./, ''));
      this.state.landmarks.push({ id: def.id, tile });
    }
    const s = this.state;
    for (const l of s.landmarks) {
      const on = (x) => this.landmarkTiles(l).some((u) => sameTile(u, x.tile));
      s.scenery = s.scenery.filter((x) => !on(x));
      s.forage.finds = s.forage.finds.filter((x) => !on(x));
      s.plants = s.plants.filter((x) => !on(x));
      for (const t of this.landmarkTiles(l)) { delete s.soil[key(t)]; delete s.soilLevel[key(t)]; }
      for (const d of s.decor.placed) if (on(d)) { const t = this.freeNear(l.tile); if (t) d.tile = t; }
    }
  }

  sceneryAt(t) { return this.state.scenery.find((d) => sameTile(d.tile, t)) || null; }
  decorAt(t) { return this.state.decor.placed.find((d) => sameTile(d.tile, t)) || null; }
  forageAt(t) { return this.state.forage.finds.find((f) => sameTile(f.tile, t)) || null; }
  tinAt(t) { return this.state.tin && sameTile(this.state.tin.tile, t) ? this.state.tin : null; }

  /** Debris: a rock, fern, bush, lichen or roots from the grotto's edge (not a wild feature), which can be cleared. */
  debrisAt(t) { const d = this.sceneryAt(t); return d && !d.feature ? d : null; }
  /** Clears the debris off a tile, leaving it open (its soil stays). */
  clearDebris(t) {
    const d = this.debrisAt(t);
    if (!d) throw new GameError("There's nothing to clear here.");
    this.state.scenery = this.state.scenery.filter((x) => x !== d);
    this.bump('debrisCleared');
    return d;
  }
  /** Nothing on the tile: no water, landmark, scenery, decor, plant, find or the seed tin. */
  isFree(t) {
    return this.inBounds(t) && this.inClearing(t) && !this.waterAt(t) && !this.landmarkAt(t) && !this.sceneryAt(t) && !this.decorAt(t) && !this.plantAt(t) && !this.forageAt(t) && !this.tinAt(t);
  }

  // ---- the pool and its streams (tuning.water)
  /** The four tiles of a 2x2 pool whose top-left is `tl`. */
  poolTiles(tl = this.state.pool) { return tl ? [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => ({ x: tl.x + dx, y: tl.y + dy })) : []; }
  isPool(t) { const p = this.state.pool; return !!p && t.x >= p.x && t.x <= p.x + 1 && t.y >= p.y && t.y <= p.y + 1; }
  /** Where the river rises: the pool's top-left tile (or the clearing's centre), for placing things near it. */
  get source() { const c = this.clearing; return this.state.pool || { x: Math.floor((c.x0 + c.x1) / 2), y: Math.floor((c.y0 + c.y1) / 2) }; }
  /** The 2x2 pool at the centre of a new clearing. */
  placePool() {
    const c = this.clearing;
    const tl = { x: Math.floor((c.x0 + c.x1) / 2) - (hash32(this.state.seed, 0x9001) & 1), y: Math.floor((c.y0 + c.y1) / 2) - (hash32(this.state.seed, 0x9002) & 1) };
    this.state.pool = tl;
    for (const t of this.poolTiles(tl)) this.makeWater(t);
  }
  /**
   * Turns a tile to water, whatever was on it: its soil is lost, a plant, debris or a find is gone, decor
   * goes back to the Bag and the seed tin moves aside. Never under a landmark (the Stump).
   */
  makeWater(t) {
    const s = this.state, k = key(t), at = (x) => sameTile(x.tile, t);
    if (this.waterAt(t) || this.landmarkAt(t)) return;
    delete s.soil[k]; delete s.soilLevel[k];
    s.plants = s.plants.filter((x) => !at(x));
    s.scenery = s.scenery.filter((x) => !at(x));
    s.forage.finds = s.forage.finds.filter((x) => !at(x));
    for (const d of s.decor.placed.filter(at)) { s.decor.placed = s.decor.placed.filter((x) => x !== d); s.decor.owned[d.decorID] = (s.decor.owned[d.decorID] || 0) + 1; }
    s.water.push(k);
    if (s.tin && at(s.tin)) { const n = this.freeNear(t); if (n) s.tin.tile = n; }
  }
  waterAt(t) {
    if (this._waterKey !== this.state.water.length) { this._waterSet = new Set(this.state.water); this._waterKey = this.state.water.length; }
    return this._waterSet.has(key(t));
  }
  /** Water (the pool and the streams): what banks are measured from. */
  isWet(t) { return this.waterAt(t); }
  /** A tile touching water (side by side): its soil can be carried off, or carried in. */
  isBank(t) {
    if (this.isWet(t) || !this.inClearing(t) || this.landmarkAt(t)) return false;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.isWet({ x: t.x + dx, y: t.y + dy }));
  }
  bankTiles() { return this.clearingTiles().filter((t) => this.isBank(t)); }

  /**
   * Cuts the pool's streams: riverTiles water tiles in at least minStreams streams, which either leave the
   * pool in different directions or fork, meandering at random. Streams never touch except where they
   * join, so they stay distinct. Deterministic from the garden seed. Avoids anything already on the ground, soil included.
   */
  generateStreams() {
    const cfg = this.t.water || {}, pool = this.poolTiles();
    if (!pool.length || this.state.water.length > pool.length) return;
    const rng = new RNG({ rng: hash32(this.state.seed, 0x5791) });
    const [lo, hi] = cfg.riverTiles || [6, 7];
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const base = new Set(pool.map(key));
    const ok = (t, water, from) => this.inClearing(t) && this.isFree(t) && !this.state.soil[key(t)] && !water.has(key(t))
      && DIRS.every(([dx, dy]) => { const n = { x: t.x + dx, y: t.y + dy }; return sameTile(n, from) || !water.has(key(n)); });
    const walk = (start, dir, len, water, out) => {
      let pos = start, d = dir;
      for (let i = 0; i < len; i++) {
        const keep = cfg.keepDirection ?? 0.55;
        const opts = i === 0 ? [[d, 1]] : [[d, keep], [(d + 1) % 4, (1 - keep) / 2], [(d + 3) % 4, (1 - keep) / 2]];
        let r = rng.next(), pick = null;
        const valid = opts.filter(([dd]) => ok({ x: pos.x + DIRS[dd][0], y: pos.y + DIRS[dd][1] }, water, pos));
        const tot = valid.reduce((a, [, w]) => a + w, 0);
        for (const [dd, w] of valid) { if (r * tot < w) { pick = dd; break; } r -= w / tot; }
        if (pick == null) pick = valid.length ? valid[valid.length - 1][0] : null;
        if (pick == null) return false;
        d = pick;
        const next = { x: pos.x + DIRS[d][0], y: pos.y + DIRS[d][1] };
        water.add(key(next)); out.push({ tile: next, dir: d });
        pos = next;
      }
      return true;
    };
    // Ways out of the pool: a pool tile and an outward direction (8 of them).
    const exits = [];
    for (const t of pool) DIRS.forEach(([dx, dy], d) => { if (!this.isPool({ x: t.x + dx, y: t.y + dy })) exits.push({ tile: t, dir: d }); });
    let best = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const total = rng.int(lo, hi), water = new Set(base), first = [], second = [];
      const fork = rng.chance(0.5);
      const a = rng.int(2, total - 2);
      const e1 = exits[rng.int(0, exits.length - 1)];
      let good = walk(e1.tile, e1.dir, a, water, first);
      if (good) {
        if (fork) {
          const at = first[rng.int(0, Math.max(0, first.length - 2))];
          const side = rng.chance(0.5) ? (at.dir + 1) % 4 : (at.dir + 3) % 4;
          good = walk(at.tile, side, total - a, water, second);
        } else {
          const others = exits.filter((x) => x.dir !== e1.dir);
          const e2 = others[rng.int(0, others.length - 1)];
          good = walk(e2.tile, e2.dir, total - a, water, second);
        }
      }
      const n = water.size - base.size;
      if (good && n === total) { best = water; break; }
      if (!best || n > best.size - base.size) best = water;
    }
    for (const k of best) if (!base.has(k)) { const [x, y] = k.split(',').map(Number); this.makeWater({ x, y }); }
  }

  /**
   * Room to grow carries the river on: from the water tile nearest a random point on the newly revealed
   * outer edge, a stream winds out to that edge (the cheapest path, with a little hashed meander). It goes
   * around plants, decor and features where it can, and through them where it must (see makeWater).
   * Deterministic from the garden seed and the expansion. Returns the new water tiles.
   */
  extendRiver(side, tier) {
    const c = this.clearing;
    const edge = [];
    if (side === 'top' || side === 'bottom') { const y = side === 'top' ? c.y0 : c.y1; for (let x = c.x0 + 1; x < c.x1; x++) edge.push({ x, y }); }
    else { const x = side === 'left' ? c.x0 : c.x1; for (let y = c.y0 + 1; y < c.y1; y++) edge.push({ x, y }); }
    if (!edge.length || !this.state.water.length) return [];
    const target = edge[hash32(this.state.seed, tier, 0x7e1) % edge.length];
    if (this.waterAt(target)) return [];
    let start = null, bestD = Infinity;
    for (const k of this.state.water) {
      const [x, y] = k.split(',').map(Number), d = Math.abs(x - target.x) + Math.abs(y - target.y) + hashUnit(this.state.seed, tier, x, y) * 0.5;
      if (d < bestD) { bestD = d; start = { x, y }; }
    }
    // A bend on the way: a point midway, pushed up to 2 tiles to one side, so the stream meanders.
    const mid = { x: Math.round((start.x + target.x) / 2), y: Math.round((start.y + target.y) / 2) };
    const sway = (hash32(this.state.seed, tier, 0x7e3) % 5) - 2;
    if (side === 'top' || side === 'bottom') mid.x = Math.min(c.x1 - 1, Math.max(c.x0 + 1, mid.x + sway));
    else mid.y = Math.min(c.y1 - 1, Math.max(c.y0 + 1, mid.y + sway));
    const blocked = (t) => this.plantAt(t) || this.decorAt(t) || this.tinAt(t) || this.sceneryAt(t) || this.landmarkAt(t);
    const a = !blocked(mid) && this.riverPath(start, mid, tier), b = a && this.riverPath(mid, target, tier);
    const path = a && b ? [...a, ...b] : this.riverPath(start, target, tier);
    if (!path) return [];
    const added = [];
    for (const t of path) if (!this.waterAt(t) && !added.some((u) => sameTile(u, t))) added.push(t);
    for (const t of added) this.makeWater(t);
    return added;
  }

  /**
   * The cheapest way from `from` to `to` through the clearing (Dijkstra, 4 directions): each step costs a
   * little more on hashed ground (the meander), more on soil and debris, and a lot through a plant, decor,
   * a feature or the tin; running along water is cheap. Returns the tiles after `from`, or null.
   */
  riverPath(from, to, tier) {
    const W = this.state.size.width, idx = (t) => t.y * W + t.x, dist = new Map(), prev = new Map(), open = [{ t: from, d: 0 }];
    dist.set(idx(from), 0);
    const cost = (t) => {
      let k = 1 + hashUnit(this.state.seed, tier, t.x, t.y, 0x7e2) * 1.4;
      if (this.waterAt(t)) k = 0.6;
      else if (this.plantAt(t) || this.decorAt(t) || this.tinAt(t) || (this.sceneryAt(t) && this.sceneryAt(t).feature)) k += 12;
      else if (this.sceneryAt(t)) k += 3;
      else if (this.soilAt(t)) k += 0.6;
      return k;
    };
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
      const { t, d } = open.splice(bi, 1)[0];
      if (sameTile(t, to)) break;
      if (d > (dist.get(idx(t)) ?? Infinity)) continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const n = { x: t.x + dx, y: t.y + dy };
        if (!this.inClearing(n) || this.landmarkAt(n)) continue;
        const nd = d + cost(n);
        if (nd < (dist.get(idx(n)) ?? Infinity)) { dist.set(idx(n), nd); prev.set(idx(n), t); open.push({ t: n, d: nd }); }
      }
    }
    if (sameTile(from, to)) return [];
    if (!prev.has(idx(to))) return null;
    const path = [];
    for (let t = to; t && !sameTile(t, from); t = prev.get(idx(t))) path.unshift(t);
    return path;
  }

  /** What digging the next tile costs. */
  digCost() { const d = (this.t.water || {}).dig || {}; return (d.cost ?? 15) + (d.step ?? 5) * (this.state.dug || 0); }
  /** Whether a tile can be dug into water, and why not. */
  canDig(t) {
    if (!this.inBounds(t) || !this.inClearing(t)) return { ok: false, reason: "That's outside the clearing." };
    if (this.isWet(t)) return { ok: false, reason: "It's already water." };
    if (!this.isFree(t)) return { ok: false, reason: 'Clear the tile first.' };
    if (!this.isBank(t)) return { ok: false, reason: 'Water can only be led from the water next to it.' };
    return { ok: true, cost: this.digCost() };
  }
  /** Dig a tile beside the water: its soil is lost, and water takes its place. */
  dig(t, now) {
    const chk = this.canDig(t);
    if (!chk.ok) throw new GameError(chk.reason);
    this.spend(chk.cost);
    this.rebase(now);
    delete this.state.soil[key(t)]; delete this.state.soilLevel[key(t)];
    this.state.water.push(key(t));
    this.state.dug = (this.state.dug || 0) + 1;
    this.rebase(now);
    this.bump('dig');
    return chk.cost;
  }

  // ---- weather and the moon (tuning.weather, tuning.moon)
  /** The weather on a local day: { id, name, icon, power }. It tends to last (persistence). Deterministic. */
  weatherOn(day) {
    const W = this.t.weather || {}, types = W.types || { clear: { name: 'Clear', icon: 'sun', weight: 1, power: 0 } };
    this._weather = this._weather || new Map();
    if (this._weather.has(day)) return this._weather.get(day);
    const ids = Object.keys(types);
    const draw = (d, salt) => {
      let r = hashUnit(this.state.seed, d, salt) * ids.reduce((a, k) => a + (types[k].weight || 0), 0);
      for (const k of ids) { if (r < (types[k].weight || 0)) return k; r -= types[k].weight || 0; }
      return ids[0];
    };
    // Walk forward from a few weeks back, so each day's weather depends on the day before.
    let id = draw(day - 30, 0x3e1);
    for (let d = day - 29; d <= day; d++) id = hashUnit(this.state.seed, d, 0x3e2) < (W.persistence ?? 0.45) ? id : draw(d, 0x3e3);
    const out = { id, ...types[id] };
    this._weather.set(day, out);
    return out;
  }
  /** The moon's phase on a local day (the real one): { index 0-7, name, power }, 0 = new, 4 = full. */
  moonOn(day) {
    const phases = (this.t.moon || {}).phases || [];
    const noon = Game.dayStart(day) + 12 * HOUR;
    const frac = (((noon - 947182440000) / 2551442877) % 1 + 1) % 1;   // a new moon: 2000-01-06 18:14 UTC
    const index = Math.floor(frac * 8 + 0.5) % 8;
    return { index, ...(phases[index] || { name: 'Moon', power: 0 }) };
  }
  static dayStart(day) { let t = day * DAY; t += new Date(t).getTimezoneOffset() * 60000; return t; }
  /** Today and tomorrow: weather, moon and how hard the water will run that night. */
  forecast(now) {
    const day = Game.dayNumber(now);
    return [day, day + 1].map((d) => { const w = this.weatherOn(d), m = this.moonOn(d); return { day: d, weather: w, moon: m, power: (w.power || 0) + (m.power || 0) }; });
  }

  // ---- the night: water moves soil, soil matures (tuning.tides)
  soilLevel(t) { return this.soilAt(t) ? (this.state.soilLevel[key(t)] || 1) : 0; }
  setSoil(t, school, level = 1) {
    if (school) { this.state.soil[key(t)] = school; this.state.soilLevel[key(t)] = level; } else { delete this.state.soil[key(t)]; delete this.state.soilLevel[key(t)]; }
  }
  /**
   * The water's level for a given power (weather + moon): Low, Normal, High or Flood (tuning.water.levels),
   * with how far it sits in from its banks (inset px) and its chance to carry soil across (cross).
   */
  waterLevel(power) {
    const L = (this.t.water || {}).levels || [{ name: 'Normal', inset: 1, cross: 0 }];
    let i = L.findIndex((l) => l.below != null && power < l.below);
    if (i < 0) i = L.length - 1;
    return { index: i, ...L[i] };
  }
  /** A day's water level (developer mode can pin what's shown with state.dev.waterLevel). */
  waterLevelOn(day) {
    const pin = this.state.dev && this.state.dev.waterLevel;
    if (pin != null) { const L = (this.t.water || {}).levels || []; if (L[pin]) return { index: pin, ...L[pin] }; }
    const w = this.weatherOn(day), m = this.moonOn(day);
    return this.waterLevel((w.power || 0) + (m.power || 0));
  }
  /**
   * Land tiles next to `t` that soil can reach without crossing water: the four sides, and a corner only when
   * neither tile beside it is water (so a diagonal never cuts across a bend in the stream).
   */
  landNeighbours(t) {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = { x: t.x + dx, y: t.y + dy };
      if (this.isWet(n)) continue;
      if (dx && dy && (this.isWet({ x: t.x + dx, y: t.y }) || this.isWet({ x: t.x, y: t.y + dy }))) continue;
      out.push(n);
    }
    return out;
  }
  /** Land on the far side of the water from `t`: straight across one or two water tiles. */
  acrossWater(t) {
    const out = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      for (let k = 1; k <= 2; k++) {
        const w = { x: t.x + dx * k, y: t.y + dy * k };
        if (!this.isWet(w)) break;
        const far = { x: t.x + dx * (k + 1), y: t.y + dy * (k + 1) };
        if (!this.isWet(far)) { out.push(far); break; }
      }
    }
    return out;
  }
  /** The local six-hour block a time falls in (0 = 00:00-06:00 on local day 0). A tide turns at each one's start. */
  static tideNumber(t) { return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / (6 * HOUR)); }
  static tideStart(n) { return Game.dayStart(Math.floor(n / 4)) + (n % 4) * 6 * HOUR; }
  /**
   * Every tide since the last one processed (one each local 00:00, 06:00, 12:00 and 18:00; catch-up covers
   * at most tides.maxTides). Records what they did together in state.lastTides for the return card.
   * Returns how many tides turned.
   */
  tideTick(now) {
    const cur = Game.tideNumber(now), s = this.state;
    if (s.tideAt == null) { s.tideAt = cur; return 0; }
    if (cur <= s.tideAt) return 0;
    const from = Math.max(s.tideAt + 1, cur - ((this.t.tides || {}).maxTides ?? 28) + 1);
    const sum = { tides: 0, taken: [], held: 0, matured: 0, crossed: 0 };
    for (let n = from; n <= cur; n++) {
      this.expireBuffs(Game.tideStart(n));        // blessings that ran out before this tide end on time
      this.visitorTick(Game.tideStart(n) - 1);   // visitors see the soil as it was until the tide turns
      const r = this.runTide(n);
      sum.tides++; sum.taken.push(...r.taken); sum.held += r.held; sum.matured += r.matured; sum.crossed += r.crossed;
      Object.assign(sum, { weather: r.weather, moon: r.moon, power: r.power, level: r.level, at: r.at });
    }
    s.tideAt = cur;
    if (sum.taken.length > 40) sum.taken = sum.taken.slice(-40);
    s.lastTides = sum;
    this.events.push({ type: 'tides', ...sum });
    return sum.tides;
  }
  /**
   * One tide (number n; see tideNumber). The water's power is that day's weather + moon, and sets its level.
   * Soil on a bank spreads along the bank and inland, one tile at a time, never through the water; only at a
   * high level does it cross the stream to the far bank. The spread uses power + tides.basePower, so even a
   * still day moves a little. Mature tiles and tiles with a plant hold more often. Each tile that held its
   * soil may mature a level (tides.matureChance). Deterministic from the garden seed and the tide.
   */
  runTide(n, override = null) {
    const T = this.t.tides || {}, maxLv = ((this.gcfg.soil || {}).levels || {}).max ?? 4;
    const d = Math.floor(n / 4);
    const w = override?.weather ? { id: override.weather, ...((this.t.weather || {}).types || {})[override.weather] } : this.weatherOn(d);
    const m = override?.moon != null ? { index: override.moon, ...(((this.t.moon || {}).phases || [])[override.moon] || {}) } : this.moonOn(d);
    const power = (w.power || 0) + (m.power || 0), push = power + (T.basePower ?? 0.4);
    const rng = new RNG({ rng: hash32(this.state.seed, n, 0x71de) });
    const at = Game.tideStart(n);
    this.rebase(at);
    const changed = new Set(), taken = [];
    let held = 0;
    const tryTake = (t, school) => {
      const cur = this.soilAt(t);
      if (cur === school || changed.has(key(t))) return;
      if (this.tideHeld(t)) { held++; return; }      // a resident with tideHold keeps its patch
      const resist = this.soilLevel(t) + (this.plantAt(t) ? (T.plantHold ?? 1.5) : 0);
      if (resist > 0 && rng.next() < resist / (resist + (T.hold ?? 1.2))) { held++; return; }
      taken.push({ tile: { ...t }, from: cur, to: school, plant: !!this.plantAt(t) });
      this.setSoil(t, school, 1);
      changed.add(key(t));
    };
    // Soil spreads from the banks: along the bank (to a neighbouring bank tile), inland (to any open
    // neighbour), never through the water. Only high water carries soil across to the other side.
    const snapshot = this.bankTiles().map((t) => ({ t, school: this.soilAt(t) })).filter((x) => x.school);
    const level = this.waterLevel(power);
    const open = (t) => this.inClearing(t) && !this.isWet(t) && !this.landmarkAt(t) && !this.sceneryAt(t);
    const pAlong = Math.min(T.cap ?? 0.8, (T.alongBank ?? 0.25) * push), pIn = Math.min(T.cap ?? 0.8, (T.inland ?? 0.06) * push);
    let crossed = 0;
    for (const x of snapshot) {
      const near = this.landNeighbours(x.t).filter(open);
      const along = near.filter((t) => this.isBank(t));
      if (along.length && rng.next() < pAlong) tryTake(along[rng.int(0, along.length - 1)], x.school);
      if (near.length && rng.next() < pIn) tryTake(near[rng.int(0, near.length - 1)], x.school);
      if (level.cross > 0 && rng.next() < level.cross) {
        const across = this.acrossWater(x.t).filter(open);
        if (across.length) { const before = taken.length; tryTake(across[rng.int(0, across.length - 1)], x.school); if (taken.length > before) { taken[taken.length - 1].crossed = true; crossed++; } }
      }
    }
    // Soil that held through the tide may mature a level.
    let matured = 0;
    for (const k of Object.keys(this.state.soil)) {
      if (changed.has(k)) continue;
      const lv = this.state.soilLevel[k] || 1;
      if (lv < maxLv && rng.next() < (T.matureChance ?? 0.5)) { this.state.soilLevel[k] = lv + 1; matured++; }
    }
    this.rebase(at);
    return { n, at, day: d, weather: w.id, moon: m.index, power, level: level.index, taken, held, matured, crossed };
  }

  /** Nearest free clearing tile to `t` (ring search). */
  freeNear(t) {
    for (let r = 1; r < 24; r++) {
      const ring = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ x: t.x + dx, y: t.y + dy });
      ring.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y));
      const hit = ring.find((p) => this.isFree(p));
      if (hit) return hit;
    }
    return null;
  }

  /** Sides of the clearing that can still be pushed back (not yet at the forest's edge). */
  openSides() {
    const c = this.clearing, s = this.state.size;
    return SIDES.filter((d) => (d === 'top' ? c.y0 > 0 : d === 'bottom' ? c.y1 < s.height - 1 : d === 'left' ? c.x0 > 0 : c.x1 < s.width - 1));
  }

  /**
   * Room to grow: the trees on one side the player chose (top, bottom, left or right) step back
   * expansion.sideTiles rows (clipped to the forest). The new ground fades in; see revealWild.
   */
  expand(now, side = null) {
    const open = this.openSides();
    if (!side) side = open[0];
    if (!open.includes(side)) throw new GameError('The forest ends on that side.');
    const c = this.clearing, s = this.state.size;
    const r = (this.t.expansion && this.t.expansion.sideTiles) || 3;
    const next = { ...c };
    if (side === 'top') next.y0 = Math.max(0, c.y0 - r);
    if (side === 'bottom') next.y1 = Math.min(s.height - 1, c.y1 + r);
    if (side === 'left') next.x0 = Math.max(0, c.x0 - r);
    if (side === 'right') next.x1 = Math.min(s.width - 1, c.x1 + r);
    const added = [];
    for (let y = next.y0; y <= next.y1; y++) for (let x = next.x0; x <= next.x1; x++) if (!this.inClearing({ x, y })) { this.state.revealed[x + ',' + y] = now; added.push({ x, y }); }
    this.state.clearing = next;
    const wild = this.revealWild(c, added);
    const river = this.extendRiver(side, this.state.revealCount || 0);
    this.events.push({ type: 'expansion', side, tiles: added, ...wild, river });
    return added;
  }

  /**
   * New ground isn't empty: a patch of one school's soil (a different school each tier, in an order
   * shuffled by the garden seed) and, beside it, that school's wild feature (tuning.expansion.features).
   * Both go on the inner band of the new ring (next to the old clearing), so the outer edge stays free for
   * the foraging patch. Deterministic from the garden seed and the tier.
   */
  revealWild(old, added) {
    const cfg = this.t.expansion || {}, feats = cfg.features || {};
    const tier = this.state.revealCount = (this.state.revealCount || 0) + 1;
    const order = SCHOOLS.slice().sort((a, b) => hash32(this.state.seed, hashStr(a)) - hash32(this.state.seed, hashStr(b)));
    const school = order[(tier - 1) % order.length];
    // The inner band: new tiles touching the old clearing (including diagonally).
    const inner = added.filter((t) => t.x >= old.x0 - 1 && t.x <= old.x1 + 1 && t.y >= old.y0 - 1 && t.y <= old.y1 + 1 && this.isFree(t));
    if (!inner.length) return {};
    const start = inner[hash32(this.state.seed, tier, 0x501) % inner.length];
    // Grow the patch along the band from the start tile (nearest first).
    const near = inner.slice().sort((a, b) => (Math.abs(a.x - start.x) + Math.abs(a.y - start.y)) - (Math.abs(b.x - start.x) + Math.abs(b.y - start.y)));
    const n = cfg.wildSoilTiles ?? 4;
    const patch = near.slice(0, n);
    for (const t of patch) this.setSoil(t, school, 1);
    this.discover('soil:' + school);
    let feature = null;
    const f = feats[school], spot = near[n];
    // The first Room to grow finds the Stump instead of a wild feature (that school's comes later).
    if (tier === 1 && !this.stump) {
      const stump = this.placeStump(spot || start, added) || this.placeStump(spot || start);
      return { soil: school, soilTiles: patch, feature: null, featureTile: null, stump: stump ? stump.tile : null };
    }
    // The second Room to grow also finds the wishing well, on the new ground.
    let well = null;
    if (tier === 2 && !this.well) {
      const l = this.placeLandmark2x2(WELL, spot || start, added.filter((t) => !spot || !sameTile(t, spot))) || this.placeLandmark2x2(WELL, spot || start);
      well = l ? l.tile : null;
    }
    if (f && spot && this.isFree(spot)) {
      this.state.scenery.push({ tile: { ...spot }, sprite: f.sprite, feature: school, flip: (hash32(this.state.seed, tier, 0x502) & 1) === 1 });
      feature = school;
      this.discover('feature:' + school);
    }
    return { soil: school, soilTiles: patch, feature, featureTile: feature ? spot : null, well };
  }
  /**
   * Puts the Stump (2x2) on four free tiles with no soil, nearest `near`: among `within` (the new ground)
   * when given, else anywhere in the clearing, preferring the edge (for gardens that expanded before it).
   */
  placeStump(near, within = null) { return this.placeLandmark2x2(STUMP, near, within); }
  /** Puts a 2x2 landmark (the Stump, the well) down once, the same way (see placeStump). */
  placeLandmark2x2(id, near, within = null) {
    const def = this.landmarkDef(id);
    if (!def || this.state.landmarks.some((l) => l.id === id)) return null;
    const allowed = within ? new Set(within.map(key)) : null;
    const ok = (t) => (!allowed || allowed.has(key(t))) && this.isFree(t) && !this.soilAt(t);
    const c = this.clearing;
    let best = null;
    for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) {
      const tiles = [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
      if (!tiles.every(ok)) continue;
      const score = near ? Math.abs(x + 0.5 - near.x) + Math.abs(y + 0.5 - near.y) : Math.min(x - c.x0, c.x1 - x - 1, y - c.y0, c.y1 - y - 1) * 4 + hashUnit(this.state.seed, x, y, 0x57);
      if (!best || score < best.score) best = { tile: { x, y }, score };
    }
    if (!best) return null;
    const l = { id, tile: best.tile };
    this.state.landmarks.push(l);
    this.discover('landmark:' + id.replace(/^landmark\./, ''));
    return l;
  }
  /** A wild feature uncovered by Room to grow: { name, sprite, beauty, text }. */
  featureDef(school) { return ((this.t.expansion || {}).features || {})[school] || null; }

  // ---- the opening grotto
  /** Mossy rocks, ferns and the like along the edge of the starting clearing. Visual; they take up their tiles. */
  placeScenery() {
    const sc = (this.t.start || {}).scenery;
    if (!sc || !(sc.sprites || []).length) return;
    const c = this.clearing;
    const edge = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const d = Math.min(x - c.x0, c.x1 - x, y - c.y0, c.y1 - y);
      if (d < (sc.edgeDepth ?? 1)) edge.push({ x, y });
    }
    for (let i = 0; i < (sc.count || 0) && edge.length; i++) {
      const tile = edge.splice(this.rng.int(0, edge.length - 1), 1)[0];
      if (!this.isFree(tile)) continue;
      this.state.scenery.push({ tile, sprite: sc.sprites[this.rng.int(0, sc.sprites.length - 1)], flip: this.rng.chance(0.5) });
    }
  }

  /** The opening's seed tin (Content/opening.json) waits on a free tile near the pool until it's opened. */
  placeTin() {
    const st = (this.t.start || {}).tin;
    const src = this.source;
    if (!st || !this.content.opening) return;
    const near = st.near ?? 2, ring = [];
    for (let dy = -near; dy <= near + 1; dy++) for (let dx = -near; dx <= near + 1; dx++) {
      const t = { x: src.x + dx, y: src.y + dy };
      if (this.isFree(t)) ring.push(t);
    }
    const tile = ring.length ? this.rng.pick(ring) : this.freeNear(src);
    if (tile) this.state.tin = { tile };
  }

  /** Each school's total weight from the opening's answers (indices, one per question). */
  openingTotals(answers) {
    const tot = Object.fromEntries(SCHOOLS.map((s) => [s, 0]));
    (this.content.opening?.questions || []).forEach((q, i) => {
      const a = q.answers[answers[i]];
      if (a) for (const [k, v] of Object.entries(a.weights || {})) tot[k] += v;
    });
    return tot;
  }

  /** The schools the answers lean to, strongest first (ties broken at random among equals). */
  openingRanking(answers) {
    const tot = this.openingTotals(answers);
    return SCHOOLS.map((s) => [s, tot[s], this.rng.next()]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
  }

  /**
   * Opens the seed tin: the answers choose a school, and the tin holds that school's starter seed packets
   * and soil amendments, plus a few of the runner-up school's (tuning.garden.starterSet).
   * Returns { school, second, results }.
   */
  openTin(answers, now, forceSchool = null) {
    if (!this.state.tin) throw new GameError('The tin has already been opened.');
    const rank = this.openingRanking(answers || []);
    const school = forceSchool || rank[0];
    const second = rank.find((s) => s !== school);
    this.state.tin = null;
    this.state.opening = { done: true, school, second, answers: forceSchool ? null : answers, at: now };
    return { school, second, results: this.grant(this.starterSet(school, second)) };
  }

  /** The tin's contents for a school and its runner-up: Common seeds of each and a little soil. */
  starterSet(school, second) {
    const cfg = (this.t.garden || {}).starterSet || {};
    const out = [];
    const add = (item, count) => { if (count > 0 && this.content.items[item]) out.push({ item, count }); };
    add(blindPacketID(school, 'common'), cfg.primaryPackets ?? 4);
    add(blindPacketID(second, 'common'), cfg.secondPackets ?? 2);
    add('amend.' + school, cfg.primaryAmendments ?? 2);
    add('amend.' + second, cfg.secondAmendments ?? 1);
    return out;
  }

  // ---- the foraging patch (tuning.forage)
  get forageCfg() { return this.t.forage || {}; }
  forageSlot(t) { return Math.floor(t / ((this.forageCfg.slotMinutes || 60) * 60000)); }

  /** The outer ring of the clearing, by the treeline: where foraged finds turn up. */
  forageTiles() {
    const c = this.clearing, out = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (x === c.x0 || x === c.x1 || y === c.y0 || y === c.y1) out.push({ x, y });
    return out;
  }

  /**
   * Plain finds by the treeline: each slot of game time since the last check has `chance` of one find
   * (deterministic from the garden seed and the slot), up to `max` waiting. Returns how many appeared.
   */
  forageTick(now) {
    const cfg = this.forageCfg, f = this.state.forage;
    const cur = this.forageSlot(now);
    if (!cfg.enabled || !(cfg.items || []).length) { f.slot = cur; return 0; }
    if (f.slot == null) { f.slot = cur; return 0; }
    let made = 0;
    const from = Math.max(f.slot + 1, cur - (cfg.maxCatchUpSlots ?? 48) + 1);
    for (let slot = from; slot <= cur; slot++) {
      if (f.finds.length >= (cfg.max ?? 3)) break;
      if (hashUnit(this.state.seed, slot, 0xf0a9) >= (cfg.chance ?? 0.3)) continue;
      const tiles = this.forageTiles().filter((t) => this.isFree(t));
      if (!tiles.length) break;
      const tile = tiles[hash32(this.state.seed, slot, 0x711e) % tiles.length];
      const itemID = cfg.items[hash32(this.state.seed, slot, 0x17e3) % cfg.items.length];
      if (!this.content.items[itemID]) continue;
      f.finds.push({ id: `forage-${slot}`, itemID, tile, at: slot * (cfg.slotMinutes || 60) * 60000 });
      made++;
    }
    f.slot = Math.max(f.slot, cur);
    return made;
  }

  /** Pick a foraged find: it goes into the Bag. */
  pickForage(id) {
    const f = this.state.forage, i = f.finds.findIndex((x) => x.id === id);
    if (i < 0) throw new GameError("It's gone.");
    const [find] = f.finds.splice(i, 1);
    this.bump('forage');
    return this.grant([{ item: find.itemID, count: 1 }]);
  }

  // ---- Bag and Field Guide
  discover(k) {
    if (this.discovered.has(k)) return false;
    this.discovered.add(k);
    return true;
  }
  grant(pending) {
    return pending.map((p) => {
      this.state.inventory[p.item] = (this.state.inventory[p.item] || 0) + p.count;
      const def = this.content.items[p.item];
      const isNew = !!def && def.inGuide !== false && this.discover('item:' + p.item);
      return { item: p.item, count: p.count, isNew };
    });
  }
  consume(itemID, n = 1) {
    const left = (this.state.inventory[itemID] || 0) - n;
    if (left < 0) throw new GameError("You don't have enough of that.");
    if (left > 0) this.state.inventory[itemID] = left; else delete this.state.inventory[itemID];
  }
  bump(counter, n = 1) { this.state.counters[counter] = (this.state.counters[counter] || 0) + n; }
  /** Field Guide entries found, for request gating. */
  get guideCount() { return [...this.discovered].filter((k) => k.startsWith('item:')).length; }

  // ---- the garden: soil, plants, growth, harvest (Content/plants.json, tuning.garden)
  get gcfg() { return this.t.garden || {}; }
  soilAt(t) { return this.state.soil[key(t)] || null; }
  get soilCounts() {
    const out = {};
    for (const s of Object.values(this.state.soil)) out[s] = (out[s] || 0) + 1;
    return out;
  }
  plantDef(id) { return this.content.plants[id] || null; }
  plantCfg(id) { return (this.gcfg.plants || {})[id] || {}; }
  plantAt(t) { return this.state.plants.find((p) => sameTile(p.tile, t)) || null; }
  plantByID(id) { return this.state.plants.find((p) => p.id === id) || null; }

  /**
   * How fast a plant grows on a soil: its own school's soil ×soil.preferred (1), plain soil ×soil.plain
   * (0.6). Another school's soil: null (it can't be planted there).
   */
  soilFactor(def, school) {
    const c = this.gcfg.soil || {};
    if (school !== def.school && this.isBlessed(def.school)) return c.preferred ?? 1;   // a well blessing: it grows anywhere
    if (!school) return c.plain ?? 0.6;
    return school === def.school ? (c.preferred ?? 1) : null;
  }

  /** Whether a seed packet can go on a tile (blind packets: by their school), and why not. */
  canPlantPacket(packetID, tile) {
    const pk = this.content.items[packetID];
    if (!pk || pk.category !== 'packet') return { ok: false, reason: "That isn't a seed packet." };
    return pk.blind ? this.canPlant(null, tile, pk.school, `${pk.name.replace(/ seeds$/, '')} seeds`) : this.canPlant(pk.plant, tile);
  }

  /** Whether a plant (or any plant of a school) can go on a tile, and why not: { ok, factor, reason }. */
  canPlant(plantID, tile, school = null, label = null) {
    const def = plantID ? this.plantDef(plantID) : { school, name: label };
    if (!def || !def.school) return { ok: false, reason: 'Unknown seeds.' };
    if (!this.inBounds(tile) || !this.inClearing(tile)) return { ok: false, reason: "That's outside the clearing." };
    if (!this.isFree(tile) && !this.hostsPlant(tile)) return { ok: false, reason: 'Something is already there.' };
    const soil = this.soilAt(tile);
    const factor = this.soilFactor(def, soil);
    if (factor == null) return { ok: false, reason: `${def.name} won't grow in ${schoolName(soil)} soil. ${plantID ? 'It likes' : 'They like'} ${schoolName(def.school)} soil, or plain ground.` };
    return { ok: true, factor };
  }
  /** A tile with something on it that a plant can still go on: an empty raised bed. */
  hostsPlant(t) {
    const d = this.decorAt(t);
    return !!d && !!this.decorKind(this.decorDef(d.decorID)).holdsPlant && !this.plantAt(t) && !this.landmarkAt(t) && !this.sceneryAt(t) && !this.forageAt(t);
  }

  /**
   * Growth speed right now, as a multiple of the plant's normal speed: its soil, then its companions
   * (speed rules, up to companions.maxSpeed) and any relic ornament of its school close by.
   */
  growthRate(p) {
    const def = this.plantDef(p.plantID);
    if (!def) return 0;
    const soil = this.soilAt(p.tile), sc = this.gcfg.soil || {};
    let r = this.soilFactor(def, soil) ?? sc.wrong ?? 0.35;
    if (soil && soil === def.school) r *= 1 + ((sc.levels || {}).speedPerLevel ?? 0.06) * (this.soilLevel(p.tile) - 1);
    const c = this.gcfg.companions || {};
    const speeds = this.activeCompanions(p).filter((x) => x.rule.effect === 'speed').length;
    if (speeds) r *= Math.min(c.maxSpeed ?? 1.5, Math.pow(c.speed ?? 1.25, speeds));
    r *= this.ornamentFactor(p);
    r *= this.residentGrowth(p);
    r *= this.blessingMult(def.school);
    return r;
  }

  /** Plants in the 8 tiles around a tile. */
  neighbours(t) {
    return this.state.plants.filter((q) => !sameTile(q.tile, t) && Math.abs(q.tile.x - t.x) <= 1 && Math.abs(q.tile.y - t.y) <= 1);
  }
  /** A plant's companion rules that hold right now: [{ rule, index, partner }]. */
  activeCompanions(p) {
    const def = this.plantDef(p.plantID);
    if (!def || !(def.companions || []).length) return [];
    const near = this.neighbours(p.tile);
    const out = [];
    def.companions.forEach((rule, index) => {
      const partner = near.find((q) => q.plantID === rule.with && q !== p);
      if (partner) out.push({ rule, index, partner });
    });
    return out;
  }
  companionKey(plantID, index) { return `companion:${plantID}:${index}`; }

  /** Relic ornaments: plants of the relic's school within its radius (a 3x3) grow faster. */
  ornamentFactor(p) {
    const def = this.plantDef(p.plantID), k = (this.gcfg.decor?.kinds || {}).ornament || {};
    const r = k.radius ?? 1;
    const near = this.state.decor.placed.some((d) => {
      const dd = this.decorDef(d.decorID);
      return dd && dd.kind === 'ornament' && dd.school === def.school && Math.abs(d.tile.x - p.tile.x) <= r && Math.abs(d.tile.y - p.tile.y) <= r;
    });
    return near ? (k.schoolSpeed ?? 1.2) : 1;
  }
  /** Growth needed for the current cycle (ms of normal-speed growth). */
  growNeed(p) { return p.need || Math.max(1, (this.plantCfg(p.plantID).growHours || 8) * HOUR); }
  /** Growth done by time t: banked growth plus time since at the current rate, capped at the need. */
  grownAt(p, t) { return Math.min(this.growNeed(p), p.grown + Math.max(0, t - p.since) * p.rate); }
  progress(p, t) { return this.grownAt(p, t) / this.growNeed(p); }
  /** seed, sprout, bud, bloom or ready (tuning.garden.stages). */
  stageOf(p, t) {
    const k = this.progress(p, t), st = this.gcfg.stages || {};
    if (k >= 1) return 'ready';
    if (k >= (st.bloom ?? 0.75)) return 'bloom';
    if (k >= (st.bud ?? 0.45)) return 'bud';
    if (k >= (st.sprout ?? 0.15)) return 'sprout';
    return 'seed';
  }
  isReady(p, t) { return this.progress(p, t) >= 1; }
  isBlooming(p, t) { const s = this.stageOf(p, t); return s === 'bloom' || s === 'ready'; }
  /** When the plant will be ready at its current rate (it's deterministic: only player actions change rates). */
  readyAt(p) { return p.rate > 0 ? p.since + Math.max(0, this.growNeed(p) - p.grown) / p.rate : Infinity; }
  /** When it reaches a stage (a share of its growth). */
  stageAt(p, share) { const need = this.growNeed(p) * share; return p.grown >= need ? p.since : p.since + (need - p.grown) / Math.max(1e-9, p.rate); }

  /**
   * Banks every plant's growth up to `now` and recomputes its rate. Called whenever something that can
   * change a rate happens (planting, harvesting, soil, decor), so growth between actions is a straight
   * line and time away needs no catching up.
   */
  rebase(now) {
    for (const p of this.state.plants) {
      if (now <= p.since) continue;         // already banked up to a later moment
      p.grown = this.grownAt(p, now);
      p.since = now;
    }
    for (const p of this.state.plants) p.rate = this.growthRate(p);
  }

  /**
   * Plant a seed packet on a tile. A blind packet (Common, Uncommon or Rare seeds of a school) picks its
   * plant now, by the packet's odds (tuning.garden.packets), and keeps it hidden until the bud shows.
   */
  plant(packetID, tile, now) {
    const pk = this.content.items[packetID];
    if (!pk || pk.category !== 'packet') throw new GameError("That isn't a seed packet.");
    if (!(this.state.inventory[packetID] > 0)) throw new GameError('You have no more of those seeds.');
    const chk = this.canPlantPacket(packetID, tile);
    if (!chk.ok) throw new GameError(chk.reason);
    this.rebase(now);
    this.consume(packetID);
    const plantID = pk.blind ? this.pullPlant(pk.school, pk.blind) : pk.plant;
    const p = this.newPlant(plantID, tile, now);
    if (pk.blind) { p.blind = pk.school; p.from = pk.blind; }
    if (pk.variety) p.variety = pk.variety;
    this.rebase(now);
    this.bump('plant');
    return p;
  }

  newPlant(plantID, tile, now, grownShare = 0) {
    const p = { id: this.rng.uuid(), plantID, tile: { ...tile }, plantedAt: now, since: now, grown: 0, rate: 0, harvests: 0, cycle: 'grow' };
    p.grown = this.growNeed(p) * grownShare;
    this.state.plants.push(p);
    p.rate = this.growthRate(p);
    return p;
  }

  /** What a harvest gives (before seeds): the produce count, plus companions' and a raised bed's extra. */
  harvestYield(p) {
    let n = this.plantCfg(p.plantID).yield || 1;
    const def = this.plantDef(p.plantID), lv = (this.gcfg.soil || {}).levels || {};
    if (def && this.soilAt(p.tile) === def.school && this.soilLevel(p.tile) >= (lv.yieldAt ?? 3)) n += 1;
    n += this.activeCompanions(p).filter((x) => x.rule.effect === 'yield').length * ((this.gcfg.companions || {}).yield ?? 1);
    const d = this.decorAt(p.tile);
    if (d) n += this.decorKind(this.decorDef(d.decorID)).yield || 0;
    return n;
  }
  /** The produce item a harvest gives (a colour variety has its own). */
  produceOf(p) { const v = p.variety && this.varietyDef(p.variety); return v ? v.produce : this.plantDef(p.plantID)?.item; }
  /** The seed packet a harvest returns (a variety breeds true). */
  packetOf(p) {
    const v = p.variety && this.varietyDef(p.variety), def = this.plantDef(p.plantID);
    if (v) return v.packet;
    return def && def.source === 'seeds' ? blindPacketID(def.school, def.tier || 'common') : 'packet.' + p.plantID;
  }
  /** Still a mystery seedling (from a blind packet, before its bud shows)? */
  isHidden(p, t) { return !!p.blind && ['seed', 'sprout'].includes(this.stageOf(p, t)); }

  /** A blind pull: a tier by the packet's odds, then evenly among the school's seed plants of that tier. */
  pullPlant(school, packetTier) {
    const odds = ((this.gcfg.packets || {}).tiers || {})[packetTier]?.odds || { common: 1 };
    const pool = (tier) => this.content.plantList.filter((p) => p.source === 'seeds' && p.school === school && (p.tier || 'common') === tier);
    let r = this.rng.next() * Object.values(odds).reduce((a, b) => a + b, 0), tier = 'common';
    for (const [k, w] of Object.entries(odds)) { if (r < w) { tier = k; break; } r -= w; }
    for (let i = PLANT_TIERS.indexOf(tier); i >= 0; i--) { const list = pool(PLANT_TIERS[i]); if (list.length) return this.rng.pick(list).id; }
    for (const t of PLANT_TIERS) { const list = pool(t); if (list.length) return this.rng.pick(list).id; }
    throw new GameError('Nothing grows from those seeds.');
  }
  varietyDef(id) { return this.content.varieties[id] || null; }

  /**
   * Harvest a ready plant: its produce and (usually) seeds back. The plant is gone and the tile is free.
   * Returns { results, plant, firstHarvest }.
   */
  harvest(plantRef, now) {
    const p = this.plantByID(plantRef);
    if (!p) throw new GameError("It's gone.");
    if (!this.isReady(p, now)) throw new GameError("It isn't ready yet.");
    this.rebase(now);
    const cfg = this.plantCfg(p.plantID);
    const extras = this.harvestExtras(p, now);
    const companions = this.activeCompanions(p);
    const pending = [{ item: this.produceOf(p), count: this.harvestYield(p) }];
    const [always, chance] = cfg.seeds || [1, 0.5];
    const seeds = (always || 0) + (this.rng.chance(chance || 0) ? 1 : 0);
    if (seeds > 0) pending.push({ item: this.packetOf(p), count: seeds });
    for (const x of extras) pending.push(x);
    const results = this.grant(pending.filter((x) => x.item && x.count > 0));
    const firstHarvest = this.discover('plant:' + p.plantID);
    // Companion rules active at this harvest are discovered (shown on the plant's Field Guide page).
    for (const c of companions) {
      if (this.discover(this.companionKey(p.plantID, c.index))) this.events.push({ type: 'companionFound', plantID: p.plantID, with: c.rule.with, effect: c.rule.effect, tile: p.tile });
    }
    p.harvests++;
    this.state.plants = this.state.plants.filter((x) => x !== p);   // every plant leaves its tile when picked
    this.rebase(now);
    this.bump('harvest');
    this.afterHarvest(p, now, results);
    return { results, plant: p, firstHarvest };
  }
  /**
   * Cross-pollination: harvesting a plant while a plant of the same family (the same kind counts) blooms
   * next to it gives, with varieties.chance (kept hidden), a seed packet of one of its colour varieties,
   * one not yet found first.
   */
  harvestExtras(p, now) {
    const def = this.plantDef(p.plantID);
    const vars = (def && def.varieties) || [];
    if (!vars.length) return [];
    const partner = this.neighbours(p.tile).some((q) => q !== p && this.plantDef(q.plantID)?.family === def.family && this.isBlooming(q, now));
    if (!partner || !this.rng.chance((this.gcfg.varieties || {}).chance ?? 0.12)) return [];
    const fresh = vars.filter((v) => !this.discovered.has('item:' + this.varietyDef(v.id).produce));
    const v = this.rng.pick(fresh.length ? fresh : vars);
    this.events.push({ type: 'crossPollinated', plantID: p.plantID, variety: v.id, tile: p.tile });
    return [{ item: this.varietyDef(v.id).packet, count: 1 }];
  }
  afterHarvest(p, now) { this.checkCollection(this.plantDef(p.plantID)?.school, now); }

  // ---- Field Guide collections (tuning.garden.collections)
  /** A school's set: its seed plants up to Rare, and its gift plant (Epic and Legendary finds aren't in it). */
  collectionPlants(school) { return this.content.plantList.filter((p) => p.school === school && PLANT_TIERS.indexOf(p.tier || 'common') <= 2); }
  collectionStatus(school) {
    const list = this.collectionPlants(school);
    const have = list.filter((p) => this.discovered.has('plant:' + p.id)).length;
    return { school, have, total: list.length, done: list.length > 0 && have === list.length, claimed: !!this.state.collections[school] };
  }
  /** Completing a school's set (every plant harvested once) gives its relic ornament and coins, once. */
  checkCollection(school, now) {
    if (!school) return null;
    const st = this.collectionStatus(school);
    if (!st.done || st.claimed) return null;
    this.state.collections[school] = now;
    const relic = this.content.relicList.find((r) => r.school === school);
    if (relic) { this.state.decor.owned[relic.id] = (this.state.decor.owned[relic.id] || 0) + 1; this.discover('decor:' + relic.id); }
    const coins = (this.gcfg.collections || {}).coins ?? 150;
    this.state.coins += coins;
    this.events.push({ type: 'collection', school, relic: relic && relic.id, coins });
    return st;
  }

  /** Dig up a growing plant (it's lost; the tile is free again). */
  clearPlant(plantRef, now) {
    const p = this.plantByID(plantRef);
    if (!p) throw new GameError("It's gone.");
    this.rebase(now);
    this.state.plants = this.state.plants.filter((x) => x !== p);
    this.rebase(now);
  }

  /** Use a soil amendment on a tile: its soil becomes that school (or plain) until changed again. */
  amend(itemID, tile, now) {
    const def = this.content.items[itemID];
    if (!def || def.category !== 'amendment') throw new GameError("That isn't a soil amendment.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError('You have none left.');
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (this.isWet(tile)) throw new GameError("You can't spread soil on water.");
    if (this.plantAt(tile)) throw new GameError('Something is growing there. Change the soil once the tile is empty.');
    if (this.landmarkAt(tile) || this.sceneryAt(tile)) throw new GameError("That ground can't be dug.");
    const cur = this.soilAt(tile);
    if ((def.amend || null) === cur) throw new GameError(`It's already ${schoolName(cur)} soil.`);
    this.consume(itemID);
    this.setSoil(tile, def.amend || null, 1);
    this.discover('soil:' + (def.amend || 'plain'));
    this.bump('amend');
    return def.amend || null;
  }

  // ---- coins, selling and the Store
  /** Coins for one of an item, or 0 if it can't be sold. Garden produce: its plant's sell price. */
  sellPrice(itemID) {
    const def = this.content.items[itemID];
    if (!def || (def.category !== 'plant' && def.category !== 'mushroom')) return 0;
    if (def.sell != null) return def.sell;
    return (this.gcfg.sellByRarity || {})[def.rarity || 'common'] || 0;
  }
  sell(itemID, n = 1) {
    const price = this.sellPrice(itemID);
    if (!price) throw new GameError("The Store doesn't buy that.");
    const k = Math.min(n, this.state.inventory[itemID] || 0);
    if (k < 1) throw new GameError("You don't have any.");
    this.consume(itemID, k);
    this.state.coins += price * k;
    this.bump('sold', k);
    this.bump('earned', price * k);
    return price * k;
  }
  spend(n) {
    if (this.state.coins < n) throw new GameError(`That costs ${n} coins (you have ${this.state.coins}).`);
    this.state.coins -= n;
  }

  /** The Store's seed shelf: every school's Common, Uncommon and Rare seeds, with price and what locks a tier. */
  storePackets() {
    const tiers = (this.gcfg.packets || {}).tiers || {};
    return SCHOOLS.flatMap((school) => PLANT_TIERS.filter((t) => tiers[t]).map((t) => ({ id: blindPacketID(school, t), school, tier: t, price: tiers[t].price || 0, locks: this.beautyLock(tiers[t].beauty || 0) })));
  }
  buyPacket(packetID, now, n = 1) {
    const row = this.storePackets().find((x) => x.id === packetID);
    if (!row) throw new GameError("The Store doesn't sell those.");
    if (row.locks.length) throw new GameError("Those seeds aren't on the shelf yet.");
    this.spend(row.price * n);
    return this.grant([{ item: packetID, count: n }]);
  }
  amendmentPrice(itemID) {
    const def = this.content.items[itemID], c = this.gcfg.amendments || {};
    return def && def.category === 'amendment' ? (def.amend ? c.price ?? 20 : c.plainPrice ?? 2) : 0;
  }
  /**
   * Today's soil stock: perDay school amendments (one bag each), chosen from the garden seed and the
   * local day, plus Garden loam, which is always there. Returns [{ id, price, soldOut }].
   */
  soilStock(now) {
    const day = Game.dayNumber(now), c = this.gcfg.amendments || {};
    let st = this.state.soilShop;
    if (!st || st.day !== day) {
      const order = SCHOOLS.slice().sort((a, b) => hash32(this.state.seed, day, hashStr(a)) - hash32(this.state.seed, day, hashStr(b)));
      st = this.state.soilShop = { day, offers: order.slice(0, c.perDay ?? 2).map((s) => 'amend.' + s), bought: [] };
    }
    const plain = (this.content.amendmentList.find((a) => !a.school) || {}).id;
    return [...st.offers.map((id) => ({ id, price: this.amendmentPrice(id), soldOut: st.bought.includes(id) })), ...(plain ? [{ id: plain, price: this.amendmentPrice(plain), soldOut: false }] : [])];
  }
  buyAmendment(itemID, now = this.state.lastUpdated) {
    const row = this.soilStock(now).find((x) => x.id === itemID);
    if (!row) throw new GameError("That isn't in stock today.");
    if (row.soldOut) throw new GameError('Sold out until tomorrow.');
    this.spend(row.price);
    if (this.content.items[itemID].amend) this.state.soilShop.bought.push(itemID);
    return this.grant([{ item: itemID, count: 1 }]);
  }

  // ---- the morning check
  /**
   * What's waiting after time away: ready plants by kind, how many are still growing and the next one to
   * be ready, and at most one small surprise per local day (tuning.garden.morning). The surprise is
   * chosen deterministically from the garden seed and the day, among the kinds possible right now.
   */
  morning(now) {
    this.rebase(now);
    const ready = {}, growing = [];
    for (const p of this.state.plants) {
      if (this.isReady(p, now)) { const k = p.variety || p.plantID; ready[k] = ready[k] || { plantID: p.plantID, variety: p.variety || null, count: 0, tiles: [] }; ready[k].count++; ready[k].tiles.push(p.tile); } else growing.push(p);
    }
    const next = growing.length ? Math.min(...growing.map((p) => this.readyAt(p))) : null;
    const day = Game.dayNumber(now);
    let surprise = null;
    const m = this.state.morning, cfg = this.gcfg.morning || {};
    if (m.lastSurpriseDay !== day) {
      m.lastSurpriseDay = day;
      if (hashUnit(this.state.seed, day, 0x5a7e) < (cfg.surpriseChance ?? 0.7)) surprise = this.rollSurprise(now, day);
    }
    return { ready: Object.values(ready), growing: growing.length, next, surprise };
  }

  /** Surprise kinds possible right now: [kind, weight, apply()] (later systems add gifts and rare colours). */
  surpriseKinds(now, day) {
    const w = (this.gcfg.morning || {}).weights || {};
    const out = [];
    const seedling = this.selfSeedSpot(now, day);
    if (seedling) out.push(['selfSeed', w.selfSeed ?? 3, () => {
      const p = this.newPlant(seedling.plantID, seedling.tile, now, (this.gcfg.stages || {}).sprout ?? 0.15);
      p.selfSeeded = true;
      this.rebase(now);
      return { type: 'selfSeed', plantID: p.plantID, tile: p.tile, from: seedling.from };
    }]);
    // A resident leaves its gift seeds.
    const friends = this.residents().filter((d) => this.content.items[d.gift]).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (friends.length) out.push(['gift', w.gift ?? 4, () => {
      const d = friends[hash32(this.state.seed, day, 0x9f7) % friends.length];
      const results = this.grant([{ item: d.gift, count: 1 }]);
      return { type: 'gift', visitor: d.id, item: d.gift, results };
    }]);
    // A rare colour: a ready plant turns out to be one of its varieties.
    const ready = this.state.plants.filter((p) => !p.variety && this.isReady(p, now) && (this.plantDef(p.plantID)?.varieties || []).length).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (ready.length) out.push(['rareColour', w.rareColour ?? 2, () => {
      const p = ready[hash32(this.state.seed, day, 0xc010) % ready.length];
      const vars = this.plantDef(p.plantID).varieties;
      p.variety = vars[hash32(this.state.seed, day, 0xc011) % vars.length].id;
      p.rareColour = true;
      return { type: 'rareColour', plantID: p.plantID, variety: p.variety, tile: p.tile };
    }]);
    return out;
  }
  rollSurprise(now, day) {
    const kinds = this.surpriseKinds(now, day).filter((k) => k[1] > 0);
    const total = kinds.reduce((a, k) => a + k[1], 0);
    if (!total) return null;
    let r = hashUnit(this.state.seed, day, 0x5b1d) * total;
    for (const [, w, apply] of kinds) { if (r < w) return apply(); r -= w; }
    return null;
  }
  /** A self-seeded seedling: next to a blooming plant, on an open tile with soil it can grow in. */
  selfSeedSpot(now, day) {
    const parents = this.state.plants.filter((p) => this.isBlooming(p, now)).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!parents.length) return null;
    const from = parents[hash32(this.state.seed, day, 0x5eed) % parents.length];
    const spots = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = { x: from.tile.x + dx, y: from.tile.y + dy };
      if ((dx || dy) && this.isFree(t) && this.canPlant(from.plantID, t).ok) spots.push(t);
    }
    if (!spots.length) return null;
    return { plantID: from.plantID, from: from.tile, tile: spots[hash32(this.state.seed, day, 0x5eef) % spots.length] };
  }

  // ---- the Store and the Old Log board (Content/requests.json)
  requestDef(id) { return (this.content.requests || []).find((r) => r.id === id) || null; }
  isDelivered(id) { return !!this.state.offerings.delivered[id]; }
  requestLocks(req, now) {
    const need = req.requires || {};
    const locks = [];
    if (need.guide && this.guideCount < need.guide) locks.push({ type: 'guide', need: need.guide, have: this.guideCount });
    if (need.request && !this.isDelivered(need.request)) locks.push({ type: 'request', id: need.request, name: this.requestDef(need.request)?.name || need.request });
    if (need.day && this.gardenDay(now) < need.day) locks.push({ type: 'day', need: need.day, have: this.gardenDay(now) });
    if (req.reward && req.reward.type === 'unlock' && req.reward.id === 'expansion' && this.fullyOpen) locks.push({ type: 'full' });
    return locks.concat(this.extraLocks(req, now));
  }
  /** Locks from later systems (beauty tiers). */
  /** A listing or request right now: its price and items (have / need), what still locks it, and whether it can be done. */
  requestStatus(req, now) {
    const locks = this.requestLocks(req, now);
    const items = req.items.map((x) => ({ item: x.item, count: x.count, owned: this.state.inventory[x.item] || 0 }));
    const done = req.kind === 'shop' ? false : req.kind === 'order' ? this.ordersToday(now).done.includes(req.id) : this.isDelivered(req.id);
    const coins = req.coins || 0;
    return { req, done, locks, items, coins, ready: !done && !locks.length && items.every((x) => x.owned >= x.count) && this.state.coins >= coins };
  }
  /** Every listing with its status: open ones first, then locked, then done. */
  requestBoard(now, kinds = null) {
    const rank = (s) => (s.done ? 2 : s.locks.length ? 1 : 0);
    return (this.content.requests || []).filter((r) => !kinds || kinds.includes(r.kind)).map((r) => this.requestStatus(r, now)).sort((a, b) => rank(a) - rank(b));
  }
  deliver(id, now, opts = {}) {
    const req = this.requestDef(id);
    if (!req) throw new GameError('Unknown listing.');
    if (req.kind === 'order' && !this.ordersToday(now).offers.includes(id)) throw new GameError("That order isn't on the log today.");
    if (req.reward.type === 'unlock' && req.reward.id === 'expansion' && !this.openSides().includes(opts.side)) throw new GameError(opts.side ? 'The forest ends on that side.' : 'Choose which side to clear.');
    const st = this.requestStatus(req, now);
    if (st.done) throw new GameError('Already done.');
    if (st.locks.length) throw new GameError("That isn't open yet.");
    if (this.state.coins < st.coins) throw new GameError(`That costs ${st.coins} coins (you have ${this.state.coins}).`);
    if (!st.ready) throw new GameError('You need more of the things it asks for.');
    for (const x of req.items) this.consume(x.item, x.count);
    if (st.coins) this.spend(st.coins);
    if (req.kind === 'shop') { const b = this.state.offerings.bought; b[id] = (b[id] || 0) + 1; }
    else if (req.kind === 'order') this.ordersToday(now).done.push(id);
    else this.state.offerings.delivered[id] = now;
    this.bump('deliver');
    return this.grantReward(req.reward, now, opts);
  }
  /** Gives a reward. Returns { type, id, count, ... } for the UI. */
  grantReward(r, now, opts = {}) {
    const out = { ...r };
    if (r.type === 'cosmetic') this.state.decor.owned[r.id] = (this.state.decor.owned[r.id] || 0) + (r.count || 1);
    else if (r.type === 'item') out.results = this.grant([{ item: r.id, count: r.count || 1 }]);
    else if (r.type === 'coins') { this.state.coins += r.count || 0; this.bump('earned', r.count || 0); }
    else if (r.type === 'unlock' && r.id === 'expansion') {
      this.state.unlocks.expansions += r.count || 1;
      out.tiles = 0;
      for (let i = 0; i < (r.count || 1); i++) out.tiles += this.expand(now, opts.side).length;
    }
    return out;
  }
  get expansionTier() { return this.state.unlocks.expansions || 0; }

  /**
   * Today's orders at the Old Log (requests of kind "order"): perDay of them each local day, picked
   * from the garden seed and the day among orders for produce the player has already grown.
   */
  ordersToday(now) {
    const day = Game.dayNumber(now);
    let o = this.state.orders;
    if (!o || o.day !== day) {
      o = this.state.orders = { day, offers: [], done: [] };
      const grown = (req) => req.items.every((x) => { const pl = this.content.items[x.item]?.plant; return pl && this.discovered.has('plant:' + pl); });
      const pool = (this.content.requests || []).filter((r) => r.kind === 'order' && grown(r) && !this.requestLocks(r, now).length);
      for (let i = 0; i < ((this.gcfg.orders || {}).perDay ?? 2) && pool.length; i++) o.offers.push(pool.splice(hash32(this.state.seed, day, i) % pool.length, 1)[0].id);
    }
    return o;
  }
  /** The Old Log: one-off commissions (open, locked, done) and today's orders. */
  oldLogBoard(now) {
    const orders = this.ordersToday(now).offers.map((id) => this.requestStatus(this.requestDef(id), now));
    return { orders, commissions: this.requestBoard(now, ['commission']) };
  }
  /** Anything at the Old Log that could be delivered right now. */
  oldLogReady(now) { const b = this.oldLogBoard(now); return [...b.orders, ...b.commissions].filter((st) => st.ready).length; }

  // ---- decor (Content/cosmetics.json, and relic ornaments from relics.json)
  decorDef(id) { return this.content.decorByID[id] || null; }
  /** What a decor's kind does (tuning.garden.decor.kinds): beauty, ground, holdsPlant, yield, glow... */
  decorKind(def) { return (def && ((this.gcfg.decor || {}).kinds || {})[def.kind]) || {}; }
  /** A raised bed with a plant in it can't be moved or put away until the plant is harvested or dug up. */
  decorBusy(d) { return !!this.decorKind(this.decorDef(d.decorID)).holdsPlant && !!this.plantAt(d.tile); }
  placeDecor(id, tile) {
    if (!(this.state.decor.owned[id] > 0)) throw new GameError("You don't have that.");
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    if (!--this.state.decor.owned[id]) delete this.state.decor.owned[id];
    const d = { id: this.rng.uuid(), decorID: id, tile: { ...tile }, color: 0 };
    this.state.decor.placed.push(d);
    this.discover('decor:' + id);
    this.rebase(this.state.lastUpdated);
    return d;
  }
  moveDecor(placedID, tile) {
    const d = this.state.decor.placed.find((x) => x.id === placedID);
    if (!d) throw new GameError('Unknown decoration.');
    if (sameTile(d.tile, tile)) return d;
    if (this.decorBusy(d)) throw new GameError('Something is growing in it. Harvest it first.');
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    d.tile = { ...tile };
    this.rebase(this.state.lastUpdated);
    return d;
  }
  removeDecor(placedID) {
    const i = this.state.decor.placed.findIndex((x) => x.id === placedID);
    if (i < 0) throw new GameError('Unknown decoration.');
    if (this.decorBusy(this.state.decor.placed[i])) throw new GameError('Something is growing in it. Harvest it first.');
    const [d] = this.state.decor.placed.splice(i, 1);
    this.state.decor.owned[d.decorID] = (this.state.decor.owned[d.decorID] || 0) + 1;
    this.rebase(this.state.lastUpdated);
  }
  /** Next colour for a placed prop (cosmetics.json "colors"). */
  recolorDecor(placedID) {
    const d = this.state.decor.placed.find((x) => x.id === placedID);
    if (!d) throw new GameError('Unknown decoration.');
    const n = (this.decorDef(d.decorID)?.colors || []).length || 1;
    if (n < 2) throw new GameError('That only comes in one colour.');
    d.color = ((d.color || 0) + 1) % n;
    return d;
  }

  // ---- visitors (Content/visitors.json, tuning.visitors): animals that leave mementos, then move in
  //
  // Interest rises while every plant a visitor likes is blooming (and faster with a matching offering on
  // the Stump). Once it's interested enough, it visits in its time window, unseen, and leaves the next of
  // its mementos: each one hints at one of the conditions it needs to stay (`stays`). On the visit after
  // its last memento, if every condition holds, it moves in. It stays while they hold and leaves at the
  // first check where one doesn't, with a parting memento naming what broke. A soil patch belongs to one
  // resident only: when it moves in it claims those tiles, and no other resident can count them.
  get guestCfg() { return this.t.visitors || {}; }
  guestDefs() { return this.content.visitorList || []; }
  guestDef(id) { return this.guestDefs().find((v) => v.id === id) || null; }
  /** A visitor's saved state: interest, mementos left so far (series), its notes, and its home while it lives here. */
  guest(id) {
    const g = (this.state.guests[id] = this.state.guests[id] || {});
    g.interest = g.interest || 0;
    g.series = g.series || 0;
    g.notes = g.notes || [];
    if (g.home === undefined) g.home = null;
    if (g.visitDay == null) g.visitDay = -1;
    g.visitCount = g.visitCount || 0;
    return g;
  }
  /** The schools a visitor belongs to (mystical visitors have two). */
  guestSchools(def) { return def.schools || [def.school]; }
  guestTierRank(def) { return Math.max(0, VISITOR_TIERS.indexOf(def.tier || 'early')); }
  isResident(id) { const g = this.state.guests[id]; return !!(g && g.home); }
  residents() { return this.guestDefs().filter((d) => this.isResident(d.id)); }
  /** Plants it likes that are blooming at t (in bloom or ready). */
  likedBlooming(def, t) { return this.state.plants.filter((p) => def.likes.plants.includes(p.plantID) && t >= p.plantedAt && this.isBlooming(p, t)); }
  /** Every plant it likes is blooming somewhere in the garden. */
  guestLikes(def, t) { const b = this.likedBlooming(def, t); return def.likes.plants.every((id) => b.some((p) => p.plantID === id)); }
  /** resident, gone (it lived here and left), visiting (it has left mementos) or none. */
  guestStage(id) {
    const g = this.guest(id);
    if (g.home) return 'resident';
    if (g.left) return 'gone';
    return g.series > 0 ? 'visiting' : 'none';
  }
  /** The interest a visit needs: the first memento comes early, later visits need more (by tier). */
  visitNeed(def, g) {
    const V = this.guestCfg.visits || {};
    return g.series === 0 ? (V.firstAt ?? 10) : ((V.at || {})[def.tier || 'early'] ?? 40);
  }

  /**
   * Visitor checks every checkMinutes of game time, catching up time away (up to maxCatchUpDays). Plants,
   * decor and soil don't change between player actions and tides (advance runs before each action, and
   * the tides call this up to just before they turn), so reading them per check is exact. Each check's
   * random choices are seeded from the garden, the visitor and the check's time.
   */
  visitorTick(now) {
    const cfg = this.guestCfg, defs = this.guestDefs();
    if (!defs.length || !cfg.checkMinutes) return;
    const step = cfg.checkMinutes * 60000;
    if (this.state.guestsAt == null) { this.state.guestsAt = Math.floor(now / step) * step; return; }
    let k0 = Math.floor(this.state.guestsAt / step) + 1;
    const k1 = Math.floor(now / step);
    if (k1 < k0) return;
    k0 = Math.max(k0, k1 - Math.ceil((cfg.maxCatchUpDays ?? 7) * DAY / step));
    const saved = this.rng;
    try {
      for (let k = k0; k <= k1; k++) {
        const t = k * step;
        this.tributeStep(t);
        defs.forEach((d, i) => { this.rng = new RNG({ rng: hash32(this.state.seed, i + 1, k) }); this.guestCheck(d, t); });
      }
    } finally { this.rng = saved; }
    this.state.guestsAt = k1 * step;
  }

  guestCheck(def, t) {
    const cfg = this.guestCfg, g = this.guest(def.id), I = cfg.interest || {}, V = cfg.visits || {};
    const trib = this.tributeFor(def, t);
    if (trib && !trib.tr.reached.includes(def.id)) trib.tr.reached.push(def.id);
    if (g.home) { this.residentCheck(def, t); return; }
    const met = this.guestLikes(def, t), gain = I.gain ?? 1.5;
    const delta = met ? gain * (trib ? trib.mult : 1) : trib ? gain * (this.tributeCfg.court ?? 0.5) : -(I.decay ?? 0.5);
    g.interest = Math.max(0, Math.min(I.max ?? 100, g.interest + delta));
    if (!(met || trib) || this.dayPhase(t) !== def.likes.time) return;
    const day = Game.dayNumber(t);
    if (g.visitDay !== day) { g.visitDay = day; g.visitCount = 0; }
    if (g.visitCount >= (V.perDay ?? 1) || g.interest < this.visitNeed(def, g)) return;
    if (!this.rng.chance((V.chance ?? 0.35) * (trib && trib.liked ? (this.tributeCfg.likedMult ?? 2) : 1))) return;
    g.visitCount++;
    if (trib && !trib.tr.visited.includes(def.id)) trib.tr.visited.push(def.id);
    this.guestVisit(def, t);
  }

  /** A visit: the next memento, or, once they're all left, it moves in if it can stay (else a plainer hint). */
  guestVisit(def, t) {
    const g = this.guest(def.id), ms = def.mementos || [];
    if (g.series < ms.length) {
      g.series++;
      this.guestNote(def, 'memento', g.series - 1, ms[g.series - 1].text, t);
      return;
    }
    const chk = this.stayCheck(def, t);
    if (chk.ok) { this.moveIn(def, t, chk); return; }
    const i = chk.broken[(g.restates || 0) % chk.broken.length];
    g.restates = (g.restates || 0) + 1;
    const text = (def.restate || {})[i];
    if (text) this.guestNote(def, 'restate', i, text, t);
  }

  /** Something a visitor left: kept on its Field Guide page, and news for the next time the player looks. */
  guestNote(def, kind, ref, text, t, extra = {}) {
    const g = this.guest(def.id);
    g.notes.push({ kind, ref, text, at: t });
    // Every memento stays; only the latest few plainer hints and partings are kept.
    const later = g.notes.filter((n) => n.kind !== 'memento');
    if (later.length > 6) g.notes = g.notes.filter((n) => n.kind === 'memento' || later.slice(-6).includes(n));
    this.state.visitorNews.push({ type: kind, visitor: def.id, text, at: t, ...extra });
    if (this.state.visitorNews.length > 30) this.state.visitorNews = this.state.visitorNews.slice(-30);
    if (kind === 'memento') this.bump('memento');
  }

  moveIn(def, t, chk) {
    const g = this.guest(def.id);
    g.home = { since: t, patches: chk.patches };
    g.left = null;
    this.discover('visitor:' + def.id.replace(/^visitor\./, ''));
    this.bump('residents');
    let results = [];
    if (!g.gifted && this.content.items[def.gift]) { g.gifted = t; results = this.grant([{ item: def.gift, count: (this.guestCfg.gift || {}).count ?? 2 }]); }
    this.state.visitorNews.push({ type: 'movedIn', visitor: def.id, at: t, results });
    this.rebase(t);
  }

  /** A resident stays while every condition holds (perhaps on another patch); otherwise it leaves now. */
  residentCheck(def, t) {
    const g = this.guest(def.id), chk = this.stayCheck(def, t);
    if (chk.ok) {
      const before = JSON.stringify(g.home.patches);
      g.home.patches = chk.patches;
      if (JSON.stringify(chk.patches) !== before) this.rebase(t);
      return;
    }
    const i = chk.broken[0];
    g.home = null;
    g.left = t;
    g.interest = Math.max(g.interest, ((this.guestCfg.visits || {}).at || {})[def.tier || 'early'] ?? 40);
    this.guestNote(def, 'parting', i, (def.parting || {})[i] || '', t);
    this.rebase(t);
  }

  // ---- what a visitor needs to stay (visitors.json "stays")
  /** Soil tiles other residents' patches hold (one tile, one resident). */
  claimedTiles(exceptID = null) {
    const out = new Set();
    for (const [id, g] of Object.entries(this.state.guests)) if (id !== exceptID && g.home) for (const p of Object.values(g.home.patches || {})) for (const k of p) out.add(k);
    return out;
  }
  soilFits(t, c) { return this.inClearing(t) && !this.isWet(t) && this.soilAt(t) === c.school && this.soilLevel(t) >= (c.minLevel || 1); }
  /**
   * A patch for a soil condition among tiles no one holds: a full 3x3 block ("3x3"), or `tiles` tiles
   * joined side by side. Returns its tile keys, or null.
   */
  findPatch(c, taken) {
    const fits = (t) => !taken.has(key(t)) && this.soilFits(t, c);
    const cl = this.clearing;
    if (c.shape === '3x3') {
      for (let y = cl.y0; y <= cl.y1 - 2; y++) for (let x = cl.x0; x <= cl.x1 - 2; x++) {
        const block = [];
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) block.push({ x: x + dx, y: y + dy });
        if (block.every(fits)) return block.map(key);
      }
      return null;
    }
    const n = c.tiles || 4, seen = new Set();
    for (const t of this.clearingTiles()) {
      if (seen.has(key(t)) || !fits(t)) continue;
      const comp = [t];
      seen.add(key(t));
      for (let i = 0; i < comp.length && comp.length < n; i++) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const u = { x: comp[i].x + dx, y: comp[i].y + dy };
          if (!seen.has(key(u)) && fits(u)) { seen.add(key(u)); comp.push(u); }
        }
      }
      if (comp.length >= n) return comp.slice(0, n).map(key);
    }
    return null;
  }
  isRaisedBed(t) { const d = this.decorAt(t); return !!d && !!this.decorKind(this.decorDef(d.decorID)).holdsPlant; }
  /** One condition at t. A soil condition returns its patch (the one it has, if it still holds) or null. */
  stayMet(def, i, t, taken, patches) {
    const c = def.stays[i];
    if (c.kind === 'soil') {
      const cur = patches && patches[i];
      if (cur && cur.every((k) => { const [x, y] = k.split(',').map(Number); return !taken.has(k) && this.soilFits({ x, y }, c); })) return cur;
      return this.findPatch(c, taken);
    }
    if (c.kind === 'bed') return this.state.plants.some((p) => p.plantID === c.plant && t >= p.plantedAt && this.isRaisedBed(p.tile));
    if (c.kind === 'beauty') return this.beautyTier(t).index >= (c.tier || 0);
    if (c.kind === 'resident') return this.isResident(c.visitor);
    return false;
  }
  /** Every condition at t: { ok, broken: [indices], patches: { index: tile keys } }. */
  stayCheck(def, t) {
    const g = this.guest(def.id), taken = this.claimedTiles(def.id), patches = {}, broken = [];
    (def.stays || []).forEach((c, i) => {
      const r = this.stayMet(def, i, t, taken, g.home && g.home.patches);
      if (!r) { broken.push(i); return; }
      if (c.kind === 'soil') { patches[i] = r; for (const k of r) taken.add(k); }
    });
    return { ok: !broken.length, broken, patches };
  }
  /** Every tile a resident's patches hold: "x,y" -> visitor def. */
  homeTiles() {
    const out = new Map();
    for (const d of this.residents()) for (const p of Object.values(this.guest(d.id).home.patches || {})) for (const k of p) out.set(k, d);
    return out;
  }
  /** Residents' perks on a plant: plants of its school on its patch grow faster (perk.growth). */
  residentGrowth(p) {
    const d = this.homeTiles().get(key(p.tile)), def = this.plantDef(p.plantID);
    if (!d || !def || !(d.perk || {}).growth || !this.guestSchools(d).includes(def.school)) return 1;
    return d.perk.growth;
  }
  /** A tile on a resident's patch with perk.tideHold never loses its soil to the tide. */
  tideHeld(t) { const d = this.homeTiles().get(key(t)); return !!(d && (d.perk || {}).tideHold); }
  /** Where a resident is seen: somewhere on its patch, moving to another tile every hour or so. */
  residentTile(def, now) {
    const tiles = Object.values(this.guest(def.id).home?.patches || {}).flat();
    if (!tiles.length) return null;
    const k = tiles[hash32(this.state.seed, hashStr(def.id), Math.floor(now / HOUR)) % tiles.length];
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  }
  /** News since the player last looked (mementos, arrivals, departures, the Stump). Taking it clears it. */
  takeVisitorNews() { const n = this.state.visitorNews; this.state.visitorNews = []; return n; }

  // ---- the Stump (landmarks.json landmark.stump): an offering draws visitors of its school
  get stump() { return this.state.landmarks.find((l) => l.id === STUMP) || null; }
  get tributeCfg() { return this.guestCfg.tribute || {}; }
  /** What an item counts for on the Stump: its school, its tier (0 common, 1 uncommon, 2 rare) and plant. */
  tributeInfo(itemID) {
    const it = this.content.items[itemID];
    if (!it || (it.category !== 'plant' && it.category !== 'mushroom')) return null;
    const pl = it.plant ? this.plantDef(it.plant) : null;
    const tier = pl ? (pl.tier || 'common') : (it.rarity || 'common');
    const rank = Math.min(2, PLANT_TIERS.includes(tier) ? PLANT_TIERS.indexOf(tier) : rarityIndex(tier));
    return { school: (pl && pl.school) || it.school || null, rank, plant: it.plant || null };
  }
  /** Bag items that can go on the Stump: garden produce and foraged finds. */
  offerable() {
    return Object.entries(this.state.inventory).filter(([id, n]) => n > 0 && this.tributeInfo(id)).map(([id, n]) => ({ id, n, ...this.tributeInfo(id) }));
  }
  /** The offering on the Stump now: { item, placedAt, takenAt, until, ... } and its phase (waiting, taken), or null. */
  tributeState(now) {
    const tr = this.state.tribute;
    if (!tr) return null;
    return { ...tr, phase: now < tr.takenAt ? 'waiting' : 'taken' };
  }
  /** When an offering placed at `now` is taken: at the next check after nightfall (now, if it's night). */
  nightAfter(now) {
    const step = (this.guestCfg.checkMinutes || 30) * 60000;
    let t = (Math.floor(now / step) + 1) * step;
    for (let i = 0; i < 96 && !this.isNight(t); i++) t += step;
    return t;
  }
  offer(itemID, now) {
    if (!this.stump) throw new GameError("There's nowhere to leave it.");
    if (this.state.tribute) throw new GameError(this.state.tribute.takenAt > now ? 'Something is already on the stump.' : 'The forest is still answering your last offering.');
    if (!this.tributeInfo(itemID)) throw new GameError("That isn't something the forest would take.");
    this.consume(itemID);
    const takenAt = this.nightAfter(now);
    this.state.tribute = { item: itemID, placedAt: now, takenAt, until: takenAt + (this.tributeCfg.hours ?? 24) * HOUR, reached: [], visited: [] };
    this.bump('tribute');
    return this.state.tribute;
  }
  /** Take the offering back before it's gone. */
  takeBackOffering(now) {
    const tr = this.state.tribute;
    if (!tr || now >= tr.takenAt) throw new GameError("It's already gone.");
    this.state.tribute = null;
    return this.grant([{ item: tr.item, count: 1 }]);
  }
  /** Whether the offering active at t reaches this visitor: { mult, liked, tr } or null. */
  tributeFor(def, t) {
    const tr = this.state.tribute;
    if (!tr || t < tr.takenAt || t >= tr.until) return null;
    const info = this.tributeInfo(tr.item);
    if (!info || !info.school || !this.guestSchools(def).includes(info.school) || info.rank < this.guestTierRank(def)) return null;
    const mult = (this.tributeCfg.mult || [2, 3, 4])[info.rank] ?? 2;
    return { mult, liked: !!info.plant && def.likes.plants.includes(info.plant), tr };
  }
  /** When an offering's day is over, the Stump's answer: someone lingered, it was moved, or barely touched. */
  tributeStep(t) {
    const tr = this.state.tribute;
    if (!tr || t < tr.until) return;
    const reaction = tr.visited.length ? 'lingered' : tr.reached.length ? 'moved' : 'untouched';
    this.state.tribute = null;
    this.state.lastTribute = { item: tr.item, reaction, at: t };
    this.state.visitorNews.push({ type: 'stump', reaction, item: tr.item, at: t });
  }

  // ---- the wishing well (landmarks.json landmark.well, tuning.well): drop in what you've grown for a reward
  //
  // Found by the second Room to grow. Each six-hour block (the tides' clock) it's drawn to one school, or to
  // all flora or all fungi (its focus). Items it wants count `desire` times their value. The more a wish is
  // worth, the better its luck: coins are always possible, but luck makes a blessing (a six-hour growth boost
  // for one or two schools, which also lets them grow on any soil) and seed packets likelier, and the packets
  // rarer. Nothing is ever certain: every reward and every packet tier keeps a chance at every luck.
  get well() { return this.state.landmarks.find((l) => l.id === WELL) || null; }
  get wellCfg() { return this.t.well || {}; }
  /** The focus for the six-hour block containing t: { id (a school, flora or fungi), until }. */
  wellFocus(t) {
    const n = Game.tideNumber(t), opts = [...SCHOOLS, 'flora', 'fungi'], L = opts.length;
    // A shuffled round of every focus per L blocks, so each comes up in turn and none repeats back to back.
    const round = (r) => {
      const perm = opts.slice().sort((a, b) => hash32(this.state.seed, r, hashStr(a), 0x3e11) - hash32(this.state.seed, r, hashStr(b), 0x3e11));
      return perm;
    };
    const r = Math.floor(n / L), perm = round(r);
    if (perm[0] === round(r - 1)[L - 1]) [perm[0], perm[1]] = [perm[1], perm[0]];
    return { id: perm[((n % L) + L) % L], until: Game.tideStart(n + 1) };
  }
  focusName(id) { return { flora: 'Flora', fungi: 'Fungi' }[id] || schoolName(id); }
  /** How much the well wants an item now: desire× for its focus, else 1. */
  wellDesire(itemID, t) {
    const it = this.content.items[itemID], f = this.wellFocus(t).id;
    if (!it) return 1;
    const hit = it.school === f || (f === 'flora' && it.category === 'plant') || (f === 'fungi' && it.category === 'mushroom');
    return hit ? (this.wellCfg.desire ?? 2.5) : 1;
  }
  /** Bag items the well takes: anything grown or foraged (flora and fungi). */
  wellItems() {
    return Object.entries(this.state.inventory).filter(([id, n]) => n > 0 && this.sellPrice(id) > 0).map(([id, n]) => ({ id, n }));
  }
  /** What a handful is worth to the well right now: { value, luck (0..maxLuck), count }. */
  wishWorth(pick, t) {
    let value = 0, count = 0;
    for (const [id, n] of Object.entries(pick || {})) {
      const k = Math.min(n, this.state.inventory[id] || 0);
      if (k <= 0) continue;
      value += k * this.sellPrice(id) * this.wellDesire(id, t);
      count += k;
    }
    const c = this.wellCfg;
    return { value, count, luck: Math.min(c.maxLuck ?? 5, Math.log2(1 + value / (c.luckScale ?? 10))) };
  }
  /** Picks from [[value, weight]] with this.rng. */
  weighted(list) {
    const tot = list.reduce((a, x) => a + x[1], 0);
    let r = this.rng.next() * tot;
    for (const [v, w] of list) { if (r < w) return v; r -= w; }
    return list[list.length - 1][0];
  }
  /** Schools of the handful, weighted by what each part was worth (for a blessing's or packet's school). */
  wishSchools(pick, t) {
    const by = {};
    for (const [id, n] of Object.entries(pick)) { const s = this.content.items[id]?.school; if (s) by[s] = (by[s] || 0) + n * this.sellPrice(id) * this.wellDesire(id, t); }
    return by;
  }
  /**
   * Drop a handful into the well: `pick` is { itemID: count }. Returns the reward:
   * { type: 'coins', coins } | { type: 'blessing', schools, until } | { type: 'packet', item, tier, results }.
   */
  wish(pick, now) {
    if (!this.well) throw new GameError("There's no well here yet.");
    const clean = {};
    for (const [id, n] of Object.entries(pick || {})) {
      if (!(n > 0)) continue;
      if (!this.sellPrice(id)) throw new GameError("The well won't take that.");
      if ((this.state.inventory[id] || 0) < n) throw new GameError("You don't have that many.");
      clean[id] = n;
    }
    const worth = this.wishWorth(clean, now);
    if (!worth.count) throw new GameError('Choose something to drop in.');
    const c = this.wellCfg, W = c.weights || {}, L = worth.luck;
    const focus = this.wellFocus(now).id, bySchool = this.wishSchools(clean, now);
    for (const [id, n] of Object.entries(clean)) this.consume(id, n);
    this.rebase(now);
    const kind = this.weighted([['coins', W.coins ?? 50], ['blessing', (W.blessing ?? 10) + (W.blessingPerLuck ?? 8) * L], ['packet', (W.packet ?? 10) + (W.packetPerLuck ?? 10) * L]]);
    // The school a blessing or packet favours: the focus if it's a school, else what the handful was mostly made of.
    const pickSchool = (exclude = []) => {
      if (SCHOOLS.includes(focus) && !exclude.includes(focus)) return focus;
      const opts = Object.entries(bySchool).filter(([s]) => !exclude.includes(s));
      return opts.length ? this.weighted(opts) : this.rng.pick(SCHOOLS.filter((s) => !exclude.includes(s)));
    };
    let out;
    if (kind === 'coins') {
      const [lo, hi] = c.coinRate || [0.6, 0.9];
      const coins = Math.max(1, Math.round(worth.value * (lo + this.rng.next() * (hi - lo))));
      this.state.coins += coins;
      this.bump('earned', coins);
      out = { type: 'coins', coins };
    } else if (kind === 'blessing') {
      const B = c.blessing || {};
      const schools = [pickSchool()];
      if (this.rng.chance(Math.min(B.twoMax ?? 0.6, (B.two ?? 0.15) + (B.twoPerLuck ?? 0.1) * L))) schools.push(pickSchool(schools));
      const b = { schools, from: now, until: now + (B.hours ?? 6) * HOUR, mult: B.mult ?? 1.5 };
      this.state.wellBuffs.push(b);
      this.rebase(now);
      out = { type: 'blessing', schools, until: b.until, mult: b.mult };
    } else {
      const P = c.packets || {}, base = P.base || [60, 30, 12, 4, 1], k = P.luckPerTier ?? 0.35;
      const tier = this.weighted(PLANT_TIERS.map((t, i) => [t, (base[i] ?? 1) * Math.exp(k * L * i)]));
      const item = blindPacketID(pickSchool(), tier);
      out = { type: 'packet', item, tier, results: this.grant([{ item, count: 1 }]) };
    }
    this.state.wellLast = { at: now, focus, ...out };
    this.bump('wish');
    return out;
  }
  /** Blessings in force: [{ schools, until, mult }]. (Expired ones are removed as time passes; see expireBuffs.) */
  get blessings() { return this.state.wellBuffs; }
  /** The growth boost a blessing gives a school now (1 if none). Blessings don't stack: two only last longer. */
  blessingMult(school) { return this.state.wellBuffs.filter((b) => b.schools.includes(school)).reduce((a, b) => Math.max(a, b.mult || 1), 1); }
  isBlessed(school) { return this.state.wellBuffs.some((b) => b.schools.includes(school)); }
  /** Blessings that ran out by t end exactly then: growth is banked to that moment and rates recomputed. */
  expireBuffs(t) {
    const done = this.state.wellBuffs.filter((b) => b.until <= t).sort((a, b) => a.until - b.until);
    for (const b of done) {
      this.rebase(b.until);
      this.state.wellBuffs = this.state.wellBuffs.filter((x) => x !== b);
      this.rebase(b.until);
    }
  }

  // ---- beauty (tuning.garden.beauty): never shown as a number
  /** variety × distinct plants + blooming × plants in bloom or ready + every placed decor's beauty. */
  beautyScore(now) {
    const b = this.gcfg.beauty || {};
    const kinds = new Set(this.state.plants.map((p) => p.plantID)).size;
    const blooming = this.state.plants.filter((p) => this.isBlooming(p, now)).length;
    const decor = this.state.decor.placed.reduce((a, d) => a + (this.decorKind(this.decorDef(d.decorID)).beauty || 0), 0)
      + this.state.scenery.reduce((a, x) => a + (x.feature ? (this.featureDef(x.feature) || {}).beauty || 0 : 0), 0);
    return kinds * (b.variety ?? 3) + blooming * (b.blooming ?? 1) + decor;
  }
  get beautyTiers() { return (this.gcfg.beauty || {}).tiers || [{ name: 'Bare', at: 0 }]; }
  /** The tier now: { index, name, frac } (frac = how far toward the next tier, for the meter). */
  beautyTier(now) {
    const tiers = this.beautyTiers, sc = this.beautyScore(now);
    let i = 0;
    while (i + 1 < tiers.length && sc >= tiers[i + 1].at) i++;
    const next = tiers[i + 1];
    return { index: i, name: tiers[i].name, frac: next ? (sc - tiers[i].at) / (next.at - tiers[i].at) : 1 };
  }
  get beautyBest() { return this.state.beautyBest || 0; }
  /** Records the best tier reached (it never relocks) and announces a new one. */
  updateBeauty(now) {
    const t = this.beautyTier(now);
    if (t.index > this.beautyBest) {
      const from = this.beautyBest;
      this.state.beautyBest = t.index;
      this.discover('beauty:' + t.index);
      this.events.push({ type: 'beautyTier', index: t.index, name: t.name, from, opens: this.opensAtBeauty(from, t.index) });
    }
    return t;
  }
  /** Store items that a beauty tier in (from, to] puts on the shelf: plant names and listing names. */
  opensAtBeauty(from, to) {
    const out = [];
    for (const [t, c] of Object.entries((this.gcfg.packets || {}).tiers || {})) { const b = c.beauty || 0; if (b > from && b <= to) out.push(`${t.charAt(0).toUpperCase() + t.slice(1)} seeds`); }
    for (const r of this.content.requests || []) { const b = (r.requires || {}).beauty; if (r.kind === 'shop' && b > from && b <= to) out.push(this.decorDef(r.reward.id)?.name || r.name); }
    return out;
  }
  beautyLock(need) { return need > this.beautyBest ? [{ type: 'beauty', need, name: (this.beautyTiers[need] || {}).name || `tier ${need}` }] : []; }
  extraLocks(req) { return this.beautyLock((req.requires || {}).beauty || 0); }

  // ---- naming
  get generatedName() {
    const counts = this.soilCounts;
    const min = (this.t.naming || {}).minSoilTiles ?? 3;
    return gardenName(this.content.nameParts, Object.fromEntries(Object.entries(counts).filter(([, n]) => n >= min)), this.state.seed);
  }
  get forestName() { return this.state.customName || this.generatedName; }
  renameForest(name) { const t = (name || '').trim(); this.state.customName = t || null; }

  // ---- developer tools (called on the separate developer save; see main.js)
  get isDev() { return !!this.state.dev; }
  debugGrant(itemID, count = 1) { this.grant([{ item: itemID, count }]); }
  devFillGuide() {
    for (const i of this.content.itemList) if (i.inGuide !== false) this.discover('item:' + i.id);
    for (const v of this.content.visitorList || []) this.discover('visitor:' + v.id.replace(/^visitor\./, ''));
    for (const p of this.content.plantList) this.discover('plant:' + p.id);
    for (const c of this.content.cosmetics || []) this.discover('decor:' + c.id);
  }
  devOpenForest(now) {
    const s = this.state.size, c = this.clearing;
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (!this.inClearing({ x, y })) this.state.revealed[x + ',' + y] = now;
    this.state.clearing = { x0: 0, y0: 0, x1: s.width - 1, y1: s.height - 1 };
    return c;
  }
  devCompleteRequests(now, all = false) {
    let n = 0;
    for (const st of this.requestBoard(now)) {
      if (st.done || (!all && st.locks.length)) continue;
      this.state.offerings.delivered[st.req.id] = now;
      this.grantReward(st.req.reward, now, { side: this.openSides()[0] });
      n++;
    }
    return n;
  }
  devResetRequests() { this.state.offerings.delivered = {}; }
  devGrantDecor() { for (const c of this.content.cosmetics || []) this.state.decor.owned[c.id] = (this.state.decor.owned[c.id] || 0) + 1; return (this.content.cosmetics || []).length; }
  /** Every plant ready now. */
  devGrowAll(now) {
    this.rebase(now);
    for (const p of this.state.plants) p.grown = this.growNeed(p);
    this.rebase(now);
    return this.state.plants.length;
  }
  devGiveCoins(n) { this.state.coins += n; }
  devGiveVarieties(n = 2) { const v = Object.values(this.content.varieties); for (const x of v) this.grant([{ item: x.packet, count: n }]); return v.length; }
  /** Set a visitor's interest: none (and forget it), first (ready for its first memento) or visit (ready to visit). */
  devGuestStage(id, stage) {
    const def = this.guestDef(id), g = this.guest(id);
    if (stage === 'none') { this.state.guests[id] = {}; this.guest(id); return; }
    g.interest = stage === 'first' ? this.visitNeed(def, { series: 0 }) : Math.max(this.visitNeed(def, { series: 1 }), g.interest);
  }
  /** A visit now: the next memento, or it moves in if it can (else a plainer hint). */
  devGuestVisit(id, now) {
    const def = this.guestDef(id), g = this.guest(id);
    if (g.home) throw new GameError('It already lives here.');
    this.guestVisit(def, now);
  }
  /** Move a visitor in now, whatever its conditions (soil patches it can find are claimed). */
  devGuestMoveIn(id, now) {
    const def = this.guestDef(id), g = this.guest(id);
    if (g.home) throw new GameError('It already lives here.');
    g.series = (def.mementos || []).length;
    this.moveIn(def, now, this.stayCheck(def, now));
  }
  /** Each condition and whether it holds right now (developer mode). */
  devGuestConditions(id, now) {
    const def = this.guestDef(id), chk = this.stayCheck(def, now);
    return (def.stays || []).map((c, i) => ({ c, ok: !chk.broken.includes(i) }));
  }
  devGiveOrnaments() { for (const r of this.content.relicList) this.state.decor.owned[r.id] = (this.state.decor.owned[r.id] || 0) + 1; return this.content.relicList.length; }
  devSetBeautyBest(i) { this.state.beautyBest = i; }
  devGivePackets(n = 5) { const ids = this.content.itemList.filter((i) => i.blind).map((i) => i.id); for (const id of ids) this.grant([{ item: id, count: n }]); return ids.length; }
  devGiveAmendments(n = 5) { for (const a of this.content.amendmentList) this.grant([{ item: a.id, count: n }]); return this.content.amendmentList.length; }
  devForageNow(now) {
    const f = this.state.forage;
    f.slot = this.forageSlot(now) - (this.forageCfg.maxCatchUpSlots ?? 48);
    return this.forageTick(now);
  }
}

// ---------------------------------------------------------------- content

/** Content bundle produced by tools/build_web.py from Resources/. */
export class Content {
  constructor(bundle) {
    this.tuning = bundle.tuning;
    this.nameParts = bundle.nameParts;
    this.itemList = bundle.items;
    this.items = Object.fromEntries(bundle.items.map((i) => [i.id, i]));
    this.landmarks = bundle.landmarks || [];
    this.story = bundle.story || {};
    this.requests = bundle.requests || [];
    this.cosmetics = bundle.cosmetics || [];
    this.opening = bundle.opening || null;
    this.visitorList = bundle.visitors || [];
    this.relicList = bundle.relics || [];
    // Garden plants (plants.json): each yields a catalogue item, and has a seed packet in the Bag.
    this.plantList = (bundle.plants || []).filter((p) => this.items[p.item]);
    this.plants = {};
    const g = (bundle.tuning.garden || {}).plants || {};
    for (const p of this.plantList) {
      const item = this.items[p.item];
      p.name = p.name || item.name;
      this.plants[p.id] = p;
      if (g[p.id] && g[p.id].sell != null) item.sell = g[p.id].sell;
      item.plant = p.id;
      this.addItem({ id: 'packet.' + p.id, category: 'packet', name: `${p.name} seeds`, rarity: item.rarity, sprite: 'packet.' + p.id, plant: p.id, school: p.school, text: p.packet, inGuide: false });
    }
    // Colour varieties (plants.json varieties): their own produce (with a palette swap) and seed packets.
    this.varieties = {};
    const spritePal = Object.fromEntries((bundle.sprites || []).map((x) => [x.id, x.palette || []]));
    const mult = ((bundle.tuning.garden || {}).varieties || {}).sellMult ?? 2;
    for (const p of this.plantList) {
      const item = this.items[p.item];
      for (const v of p.varieties || []) {
        const suffix = v.id.split('.').slice(1).join('.');
        const variant = varietySwap(spritePal[item.sprite], v.hue, v.leaves);
        const [r, gg, b] = hslToRgb(v.hue / 360, 0.65, 0.6), [r2, g2, b2] = hslToRgb(v.hue / 360, 0.5, 0.82);
        const def = { ...v, plantID: p.id, produce: `${item.id}.${suffix}`, packet: 'packet.' + v.id, variant };
        this.varieties[v.id] = def;
        this.addItem({ id: def.produce, category: item.category, name: v.name, rarity: item.rarity, sprite: item.sprite, variant, school: p.school, plant: p.id, variety: v.id,
          sell: item.sell != null ? item.sell * mult : undefined, guideText: `A colour of ${p.name} that only cross-pollination brings.` });
        this.addItem({ id: def.packet, category: 'packet', name: `${v.name} seeds`, rarity: item.rarity, sprite: 'packet.' + p.id, variant: { swap: { 7: rgbHex(r, gg, b), 8: rgbHex(r2, g2, b2) } },
          plant: p.id, variety: v.id, school: p.school, text: `${p.packet || ''} A rare colour.`.trim(), inGuide: false });
      }
    }
    // Blind seed packets: Common, Uncommon and Rare seeds of each school (tuning.garden.packets).
    for (const school of SCHOOLS) for (const tier of PLANT_TIERS) {
      const S = schoolName(school), T = TIER_NAMES[tier];
      this.addItem({ id: blindPacketID(school, tier), category: 'packet', name: `${T} ${S} seeds`, rarity: { epic: 'veryRare' }[tier] || tier, sprite: `packet.${school}.${tier}`, school, blind: tier, inGuide: false,
        text: { common: `${S} seeds. Mostly common plants, now and then something better.`, uncommon: `${S} seeds with better odds of something special.`, rare: `${S} seeds with good odds of a rare plant. Never a sure thing.`,
          epic: `${S} seeds with a real chance of something few gardens ever see. Still never a sure thing.`, legendary: `The finest ${S} seeds there are: the best odds of all of something extraordinary, though even these can come up ordinary.` }[tier] });
    }
    // Soil amendments (amendments.json): Bag items that change a tile's soil.
    // Relics (relics.json) are decor ornaments: kind "ornament", with their school.
    for (const r of this.relicList) this.cosmetics.push({ id: r.id, name: r.name, sprite: r.sprite, size: [1, 1], kind: 'ornament', school: r.school, text: r.inscription });
    this.decorByID = Object.fromEntries(this.cosmetics.map((c) => [c.id, c]));
    this.amendmentList = bundle.amendments || [];
    for (const a of this.amendmentList) this.addItem({ id: a.id, category: 'amendment', name: a.name, rarity: 'common', sprite: a.id, amend: a.school, text: a.text, inGuide: false });
  }
  addItem(it) {
    if (this.items[it.id]) return this.items[it.id];
    this.itemList.push(it);
    this.items[it.id] = it;
    return it;
  }
}
