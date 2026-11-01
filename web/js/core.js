// Undergrowth web prototype — game logic.
// A JavaScript port of Packages/UndergrowthCore (the Swift package). Same data
// files, same rules; times are stored as epoch milliseconds.

export const CORE_STATS = ['damp', 'glow', 'bloom', 'verdure', 'stone', 'depth'];
export const RARITIES = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];
export const RARITY_NAMES = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', veryRare: 'Very rare', legendary: 'Legendary' };
export const rarityIndex = (r) => Math.max(0, RARITIES.indexOf(r));
/** 2 = spawn-table content (older forests are replanted). 3 = clearing, tutorial, unlocks (2 migrates).
 *  4 = creature influence radius doubled (owned/placed creatures are scaled on load). */
export const SAVE_VERSION = 4;
export const TUTORIAL_STEPS = ['forage', 'pickClover', 'plant', 'dig', 'crack', 'place', 'watch', 'wrap', 'done'];

// ---------------------------------------------------------------- utilities

/** Seedable RNG (mulberry32). State lives on `holder.rng` so it is saved with the forest. */
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
  range(lo, hi) { return hi <= lo ? lo : lo + (hi - lo) * this.next(); }
  int(lo, hi) { return hi <= lo ? lo : lo + Math.floor(this.next() * (hi - lo + 1)); }
  uuid() {
    let s = '';
    for (let i = 0; i < 4; i++) s += Math.floor(this.next() * 0x100000000).toString(16).padStart(8, '0');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
  }
}

/** Deterministic 32-bit hash so tile decorations don't shuffle between runs. */
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

export function weightedPick(items, rng) {
  const total = items.reduce((a, [, w]) => a + Math.max(0, w), 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const [item, w] of items) {
    if (w <= 0) continue;
    if (r < w) return item;
    r -= w;
  }
  for (let i = items.length - 1; i >= 0; i--) if (items[i][1] > 0) return items[i][0];
  return null;
}

const range = (r) => (Array.isArray(r) ? [Math.min(r[0], r[1]), Math.max(r[0], r[1])] : [r, r]);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sameTile = (a, b) => a.x === b.x && a.y === b.y;

export function boundMatches(bound, v) {
  if (bound.min != null && v < bound.min) return false;
  if (bound.max != null && v > bound.max) return false;
  return true;
}
export function groupMatches(group, stats) {
  for (const k in group) if (!boundMatches(group[k], stats[k] || 0)) return false;
  return true;
}
export function conditionMatches(all, any, stats) {
  if (all && !groupMatches(all, stats)) return false;
  if (any && any.length) return any.some((g) => groupMatches(g, stats));
  return true;
}

export function spawnWeight(rule, stats, rarityWeight) {
  if (rule.requires && !groupMatches(rule.requires, stats)) return 0;
  let mult = 1;
  for (const k in rule.statWeights || {}) mult += rule.statWeights[k] * (stats[k] || 0) / 100;
  return Math.max(0, rule.baseWeight * rarityWeight * mult);
}

export class GameError extends Error {}

// ---------------------------------------------------------------- stats

export class StatEngine {
  constructor(tuning) { this.t = tuning; }

  /** How far a creature reaches: its radius plus padding (so radius 1 still touches neighbours). */
  reach(radius) { return radius + (this.t.falloff.radiusPadding || 0); }

  falloff(d, radius) {
    const f = this.t.falloff;
    const reach = this.reach(radius);
    if (reach <= 0 || d >= reach) return 0;
    const inner = reach * Math.max(0, Math.min(1, f.innerRadiusFraction));
    if (d <= inner) return 1;
    const t = 1 - (d - inner) / Math.max(0.0001, reach - inner);
    return f.curve === 'linear' ? t : t * t * (3 - 2 * t);
  }

  /** Ramp level 0..1 while placed; fades over the same time after removal. */
  level(p, now) {
    const ramp = Math.max(1, p.rampSeconds ?? this.t.rampSecondsToFull) * 1000;
    const decay = Math.max(1, p.rampSeconds ?? this.t.decaySecondsToZero) * 1000;
    const rampAt = (t) => Math.min(1, p.startLevel + Math.max(0, t - p.placedAt) / ramp);
    if (p.removedAt == null || now <= p.removedAt) return rampAt(now);
    return Math.max(0, rampAt(p.removedAt) - (now - p.removedAt) / decay);
  }

  fullyDecayedAt(p) {
    if (p.removedAt == null) return null;
    return p.removedAt + this.level(p, p.removedAt) * Math.max(1, p.rampSeconds ?? this.t.decaySecondsToZero) * 1000;
  }

  /** Raw (unclamped) sums; the Game adds soil boosts and clamps. */
  statsAt(tile, placements, now) {
    const out = {};
    for (const k of CORE_STATS) out[k] = 0;
    for (const p of placements) {
      const lv = this.level(p, now);
      if (lv <= 0) continue;
      const f = this.falloff(dist(tile, p.tile), p.radius);
      if (f <= 0) continue;
      for (const k in p.contributions) out[k] = (out[k] || 0) + p.contributions[k] * lv * f;
    }
    return out;
  }

  /** Raw (unclamped) stats for every tile. */
  field(size, placements, now) {
    const keys = [...CORE_STATS];
    for (const p of placements) for (const k in p.contributions) if (!keys.includes(k)) keys.push(k);
    const K = keys.length;
    const values = new Float64Array(size.width * size.height * K);
    for (const p of placements) {
      const lv = this.level(p, now);
      if (lv <= 0) continue;
      const r = Math.ceil(this.reach(p.radius));
      const contribs = Object.entries(p.contributions).map(([k, v]) => [keys.indexOf(k), v]);
      for (let y = Math.max(0, p.tile.y - r); y <= Math.min(size.height - 1, p.tile.y + r); y++) {
        for (let x = Math.max(0, p.tile.x - r); x <= Math.min(size.width - 1, p.tile.x + r); x++) {
          const f = this.falloff(Math.hypot(x - p.tile.x, y - p.tile.y), p.radius);
          if (f <= 0) continue;
          const o = (y * size.width + x) * K;
          for (const [ki, v] of contribs) values[o + ki] += v * lv * f;
        }
      }
    }
    return new StatField(size, keys, values);
  }
}

export class StatField {
  constructor(size, keys, values) { this.size = size; this.keys = keys; this.values = values; }
  statsAt(x, y) {
    const out = {};
    const o = (y * this.size.width + x) * this.keys.length;
    this.keys.forEach((k, i) => { out[k] = this.values[o + i]; });
    return out;
  }
  add(x, y, stats) {
    const o = (y * this.size.width + x) * this.keys.length;
    for (const k in stats) {
      const i = this.keys.indexOf(k);
      if (i >= 0) this.values[o + i] += stats[k];
    }
  }
  clamp(cap) { for (let i = 0; i < this.values.length; i++) this.values[i] = Math.min(cap, Math.max(0, this.values[i])); }
  means() {
    const out = {};
    const K = this.keys.length;
    const n = Math.max(1, this.size.width * this.size.height);
    this.keys.forEach((k, i) => {
      let s = 0;
      for (let j = i; j < this.values.length; j += K) s += this.values[j];
      out[k] = s / n;
    });
    return out;
  }
}

// ---------------------------------------------------------------- naming

export function forestName(parts, tuning, means, seed) {
  const pick = (list, salt) => (list && list.length ? list[hash32(seed, hashStr(salt)) % list.length] : null);
  const ranked = Object.entries(means)
    .filter(([k]) => parts.stats[k])
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1));
  if (!ranked.length || ranked[0][1] < tuning.quietThreshold) return pick(parts.quietNames, 'quiet') || 'Quiet Clearing';
  const top = ranked[0][1];
  const featured = ranked.filter(([, v]) => v >= Math.max(tuning.quietThreshold, top * tuning.featureFraction));
  const first = featured[0][0];
  const adjective = pick(parts.stats[first].adjectives, 'adj-' + first) || '';
  const placeStat = featured.length > 1 ? featured[1][0] : first;
  const place = pick(parts.stats[placeStat].places, 'place-' + placeStat) || pick(parts.defaultPlaces, 'place') || 'Wood';
  let name = `${adjective} ${place}`.trim();
  if (featured.length > 2) {
    const phrase = pick(parts.stats[featured[2][0]].phrases, 'phrase-' + featured[2][0]);
    if (phrase) name += ` of ${phrase}`;
  }
  return name;
}

// ---------------------------------------------------------------- tile rules

