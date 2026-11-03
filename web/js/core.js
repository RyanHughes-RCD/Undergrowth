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
export const SAVE_VERSION = 7;
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
    if (saved.version < SAVE_VERSION) {
      const g = Game.newGarden(content, now, null, saved.discovered || []);
      if (saved.dev) g.state.dev = { ...saved.dev };
      g.state.archivedFrom = { version: saved.version, at: now };
      g.events.push({ type: 'freshGarden', version: saved.version, kept: g.discovered.size });
      return { game: g, archived: saved };
    }
    return { game: new Game(content, saved), archived: null };
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
    const report = { forage: this.forageTick(now) };
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

  /** Puts data-defined landmarks (the Old Log) on the map, once, and keeps their tiles clear. */
  placeLandmarks() {
    for (const def of this.content.landmarks || []) {
      if (this.state.landmarks.some((l) => l.id === def.id)) continue;
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
      for (const d of s.decor.placed) if (on(d)) { const t = this.freeNear(l.tile); if (t) d.tile = t; }
    }
  }

  sceneryAt(t) { return this.state.scenery.find((d) => sameTile(d.tile, t)) || null; }
  decorAt(t) { return this.state.decor.placed.find((d) => sameTile(d.tile, t)) || null; }
  forageAt(t) { return this.state.forage.finds.find((f) => sameTile(f.tile, t)) || null; }
  tinAt(t) { return this.state.tin && sameTile(this.state.tin.tile, t) ? this.state.tin : null; }

  /** Nothing on the tile: no landmark, scenery, decor, plant, find or the seed tin. */
  isFree(t) {
    return this.inBounds(t) && this.inClearing(t) && !this.landmarkAt(t) && !this.sceneryAt(t) && !this.decorAt(t) && !this.plantAt(t) && !this.forageAt(t) && !this.tinAt(t);
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

  /** Grows the clearing by one ring on every side (clipped to the forest). */
  expand(now) {
    const c = this.clearing, s = this.state.size;
    const r = (this.t.expansion && this.t.expansion.ringTiles) || 1;
    const next = { x0: Math.max(0, c.x0 - r), y0: Math.max(0, c.y0 - r), x1: Math.min(s.width - 1, c.x1 + r), y1: Math.min(s.height - 1, c.y1 + r) };
    const added = [];
    for (let y = next.y0; y <= next.y1; y++) for (let x = next.x0; x <= next.x1; x++) if (!this.inClearing({ x, y })) { this.state.revealed[x + ',' + y] = now; added.push({ x, y }); }
    this.state.clearing = next;
    this.events.push({ type: 'expansion', tiles: added });
    return added;
  }

  // ---- the opening grotto
  /** Mossy rocks, ferns and the like along the edge of the starting clearing. Visual; they take up their tiles. */
  placeScenery() {
    const sc = (this.t.start || {}).scenery;
    if (!sc || !(sc.sprites || []).length) return;
    const c = this.clearing, log = this.state.landmarks[0];
    const edge = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const d = Math.min(x - c.x0, c.x1 - x, y - c.y0, c.y1 - y);
      if (d < (sc.edgeDepth ?? 1) && !(log && x >= log.tile.x - 1 && x <= log.tile.x + this.landmarkFootprint(log)[0] && Math.abs(y - log.tile.y) <= 1)) edge.push({ x, y });
    }
    for (let i = 0; i < (sc.count || 0) && edge.length; i++) {
      const tile = edge.splice(this.rng.int(0, edge.length - 1), 1)[0];
      if (!this.isFree(tile)) continue;
      this.state.scenery.push({ tile, sprite: sc.sprites[this.rng.int(0, sc.sprites.length - 1)], flip: this.rng.chance(0.5) });
    }
  }

  /** The opening's seed tin (Content/opening.json) waits on a free tile near the old log until it's opened. */
  placeTin() {
    const st = (this.t.start || {}).tin;
    const log = this.state.landmarks[0];
    if (!st || !log || !this.content.opening) return;
    const near = st.near ?? 2, ring = [];
    for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) {
      const t = { x: log.tile.x + dx, y: log.tile.y + dy };
      if ((dx || dy) && this.isFree(t)) ring.push(t);
    }
    const tile = ring.length ? this.rng.pick(ring) : this.freeNear(log.tile);
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

  /** The tin's contents for a school and its runner-up. */
  starterSet(school, second) {
    const cfg = (this.t.garden || {}).starterSet || {};
    const starters = (s) => this.content.plantList.filter((p) => p.source === 'starter' && p.school === s);
    const out = [];
    const add = (item, count) => { if (count > 0 && this.content.items[item]) out.push({ item, count }); };
    const [a, b] = starters(school);
    if (a) add('packet.' + a.id, cfg.primaryPackets ?? 3);
    if (b) add('packet.' + b.id, cfg.primarySecondPlant ?? 1);
    const [c] = starters(second);
    if (c) add('packet.' + c.id, cfg.secondPackets ?? 2);
    add('amend.' + school, cfg.primaryAmendments ?? 4);
    add('amend.' + second, cfg.secondAmendments ?? 2);
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
    if (!school) return c.plain ?? 0.6;
    return school === def.school ? (c.preferred ?? 1) : null;
  }

  /** Whether a plant can go on a tile, and why not: { ok, factor, reason }. */
  canPlant(plantID, tile) {
    const def = this.plantDef(plantID);
    if (!def) return { ok: false, reason: 'Unknown seeds.' };
    if (!this.inBounds(tile) || !this.inClearing(tile)) return { ok: false, reason: "That's outside the clearing." };
    if (!this.isFree(tile) && !this.hostsPlant(tile)) return { ok: false, reason: 'Something is already there.' };
    const soil = this.soilAt(tile);
    const factor = this.soilFactor(def, soil);
    if (factor == null) return { ok: false, reason: `${def.name} won't grow in ${schoolName(soil)} soil. It likes ${schoolName(def.school)} soil, or plain ground.` };
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
    let r = this.soilFactor(def, this.soilAt(p.tile)) ?? this.gcfg.soil?.plain ?? 0.6;
    const c = this.gcfg.companions || {};
    const speeds = this.activeCompanions(p).filter((x) => x.rule.effect === 'speed').length;
    if (speeds) r *= Math.min(c.maxSpeed ?? 1.5, Math.pow(c.speed ?? 1.25, speeds));
    r *= this.ornamentFactor(p);
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

  /** Plant a seed packet on a tile. */
  plant(packetID, tile, now) {
    const pk = this.content.items[packetID];
    if (!pk || !pk.plant) throw new GameError("That isn't a seed packet.");
    if (!(this.state.inventory[packetID] > 0)) throw new GameError('You have no more of those seeds.');
    const chk = this.canPlant(pk.plant, tile);
    if (!chk.ok) throw new GameError(chk.reason);
    this.rebase(now);
    this.consume(packetID);
    const p = this.newPlant(pk.plant, tile, now);
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
    n += this.activeCompanions(p).filter((x) => x.rule.effect === 'yield').length * ((this.gcfg.companions || {}).yield ?? 1);
    const d = this.decorAt(p.tile);
    if (d) n += this.decorKind(this.decorDef(d.decorID)).yield || 0;
    return n;
  }
  /** The produce item a harvest gives (a colour variety has its own). */
  produceOf(p) { return this.plantDef(p.plantID)?.item; }

  /**
   * Harvest a ready plant: its produce and (usually) seeds back. An annual leaves the tile empty; a
   * perennial drops back to its bud stage and regrows in regrowHours. Returns { results, plant, regrows }.
   */
  harvest(plantRef, now) {
    const p = this.plantByID(plantRef);
    if (!p) throw new GameError("It's gone.");
    if (!this.isReady(p, now)) throw new GameError("It isn't ready yet.");
    this.rebase(now);
    const def = this.plantDef(p.plantID), cfg = this.plantCfg(p.plantID);
    const extras = this.harvestExtras(p, now);
    const companions = this.activeCompanions(p);
    const pending = [{ item: this.produceOf(p), count: this.harvestYield(p) }];
    const [always, chance] = cfg.seeds || [1, 0.5];
    const seeds = (always || 0) + (this.rng.chance(chance || 0) ? 1 : 0);
    if (seeds > 0) pending.push({ item: 'packet.' + p.plantID, count: seeds });
    for (const x of extras) pending.push(x);
    const results = this.grant(pending.filter((x) => x.item && x.count > 0));
    const firstHarvest = this.discover('plant:' + p.plantID);
    // Companion rules active at this harvest are discovered (shown on the plant's Field Guide page).
    for (const c of companions) {
      if (this.discover(this.companionKey(p.plantID, c.index))) this.events.push({ type: 'companionFound', plantID: p.plantID, with: c.rule.with, effect: c.rule.effect, tile: p.tile });
    }
    p.harvests++;
    let regrows = false;
    if (def.perennial && cfg.regrowHours) {
      const bud = (this.gcfg.stages || {}).bud ?? 0.45;
      p.cycle = 'regrow';
      p.need = cfg.regrowHours * HOUR / (1 - bud);
      p.grown = p.need * bud;
      p.since = now;
      delete p.variety;
      regrows = true;
    } else {
      this.state.plants = this.state.plants.filter((x) => x !== p);
    }
    this.rebase(now);
    this.bump('harvest');
    this.afterHarvest(p, now, results);
    return { results, plant: p, regrows, firstHarvest };
  }
  /** Extra things a harvest gives (later systems: cross-pollinated seeds). */
  harvestExtras() { return []; }
  afterHarvest() {}

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
    if (this.plantAt(tile)) throw new GameError('Something is growing there. Change the soil once the tile is empty.');
    if (this.landmarkAt(tile) || this.sceneryAt(tile)) throw new GameError("That ground can't be dug.");
    const cur = this.soilAt(tile);
    if ((def.amend || null) === cur) throw new GameError(`It's already ${schoolName(cur)} soil.`);
    this.consume(itemID);
    if (def.amend) this.state.soil[key(tile)] = def.amend; else delete this.state.soil[key(tile)];
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

  /** Plants whose seed packets the Store sells, with what (if anything) still locks each. */
  storePlants(now) {
    return this.content.plantList.filter((p) => p.source !== 'gift').map((p) => ({ def: p, price: this.plantCfg(p.id).packet || 0, locks: this.plantLocks(p, now) }));
  }
  buyPacket(plantID, now, n = 1) {
    const row = this.storePlants(now).find((x) => x.def.id === plantID);
    if (!row) throw new GameError("The Store doesn't sell those.");
    if (row.locks.length) throw new GameError("Those seeds aren't in the Store yet.");
    this.spend(row.price * n);
    return this.grant([{ item: 'packet.' + plantID, count: n }]);
  }
  amendmentPrice(itemID) {
    const def = this.content.items[itemID], c = this.gcfg.amendments || {};
    return def && def.category === 'amendment' ? (def.amend ? c.price ?? 6 : c.plainPrice ?? 2) : 0;
  }
  buyAmendment(itemID, n = 1) {
    const price = this.amendmentPrice(itemID);
    if (!price) throw new GameError("The Store doesn't sell that.");
    this.spend(price * n);
    return this.grant([{ item: itemID, count: n }]);
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
    const done = req.kind === 'shop' ? false : this.isDelivered(req.id);
    const coins = req.coins || 0;
    return { req, done, locks, items, coins, ready: !done && !locks.length && items.every((x) => x.owned >= x.count) && this.state.coins >= coins };
  }
  /** Every listing with its status: open ones first, then locked, then done. */
  requestBoard(now, kinds = null) {
    const rank = (s) => (s.done ? 2 : s.locks.length ? 1 : 0);
    return (this.content.requests || []).filter((r) => !kinds || kinds.includes(r.kind)).map((r) => this.requestStatus(r, now)).sort((a, b) => rank(a) - rank(b));
  }
  deliver(id, now) {
    const req = this.requestDef(id);
    if (!req) throw new GameError('Unknown listing.');
    const st = this.requestStatus(req, now);
    if (st.done) throw new GameError('Already done.');
    if (st.locks.length) throw new GameError("That isn't open yet.");
    if (this.state.coins < st.coins) throw new GameError(`That costs ${st.coins} coins (you have ${this.state.coins}).`);
    if (!st.ready) throw new GameError('You need more of the things it asks for.');
    for (const x of req.items) this.consume(x.item, x.count);
    if (st.coins) this.spend(st.coins);
    if (req.kind === 'shop') { const b = this.state.offerings.bought; b[id] = (b[id] || 0) + 1; } else this.state.offerings.delivered[id] = now;
    this.bump('deliver');
    return this.grantReward(req.reward, now);
  }
  /** Gives a reward. Returns { type, id, count, ... } for the UI. */
  grantReward(r, now) {
    const out = { ...r };
    if (r.type === 'cosmetic') this.state.decor.owned[r.id] = (this.state.decor.owned[r.id] || 0) + (r.count || 1);
    else if (r.type === 'item') out.results = this.grant([{ item: r.id, count: r.count || 1 }]);
    else if (r.type === 'coins') { this.state.coins += r.count || 0; this.bump('earned', r.count || 0); }
    else if (r.type === 'unlock' && r.id === 'expansion') {
      this.state.unlocks.expansions += r.count || 1;
      out.tiles = 0;
      for (let i = 0; i < (r.count || 1); i++) out.tiles += this.expand(now).length;
    }
    return out;
  }
  get expansionTier() { return this.state.unlocks.expansions || 0; }

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

  // ---- beauty (tuning.garden.beauty): never shown as a number
  /** variety × distinct plants + blooming × plants in bloom or ready + every placed decor's beauty. */
  beautyScore(now) {
    const b = this.gcfg.beauty || {};
    const kinds = new Set(this.state.plants.map((p) => p.plantID)).size;
    const blooming = this.state.plants.filter((p) => this.isBlooming(p, now)).length;
    const decor = this.state.decor.placed.reduce((a, d) => a + (this.decorKind(this.decorDef(d.decorID)).beauty || 0), 0);
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
    for (const p of this.content.plantList) { const b = this.plantCfg(p.id).beauty; if (p.source === 'store' && b > from && b <= to) out.push(`${p.name} seeds`); }
    for (const r of this.content.requests || []) { const b = (r.requires || {}).beauty; if (b > from && b <= to) out.push(this.decorDef(r.reward.id)?.name || r.name); }
    return out;
  }
  beautyLock(need) { return need > this.beautyBest ? [{ type: 'beauty', need, name: (this.beautyTiers[need] || {}).name || `tier ${need}` }] : []; }
  extraLocks(req) { return this.beautyLock((req.requires || {}).beauty || 0); }
  plantLocks(p) { return p.source === 'store' ? this.beautyLock(this.plantCfg(p.id).beauty || 0) : []; }

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
      this.grantReward(st.req.reward, now);
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
  devGiveOrnaments() { for (const r of this.content.relicList) this.state.decor.owned[r.id] = (this.state.decor.owned[r.id] || 0) + 1; return this.content.relicList.length; }
  devSetBeautyBest(i) { this.state.beautyBest = i; }
  devGivePackets(n = 5) { for (const p of this.content.plantList) this.grant([{ item: 'packet.' + p.id, count: n }]); return this.content.plantList.length; }
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
