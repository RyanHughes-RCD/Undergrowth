// Undergrowth web prototype — game logic.
// A JavaScript port of Packages/UndergrowthCore (the Swift package). Same data
// files, same rules; times are stored as epoch milliseconds.

export const CORE_STATS = ['damp', 'glow', 'bloom', 'verdure', 'stone', 'depth'];
export const RARITIES = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];
export const RARITY_NAMES = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', veryRare: 'Very rare', legendary: 'Legendary' };
export const rarityIndex = (r) => Math.max(0, RARITIES.indexOf(r));
/** Bumped to 2 for the spawn-table content: older forests are replanted. */
export const SAVE_VERSION = 2;

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
    this.normalizeSlots();
    this.fitToGrid();
    this.statCache = null;
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
    const g = new Game(content, state);
    state.forestID = g.rng.uuid();
    for (const typeID of content.tuning.starterCreatures) state.creatures.push(g.rollCreature(typeID, 'starter', now, false));
    g.advance(now);
    return g;
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
    f.clamp(this.t.statCap);
    return f;
  }
  field(now) { return this.statCache || (this.statCache = this.statField(now)); }

  tileStats(tile, now) {
    const s = this.stats.statsAt(tile, this.effectivePlacements(), now);
    for (const b of this.activeBoosts(now)) if (sameTile(b.tile, tile)) for (const k in b.stats) s[k] = (s[k] || 0) + b.stats[k];
    for (const k in s) s[k] = Math.min(this.t.statCap, Math.max(0, s[k]));
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
        if (!this.inBounds({ x, y }) || Math.hypot(x - p.tile.x, y - p.tile.y) >= reach) continue;
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
    return report;
  }

  lifetime(itemID) {
    const h = this.content.items[itemID]?.spawn?.lifetimeHours;
    return h != null ? h * HOUR : this.t.spawns.lifetimeSeconds * 1000;
  }

  expireSpawns(t) {
    const before = this.state.spawns.length;
    this.state.spawns = this.state.spawns.filter((s) => { const life = this.lifetime(s.itemID); return life <= 0 || t - s.spawnedAt < life; });
    return before - this.state.spawns.length;
  }

  spawnTick(t) {
    let made = 0;
    const st = this.t.spawns;
    for (let i = 0; i < st.attemptsPerTick; i++) {
      if (this.state.spawns.length >= st.maxTotal) break;
      if (!this.rng.chance(st.spawnChance)) continue;
      const tile = { x: this.rng.int(0, this.state.size.width - 1), y: this.rng.int(0, this.state.size.height - 1) };
      if (!this.isFree(tile)) continue;
      const item = weightedPick(this.spawnWeights(tile, t), this.rng);
      if (item) {
        this.state.spawns.push({ id: this.rng.uuid(), itemID: item.id, tile, spawnedAt: t });
        made++;
      }
    }
    return made;
  }

  /** What could spawn on a tile at time `t` (stats, day/night, rain, one-at-a-time, creature effects). */
  spawnWeights(tile, t) {
    const s = this.tileStats(tile, t);
    const night = this.isNight(t, tile);
    const raining = this.isRaining(t);
    const weightFx = this.effects('spawnWeight', tile);
    const offsetFx = this.effects('requirementOffset', tile);
    const subFx = this.effects('statSubstitute', tile);
    const onMap = new Set(this.state.spawns.map((x) => x.itemID));
    const out = [];
    for (const item of this.content.spawnableItems) {
      const rule = item.spawn;
      if (rule.time === 'night' && !night) continue;
      if (rule.time === 'day' && night) continue;
      if (rule.rain && !raining) continue;
      if (rule.oneAtATime && onMap.has(item.id)) continue;
      let ok = true;
      for (const stat in rule.requires || {}) {
        const b = { ...rule.requires[stat] };
        for (const e of offsetFx) if (e.stat === stat && Game.effectMatches(e, item) && b.min != null) b.min = Math.max(0, b.min + (e.offset || 0));
        let v = s[stat] || 0;
        for (const e of subFx) if (e.from === stat && Game.effectMatches(e, item) && e.to) v = Math.max(v, s[e.to] || 0);
        if (!boundMatches(b, v)) { ok = false; break; }
      }
      if (!ok) continue;
      let w = rule.baseWeight;
      for (const k in rule.statWeights || {}) w *= 1 + rule.statWeights[k] * (s[k] || 0) / 100;
      for (const e of weightFx) if (Game.effectMatches(e, item)) w *= e.mult ?? 1;
      if (w > 0) out.push([item, w]);
    }
    return out;
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
  get freeSlotCount() { return this.state.slots.filter((s) => s.kind === 'normal' && !s.placementID).length; }
  inBounds(t) { return t.x >= 0 && t.y >= 0 && t.x < this.state.size.width && t.y < this.state.size.height; }
  creatureAt(t) { return this.state.placements.find((p) => p.removedAt == null && sameTile(p.tile, t)) || null; }
  spawnAt(t) { return this.state.spawns.find((s) => sameTile(s.tile, t)) || null; }
  seedAt(t) { return this.state.plantedSeeds.find((s) => sameTile(s.tile, t)) || null; }
  isFree(t) { return this.inBounds(t) && !this.creatureAt(t) && !this.spawnAt(t) && !this.seedAt(t) && !this.visitorAt(t); }
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
    if (!this.inBounds(tile)) throw new GameError("That's outside the forest.");
    if (this.activePlacement(creatureID)) throw new GameError('That creature is already out in the forest.');
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    const slot = this.state.slots.find((s) => s.kind === 'normal' && !s.placementID);
    if (!slot) throw new GameError('All placement slots are full. Return a creature to the Burrow first.');
    let startLevel = 0;
    const old = this.state.placements.findIndex((p) => p.creatureID === creatureID && p.removedAt != null && sameTile(p.tile, tile));
    if (old >= 0) {
      startLevel = this.stats.level(this.state.placements[old], now);
      this.state.placements.splice(old, 1);
    }
    const rampHours = c.rampHours ?? this.content.creatures[c.typeID]?.rampHours;
    const p = {
      id: this.rng.uuid(), creatureID, tile: { ...tile }, contributions: { ...c.contributions },
      radius: c.radius, placedAt: now, startLevel, removedAt: null, rampSeconds: rampHours ? rampHours * 3600 : null,
    };
    this.state.placements.push(p);
    slot.placementID = p.id;
    this.statCache = this.statField(now);
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
      this.state.geodes.push({ id: this.rng.uuid(), itemID: def.id, foundTile: { ...spawn.tile }, foundStats: stats, foundAt: now });
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
    if (def.inGuide !== false) this.discover('item:' + def.id);
    return this.grant(pending);
  }

  plantSeed(itemID, tile, now) {
    const def = this.content.items[itemID];
    if (!def) throw new GameError('Unknown item.');
    if (!def.onGrow) throw new GameError("That can't be planted.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    if (!this.inBounds(tile)) throw new GameError("That's outside the forest.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    this.consume(itemID);
    const speed = this.mult(this.effects('seedGrowth', tile));
    const grow = this.rng.range(...range(this.t.seeds.growSeconds)) / Math.max(0.01, speed);
    this.state.plantedSeeds.push({ id: this.rng.uuid(), seedItemID: itemID, tile: { ...tile }, plantedAt: now, growSeconds: grow });
  }

  /** Harvest a grown seed: a Sproutling if one grew (depends on the tile), else a plant. */
  harvestSeed(id, now) {
    const i = this.state.plantedSeeds.findIndex((s) => s.id === id);
    if (i < 0) throw new GameError('Unknown item.');
    const seed = this.state.plantedSeeds[i];
    if (this.seedProgress(seed, now) < 1) throw new GameError("It isn't ready yet.");
    this.state.plantedSeeds.splice(i, 1);
    const c = this.findCreature('seed', seed.seedItemID, seed.tile, this.tileStats(seed.tile, now), now, seed.plantedAt);
    if (c) return this.grant([{ creature: c }]);
    const table = this.content.items[seed.seedItemID]?.onGrow;
    return table ? this.grant(this.rollTable(table, seed.seedItemID, now)) : [];
  }

  /** Crack a geode: first a roll for a Geode Critter (by where it was found), else its loot table. */
  crack(itemID, now) {
    const def = this.content.items[itemID];
    if (!def) throw new GameError('Unknown item.');
    if (!def.onCrack) throw new GameError("That can't be cracked.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    this.consume(itemID);
    const gi = this.state.geodes.findIndex((g) => g.itemID === itemID);
    const found = gi >= 0 ? this.state.geodes.splice(gi, 1)[0] : null;
    const tile = found ? found.foundTile : null;
    const c = this.findCreature('geode', itemID, tile, found ? found.foundStats : {}, now);
    if (c) return this.grant([{ creature: c }]);
    const up = tile ? Math.max(0, ...this.effects('gemUpgrade', tile).map((e) => e.chance || 0)) : 0;
    return this.grant(this.rollTable(def.onCrack, itemID, now, { gemUpgradeChance: up }));
  }

  /** Use an item from the bag. Soil boosts need a tile; a Moonfall Shard doesn't. */
  use(itemID, tile, now) {
    const def = this.content.items[itemID];
    if (!def || !def.use) throw new GameError("That can't be used.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    const use = def.use;
    if (use.type === 'soilBoost') {
      if (!tile || !this.inBounds(tile)) throw new GameError("That's outside the forest.");
      this.consume(itemID);
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
  }
  familyName(id) { return this.creatureList.find((c) => c.family === id)?.familyName || id; }
  itemsInGroup(g) { return this.itemList.filter((i) => i.groups && i.groups.includes(g)); }
}