export class TileRuleEngine {
  constructor(rules, maxDecorations, seed) {
    const sorted = rules.map((r, i) => [r, i]).sort((a, b) => {
      const pa = a[0].priority || 0, pb = b[0].priority || 0;
      return pa !== pb ? pb - pa : a[1] - b[1];
    }).map(([r]) => r);
    this.ground = sorted.filter((r) => r.layer === 'ground');
    // Overlay families in the order they first appear in the rules file; each family's rules by priority.
    const groupOrder = [];
    for (const r of rules) if (r.layer === 'overlay' && !groupOrder.includes(r.group || r.id)) groupOrder.push(r.group || r.id);
    this.overlayGroups = groupOrder.map((g) => sorted.filter((r) => r.layer === 'overlay' && (r.group || r.id) === g));
    this.decorations = sorted.filter((r) => r.layer === 'decoration');
    this.tints = sorted.filter((r) => r.layer === 'tint');
    this.maxDecorations = maxDecorations;
    this.seed = seed;
  }

  h(x, y, salt) { return hash32(this.seed, x, y, hashStr(salt)); }

  visual(stats, x, y) {
    let ground = '__missing';
    const g = this.ground.find((r) => conditionMatches(r.when, r.any, stats));
    if (g && g.sprites && g.sprites.length) ground = g.sprites[this.h(x, y, 'g-' + g.id) % g.sprites.length];

    // Overlays: the strongest matching level of each family, stacked bottom-up.
    const overlays = [];
    if (!(g && g.suppressOverlays)) {
      for (const fam of this.overlayGroups) {
        const r = fam.find((rule) => conditionMatches(rule.when, rule.any, stats));
        if (!r || !r.sprites || !r.sprites.length) continue;
        const h = this.h(x, y, 'o-' + (r.group || r.id));
        overlays.push({ sprite: r.sprites[h % r.sprites.length], flip: ((h >>> 9) & 1) === 1 });
      }
    }

    const decorations = [];
    for (const r of this.decorations) {
      if (decorations.length >= this.maxDecorations) break;
      if (!r.sprites || !r.sprites.length || !conditionMatches(r.when, r.any, stats)) continue;
      const h = this.h(x, y, 'd-' + r.id);
      if (h / 4294967296 >= (r.density == null ? 1 : r.density)) continue;
      const h2 = hash32(h, 7);
      const slot = decorations.length;
      decorations.push({
        sprite: r.sprites[h2 % r.sprites.length],
        dx: [0, -6, 6, 0][slot % 4] + ((h2 >>> 8) % 5) - 2,
        dy: [0, -1, 1, -3][slot % 4] + ((h2 >>> 16) % 3) - 1,
        flip: ((h2 >>> 24) & 1) === 1,
      });
    }

    let r = 0, gg = 0, b = 0, total = 0;
    for (const t of this.tints) {
      if (!conditionMatches(t.when, t.any, stats)) continue;
      const c = parseHex(t.color);
      if (!c) continue;
      const w = (stats[t.stat] || 0) / 100 * (t.strength == null ? 0.3 : t.strength);
      if (w <= 0) continue;
      r += c[0] * w; gg += c[1] * w; b += c[2] * w; total += w;
    }
    let tint = null;
    if (total > 0.001) {
      const amount = Math.round(Math.min(0.6, total) * 20) / 20;
      if (amount > 0) tint = [Math.round(r / total), Math.round(gg / total), Math.round(b / total), amount];
    }
    return { ground, overlays, decorations, tint };
  }

  /** A decorative tile outside the map: forest edge, denser further out. */
  edgeVisual(x, y, size, edge) {
    const d = Math.max(0, -x, x - (size.width - 1), -y, y - (size.height - 1));
    const h = this.h(x, y, 'edge');
    const ground = edge.ground[h % edge.ground.length];
    const decorations = [];
    const density = Math.min(edge.maxDensity, edge.baseDensity + edge.densityPerTile * (d - 1));
    const h2 = hash32(h, 1);
    if (edge.decorations.length && h2 / 4294967296 < density) {
      const h3 = hash32(h, 2);
      decorations.push({ sprite: edge.decorations[h3 % edge.decorations.length], dx: ((h3 >>> 8) % 5) - 2, dy: ((h3 >>> 16) % 3) - 1, flip: ((h3 >>> 24) & 1) === 1 });
    }
    return { ground, overlays: [], decorations, tint: null };
  }
}

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

