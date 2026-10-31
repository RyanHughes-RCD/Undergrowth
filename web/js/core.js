// Undergrowth web prototype — game logic.
// A JavaScript port of Packages/UndergrowthCore (the Swift package). Same data
// files, same rules; times are stored as epoch milliseconds.

export const CORE_STATS = ['damp', 'glow', 'bloom', 'verdure', 'stone', 'depth'];
export const RARITIES = ['common', 'uncommon', 'rare', 'epic'];
export const rarityIndex = (r) => Math.max(0, RARITIES.indexOf(r));
export const SAVE_VERSION = 1;

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

  falloff(d, radius) {
    const f = this.t.falloff;
    if (radius <= 0 || d > radius) return 0;
    const inner = radius * Math.max(0, Math.min(1, f.innerRadiusFraction));
    if (d <= inner) return 1;
    const t = 1 - (d - inner) / Math.max(0.0001, radius - inner);
    return f.curve === 'linear' ? t : t * t * (3 - 2 * t);
  }

  /** Ramp level 0..1 while placed; decays linearly after removal. */
  level(p, now) {
    const ramp = Math.max(1, this.t.rampSecondsToFull) * 1000;
    const decay = Math.max(1, this.t.decaySecondsToZero) * 1000;
    const rampAt = (t) => Math.min(1, p.startLevel + Math.max(0, t - p.placedAt) / ramp);
    if (p.removedAt == null || now <= p.removedAt) return rampAt(now);
    return Math.max(0, rampAt(p.removedAt) - (now - p.removedAt) / decay);
  }

  fullyDecayedAt(p) {
    if (p.removedAt == null) return null;
    return p.removedAt + this.level(p, p.removedAt) * Math.max(1, this.t.decaySecondsToZero) * 1000;
  }

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
    for (const k in out) out[k] = Math.min(this.t.statCap, Math.max(0, out[k]));
    return out;
  }

  /** Stats for every tile: Float64Array of width*height*keys. */
  field(size, placements, now) {
    const keys = [...CORE_STATS];
    for (const p of placements) for (const k in p.contributions) if (!keys.includes(k)) keys.push(k);
    const K = keys.length;
    const values = new Float64Array(size.width * size.height * K);
    for (const p of placements) {
      const lv = this.level(p, now);
      if (lv <= 0) continue;
      const r = Math.ceil(p.radius);
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
    const cap = this.t.statCap;
    for (let i = 0; i < values.length; i++) values[i] = Math.min(cap, Math.max(0, values[i]));
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

export class Game {
  constructor(content, state) {
    this.content = content;
    this.state = state;
    this.t = content.tuning;
    this.stats = new StatEngine(this.t);
    this.rng = new RNG(state);
    this.discovered = new Set(state.discovered);
    this.normalizeSlots();
    this.fitToGrid();
    this.statCache = null;
  }

  static newForest(content, now, seed) {
    const s = (seed == null ? Math.floor(Math.random() * 0xffffffff) : seed) >>> 0;
    const state = {
      version: SAVE_VERSION, forestID: '', seed: s, rng: s, size: { ...content.tuning.grid },
      createdAt: now, customName: null, creatures: [], placements: [], slots: [], spawns: [],
      // Back-date the spawn clock so a new forest starts with a few things to find.
      plantedSeeds: [], inventory: {}, discovered: [], pity: {},
      lastSpawnTick: now - content.tuning.spawns.tickSeconds * 1000 * 6, lastUpdated: now,
      debugTimeOffset: 0,
    };
    const g = new Game(content, state);
    state.forestID = g.rng.uuid();
    for (const typeID of content.tuning.starterCreatures) {
      state.creatures.push(g.rollCreature(typeID, 'starter', now, false));
    }
    return g;
  }

  /** Serializable snapshot. */
  toJSON() { return { ...this.state, discovered: [...this.discovered] }; }

  /** If the configured map size changed since this forest was saved, shrink/grow it to fit. */
  fitToGrid() {
    const size = this.t.grid;
    const s = this.state;
    if (s.size.width === size.width && s.size.height === size.height) return;
    s.size = { ...size };
    const inside = (t) => t.x >= 0 && t.y >= 0 && t.x < size.width && t.y < size.height;
    s.spawns = s.spawns.filter((x) => inside(x.tile));
    s.plantedSeeds = s.plantedSeeds.filter((x) => inside(x.tile));
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

  // ---- time
  now(real = Date.now()) { return real + this.state.debugTimeOffset; }
  debugSkip(seconds) { this.state.debugTimeOffset += seconds * 1000; }

  /** Brings the forest up to `now`: prunes decayed placements, replays missed spawn ticks (capped). */
  advance(now) {
    const report = { spawned: 0, despawned: 0, ticks: 0 };
    this.state.placements = this.state.placements.filter((p) => {
      const end = this.stats.fullyDecayedAt(p);
      return end == null || end > now;
    });
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
    this.state.lastUpdated = now;
    this.statCache = this.statField(now);
    return report;
  }

  expireSpawns(t) {
    const life = this.t.spawns.lifetimeSeconds * 1000;
    if (life <= 0) return 0;
    const before = this.state.spawns.length;
    this.state.spawns = this.state.spawns.filter((s) => t - s.spawnedAt < life);
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

  spawnWeights(tile, t) {
    const s = this.stats.statsAt(tile, this.state.placements, t);
    const out = [];
    for (const item of this.content.spawnableItems) {
      const w = spawnWeight(item.spawn, s, this.t.rarityWeights[item.rarity] ?? 1);
      if (w > 0) out.push([item, w]);
    }
    return out;
  }

  // ---- queries
  statField(now) { return this.stats.field(this.state.size, this.state.placements, now); }
  field(now) { return this.statCache || (this.statCache = this.statField(now)); }
  tileStats(tile, now) { return this.stats.statsAt(tile, this.state.placements, now); }
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
  isFree(t) { return this.inBounds(t) && !this.creatureAt(t) && !this.spawnAt(t) && !this.seedAt(t); }
  level(p, now) { return this.stats.level(p, now); }
  seedProgress(seed, now) { return Math.min(1, Math.max(0, (now - seed.plantedAt) / (Math.max(1, seed.growSeconds) * 1000))); }

  // ---- creatures
  rollCreature(typeID, origin, now, forceGlimmer = null) {
    const profile = this.t.creatureTraits[typeID];
    const def = this.content.creatures[typeID];
    const glimmer = forceGlimmer == null ? this.rng.chance(this.t.glimmerChance) : forceGlimmer;
    const contributions = {};
    const statKeys = def ? def.stats : Object.keys(profile ? profile.contribution : {});
    for (const stat of statKeys) {
      const [lo, hi] = range(profile && profile.contribution[stat] ? profile.contribution[stat] : [10, 20]);
      let v = this.rng.range(lo, hi);
      if (glimmer) v = Math.max(v, this.rng.range(lo, hi)) * (profile ? profile.glimmer.contributionMult : 1);
      contributions[stat] = Math.round(v * 10) / 10;
    }
    let radius = this.rng.range(...range(profile ? profile.radius : [3, 5]));
    if (glimmer) radius += profile ? profile.glimmer.radiusBonus : 0;
    return {
      id: this.rng.uuid(), typeID, contributions, radius: Math.round(radius * 10) / 10,
      isGlimmer: glimmer, obtainedAt: now, nickname: null, origin,
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
    const p = {
      id: this.rng.uuid(), creatureID, tile: { ...tile }, contributions: { ...c.contributions },
      radius: c.radius, placedAt: now, startLevel, removedAt: null,
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

  rollTable(id, origin, now) {
    const table = this.content.loot[id];
    if (!table) return [];
    const out = [];
    for (const r of table.rolls) {
      if (!this.pityRoll(r.chance == null ? 1 : r.chance, r.pity)) continue;
      const count = r.count ? this.rng.int(...range(r.count).map(Math.round)) : 1;
      if (r.creature) out.push({ creature: this.rollCreature(r.creature, origin, now) });
      else if (r.item) { if (count > 0) out.push({ item: r.item, count }); }
      else if (r.group) {
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

  collect(spawnID, now) {
    const i = this.state.spawns.findIndex((s) => s.id === spawnID);
    if (i < 0) throw new GameError('Unknown item.');
    const [spawn] = this.state.spawns.splice(i, 1);
    const def = this.content.items[spawn.itemID];
    if (!def) return [];
    const pending = def.onCollect ? this.rollTable(def.onCollect, def.id, now) : [{ item: def.id, count: 1 }];
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
    const grow = this.rng.range(...range(this.t.seeds.growSeconds));
    this.state.plantedSeeds.push({ id: this.rng.uuid(), seedItemID: itemID, tile: { ...tile }, plantedAt: now, growSeconds: grow });
  }

  harvestSeed(id, now) {
    const i = this.state.plantedSeeds.findIndex((s) => s.id === id);
    if (i < 0) throw new GameError('Unknown item.');
    const seed = this.state.plantedSeeds[i];
    if (this.seedProgress(seed, now) < 1) throw new GameError("It isn't ready yet.");
    this.state.plantedSeeds.splice(i, 1);
    const table = this.content.items[seed.seedItemID]?.onGrow;
    return table ? this.grant(this.rollTable(table, seed.seedItemID, now)) : [];
  }

  crack(itemID, now) {
    const def = this.content.items[itemID];
    if (!def) throw new GameError('Unknown item.');
    if (!def.onCrack) throw new GameError("That can't be cracked.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    this.consume(itemID);
    return this.grant(this.rollTable(def.onCrack, itemID, now));
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
  itemsInGroup(g) { return this.itemList.filter((i) => i.groups && i.groups.includes(g)); }
}