// ---------------------------------------------------------------- game

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export class Game {
  constructor(content, state) {
    this.content = content;
    this.state = state;
    state.geodes = state.geodes || [];
    state.visitors = state.visitors || [];
    state.soilBoosts = state.soilBoosts || [];
    state.nextGlimmer = !!state.nextGlimmer;
    this.t = content.tuning;
    this.stats = new StatEngine(this.t);
    this.rng = new RNG(state);
    this.discovered = new Set(state.discovered);
    /** One-shot notifications for the UI (tutorial steps, unlocks, milestones). Not saved. */
    this.events = [];
    this.migrate();
    this.normalizeSlots();
    this.fitToGrid();
    this.placeLandmarks();
    this.statCache = null;
  }

  /** Older saves predate the clearing, tutorial and unlocks: open them fully, tutorial done. */
  migrate() {
    const s = this.state;
    if (!s.clearing) {
      s.clearing = { x0: 0, y0: 0, x1: s.size.width - 1, y1: s.size.height - 1 };
      s.tutorial = s.tutorial || { step: 'done' };
      s.minUnlockedSlots = this.t.placementSlots;
    }
    s.revealed = s.revealed || {};
    s.milestones = s.milestones || {};
    s.tutorial = s.tutorial || { step: 'done' };
    s.landmarks = s.landmarks || [];
    s.counters = s.counters || {};
    s.tasks = s.tasks || { claimed: [], announced: [] };
    if (s.lastExpansionAt == null) s.lastExpansionAt = s.createdAt;
    if (s.announcedSlots == null) s.announcedSlots = this.unlockedSlots(s.lastUpdated || s.createdAt);
    if ((s.version || 0) < 4) {
      // Every creature's influence radius doubled (spreadsheet + glimmer bonus); scale what's already owned.
      for (const c of s.creatures) c.radius *= 2;
      for (const p of s.placements) p.radius *= 2;
      // The starting clearing is now twice as tall. Forests that haven't expanded yet get the extra
      // rows (same width); the new tiles fade in like any revealed ground.
      const c = s.clearing, H = s.size.height;
      const untouched = !Object.keys(s.revealed).length && c.y1 - c.y0 + 1 < H;
      if (untouched) {
        const h = c.y1 - c.y0 + 1, add = h;
        const up = Math.min(c.y0, Math.floor(add / 2));
        const down = Math.min(H - 1 - c.y1, add - up);
        const now = s.lastUpdated || s.createdAt;
        for (let y = c.y0 - up; y <= c.y1 + down; y++) {
          if (y >= c.y0 && y <= c.y1) continue;
          for (let x = c.x0; x <= c.x1; x++) s.revealed[x + ',' + y] = now;
        }
        s.clearing = { x0: c.x0, x1: c.x1, y0: c.y0 - up, y1: c.y1 + down };
      }
    }
    s.version = SAVE_VERSION;
  }

  /** A brand-new forest. Players start with no creatures (unless tuning lists starters). */
  static newForest(content, now, seed) {
    const s = (seed == null ? Math.floor(Math.random() * 0xffffffff) : seed) >>> 0;
    const state = {
      version: SAVE_VERSION, forestID: '', seed: s, rng: s, size: { ...content.tuning.grid },
      createdAt: now, customName: null, creatures: [], placements: [], slots: [], spawns: [],
      // Back-date the spawn clock so a new forest starts with a few things to find.
      plantedSeeds: [], inventory: {}, discovered: [], pity: {},
      lastSpawnTick: now - content.tuning.spawns.tickSeconds * 1000 * 6, lastUpdated: now,
      debugTimeOffset: 0, geodes: [], visitors: [], soilBoosts: [], nextGlimmer: false,
      lastWandererDay: Game.dayNumber(now),
    };
    // Start as a small clearing in the middle of the full forest.
    const c = content.tuning.clearing || {};
    const W = state.size.width, H = state.size.height;
    const cw = Math.min(W, c.startWidth || W), ch = Math.min(H, c.startHeight || H);
    const x0 = Math.floor((W - cw) / 2), y0 = Math.floor((H - ch) / 2);
    state.clearing = { x0, y0, x1: x0 + cw - 1, y1: y0 + ch - 1 };
    state.revealed = {};
    state.milestones = {};
    state.landmarks = [];
    state.lastExpansionAt = now;
    state.minUnlockedSlots = 0;
    const tut = content.tuning.tutorial;
    state.tutorial = { step: tut && tut.enabled ? 'forage' : 'done' };
    // The tutorial keeps the opening calm; otherwise back-date spawns so there's something to find.
    if (state.tutorial.step !== 'done') state.lastSpawnTick = now;
    const g = new Game(content, state);
    state.forestID = g.rng.uuid();
    state.announcedSlots = g.unlockedSlots(now);
    for (const typeID of content.tuning.starterCreatures) state.creatures.push(g.rollCreature(typeID, 'starter', now, false));
    if (state.tutorial.step === 'forage') g.enterTutorialStep('forage', now);
    g.advance(now);
    g.events = [];
    return g;
  }

  // ---- clearing + landmarks
  get clearing() { return this.state.clearing; }
  inClearing(t) { const c = this.state.clearing; return t.x >= c.x0 && t.x <= c.x1 && t.y >= c.y0 && t.y <= c.y1; }
  clearingTiles() {
    const c = this.state.clearing, out = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) out.push({ x, y });
    return out;
  }
  /** 0 outside the clearing; newly revealed tiles fade influence in over revealRampSeconds. */
  revealFactor(x, y, now) {
    if (!this.inClearing({ x, y })) return 0;
    const at = this.state.revealed[x + ',' + y];
    if (at == null) return 1;
    const ramp = ((this.t.expansion && this.t.expansion.revealRampSeconds) || 0) * 1000;
    return ramp <= 0 ? 1 : Math.min(1, Math.max(0, (now - at) / ramp));
  }
  landmarkAt(t) { return this.state.landmarks.find((l) => sameTile(l.tile, t)) || null; }

  /** Puts data-defined landmarks (the old log) on the map, once. */
  placeLandmarks() {
    for (const def of this.content.landmarks || []) {
      if (this.state.landmarks.some((l) => l.id === def.id)) continue;
      const c = this.state.clearing;
      let tile = { x: Math.floor((c.x0 + c.x1) / 2), y: Math.floor((c.y0 + c.y1) / 2) };
      if (def.position && typeof def.position === 'object') tile = { ...def.position };
      // Clear the spot (spawns move out of the way; creatures are nudged to a neighbour).
      this.state.spawns = this.state.spawns.filter((sp) => !sameTile(sp.tile, tile));
      this.state.plantedSeeds = this.state.plantedSeeds.filter((sp) => !sameTile(sp.tile, tile));
      this.state.landmarks.push({ id: def.id, tile });
      for (const p of this.activePlacements) if (sameTile(p.tile, tile)) p.tile = this.freeNear(tile) || p.tile;
      if (def.inGuide !== false) this.discover('landmark:' + def.id.replace(/^landmark\./, ''));
    }
  }

  /** Nearest free clearing tile to `t` (ring search). */
  freeNear(t, avoid = []) {
    for (let r = 1; r < 20; r++) {
      const ring = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        ring.push({ x: t.x + dx, y: t.y + dy });
      }
      ring.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y));
      const hit = ring.find((p) => this.isFree(p) && !avoid.some((q) => sameTile(q, p)));
      if (hit) return hit;
    }
    return null;
  }

  // ---- slots
  /** How many creature slots are open: by days since the forest began (configurable). */
  unlockedSlots(now) {
    const days = (now - this.state.createdAt) / DAY;
    const unlockDays = (this.t.slotUnlocks && this.t.slotUnlocks.unlockDays) || [];
    const byAge = unlockDays.length ? unlockDays.filter((d) => days >= d).length : this.t.placementSlots;
    return Math.min(this.t.placementSlots, Math.max(this.state.minUnlockedSlots || 0, byAge, 1));
  }
  /** Day (1-based, as players count) a slot index opens on. */
  slotUnlockDay(i) {
    const d = (this.t.slotUnlocks && this.t.slotUnlocks.unlockDays) || [];
    return d[i] != null ? d[i] + 1 : null;
  }
  openSlots(now) { return this.state.slots.filter((s) => s.kind === 'normal').slice(0, this.unlockedSlots(now)); }

  // ---- tutorial
  get tutorialStep() { return this.state.tutorial.step; }
  get inTutorial() { return this.state.tutorial.step !== 'done'; }

  /** Spawns a tutorial item next to the log (kept until picked). */
  tutorialSpawn(itemID, extra, now) {
    const log = this.state.landmarks[0];
    const centre = log ? log.tile : { x: Math.floor((this.clearing.x0 + this.clearing.x1) / 2), y: Math.floor((this.clearing.y0 + this.clearing.y1) / 2) };
    const prefer = { forage: [1, 0], pickClover: [-1, 1], dig: [0, -2] }[this.tutorialStep] || [1, 1];
    let tile = { x: centre.x + prefer[0], y: centre.y + prefer[1] };
    if (!this.isFree(tile)) {
      // Natural spawns don't block the tutorial: move them aside.
      const sp = this.spawnAt(tile);
      if (sp && !sp.keep && this.inClearing(tile)) this.state.spawns = this.state.spawns.filter((x) => x !== sp);
      if (!this.isFree(tile)) tile = this.freeNear(centre);
    }
    if (!tile) return null;
    const spawn = { id: this.rng.uuid(), itemID, tile, spawnedAt: now, keep: true, tutorial: true, ...extra };
    this.state.spawns.push(spawn);
    return spawn;
  }

  enterTutorialStep(step, now) {
    const tut = this.state.tutorial;
    tut.step = step;
    if (step === 'forage') tut.spawnID = this.tutorialSpawn('mushroom.brown-button-cap', {}, now)?.id;
    if (step === 'pickClover') tut.spawnID = this.tutorialSpawn('plant.clover', { forced: [{ item: 'seed.mystery-seed', count: 1 }] }, now)?.id;
    if (step === 'dig') tut.spawnID = this.tutorialSpawn('geode.pebble-geode', { forcedCreature: { rarity: 'common' }, wiggle: true }, now)?.id;
    if (!['forage', 'pickClover', 'dig'].includes(step)) tut.spawnID = null;
    this.events.push({ type: 'tutorial', step });
  }

  /** Where the tutorial wants the player to look: a tile, or nothing (UI button steps). */
  tutorialTarget() {
    const tut = this.state.tutorial;
    if (tut.spawnID) { const sp = this.state.spawns.find((x) => x.id === tut.spawnID); if (sp) return sp.tile; }
    if (tut.step === 'watch' && tut.placementID) { const p = this.state.placements.find((x) => x.id === tut.placementID); if (p) return p.tile; }
    return null;
  }

  finishTutorial() {
    this.state.tutorial = { step: 'done' };
    this.events.push({ type: 'tutorial', step: 'done' });
    if ((this.content.tasks || []).length) this.events.push({ type: 'tasksIntro' });
  }

  // ---- starter tasks (Content/tasks.json)
  bump(counter, n = 1) { this.state.counters[counter] = (this.state.counters[counter] || 0) + n; }

  counterValue(name) {
    if (name === 'guide') return this.discovered.size;
    if (name === 'creatures') return this.state.creatures.length;
    if (name === 'placed') return this.activePlacements.length;
    return this.state.counters[name] || 0;
  }

  /** The next few unclaimed tasks, with progress. */
  activeTasks() {
    const cfg = this.t.tasks || {};
    if (cfg.startAfterTutorial !== false && this.inTutorial) return [];
    const claimed = new Set(this.state.tasks.claimed);
    return (this.content.tasks || []).filter((t) => !claimed.has(t.id)).slice(0, cfg.visibleAtOnce || 3)
      .map((t) => { const v = Math.min(t.target, this.counterValue(t.counter)); return { ...t, progress: v, done: v >= t.target }; });
  }

  claimTask(id, now) {
    const task = this.activeTasks().find((t) => t.id === id);
    if (!task) throw new GameError('That task isn\'t available.');
    if (!task.done) throw new GameError('Not finished yet.');
    this.state.tasks.claimed.push(id);
    return this.grant((task.reward || []).map((r) => ({ item: r.item, count: r.count || 1 })));
  }

  checkTasks() {
    for (const t of this.activeTasks()) {
      if (t.done && !this.state.tasks.announced.includes(t.id)) {
        this.state.tasks.announced.push(t.id);
        this.events.push({ type: 'taskDone', task: t });
      }
    }
  }

  /** Keeps the tutorial on track (e.g. a tutorial item went missing) and advances timed steps. */
  tutorialTick(now) {
    const tut = this.state.tutorial;
    if (['forage', 'pickClover', 'dig'].includes(tut.step) && !this.state.spawns.some((x) => x.id === tut.spawnID)) {
      this.enterTutorialStep(tut.step, now);
    }
    if (tut.step === 'watch') {
      const p = this.state.placements.find((x) => x.id === tut.placementID);
      if (!p || this.level(p, now) >= 1) this.enterTutorialStep('wrap', now);
    }
  }

  /** Serializable snapshot. */
  toJSON() { return { ...this.state, discovered: [...this.discovered] }; }

  /** If the configured map size changed since this forest was saved, resize it to fit. */
  fitToGrid() {
    const size = this.t.grid;
    const s = this.state;
    if (s.size.width === size.width && s.size.height === size.height) return;
    s.size = { ...size };
    const inside = (t) => t.x >= 0 && t.y >= 0 && t.x < size.width && t.y < size.height;
    s.spawns = s.spawns.filter((x) => inside(x.tile));
    s.plantedSeeds = s.plantedSeeds.filter((x) => inside(x.tile));
    s.visitors = s.visitors.filter((x) => inside(x.tile));
    for (const p of s.placements) {
      p.tile = { x: Math.min(Math.max(0, p.tile.x), size.width - 1), y: Math.min(Math.max(0, p.tile.y), size.height - 1) };
    }
  }

  normalizeSlots() {
    const normal = this.state.slots.filter((s) => s.kind === 'normal').length;
    for (let i = normal; i < this.t.placementSlots; i++) this.state.slots.push({ kind: 'normal', placementID: null });
    let excess = normal - this.t.placementSlots;
    if (excess > 0) {
      this.state.slots = this.state.slots.filter((s) => {
        if (excess > 0 && s.kind === 'normal' && !s.placementID) { excess--; return false; }
        return true;
      });
    }
  }

  // ---- clock: time of day + weather
  now(real = Date.now()) { return real + this.state.debugTimeOffset; }
  debugSkip(seconds) { this.state.debugTimeOffset += seconds * 1000; }
  get clock() { return this.t.clock || { nightStartHour: 20, nightEndHour: 6, rainChance: 0.25, weatherBlockHours: 2 }; }
  static dayNumber(t) { return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / DAY); }

  /** Night by the forest's clock (local time), or anywhere a creature makes it night. */
  isNight(t, tile = null) {
    const c = this.clock;
    const h = new Date(t).getHours();
    const night = c.nightStartHour > c.nightEndHour ? (h >= c.nightStartHour || h < c.nightEndHour) : (h >= c.nightStartHour && h < c.nightEndHour);
    if (night) return true;
    return tile ? this.effects('night', tile).length > 0 : false;
  }

  /** Deterministic weather: each block of hours is rainy or dry. */
  isRaining(t) {
    const block = Math.floor(t / (Math.max(0.25, this.clock.weatherBlockHours) * HOUR));
    return hash32(this.state.seed, block, 0xaa17) / 4294967296 < this.clock.rainChance;
  }

  // ---- creature effects
  species(p) { const c = this.creature(p.creatureID); return c ? this.content.creatures[c.typeID] : null; }

  activeEffects(type) {
    const out = [];
    for (const p of this.activePlacements) for (const e of this.species(p)?.effects || []) if (e.type === type) out.push([e, p]);
    return out;
  }

  /** Effects of one type that apply to a tile (radius, forest-wide, or own tile). */
  effects(type, tile) {
    return this.activeEffects(type).filter(([e, p]) => {
      if (e.scope === 'forest') return true;
      if (e.scope === 'tile') return sameTile(p.tile, tile);
      return dist(tile, p.tile) < this.stats.reach(p.radius);
    }).map(([e]) => e);
  }

  mult(effects) { return effects.reduce((a, e) => a * (e.mult ?? 1), 1); }

  static effectMatches(e, item) {
    if (e.category && e.category !== item.category) return false;
    if (e.rarities && !e.rarities.includes(item.rarity)) return false;
    if (e.items && !e.items.includes(item.id)) return false;
    return true;
  }

  /** Placements with radius links (Mycelium Weaver) and ramp speed (Grove Heart) applied. */
  effectivePlacements() {
    const links = this.activeEffects('radiusLink');
    const speeds = this.activeEffects('rampSpeed');
    if (!links.length && !speeds.length) return this.state.placements;
    return this.state.placements.map((p) => {
      const q = { ...p };
      let bonus = 0;
      for (const [e, src] of links) if (src.id !== p.id && dist(src.tile, p.tile) <= (e.range || 0)) bonus = Math.max(bonus, e.bonus || 0);
      q.radius += bonus;
      let m = 1;
      for (const [e, src] of speeds) if (dist(p.tile, src.tile) < this.stats.reach(src.radius)) m = Math.max(m, e.mult || 1);
      if (m !== 1) q.rampSeconds = (p.rampSeconds ?? this.t.rampSecondsToFull) / m;
      return q;
    });
  }

  // ---- stats
  activeBoosts(now) { return this.state.soilBoosts.filter((b) => now >= b.appliedAt && (b.expiresAt == null || now < b.expiresAt)); }

  statField(now) {
    const f = this.stats.field(this.state.size, this.effectivePlacements(), now);
    for (const b of this.activeBoosts(now)) if (this.inBounds(b.tile)) f.add(b.tile.x, b.tile.y, b.stats);
    // Nothing reaches past the treeline; newly revealed tiles fade in.
    const K = f.keys.length, W = this.state.size.width;
    for (let y = 0; y < this.state.size.height; y++) for (let x = 0; x < W; x++) {
      const m = this.revealFactor(x, y, now);
      if (m >= 1) continue;
      const o = (y * W + x) * K;
      for (let i = 0; i < K; i++) f.values[o + i] *= m;
    }
    f.clamp(this.t.statCap);
    return f;
  }
  field(now) { return this.statCache || (this.statCache = this.statField(now)); }

  tileStats(tile, now) {
    const s = this.stats.statsAt(tile, this.effectivePlacements(), now);
    for (const b of this.activeBoosts(now)) if (sameTile(b.tile, tile)) for (const k in b.stats) s[k] = (s[k] || 0) + b.stats[k];
    const m = this.revealFactor(tile.x, tile.y, now);
    for (const k in s) s[k] = Math.min(this.t.statCap, Math.max(0, s[k] * m));
    return s;
  }

  level(p, now) {
    const eff = this.effectivePlacements().find((q) => q.id === p.id) || p;
    return this.stats.level(eff, now);
  }

  /** Ground sprites forced by creature effects (Hollow Digger's cavern, Bog Wisp's ponds). */
  groundOverrides(field) {
    const out = new Map();
    for (const [e, p] of this.activeEffects('groundOverride')) {
      if (!e.sprite) continue;
      if (e.scope === 'tile') { out.set(p.tile.x + ',' + p.tile.y, e.sprite); continue; }
      const reach = this.stats.reach(p.radius), r = Math.ceil(reach);
      for (let y = p.tile.y - r; y <= p.tile.y + r; y++) for (let x = p.tile.x - r; x <= p.tile.x + r; x++) {
        if (!this.inClearing({ x, y }) || Math.hypot(x - p.tile.x, y - p.tile.y) >= reach) continue;
        if (e.when && !groupMatches(e.when, field.statsAt(x, y))) continue;
        out.set(x + ',' + y, e.sprite);
      }
    }
    return out;
  }

  // ---- time passing
  advance(now) {
    const report = { spawned: 0, despawned: 0, ticks: 0, visitors: 0 };
    this.state.placements = this.state.placements.filter((p) => {
      const end = this.stats.fullyDecayedAt(p);
      return end == null || end > now;
    });
    this.state.soilBoosts = this.state.soilBoosts.filter((b) => b.expiresAt == null || b.expiresAt > now);
    const tick = Math.max(1, this.t.spawns.tickSeconds) * 1000;
    let ticks = Math.floor((now - this.state.lastSpawnTick) / tick);
    const max = this.t.spawns.maxCatchUpTicks;
    if (ticks > max) {
      this.state.lastSpawnTick += (ticks - max) * tick;
      ticks = max;
    }
    for (let i = 0; i < ticks; i++) {
      const t = this.state.lastSpawnTick + tick;
      report.despawned += this.expireSpawns(t);
      report.spawned += this.spawnTick(t);
      this.state.lastSpawnTick = t;
      report.ticks++;
    }
    report.despawned += this.expireSpawns(now);

    // Wanderers: one check per forest day.
    const today = Game.dayNumber(now);
    const last = this.state.lastWandererDay ?? today;
    const first = Math.max(last + 1, today - ((this.t.wanderers && this.t.wanderers.maxCatchUpDays) || 7) + 1);
    for (let d = first; d <= today; d++) report.visitors += this.checkWanderers(now);
    this.state.lastWandererDay = today;

    this.state.lastUpdated = now;
    this.statCache = this.statField(now);
    this.checkProgress(now);
    return report;
  }

  // ---- progression: slots, blend, expansion, first-uncommon hint
  checkProgress(now) {
    const s = this.state;
    if (this.inTutorial) this.tutorialTick(now);
    const open = this.unlockedSlots(now);
    if (open > (s.announcedSlots || 0)) {
      s.announcedSlots = open;
      this.events.push({ type: 'slotUnlocked', count: open, max: this.t.placementSlots });
    }
    if (!s.milestones.blend) {
      const tiles = this.blendedTiles(now);
      if (tiles.length) { s.milestones.blend = now; this.events.push({ type: 'blend', tiles }); }
    }
    if (!this.inTutorial) this.checkExpansion(now);
    this.checkTasks();
    if (!s.milestones.uncommonHint) {
      const tile = this.firstUncommonTile(now);
      if (tile) { s.milestones.uncommonHint = now; this.events.push({ type: 'uncommonHint', tile }); }
    }
  }

  /** Tiles where at least two placed creatures each contribute blend.minEach or more. */
  blendedTiles(now) {
    const active = this.effectivePlacements().filter((p) => p.removedAt == null);
    if (active.length < 2) return [];
    const minEach = (this.t.blend && this.t.blend.minEach) || 3;
    const out = [];
    for (const t of this.clearingTiles()) {
      const m = this.revealFactor(t.x, t.y, now);
      let n = 0;
      for (const p of active) {
        const f = this.stats.falloff(dist(t, p.tile), p.radius);
        if (f <= 0) continue;
        const amount = Object.values(p.contributions).reduce((a, v) => a + Math.max(0, v), 0) * this.stats.level(p, now) * f * m;
        if (amount >= minEach) n++;
      }
      if (n >= 2) out.push(t);
    }
    return out;
  }

  expansionReady(now) {
    const e = this.t.expansion;
    if (!e) return false;
    const c = this.clearing, s = this.state.size;
    if (c.x0 <= 0 && c.y0 <= 0 && c.x1 >= s.width - 1 && c.y1 >= s.height - 1) return false;
    if (now - (this.state.lastExpansionAt || 0) < (e.minHoursBetween || 0) * HOUR) return false;
    const field = this.field(now);
    const results = (e.conditions || []).map((cond) => {
      if (cond.type === 'tilesAboveThreshold') {
        const tiles = this.clearingTiles();
        const above = tiles.filter((t) => Math.max(...CORE_STATS.map((k) => field.statsAt(t.x, t.y)[k] || 0)) >= cond.threshold).length;
        return above / Math.max(1, tiles.length) >= cond.fraction;
      }
      if (cond.type === 'slotsUnlocked') return this.unlockedSlots(now) >= cond.count;
      return false;
    });
    return e.mode === 'all' ? results.length > 0 && results.every(Boolean) : results.some(Boolean);
  }

  /** Grows the clearing by one ring (clipped to the full forest). New tiles fade in from 0. */
  expand(now) {
    const c = this.clearing, s = this.state.size;
    const r = (this.t.expansion && this.t.expansion.ringTiles) || 1;
    const next = { x0: Math.max(0, c.x0 - r), y0: Math.max(0, c.y0 - r), x1: Math.min(s.width - 1, c.x1 + r), y1: Math.min(s.height - 1, c.y1 + r) };
    const added = [];
    for (let y = next.y0; y <= next.y1; y++) for (let x = next.x0; x <= next.x1; x++) {
      if (!this.inClearing({ x, y })) { this.state.revealed[x + ',' + y] = now; added.push({ x, y }); }
    }
    this.state.clearing = next;
    this.state.lastExpansionAt = now;
    this.statCache = this.statField(now);
    this.events.push({ type: 'expansion', tiles: added });
    return added;
  }

  checkExpansion(now) { if (this.expansionReady(now)) this.expand(now); }

  /** First open tile whose stats meet an Uncommon spawn's requirements (ignores time/weather). */
  firstUncommonTile(now) {
    const rarity = (this.t.uncommonHint && this.t.uncommonHint.rarity) || 'uncommon';
    const items = this.content.spawnableItems.filter((i) => i.rarity === rarity && i.spawn.requires && Object.keys(i.spawn.requires).length);
    const field = this.field(now);
    for (const t of this.clearingTiles()) {
      if (this.landmarkAt(t)) continue;
      const st = field.statsAt(t.x, t.y);
      if (items.some((i) => groupMatches(i.spawn.requires, st))) return t;
    }
    return null;
  }

  takeEvents() { const e = this.events; this.events = []; return e; }

  lifetime(itemID) {
    const h = this.content.items[itemID]?.spawn?.lifetimeHours;
    return h != null ? h * HOUR : this.t.spawns.lifetimeSeconds * 1000;
  }

  expireSpawns(t) {
    const before = this.state.spawns.length;
    this.state.spawns = this.state.spawns.filter((s) => { const life = this.lifetime(s.itemID); return s.keep || life <= 0 || t - s.spawnedAt < life; });
    return before - this.state.spawns.length;
  }

  spawnTick(t) {
    let made = 0;
    const st = this.t.spawns;
    // The spawn cap scales with how much of the forest is open.
    const c = this.clearing, area = (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
    const cap = Math.min(st.maxTotal, Math.max(st.minCap || 3, Math.round(area * (st.maxPerOpenTile || 0.1))));
    for (let i = 0; i < st.attemptsPerTick; i++) {
      if (this.state.spawns.length >= cap) break;
      if (!this.rng.chance(st.spawnChance)) continue;
      const tile = { x: this.rng.int(c.x0, c.x1), y: this.rng.int(c.y0, c.y1) };
      if (!this.isFree(tile)) continue;
      const item = this.pickSpawn(tile, t);
      if (item) {
        this.state.spawns.push({ id: this.rng.uuid(), itemID: item.id, tile, spawnedAt: t });
        made++;
      }
    }
    return made;
  }

  /**
   * Effective spawn weight for every item that qualifies on a tile at time `t`.
   *  - Gates (weight 0): minimum stats, day/night, and for wild spawns rain + one-at-a-time.
   *  - Multiplier = 1 + Σ statScaling% × max(0, tile stat − item minimum), clamped to
   *    spawns.scaling.minMultiplier..maxMultiplier. Effective = base × multiplier.
   *  - Creature effects (spawn-weight bonuses) multiply after the clamp; minimum-lowering and
   *    stat-substitute effects also apply to the scaling.
   * opts.seed: choosing what a Mystery Seed grows into (rain/one-at-a-time don't apply).
   * opts.items: limit to these items.
   */
  spawnDetails(tile, t, opts = {}) {
    const s = this.tileStats(tile, t);
    const night = this.isNight(t, tile);
    const raining = this.isRaining(t);
    const weightFx = this.effects('spawnWeight', tile);
    const offsetFx = this.effects('requirementOffset', tile);
    const subFx = this.effects('statSubstitute', tile);
    const onMap = new Set(this.state.spawns.map((x) => x.itemID));
    const sc = (this.t.spawns && this.t.spawns.scaling) || {};
    const lo = sc.minMultiplier ?? 0.25, hi = sc.maxMultiplier ?? 4;
    const out = [];
    for (const item of opts.items || this.content.spawnableItems) {
      const rule = item.spawn;
      if (!rule) continue;
      if (rule.time === 'night' && !night) continue;
      if (rule.time === 'day' && night) continue;
      if (!opts.seed && rule.rain && !raining) continue;
      if (!opts.seed && rule.oneAtATime && onMap.has(item.id)) continue;
      const req = rule.requires || {};
      const stats = new Set([...Object.keys(req), ...Object.keys(rule.statScaling || {})]);
      let ok = true;
      const mins = {}, vals = {};
      for (const stat of stats) {
        const b = { ...(req[stat] || {}) };
        for (const e of offsetFx) if (e.stat === stat && Game.effectMatches(e, item) && b.min != null) b.min = Math.max(0, b.min + (e.offset || 0));
        let v = s[stat] || 0;
        for (const e of subFx) if (e.from === stat && Game.effectMatches(e, item) && e.to) v = Math.max(v, s[e.to] || 0);
        if (req[stat] && !boundMatches(b, v)) { ok = false; break; }
        mins[stat] = b.min || 0;
        vals[stat] = v;
      }
      if (!ok) continue;
      let raw = 1;
      for (const stat in rule.statScaling || {}) raw += (rule.statScaling[stat] / 100) * Math.max(0, vals[stat] - mins[stat]);
      const mult = Math.min(hi, Math.max(lo, raw));
      let fx = 1;
      for (const e of weightFx) if (Game.effectMatches(e, item)) fx *= e.mult ?? 1;
      const weight = rule.baseWeight * mult * fx;
      if (weight > 0) out.push({ item, base: rule.baseWeight, rawMult: raw, mult, clamped: raw !== mult, fx, weight });
    }
    return out;
  }

  spawnWeights(tile, t) { return this.spawnDetails(tile, t).map((d) => [d.item, d.weight]); }

  /**
   * Category weights for a tile: spawns.categoryWeights × a stat multiplier, so a category's own
   * stats (spawns.categoryScaling, % per point) make it likelier there. E.g. Stone/Depth from
   * Geode Critters tilt the area towards geodes. Clamped to categoryScaling.min/maxMultiplier.
   */
  categoryDetails(details, stats) {
    const cw = (this.t.spawns && this.t.spawns.categoryWeights) || {};
    const cs = (this.t.spawns && this.t.spawns.categoryScaling) || {};
    const lo = cs.minMultiplier ?? 0.25, hi = cs.maxMultiplier ?? 6;
    const cats = [...new Set(details.map((d) => d.item.category))];
    const rows = cats.map((c) => {
      let raw = 1;
      for (const stat in cs[c] || {}) raw += (cs[c][stat] / 100) * ((stats && stats[stat]) || 0);
      const mult = Math.min(hi, Math.max(lo, raw));
      return { category: c, base: cw[c] ?? 1, mult, weight: (cw[c] ?? 1) * mult };
    });
    const total = rows.reduce((x, r) => x + r.weight, 0) || 1;
    for (const r of rows) r.share = r.weight / total;
    return rows;
  }

  categoryOdds(details, stats) {
    return Object.fromEntries(this.categoryDetails(details, stats).map((r) => [r.category, r.share]));
  }

  /** Category first (mushroom / plant / geode, tilted by the tile's stats), then the item within it by effective weight. */
  pickSpawn(tile, t) {
    const details = this.spawnDetails(tile, t);
    if (!details.length) return null;
    const cats = this.categoryDetails(details, this.tileStats(tile, t));
    const cat = weightedPick(cats.map((r) => [r.category, r.weight]), this.rng);
    return weightedPick(details.filter((d) => d.item.category === cat).map((d) => [d.item, d.weight]), this.rng);
  }

  /** What a Mystery Seed planted on this tile now would grow into (plants it qualifies for). */
  seedDetails(tile, t) {
    const pool = this.content.itemsInGroup('plants').filter((i) => i.spawn);
    return this.spawnDetails(tile, t, { seed: true, items: pool });
  }

  choosePlant(tile, t) {
    const picked = weightedPick(this.seedDetails(tile, t).map((d) => [d.item, d.weight]), this.rng);
    return picked ? picked.id : null;
  }

  /** Growth-stage sprites for a planted seed: the chosen plant's own, else seed stages ending in the plant. */
  seedStages(seed) {
    const seedDef = this.content.items[seed.seedItemID];
    const base = (seedDef && seedDef.growthSprites) || ['__missing'];
    const plant = seed.plantID && this.content.items[seed.plantID];
    if (!plant) return base;
    if (plant.growthSprites && plant.growthSprites.length) return plant.growthSprites;
    return [...base.slice(0, -1), plant.sprite];
  }

  // ---- wanderers
  ownsSpecies(id) { return this.state.creatures.some((c) => c.typeID === id); }

  checkWanderers(t) {
    const field = this.statField(t);
    let arrived = 0;
    for (const def of this.content.creatureList) {
      if (def.source?.kind !== 'wanderer') continue;
      if (def.unique && this.ownsSpecies(def.id)) continue;
      if (this.state.visitors.some((v) => v.speciesID === def.id)) continue;
      const tiles = [];
      for (let y = 0; y < this.state.size.height; y++) for (let x = 0; x < this.state.size.width; x++) {
        if (this.isFree({ x, y }) && groupMatches(def.requires || {}, field.statsAt(x, y))) tiles.push({ x, y });
      }
      if (!tiles.length) continue;
      const tile = tiles[this.rng.int(0, tiles.length - 1)];
      const chance = (def.chance || 0) * this.mult(this.effects('creatureChance', tile).filter((e) => !e.family || e.family === def.family));
      if (this.rng.chance(chance)) {
        this.state.visitors.push({ id: this.rng.uuid(), speciesID: def.id, tile, arrivedAt: t });
        arrived++;
      }
    }
    return arrived;
  }

  visitorAt(t) { return this.state.visitors.find((v) => sameTile(v.tile, t)) || null; }

  befriend(visitorID, now) {
    const i = this.state.visitors.findIndex((v) => v.id === visitorID);
    if (i < 0) throw new GameError('Unknown creature.');
    const [v] = this.state.visitors.splice(i, 1);
    return this.grant([{ creature: this.makeCreature(v.speciesID, 'wanderer', now) }]);
  }

  // ---- finding creatures
  makeCreature(typeID, origin, now) {
    const force = this.state.nextGlimmer ? true : null;
    this.state.nextGlimmer = false;
    return this.rollCreature(typeID, origin, now, force);
  }

  /**
   * Rolls for a creature hiding in a source (mushroom, seed, geode). Candidates are species with
   * that source whose tile conditions are met; rarest are rolled first, first hit wins. A
   * per-family pity counter guarantees a find after enough misses.
   */
  findCreature(kind, sourceItem, tile, stats, now, plantedAt = null) {
    const candidates = this.content.creatureList.filter((def) => {
      const src = def.source;
      if (!src || src.kind !== kind) return false;
      if (src.items && sourceItem && !src.items.includes(sourceItem)) return false;
      if (!groupMatches(def.requires || {}, stats)) return false;
      if (def.plantedTime && (def.plantedTime === 'night') !== this.isNight(plantedAt ?? now, tile)) return false;
      if (def.unique && this.ownsSpecies(def.id)) return false;
      return true;
    });
    if (!candidates.length) return null;
    const chanceFx = tile ? this.effects('creatureChance', tile) : this.activeEffects('creatureChance').filter(([e]) => e.scope === 'forest').map(([e]) => e);
    let hit = null;
    for (const def of [...candidates].sort((a, b) => (a.chance || 0) - (b.chance || 0))) {
      const m = this.mult(chanceFx.filter((e) => !e.family || e.family === def.family));
      if (this.rng.chance((def.chance || 0) * m)) { hit = def; break; }
    }
    const key = candidates[0].family;
    const threshold = this.t.pity[key];
    if (threshold > 0) {
      if (!hit) {
        const misses = (this.state.pity[key] || 0) + 1;
        if (misses >= threshold) hit = candidates.reduce((a, b) => ((b.chance || 0) > (a.chance || 0) ? b : a));
        else this.state.pity[key] = misses;
      }
      if (hit) this.state.pity[key] = 0;
    }
    return hit ? this.makeCreature(hit.id, sourceItem, now) : null;
  }

  // ---- queries
  creature(id) { return this.state.creatures.find((c) => c.id === id) || null; }
  activePlacement(creatureID) { return this.state.placements.find((p) => p.creatureID === creatureID && p.removedAt == null) || null; }
  get activePlacements() { return this.state.placements.filter((p) => p.removedAt == null); }
  get placedCreatures() { return this.activePlacements.map((p) => this.creature(p.creatureID)).filter(Boolean); }
  get burrow() {
    const placed = new Set(this.activePlacements.map((p) => p.creatureID));
    return this.state.creatures.filter((c) => !placed.has(c.id));
  }
  get freeSlotCount() { return this.openSlots(this.now()).filter((s) => !s.placementID).length; }
  inBounds(t) { return t.x >= 0 && t.y >= 0 && t.x < this.state.size.width && t.y < this.state.size.height; }
  creatureAt(t) { return this.state.placements.find((p) => p.removedAt == null && sameTile(p.tile, t)) || null; }
  spawnAt(t) { return this.state.spawns.find((s) => sameTile(s.tile, t)) || null; }
  seedAt(t) { return this.state.plantedSeeds.find((s) => sameTile(s.tile, t)) || null; }
  isFree(t) { return this.inBounds(t) && this.inClearing(t) && !this.landmarkAt(t) && !this.creatureAt(t) && !this.spawnAt(t) && !this.seedAt(t) && !this.visitorAt(t); }
  seedProgress(seed, now) { return Math.min(1, Math.max(0, (now - seed.plantedAt) / (Math.max(1, seed.growSeconds) * 1000))); }

  // ---- creatures
  /** A new individual: rolls 60–100% of the species' maximum bonuses; glimmers +50% and +1 radius. */
  rollCreature(typeID, origin, now, forceGlimmer = null) {
    const def = this.content.creatures[typeID];
    const roll = this.t.creatureRoll || { bonusRange: [0.6, 1], glimmerBonusMult: 1.5, glimmerRadiusBonus: 1 };
    const glimmer = forceGlimmer == null ? this.rng.chance(this.t.glimmerChance) : forceGlimmer;
    const contributions = {};
    for (const stat in def?.bonuses || {}) {
      let v = def.bonuses[stat] * this.rng.range(...range(roll.bonusRange));
      if (glimmer) v *= roll.glimmerBonusMult;
      contributions[stat] = Math.round(v * 10) / 10;
    }
    for (const stat in def?.extraContributions || {}) {
      const v = def.extraContributions[stat];
      contributions[stat] = (contributions[stat] || 0) + (glimmer ? v * roll.glimmerBonusMult : v);
    }
    let radius = def?.radius ?? 2;
    if (glimmer) radius += roll.glimmerRadiusBonus;
    return {
      id: this.rng.uuid(), typeID, contributions, radius: Math.round(radius * 10) / 10,
      isGlimmer: glimmer, obtainedAt: now, nickname: null, origin, rampHours: def?.rampHours ?? null,
    };
  }

  discover(key) {
    if (this.discovered.has(key)) return false;
    this.discovered.add(key);
    return true;
  }

  place(creatureID, tile, now) {
    const c = this.creature(creatureID);
    if (!c) throw new GameError('Unknown creature.');
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (this.activePlacement(creatureID)) throw new GameError('That creature is already out in the forest.');
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    const slot = this.openSlots(now).find((s) => !s.placementID);
    if (!slot) throw new GameError('All open slots are full. Return a creature to the Burrow first.');
    let startLevel = 0;
    const old = this.state.placements.findIndex((p) => p.creatureID === creatureID && p.removedAt != null && sameTile(p.tile, tile));
    if (old >= 0) {
      startLevel = this.stats.level(this.state.placements[old], now);
      this.state.placements.splice(old, 1);
    }
    const rampHours = c.rampHours ?? this.content.creatures[c.typeID]?.rampHours;
    let rampSeconds = rampHours ? rampHours * 3600 : null;
    // The tutorial creature ramps fast the first time it's placed, so the player sees the land change.
    if (c.fastRampSeconds) { rampSeconds = c.fastRampSeconds; delete c.fastRampSeconds; }
    const p = {
      id: this.rng.uuid(), creatureID, tile: { ...tile }, contributions: { ...c.contributions },
      radius: c.radius, placedAt: now, startLevel, removedAt: null, rampSeconds,
    };
    this.state.placements.push(p);
    slot.placementID = p.id;
    this.bump('place');
    this.statCache = this.statField(now);
    const tut = this.state.tutorial;
    if (tut.step === 'place' && tut.creatureID === creatureID) {
      tut.placementID = p.id;
      this.enterTutorialStep('watch', now);
    }
    this.checkProgress(now);
  }

  recall(creatureID, now) {
    const p = this.activePlacement(creatureID);
    if (!p) throw new GameError('That creature is in the Burrow.');
    p.removedAt = now;
    for (const s of this.state.slots) if (s.placementID === p.id) s.placementID = null;
    this.statCache = this.statField(now);
  }

  rename(creatureID, name) {
    const c = this.creature(creatureID);
    if (!c) return;
    const t = (name || '').trim();
    c.nickname = t || null;
  }

  // ---- loot
  pityRoll(chance, key) {
    const threshold = key ? this.t.pity[key] : null;
    if (!threshold) return this.rng.chance(chance);
    const misses = this.state.pity[key] || 0;
    const hit = misses + 1 >= threshold || this.rng.chance(chance);
    this.state.pity[key] = hit ? 0 : misses + 1;
    return hit;
  }

  pickWeighted(list, rarityPity, rarityPityMin) {
    const ri = (id) => rarityIndex(this.content.items[id]?.rarity || 'common');
    let pool = list.filter((e) => e.weight > 0 && this.content.items[e.item]);
    let forced = false;
    const threshold = rarityPity ? this.t.pity[rarityPity] : null;
    if (rarityPity && rarityPityMin && threshold && (this.state.pity[rarityPity] || 0) + 1 >= threshold) {
      const better = pool.filter((e) => ri(e.item) >= rarityIndex(rarityPityMin));
      if (better.length) { pool = better; forced = true; }
    }
    const picked = weightedPick(pool.map((e) => [e.item, e.weight]), this.rng);
    if (picked && rarityPity && rarityPityMin && (forced || pool.some((e) => ri(e.item) >= rarityIndex(rarityPityMin)))) {
      const good = ri(picked) >= rarityIndex(rarityPityMin) || forced;
      this.state.pity[rarityPity] = good ? 0 : (this.state.pity[rarityPity] || 0) + 1;
    }
    return picked;
  }

  upgrade(id) {
    const def = this.content.items[id];
    const next = def && RARITIES[rarityIndex(def.rarity) + 1];
    if (!next) return id;
    const options = this.content.itemList.filter((i) => i.category === def.category && i.rarity === next);
    return options.length ? options[this.rng.int(0, options.length - 1)].id : id;
  }

  pickFromGroup(group, minRarity, rarityPity, rarityPityMin) {
    let pool = this.content.itemsInGroup(group);
    if (minRarity) pool = pool.filter((i) => rarityIndex(i.rarity) >= rarityIndex(minRarity));
    let forced = false;
    const threshold = rarityPity ? this.t.pity[rarityPity] : null;
    if (rarityPity && rarityPityMin && threshold && (this.state.pity[rarityPity] || 0) + 1 >= threshold) {
      const better = pool.filter((i) => rarityIndex(i.rarity) >= rarityIndex(rarityPityMin));
      if (better.length) { pool = better; forced = true; }
    }
    const picked = weightedPick(pool.map((i) => [i, (this.t.rarityWeights[i.rarity] ?? 1) * (i.lootWeight ?? 1)]), this.rng);
    if (!picked) return null;
    if (rarityPity && rarityPityMin) {
      const good = rarityIndex(picked.rarity) >= rarityIndex(rarityPityMin) || forced;
      this.state.pity[rarityPity] = good ? 0 : (this.state.pity[rarityPity] || 0) + 1;
    }
    return picked.id;
  }

  rollTable(id, origin, now, mods = {}) {
    const table = this.content.loot[id];
    if (!table) return [];
    const out = [];
    for (const r of table.rolls) {
      if (!this.pityRoll(r.chance == null ? 1 : r.chance, r.pity)) continue;
      let count = r.count ? this.rng.int(...range(r.count).map(Math.round)) : 1;
      if (r.seedDrop) count = Math.round(count * (mods.seedDropMult || 1));
      if (r.creature) out.push({ creature: this.rollCreature(r.creature, origin, now) });
      else if (r.item) { if (count > 0) out.push({ item: r.item, count }); }
      else if (r.pick) {
        let picked = this.pickWeighted(r.pick, r.rarityPity, r.rarityPityMin);
        if (picked && mods.gemUpgradeChance && this.rng.chance(mods.gemUpgradeChance)) picked = this.upgrade(picked);
        if (picked) out.push({ item: picked, count: Math.max(1, count) });
      } else if (r.group) {
        const picked = this.pickFromGroup(r.group, r.minRarity, r.rarityPity, r.rarityPityMin);
        if (picked && count > 0) out.push({ item: picked, count });
      }
      if (r.exclusive) break;
    }
    return out;
  }

  /** Adds pending loot to the forest. Returns results with `isNew` flags. */
  grant(pending) {
    return pending.map((p) => {
      if (p.item) {
        this.state.inventory[p.item] = (this.state.inventory[p.item] || 0) + p.count;
        const def = this.content.items[p.item];
        const isNew = !!def && def.inGuide !== false && this.discover('item:' + p.item);
        return { item: p.item, count: p.count, isNew };
      }
      this.state.creatures.push(p.creature);
      const isNew = this.discover(`creature:${p.creature.typeID}${p.creature.isGlimmer ? ':glimmer' : ''}`);
      return { creature: p.creature, isNew };
    });
  }

  /** Tap a wild spawn: pick a mushroom or plant, or dig up a geode. */
  collect(spawnID, now) {
    const i = this.state.spawns.findIndex((s) => s.id === spawnID);
    if (i < 0) throw new GameError('Unknown item.');
    const [spawn] = this.state.spawns.splice(i, 1);
    const def = this.content.items[spawn.itemID];
    if (!def) return [];
    const stats = this.tileStats(spawn.tile, now);
    let pending;
    if (def.category === 'geode') {
      // Dug geodes remember where they came from (decides which critters can be inside).
      const geode = { id: this.rng.uuid(), itemID: def.id, foundTile: { ...spawn.tile }, foundStats: stats, foundAt: now };
      if (spawn.forcedCreature) geode.forcedCreature = spawn.forcedCreature;
      this.state.geodes.push(geode);
      pending = [{ item: def.id, count: 1 }];
    } else {
      pending = def.onCollect
        ? this.rollTable(def.onCollect, def.id, now, { seedDropMult: this.mult(this.effects('seedDrops', spawn.tile)) })
        : [{ item: def.id, count: 1 }];
      if (def.category === 'mushroom') {
        const c = this.findCreature('mushroom', def.id, spawn.tile, stats, now);
        if (c) pending.push({ creature: c });
      }
    }
    for (const e of this.effects('bonusDrop', spawn.tile)) {
      if ((e.items || []).includes(def.id) && e.table && this.rng.chance(e.chance || 0)) pending.push(...this.rollTable(e.table, def.id, now));
    }
    // Guaranteed drops (tutorial): make sure each forced item is included at least once.
    for (const f of spawn.forced || []) {
      if (!pending.some((x) => x.item === f.item)) pending.push({ item: f.item, count: f.count || 1 });
    }
    if (def.inGuide !== false) this.discover('item:' + def.id);
    this.bump('collect');
    this.bump('collect:' + def.category);
    if (def.category === 'geode') this.bump('dig');
    const results = this.grant(pending);
    const tut = this.state.tutorial;
    if (spawn.tutorial && spawn.id === tut.spawnID) {
      const next = { forage: 'pickClover', pickClover: 'plant', dig: 'crack' }[tut.step];
      if (next) this.enterTutorialStep(next, now);
    }
    return results;
  }

  plantSeed(itemID, tile, now) {
    const def = this.content.items[itemID];
    if (!def) throw new GameError('Unknown item.');
    if (!def.onGrow) throw new GameError("That can't be planted.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    this.consume(itemID);
    const speed = this.mult(this.effects('seedGrowth', tile));
    const grow = this.rng.range(...range(this.t.seeds.growSeconds)) / Math.max(0.01, speed);
    // The plant is chosen now (tile stats + time of day at planting), so its growth stages can show it.
    const plantID = this.choosePlant(tile, now);
    this.state.plantedSeeds.push({ id: this.rng.uuid(), seedItemID: itemID, tile: { ...tile }, plantedAt: now, growSeconds: grow, plantID });
    this.bump('plant');
    if (this.state.tutorial.step === 'plant') this.enterTutorialStep('dig', now);
  }

  /** Harvest a grown seed: a Sproutling if one grew (depends on the tile), else a plant. */
  harvestSeed(id, now) {
    const i = this.state.plantedSeeds.findIndex((s) => s.id === id);
    if (i < 0) throw new GameError('Unknown item.');
    const seed = this.state.plantedSeeds[i];
    if (this.seedProgress(seed, now) < 1) throw new GameError("It isn't ready yet.");
    this.state.plantedSeeds.splice(i, 1);
    this.bump('harvest');
    const c = this.findCreature('seed', seed.seedItemID, seed.tile, this.tileStats(seed.tile, now), now, seed.plantedAt);
    if (c) return this.grant([{ creature: c }]);
    if (seed.plantID && this.content.items[seed.plantID]) return this.grant([{ item: seed.plantID, count: 1 }]);
    // Seeds planted before plants were chosen at planting time: fall back to the seed's loot table.
    const table = this.content.items[seed.seedItemID]?.onGrow;
    return table ? this.grant(this.rollTable(table, seed.seedItemID, now)) : [];
  }

  /** Crack a geode: first a roll for a Geode Critter (by where it was found), else its loot table. */
  crack(itemID, now, opts = {}) {
    const def = this.content.items[itemID];
    if (!def) throw new GameError('Unknown item.');
    if (!def.onCrack) throw new GameError("That can't be cracked.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    this.consume(itemID);
    this.bump('crack');
    // Geodes with a guaranteed creature (the tutorial geode) are cracked first.
    let gi = this.state.geodes.findIndex((g) => g.itemID === itemID && g.forcedCreature);
    if (gi < 0) gi = this.state.geodes.findIndex((g) => g.itemID === itemID);
    const found = gi >= 0 ? this.state.geodes.splice(gi, 1)[0] : null;
    if (found && found.forcedCreature) return this.crackGuaranteed(found, now, opts.family);
    const tile = found ? found.foundTile : null;
    const c = this.findCreature('geode', itemID, tile, found ? found.foundStats : {}, now);
    if (c) return this.grant([{ creature: c }]);
    const up = tile ? Math.max(0, ...this.effects('gemUpgrade', tile).map((e) => e.chance || 0)) : 0;
    return this.grant(this.rollTable(def.onCrack, itemID, now, { gemUpgradeChance: up }));
  }

  /** True if the next crack of this geode is the tutorial's guaranteed creature. */
  hasGuaranteedGeode(itemID) { return this.state.geodes.some((g) => g.itemID === itemID && g.forcedCreature); }

  /** The tutorial geode: a guaranteed creature of the given rarity, family random or player-chosen. */
  crackGuaranteed(found, now, family) {
    const cfg = this.t.tutorial || {};
    const families = cfg.families || ['fungling', 'sproutling', 'geodeCritter'];
    const fam = family && families.includes(family) ? family : families[this.rng.int(0, families.length - 1)];
    const rarity = found.forcedCreature.rarity || 'common';
    const pool = this.content.creatureList.filter((c) => c.family === fam && c.rarity === rarity);
    const def = pool[this.rng.int(0, pool.length - 1)];
    const c = this.makeCreature(def.id, found.itemID, now);
    if (cfg.rampSeconds) c.fastRampSeconds = cfg.rampSeconds;
    const results = this.grant([{ creature: c }]);
    const tut = this.state.tutorial;
    if (tut.step === 'crack') {
      tut.creatureID = c.id;
      this.enterTutorialStep('place', now);
    }
    return results;
  }

  /** Use an item from the bag. Soil boosts need a tile; a Moonfall Shard doesn't. */
  use(itemID, tile, now) {
    const def = this.content.items[itemID];
    if (!def || !def.use) throw new GameError("That can't be used.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    const use = def.use;
    if (use.type === 'soilBoost') {
      if (!tile || !this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
      this.consume(itemID);
      this.bump('use');
      this.state.soilBoosts.push({
        id: this.rng.uuid(), tile: { ...tile }, stats: { ...use.stats }, appliedAt: now,
        expiresAt: use.permanent ? null : now + (use.hours || 24) * HOUR,
      });
      this.statCache = this.statField(now);
      return use.text || def.name;
    }
    if (use.type === 'nextGlimmer') {
      this.consume(itemID);
      this.state.nextGlimmer = true;
      return 'The next creature you find will be a Glimmer.';
    }
    throw new GameError("That can't be used.");
  }

  consume(itemID) {
    const n = (this.state.inventory[itemID] || 0) - 1;
    if (n > 0) this.state.inventory[itemID] = n; else delete this.state.inventory[itemID];
  }

  // ---- naming
  get generatedName() {
    const f = this.field(this.state.lastUpdated);
    return forestName(this.content.nameParts, this.t.naming, f.means(), this.state.seed);
  }
  get forestName() { return this.state.customName || this.generatedName; }
  renameForest(name) {
    const t = (name || '').trim();
    this.state.customName = t || null;
  }

  // ---- debug
  debugGrant(itemID, count = 1) { this.state.inventory[itemID] = (this.state.inventory[itemID] || 0) + count; }
  debugGrantCreature(typeID, glimmer, now) { return this.grant([{ creature: this.rollCreature(typeID, 'debug', now, glimmer) }]); }
}

// ---------------------------------------------------------------- content

/** Content bundle produced by tools/build_web.py (same JSON as the iOS app). */
export class Content {
  constructor(bundle) {
    this.tuning = bundle.tuning;
    this.nameParts = bundle.nameParts;
    this.creatureList = bundle.creatures;
    this.creatures = Object.fromEntries(bundle.creatures.map((c) => [c.id, c]));
    this.itemList = bundle.items;
    this.items = Object.fromEntries(bundle.items.map((i) => [i.id, i]));
    this.loot = bundle.loot;
    this.tileRules = bundle.tileRules;
    this.spawnableItems = bundle.items.filter((i) => i.spawn);
    this.landmarks = bundle.landmarks || [];
    this.story = bundle.story || {};
    this.tasks = bundle.tasks || [];
  }
  familyName(id) { return this.creatureList.find((c) => c.family === id)?.familyName || id; }
  itemsInGroup(g) { return this.itemList.filter((i) => i.groups && i.groups.includes(g)); }
}
