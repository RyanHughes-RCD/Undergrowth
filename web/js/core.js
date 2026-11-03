// Undergrowth web prototype — game logic.
// A JavaScript port of Packages/UndergrowthCore (the Swift package). Same data
// files, same rules; times are stored as epoch milliseconds.

export const CORE_STATS = ['spore', 'glow', 'bloom', 'verdure', 'shimmer', 'spirit'];
export const RARITIES = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];
export const RARITY_NAMES = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', veryRare: 'Very rare', legendary: 'Legendary' };
export const rarityIndex = (r) => Math.max(0, RARITIES.indexOf(r));
/** 2 = spawn-table content (older forests are replanted). 3 = clearing, tutorial, unlocks (2 migrates).
 *  4 = creature influence radius doubled (owned/placed creatures are scaled on load).
 *  5 = garden schools: damp/stone/depth became spore/shimmer/spirit, soil packs became school seeds
 *      (migrateSchools remaps every saved key on load).
 *  6 = relics: placed creatures become buried relics of their main stat's school (Game.migrate). */
export const SAVE_VERSION = 6;

/** Version 5 renames, kept so older saves load: stat ids, terrain and landmark ids, soil packs. */
export const SCHOOL_RENAMES = {
  stats: { damp: 'spore', stone: 'shimmer', depth: 'spirit' },
  terrains: { damp: 'spore', stone: 'shimmer', depth: 'spirit', 'dripstone-ledge': 'dewcrystal-dell', 'crystal-outcrop': 'crystal-glade',
    'rock-garden': 'prism-garden', 'geode-bed': 'dreaming-hollow', 'overgrown-rocks': 'overgrown-crystals' },
  landmarks: { 'landmark.cave': 'landmark.crystal-grotto', 'landmark.standing-stones': 'landmark.singing-crystals' },
  items: { 'supply.dew-moss': 'seed.spore', 'supply.glow-dust': 'seed.glow', 'supply.petal-mulch': 'seed.bloom',
    'supply.leaf-mould': 'seed.verdure', 'supply.grit': 'seed.shimmer', 'supply.loose-loam': 'seed.spirit' },
  listings: { 'shop-dew-moss': 'shop-seed-spore', 'shop-glow-dust': 'shop-seed-glow', 'shop-petal-mulch': 'shop-seed-bloom',
    'shop-leaf-mould': 'shop-seed-verdure', 'shop-grit': 'shop-seed-shimmer', 'shop-loose-loam': 'shop-seed-spirit' },
};

/**
 * Saves from before version 5 name the old stats. Remaps, in place: creature and placement
 * contributions, soil boosts, the ambient water layer (ambientDamp → ambientSpore), guide discoveries
 * (terrain:<id>, landmark:<id>, item:<id>), formed landmarks, soil packs in the Bag (→ the matching
 * school seed), shop purchase counts and any pending Spirit Well result. Safe to run twice.
 */
export function migrateSchools(state) {
  if (!state || (state.version || 0) >= 5) return state;
  const R = SCHOOL_RENAMES;
  const statKeys = (o) => {
    if (!o || typeof o !== 'object') return o;
    for (const [a, b] of Object.entries(R.stats)) if (a in o) { o[b] = (o[b] || 0) + o[a]; delete o[a]; }
    return o;
  };
  const renameKeys = (o, map) => {
    if (!o || typeof o !== 'object') return;
    for (const [a, b] of Object.entries(map)) if (a in o) { o[b] = (typeof o[a] === 'number' ? (o[b] || 0) : 0) + o[a]; delete o[a]; }
  };
  for (const c of state.creatures || []) statKeys(c.contributions);
  for (const p of state.placements || []) statKeys(p.contributions);
  for (const b of state.soilBoosts || []) statKeys(b.stats);
  if (state.ambientDamp && !state.ambientSpore) state.ambientSpore = state.ambientDamp;
  delete state.ambientDamp;
  const landmarkKey = (id) => id.replace(/^landmark\./, '');
  state.discovered = [...new Set((state.discovered || []).map((k) => {
    const [kind, ...rest] = k.split(':'), id = rest.join(':');
    if (kind === 'terrain' && R.terrains[id]) return 'terrain:' + R.terrains[id];
    if (kind === 'landmark' && R.landmarks['landmark.' + id]) return 'landmark:' + landmarkKey(R.landmarks['landmark.' + id]);
    if (kind === 'item' && R.items[id]) return 'item:' + R.items[id];
    return k;
  }))];
  for (const l of state.landmarks || []) if (R.landmarks[l.id]) l.id = R.landmarks[l.id];
  // Soil packs in the Bag become the matching school seed (and that seed counts as found).
  for (const [a, b] of Object.entries(R.items)) if (state.inventory && state.inventory[a] > 0 && !state.discovered.includes('item:' + b)) state.discovered.push('item:' + b);
  renameKeys(state.inventory, R.items);
  if (state.offerings) { renameKeys(state.offerings.bought, R.listings); renameKeys(state.offerings.delivered, R.listings); }
  // A pending Spirit Well result may name a soil pack.
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach((v, i) => { if (typeof v === 'string' && R.items[v]) o[i] = R.items[v]; else walk(v); });
    if (o && typeof o === 'object') for (const k in o) { if (typeof o[k] === 'string' && R.items[o[k]]) o[k] = R.items[o[k]]; else walk(o[k]); }
  };
  if (state.wish) walk(state.wish.pending);
  return state;
}
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

// ---------------------------------------------------------------- intensity (player-facing)

/**
 * The one mapping from a raw tile stat value to its player-facing intensity (tuning.intensity).
 * Returns { level: 0..bands, label, min, max }: level 0 is "No Intensity" (below minInfluence).
 * Values above the last band's range (the stat cap is 100) stay at the top band.
 */
export function intensityOf(value, tuning) {
  const cfg = (tuning && tuning.intensity) || {};
  const bands = cfg.bands || [];
  const v = value || 0;
  let level = 0;
  for (let i = 0; i < bands.length; i++) if (v >= bands[i].min) level = i + 1;
  if (!level) return { level: 0, label: 'No Intensity', min: 0, max: (bands[0] ? bands[0].min : 6) - 1 };
  const b = bands[level - 1], next = bands[level];
  return { level, label: b.label, min: b.min, max: next ? next.min - 1 : Infinity };
}

/**
 * A requirement ("at least `min`") as an intensity: the band it falls in, plus whether it sits at the
 * start, middle or top of that band, so a threshold of 20 isn't shown as plain "Moderate" (16).
 */
export function requirementOf(min, tuning) {
  const cfg = (tuning && tuning.intensity) || {};
  const floor = cfg.minInfluence ?? 6;
  const m = Math.max(min || 0, floor);
  const b = intensityOf(m, tuning);
  const span = Number.isFinite(b.max) ? b.max - b.min + 1 : 10;
  const pos = (m - b.min) / span;
  const qualifier = pos < 0.2 ? '' : pos < 0.6 ? 'mid ' : 'high ';
  return { ...b, text: qualifier + b.label, exact: pos < 0.2 };
}

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
  level(p, now, stat = null) {
    const ramp = Math.max(1, p.rampSeconds ?? this.t.rampSecondsToFull) * 1000;
    const decay = Math.max(1, p.rampSeconds ?? this.t.decaySecondsToZero) * 1000 / this.decayRate(stat);
    const rampAt = (t) => Math.min(1, p.startLevel + Math.max(0, t - p.placedAt) / ramp);
    if (p.removedAt == null || now <= p.removedAt) return rampAt(now);
    return Math.max(0, rampAt(p.removedAt) - (now - p.removedAt) / decay);
  }

  /** Fade-rate multiplier for a stat after its creature leaves (terrain.statDecayRate; Shimmer lingers). */
  decayRate(stat) {
    const r = (this.t.terrain && this.t.terrain.statDecayRate) || {};
    return Math.max(0.01, stat && r[stat] != null ? r[stat] : 1);
  }

  fullyDecayedAt(p) {
    if (p.removedAt == null) return null;
    // The slowest-fading stat this creature gave decides when its placement is finally gone.
    let rate = 1;
    for (const k in p.contributions || {}) rate = Math.min(rate, this.decayRate(k));
    return p.removedAt + this.level(p, p.removedAt) * Math.max(1, p.rampSeconds ?? this.t.decaySecondsToZero) * 1000 / rate;
  }

  /** Raw (unclamped) sums; the Game adds soil boosts and clamps. */
  statsAt(tile, placements, now) {
    const out = {};
    for (const k of CORE_STATS) out[k] = 0;
    for (const p of placements) {
      const f = this.falloff(dist(tile, p.tile), p.radius);
      if (f <= 0) continue;
      for (const k in p.contributions) {
        const lv = this.level(p, now, p.removedAt == null ? null : k);
        if (lv > 0) out[k] = (out[k] || 0) + p.contributions[k] * lv * f;
      }
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
      // Per stat: after removal each stat fades at its own rate (Shimmer slowest).
      const contribs = Object.entries(p.contributions)
        .map(([k, v]) => [keys.indexOf(k), v * this.level(p, now, p.removedAt == null ? null : k)])
        .filter(([, v]) => v !== 0);
      if (!contribs.length) continue;
      const r = Math.ceil(this.reach(p.radius));
      for (let y = Math.max(0, p.tile.y - r); y <= Math.min(size.height - 1, p.tile.y + r); y++) {
        for (let x = Math.max(0, p.tile.x - r); x <= Math.min(size.width - 1, p.tile.x + r); x++) {
          const f = this.falloff(Math.hypot(x - p.tile.x, y - p.tile.y), p.radius);
          if (f <= 0) continue;
          const o = (y * size.width + x) * K;
          for (const [ki, v] of contribs) values[o + ki] += v * f;
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
  constructor(rules, maxDecorations, seed, stages = null) {
    // "staged" rules expand into one rule per intensity stage (visuals.intensityStages thresholds):
    // { id, layer, stat, staged: true, sprites: ["ov.x.s{n}a", ...] } → id1..id9 in one group.
    rules = Game.expandStagedRules(rules, stages);
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
        // variantOf: use another family's choice (a glow layer lines up with the art under it).
        const h = this.h(x, y, 'o-' + (r.variantOf || r.group || r.id));
        overlays.push({ sprite: r.sprites[h % r.sprites.length], flip: ((h >>> 9) & 1) === 1, pulse: r.pulse || null });
      }
    }

    const decorations = [];
    const usedGroups = new Set();
    for (const r of this.decorations) {
      if (decorations.length >= this.maxDecorations) break;
      if (r.group && usedGroups.has(r.group)) continue;          // staged: only the highest stage shows
      if (!r.sprites || !r.sprites.length || !conditionMatches(r.when, r.any, stats)) continue;
      if (r.group) usedGroups.add(r.group);
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

/**
 * A readable hint for where an item grows, from its stat minimums (story.json "hints"), e.g.
 * "Grows where Shimmer meets deep soil." Used for items not yet in the Field Guide.
 */
export function itemHint(item, story) {
  const H = (story && story.hints) || {};
  const sp = item.spawn || {};
  const req = Object.entries(sp.requires || {}).filter(([, b]) => (b.min || 0) > 0).sort((a, b) => b[1].min - a[1].min);
  const words = req.map(([k]) => (H.stats || {})[k] || k);
  const verb = (H.verbs || {})[item.category] || 'Found';
  const fill = (tpl) => tpl.replace('{verb}', verb).replace('{a}', words[0]).replace('{b}', words[1]).replace('{c}', words[2]);
  let out;
  if (sp.seedOnly) out = fill(H.seed || 'Grows from Mystery Seeds');
  else if (sp.terrain === 'pool') out = fill(H.pool || '{verb} in shallow pools');
  else if (!words.length) out = fill(H.none || '{verb} almost anywhere');
  else if (words.length === 1) out = fill(H.one || '{verb} on {a}');
  else if (words.length === 2) out = fill(H.two || '{verb} where {a} meets {b}');
  else out = fill(H.three || '{verb} where {a}, {b} and {c} come together');
  const top = req.length ? req[0][1].min : 0;
  if (top >= ((H.strongAt) ?? 46)) out += H.strong || ', where it is strongest';
  else if (top >= ((H.richAt) ?? 26)) out += H.rich || ', where it has grown in';
  if (sp.time === 'night') out += H.night || ', at night';
  if (sp.time === 'day') out += H.day || ', by day';
  if (sp.rain) out += H.rain || ', in the rain';
  return out.charAt(0).toUpperCase() + out.slice(1) + '.';
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export class Game {
  constructor(content, state) {
    this.content = content;
    this.state = state;
    migrateSchools(state);                 // version 5: garden schools (before any defaults below)
    state.geodes = state.geodes || [];
    state.visitors = state.visitors || [];
    state.soilBoosts = state.soilBoosts || [];
    state.relics = state.relics || [];
    state.guests = state.guests || {};          // visitors (Content/visitors.json): interest, clues, presence
    state.guestTracks = state.guestTracks || [];
    state.ambientSpore = state.ambientSpore || {};
    state.nextGlimmer = !!state.nextGlimmer;
    // Offerings (older saves start empty).
    state.offerings = state.offerings || { delivered: {} };
    state.offerings.delivered = state.offerings.delivered || {};
    state.offerings.bought = state.offerings.bought || {};
    state.unlocks = { slots: 0, nests: 0, expansions: 0, trowel: false, ...(state.unlocks || {}) };
    state.unlocks.upgrades = state.unlocks.upgrades || {};
    state.decor = state.decor || { owned: {}, placed: [] };
    state.decor.owned = state.decor.owned || {};
    state.decor.placed = state.decor.placed || [];
    state.compost = state.compost || 0;
    state.nests = state.nests || [];
    state.scenery = state.scenery || [];
    state.buffs = state.buffs || [];
    state.wish = { discovered: null, demand: null, pending: null, count: 0, ...(state.wish || {}) };
    this.t = content.tuning;
    this.stats = new StatEngine(this.t);
    this.rng = new RNG(state);
    this.discovered = new Set(state.discovered);
    /** One-shot notifications for the UI (tutorial steps, unlocks, milestones). Not saved. */
    this.events = [];
    this.migrate();
    this.rebalanceOwnedCreatures();
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
    // The guided tutorial is gone (tuning.tutorial.enabled false): forests mid-tutorial just carry on.
    if (s.tutorial.step !== 'done' && !(this.t.tutorial && this.t.tutorial.enabled)) {
      s.tutorial = { step: 'done' };
      for (const sp of s.spawns || []) delete sp.wiggle;
    }
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
    if ((s.version || 0) < 6) this.migrateToRelics();
    s.version = SAVE_VERSION;
  }

  /**
   * Save version 6: creatures no longer shape the land. Each placed creature becomes a buried relic of
   * its main stat's school, at the creature's tier, on its tile, already at full strength (the land
   * it made stays). The creature itself is kept (resting, hidden while creature placement is off),
   * as are eggs and nests. Placements that were already fading are left to fade as before.
   */
  migrateToRelics() {
    const s = this.state, now = s.lastUpdated || s.createdAt || 0;
    const keep = [];
    for (const p of s.placements || []) {
      if (p.removedAt != null) { keep.push(p); continue; }
      const c = (s.creatures || []).find((x) => x.id === p.creatureID);
      const def = c && this.content.creatures[c.typeID];
      const main = Object.entries(p.contributions || {}).filter(([k, v]) => CORE_STATS.includes(k) && v > 0).sort((a, b) => b[1] - a[1])[0];
      if (!main) { keep.push(p); continue; }
      const tier = (def && RARITIES.includes(def.rarity)) ? def.rarity : 'common';
      const relicID = 'relic.' + main[0] + '.' + tier;
      s.relics.push({ id: 'r-' + p.id, relicID, school: main[0], tier, tile: { ...p.tile }, buriedAt: Math.min(p.placedAt || now, now - 86400000), fromCreature: p.creatureID || null });
      this.discover('item:' + relicID);
    }
    s.placements = keep;
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
      balanceVersion: (content.tuning.creatureRoll || {}).balanceVersion || 1,
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
    else { g.placeScenery(); g.placeStarters(now); }
    g.advance(now);
    g.events = [];
    return g;
  }

  /**
   * The opening (tuning.start): a few things already waiting around the old log, on the surface and
   * kept until picked. One random mushroom or geode among them is guaranteed to hold a creature.
   */
  placeStarters(now) {
    const st = this.t.start || {};
    const log = this.state.landmarks[0];
    const c = this.clearing;
    const centre = log ? log.tile : { x: Math.floor((c.x0 + c.x1) / 2), y: Math.floor((c.y0 + c.y1) / 2) };
    const r = st.radius ?? 3;
    const made = [];
    for (const e of st.spawns || []) {
      const def = this.content.items[e.item];
      if (!def) continue;
      for (let i = 0; i < (e.count || 1); i++) {
        let tile = null;
        for (let k = 0; k < 30 && !tile; k++) {
          const t = { x: centre.x + this.rng.int(-r, r), y: centre.y + this.rng.int(-r, r) };
          if (this.isFree(t)) tile = t;
        }
        tile = tile || this.freeNear(centre);
        if (!tile) continue;
        const sp = { id: this.rng.uuid(), itemID: def.id, tile, spawnedAt: now, keep: true, starter: true, placement: 'surface' };
        if (e.forced) sp.forced = e.forced.map((f) => ({ ...f }));      // e.g. a plant that always drops a seed
        this.state.spawns.push(sp);
        made.push(sp);
      }
    }
    // The old guaranteed creature (an egg in one geode) only while creatures shape the land.
    const holdIn = st.guaranteedIn || ['mushroom', 'geode'];
    const holders = this.creaturesOn ? made.filter((sp) => holdIn.includes(this.content.items[sp.itemID].category)) : [];
    if (holders.length) holders[this.rng.int(0, holders.length - 1)].forcedCreature = { rarity: st.guaranteedCreatureRarity || 'common' };
    // The opening's relic (Content/opening.json): close to the old log, unlike any other find.
    if (st.relic && this.content.items[st.relic.item]) {
      const near = st.relic.near ?? 2, ring = [];
      for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) {
        const t = { x: centre.x + dx, y: centre.y + dy };
        if ((dx || dy) && Math.max(Math.abs(dx), Math.abs(dy)) >= 1 && this.isFree(t)) ring.push(t);
      }
      const tile = ring.length ? ring[this.rng.int(0, ring.length - 1)] : this.freeNear(centre);
      if (tile) {
        const sp = { id: this.rng.uuid(), itemID: st.relic.item, tile, spawnedAt: now, keep: true, starter: true, placement: 'surface', opening: true };
        this.state.spawns.push(sp);
        made.push(sp);
      }
    }
    return made;
  }

  /**
   * The opening grotto (tuning.start.scenery): mossy rocks, ferns and the like along the edge of the
   * starting clearing, so it feels like a sheltered nook. Purely visual; they take up their tiles.
   */
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

  /** A creature that can come from this source item (any rarity if none of the asked rarity). */
  guaranteedCreature(kind, itemID, rarity, now) {
    const from = this.content.creatureList.filter((d) => d.source && d.source.kind === kind && !d.notYet);
    let pool = from.filter((d) => (d.source.items || []).includes(itemID) && (!rarity || d.rarity === rarity));
    if (!pool.length) pool = from.filter((d) => !rarity || d.rarity === rarity);
    if (!pool.length) pool = from;
    if (!pool.length) return null;
    return this.rollCreature(pool[this.rng.int(0, pool.length - 1)].id, itemID, now);
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
  landmarkAt(t) { return this.state.landmarks.find((l) => this.landmarkTiles(l).some((u) => sameTile(u, t))) || null; }
  /** [w, h] tiles a landmark covers (landmarks.json "footprint"), from its tile rightward and down. */
  landmarkFootprint(l) { const f = (this.landmarkDef(l.id) || {}).footprint; return Array.isArray(f) ? f : [1, 1]; }
  /** Every tile a landmark covers (the Old Log stump sits across two). */
  landmarkTiles(l) {
    const [w, h] = this.landmarkFootprint(l);
    if (w === 1 && h === 1) return [l.tile];
    const out = [];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: l.tile.x + dx, y: l.tile.y + dy });
    return out;
  }
  /** Moves anything off a landmark's tiles: spawns and seeds make way, the rest is nudged next door. */
  clearLandmarkTiles(l) {
    const s = this.state, tiles = this.landmarkTiles(l);
    const on = (t) => tiles.some((u) => sameTile(u, t));
    s.spawns = s.spawns.filter((sp) => !on(sp.tile));
    s.plantedSeeds = s.plantedSeeds.filter((sp) => !on(sp.tile));
    s.scenery = (s.scenery || []).filter((d) => !on(d.tile));
    const nudge = (list) => { for (const x of list || []) if (on(x.tile)) { const t = this.freeNear(l.tile); if (t) x.tile = t; } };
    nudge(this.activePlacements);
    nudge(s.decor && s.decor.placed);
    nudge(s.nests);
    nudge(s.visitors);
  }

  /** Puts data-defined landmarks (the old log) on the map, once. */
  placeLandmarks() {
    for (const def of this.content.landmarks || []) {
      if (def.earned || def.discovery) continue;      // earned / discovered landmarks appear in play
      if (this.state.landmarks.some((l) => l.id === def.id)) continue;
      const c = this.state.clearing;
      let tile = { x: Math.floor((c.x0 + c.x1) / 2), y: Math.floor((c.y0 + c.y1) / 2) };
      if (def.position && typeof def.position === 'object') tile = { ...def.position };
      if (def.inGuide !== false) this.discover('landmark:' + def.id.replace(/^landmark\./, ''));
      this.state.landmarks.push({ id: def.id, tile });
    }
    // Clear every landmark's tiles (spawns move out of the way; creatures are nudged to a neighbour).
    // Runs on every load, so a landmark that grew (the Old Log stump now covers two tiles) makes room.
    for (const l of this.state.landmarks) this.clearLandmarkTiles(l);
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
  /** Total creature slots: tuning.placementSlots (a developer test forest can raise it). */
  get maxSlots() { return (this.state.dev && this.state.dev.slots) || this.t.placementSlots; }
  /** How many creature slots are open: by days since the forest began (configurable). */
  unlockedSlots(now) {
    const days = (now - this.state.createdAt) / DAY;
    const unlockDays = (this.t.slotUnlocks && this.t.slotUnlocks.unlockDays) || [];
    const byAge = unlockDays.length ? unlockDays.filter((d) => days >= d).length : this.maxSlots;
    return Math.min(this.maxSlots, Math.max(this.state.minUnlockedSlots || 0, byAge, 1));
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
    const spawn = { id: this.rng.uuid(), itemID, tile, spawnedAt: now, keep: true, tutorial: true, placement: 'surface', ...extra };
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
    if (name === 'relic') return (this.state.relics || []).length;
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
    for (let i = normal; i < this.maxSlots; i++) this.state.slots.push({ kind: 'normal', placementID: null });
    let excess = normal - this.maxSlots;
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
  get clock() { return this.t.clock || { dawnStartHour: 5, dayStartHour: 7, duskStartHour: 17, nightStartHour: 19, rainChance: 0.25, weatherBlockHours: 2 }; }

  /**
   * Time of day by the device's local clock (tuning.clock): 'dawn' | 'day' | 'dusk' | 'night'.
   * The same boundaries drive lighting, night-only spawns and Glow.
   */
  dayPhase(t) {
    const c = this.clock, d = new Date(t), h = d.getHours() + d.getMinutes() / 60;
    const dawn = c.dawnStartHour ?? c.nightEndHour ?? 5, day = c.dayStartHour ?? 7, dusk = c.duskStartHour ?? 17, night = c.nightStartHour ?? 19;
    if (h >= dawn && h < day) return 'dawn';
    if (h >= day && h < dusk) return 'day';
    if (h >= dusk && h < night) return 'dusk';
    return 'night';
  }
  static dayNumber(t) { return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / DAY); }

  /** Night by the forest's clock (local time), or anywhere a creature makes it night. */
  isNight(t, tile = null) {
    const night = this.dayPhase(t) === 'night';
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
  /**
   * Placements as they act right now: creature effects (radius links, ramp speed), landmark radius
   * boosts, and the influence spread: a newly placed creature's influence starts close around it and
   * reaches its full radius over tuning.influenceSpreadHours (strength ramps separately, rampHours).
   */
  effectivePlacements(now = this.now()) {
    const links = this.activeEffects('radiusLink');
    const speeds = this.activeEffects('rampSpeed');
    const spread = (this.t.influenceSpreadHours || 0) * 3600 * 1000;
    const lmBoost = this.landmarkEffects ? this.landmarkEffects('radiusBoost') : [];
    const relics = this.relicSources(now);
    if (!links.length && !speeds.length && !spread && !lmBoost.length) return relics.length ? [...this.state.placements, ...relics] : this.state.placements;
    return [...this.state.placements.map((p) => {
      const q = { ...p };
      for (const [e, lm] of lmBoost) if (dist(lm.tile, p.tile) <= (e.range || 0)) q.radius += e.add || 0;
      if (spread) {
        const until = p.removedAt == null ? now : Math.min(now, p.removedAt);
        const frac = Math.min(1, Math.max(p.startLevel || 0, (until - p.placedAt) / spread));
        const min = this.t.influenceSpreadMinRadius ?? 0.5;
        q.radius = Math.min(q.radius, min + (q.radius - min) * frac);
      }
      let bonus = 0;
      for (const [e, src] of links) if (src.id !== p.id && dist(src.tile, p.tile) <= (e.range || 0)) bonus = Math.max(bonus, e.bonus || 0);
      q.radius += bonus;
      let m = 1;
      for (const [e, src] of speeds) if (dist(p.tile, src.tile) < this.stats.reach(src.radius)) m = Math.max(m, e.mult || 1);
      if (m !== 1) q.rampSeconds = (p.rampSeconds ?? this.t.rampSecondsToFull) / m;
      return q;
    }), ...relics];
  }

  // ---- relics (Content/relics.json, tuning.relics): the only permanent way to change the land
  get relicCfg() { return this.t.relics || {}; }
  relicTier(tier) { return (this.relicCfg.tiers || {})[tier] || (this.relicCfg.tiers || {}).common || { strength: 20, radius: 2.5, rampHours: 1, spreadHours: 1 }; }
  relicAt(t) { return (this.state.relics || []).find((r) => sameTile(r.tile, t)) || null; }
  relicDef(id) { return (this.content.relicList || []).find((r) => r.id === id) || null; }
  /**
   * Buried relics as permanent stat sources, shaped like placements so the stat engine, terrain,
   * spawn weighting and the inspector treat them like creatures did: strength (ramping over rampHours)
   * with the creature falloff, and influence that starts close around the relic and spreads to its
   * full radius over spreadHours. They never decay.
   */
  relicSources(now) {
    const out = [];
    const min = this.t.influenceSpreadMinRadius ?? 0.5;
    for (const r of this.state.relics || []) {
      const tier = this.relicTier(r.tier);
      const spread = (tier.spreadHours ?? this.t.influenceSpreadHours ?? 0) * 3600 * 1000;
      const frac = spread > 0 ? Math.min(1, Math.max(0, (now - r.buriedAt) / spread)) : 1;
      out.push({ id: r.id, relic: r.relicID, tile: r.tile, contributions: { [r.school]: tier.strength }, radius: min + (tier.radius - min) * frac,
        placedAt: r.buriedAt, startLevel: 0, removedAt: null, rampSeconds: Math.max(1, (tier.rampHours ?? 1) * 3600) });
    }
    return out;
  }
  // ---- the opening (Content/opening.json): the first relic's school comes from a few quiet questions
  get openingSpawn() { return this.state.spawns.find((sp) => sp.opening) || null; }
  /** Totals of each school for a set of answers (answer index per question). */
  openingTotals(answers) {
    const qs = (this.content.opening && this.content.opening.questions) || [], tot = {};
    for (const k of CORE_STATS) tot[k] = 0;
    answers.forEach((a, i) => { const ans = qs[i] && qs[i].answers[a]; if (ans) for (const k in ans.weights || {}) tot[k] = (tot[k] || 0) + ans.weights[k]; });
    return tot;
  }
  /** The school a set of answers chooses: the highest total, ties broken at random among the leaders. */
  openingSchool(answers) {
    const tot = this.openingTotals(answers), best = Math.max(...CORE_STATS.map((k) => tot[k]));
    const lead = CORE_STATS.filter((k) => tot[k] === best);
    return lead[this.rng.int(0, lead.length - 1)];
  }
  /** The relic takes its school and goes into the Bag as a common relic of that school. */
  claimOpeningRelic(school, now, answers = null) {
    if (!CORE_STATS.includes(school)) throw new GameError('Unknown school.');
    const sp = this.openingSpawn;
    if (sp) this.state.spawns = this.state.spawns.filter((x) => x !== sp);
    const id = 'relic.' + school + '.common';
    this.state.opening = { school, at: now, answers };
    return this.grant([{ item: id, count: 1 }]);
  }

  /** Bury a relic from the Bag on an open tile. It stays for good. */
  buryRelic(itemID, tile, now) {
    const def = this.content.items[itemID];
    if (!def || def.category !== 'relic') throw new GameError("That isn't a relic.");
    if (!def.school) throw new GameError('It is waiting to learn what you want of it.');
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    if (!tile || !this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    this.consume(itemID);
    this.bump('relic');
    const r = { id: this.rng.uuid(), relicID: itemID, school: def.school, tier: def.tier, tile: { ...tile }, buriedAt: now };
    this.state.relics.push(r);
    this.discover('item:' + itemID);
    this.events.push({ type: 'relicBuried', relic: r });
    this.statCache = this.statField(now);
    return r;
  }
  /** A relic dropped by a find on mature, strong relic ground (tuning.relics.findDrop), or null. */
  relicFromFind(tile, stats, now) {
    const fd = this.relicCfg.findDrop || {};
    if (!(fd.chance > 0)) return null;
    const top = CORE_STATS.reduce((a, k) => ((stats[k] || 0) > (stats[a] || 0) ? k : a), CORE_STATS[0]);
    if ((stats[top] || 0) < (fd.minStat ?? 26)) return null;
    const age = (fd.minAgeHours ?? 24) * 3600000;
    const src = (this.state.relics || []).find((r) => r.school === top && now - r.buriedAt >= age && dist(r.tile, tile) < this.stats.reach(this.relicTier(r.tier).radius));
    if (!src || !this.rng.chance(fd.chance)) return null;
    const tier = weightedPick(Object.entries(fd.tierWeights || { common: 1 }), this.rng) || 'common';
    const id = 'relic.' + top + '.' + tier;
    return this.content.items[id] ? id : null;
  }

  static expandStagedRules(rules, stages) {
    const th = stages && stages.length ? stages : [2, 4, 6, 9, 12, 16, 21, 27, 35];
    const out = [];
    for (const r of rules) {
      if (!r.staged) { out.push(r); continue; }
      th.forEach((min, i) => {
        const n = i + 1;
        out.push({
          ...r, staged: undefined, id: r.id + n, group: r.group || r.id, priority: (r.priority || 0) + n,
          when: { ...(r.when || {}), [r.stat]: { min } },
          sprites: (r.sprites || []).map((x) => x.replace('{n}', n)),
        });
      });
    }
    return out;
  }

  /** Combo tiles on this tile (tuning.combos: pool, moss, meadow …), from its raw stats. */
  combosAt(stats) {
    const out = [];
    for (const id in this.t.combos || {}) {
      if (id.startsWith('_')) continue;
      if (groupMatches(this.t.combos[id].requires || {}, stats)) out.push(id);
    }
    return out;
  }
  combo(id) { return (this.t.combos || {})[id] || {}; }

  /** Named terrains (tuning.terrains): id → { name, requires, home, rule }. */
  get terrainDefs() {
    if (this._terrainDefs && this._terrainDefs.src === this.t.terrains) return this._terrainDefs.list;
    const src = this.t.terrains || {};
    const list = Object.entries(src).filter(([id, d]) => !id.startsWith('_') && d && typeof d === 'object' && d.requires)
      .map(([id, d]) => ({ id, ...d, home: new Set(d.home || []), keys: Object.keys(d.requires) }));
    this._terrainDefs = { src: this.t.terrains, list };
    return list;
  }
  terrainDef(id) { return this.terrainDefs.find((d) => d.id === id) || null; }

  /**
   * The named terrain a tile shows (one per tile): the most specific match (most stats), then the one
   * whose stats add up highest. null on plain ground.
   */
  terrainAt(stats) {
    let best = null, bestN = 0, bestSum = -1;
    for (const d of this.terrainDefs) {
      if (d.keys.length < bestN || !groupMatches(d.requires, stats)) continue;
      const sum = d.keys.reduce((a, k) => a + (stats[k] || 0), 0);
      if (d.keys.length > bestN || sum > bestSum) { best = d; bestN = d.keys.length; bestSum = sum; }
    }
    return best;
  }

  // ---- terrain: each stat's own identity (tuning.terrain)
  get terrain() { return this.t.terrain || {}; }

  /** Elevation -1..1 from a tile's stats: Shimmer raises the ground, Spirit sinks it. */
  elevationOf(stats) {
    const e = this.terrain.elevation || {};
    const v = (stats.shimmer || 0) * (e.shimmerPerPoint ?? 0.025) - (stats.spirit || 0) * (e.spiritPerPoint ?? 0.025);
    const m = e.max ?? 1;
    return Math.max(-m, Math.min(m, v));
  }

  /** Each core stat's share of the tile's total, and the dominant stat (share ≥ terrain.dominantShare). */
  shares(stats) {
    let total = 0;
    for (const k of CORE_STATS) total += stats[k] || 0;
    const out = { total, dominant: null, top: null };
    let best = 0;
    for (const k of CORE_STATS) {
      const sh = total > 0 ? (stats[k] || 0) / total : 0;
      out[k] = sh;
      if (sh > best) { best = sh; out.top = k; }
    }
    if (total >= 1 && best >= (this.terrain.dominantShare ?? 0.35)) out.dominant = out.top;
    return out;
  }

  /** Glow's day/night factor by local time: weak by day, strong at night; deep tiles glow even by day. */
  glowFactor(t, stats = {}, kind = 'spawn') {
    const g = this.terrain.glowCycle || {};
    const night = kind === 'visual' ? (g.visualNight ?? 1.5) : (g.nightFactor ?? 1.6);
    const day = kind === 'visual' ? (g.visualDay ?? 0.35) : (g.dayFactor ?? 0.4);
    if (this.isNight(t)) return night;
    const k = Math.min(1, (stats.spirit || 0) / Math.max(1, g.spiritForFullGlow ?? 40));
    return day + (night - day) * k;
  }

  /** Bloom's daily cycle by local time: opens in the morning, peaks at midday, closes at dusk. */
  bloomFactor(t) {
    const b = this.terrain.bloomCycle || {};
    const d = new Date(t), h = d.getHours() + d.getMinutes() / 60;
    const open = b.openHour ?? 6, peak = b.peakHour ?? 12, close = b.closeHour ?? 19;
    const lo = b.minFactor ?? 0.15, hi = b.maxFactor ?? 1.3;
    let k = 0;
    if (h > open && h <= peak) k = 0.5 - 0.5 * Math.cos(Math.PI * (h - open) / Math.max(0.01, peak - open));
    else if (h > peak && h < close) k = 0.5 + 0.5 * Math.cos(Math.PI * (h - peak) / Math.max(0.01, close - peak));
    return lo + (hi - lo) * k;
  }

  /** How much each stat counts toward spawn weights right now (Glow by day/night, Bloom by its cycle). */
  statFactors(t, stats) { return { glow: this.glowFactor(t, stats), bloom: this.bloomFactor(t) }; }

  /** High Bloom flattens plant weights (exponent < 1), so more kinds of plant turn up. */
  varietyExponent(stats, t) {
    const b = this.terrain.bloom || {};
    const eff = (stats.bloom || 0) * this.bloomFactor(t);
    return Math.max(b.minVarietyExponent ?? 0.35, 1 - (b.varietyPerPoint ?? 0) * eff);
  }

  /**
   * Stats plus derived values for the tile-art rules table: share_<stat> (0..1 of the tile's
   * total), elev (-100..100), glowVis / bloomVis (Glow and Bloom as they look right now).
   */
  visualStats(stats, t) {
    const sh = this.shares(stats);
    const out = { ...stats, total: sh.total, elev: Math.round(this.elevationOf(stats) * 100) };
    for (const k of CORE_STATS) out['share_' + k] = sh[k];
    out.glowVis = (stats.glow || 0) * this.glowFactor(t, stats, 'visual');
    out.bloomVis = (stats.bloom || 0) * this.bloomFactor(t);
    out.combos = this.combosAt(stats);
    for (const c of out.combos) out['combo_' + c] = 1;
    const ter = this.terrainAt(stats);
    out.terrain = ter ? ter.id : null;
    if (ter) out['terrain_' + ter.id] = 1;
    return out;
  }

  /** "x,y" tile keys by grid index and back, built once per grid size (hot loops avoid string churn). */
  get tileKeys() {
    const W = this.state.size.width, H = this.state.size.height;
    if (!this._keys || this._keys.w !== W || this._keys.h !== H) {
      const names = new Array(W * H), index = new Map();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = x + ',' + y; names[y * W + x] = k; index.set(k, y * W + x); }
      this._keys = { w: W, h: H, names, index };
    }
    return this._keys;
  }

  /** Ambient Spore (seeped/pooled water), separate from creature contributions. */
  ambientAt(x, y) { return (this.state.ambientSpore && this.state.ambientSpore[x + ',' + y]) || 0; }

  /**
   * One step of Spore spreading (per spawn tick). Each clearing tile takes in water from wetter
   * neighbours (spreadRate × difference), more easily downhill (downhillBoost) and hardly uphill
   * (uphillPenalty); water also runs down slopes on its own (gravityPerTick). High-Shimmer tiles
   * block seepage across them (none at shimmerBlocksAt). It evaporates (evaporation), less on low
   * ground (lowGroundRetention), so hollows turn boggy. Creature Spore is a source; only this
   * ambient layer changes, so creature ramp/decay stays as it is.
   */
  ambientTick(t) {
    const cfg = this.terrain.ambientSpore || {};
    if (cfg.enabled === false) return;
    const W = this.state.size.width, c = this.clearing;
    const amb = this.state.ambientSpore || {};
    const field = this.statField(t, { raw: true });     // water physics uses the raw values
    const n = W * this.state.size.height;
    const D = new Float32Array(n), E = new Float32Array(n), S = new Float32Array(n);
    let any = false;
    const K = field.keys.length, kd = field.keys.indexOf('spore'), ks = field.keys.indexOf('shimmer'), kp = field.keys.indexOf('spirit');
    const el = this.terrain.elevation || {}, sp = el.shimmerPerPoint ?? 0.025, dp = el.spiritPerPoint ?? 0.025, em = el.max ?? 1;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const i = y * W + x, o = i * K;
      D[i] = field.values[o + kd]; S[i] = field.values[o + ks];
      E[i] = Math.max(-em, Math.min(em, S[i] * sp - field.values[o + kp] * dp));
      if (D[i] > 0) any = true;
    }
    if (!any) { this.state.ambientSpore = {}; return; }
    const rate = cfg.spreadRate ?? 0.05, down = cfg.downhillBoost ?? 2.5, up = cfg.uphillPenalty ?? 0.8;
    const grav = cfg.gravityPerTick ?? 0, block = Math.max(1, cfg.shimmerBlocksAt ?? 40);
    const evap = cfg.evaporation ?? 0.06, keep = cfg.lowGroundRetention ?? 0.7, max = cfg.max ?? 45, minKeep = cfg.minKeep ?? 0.05;
    const next = {}, names = this.tileKeys.names;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const i = y * W + x;
      let inflow = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < c.x0 || nx > c.x1 || ny < c.y0 || ny > c.y1) continue;
        const j = ny * W + nx;
        const dz = E[j] - E[i];                      // > 0: the neighbour is higher, water runs down to us
        let f = 0;
        if (D[j] > D[i]) f += rate * (D[j] - D[i]);
        if (dz > 0 && D[j] > 0) f += grav * D[j] * dz;
        if (f <= 0) continue;
        f *= dz >= 0 ? 1 + down * dz : Math.max(0, 1 + up * dz);
        f *= 1 - Math.min(1, Math.max(S[i], S[j]) / block);
        inflow += f;
      }
      const key = names[i];
      const a = amb[key] || 0;
      if (!inflow && !a) continue;
      const e = evap * (E[i] < 0 ? 1 - keep * Math.min(1, -E[i]) : 1);
      const v = Math.min(max, a + inflow - e * a);
      if (v >= minKeep) next[key] = Math.round(v * 100) / 100;
    }
    this.state.ambientSpore = next;
  }

  /** Where a new spawn sits. Item data spawn.placement: surface | buried | auto (default). Auto:
   *  items whose highest requirement is Spirit are buried; geodes are buried on Spirit-dominant
   *  tiles and exposed on Shimmer-dominant ones; everything else is on the surface. */
  resolvePlacement(item, stats) {
    const p = (item.spawn && item.spawn.placement) || 'auto';
    if (p === 'surface' || p === 'buried') return p;
    const req = (item.spawn && item.spawn.requires) || {};
    let top = null, best = -1;
    for (const k in req) { const m = req[k].min ?? 0; if (m > best) { best = m; top = k; } }
    if (top === 'spirit') return 'buried';
    if (item.category === 'geode' && this.shares(stats).dominant === 'spirit') return 'buried';
    return 'surface';
  }

  /** How a spawn shows right now: 'surface', 'exposed' (geode on Shimmer), 'buried', or 'hidden' (tall grass). */
  spawnView(spawn, t, stats = null) {
    if (spawn.placement === 'buried') return 'buried';
    const st = stats || this.tileStats(spawn.tile, t);
    if (!spawn.tutorial && !spawn.revealed && (st.verdure || 0) >= ((this.terrain.verdure || {}).hideThreshold ?? 30)) return 'hidden';
    const def = this.content.items[spawn.itemID];
    if (def && def.category === 'geode' && this.shares(st).dominant === 'shimmer') return 'exposed';
    return 'surface';
  }

  /** Tap a rustling patch of tall grass: what was hiding there shows itself. */
  revealSpawn(id) {
    const sp = this.state.spawns.find((x) => x.id === id);
    if (!sp) throw new GameError('Unknown item.');
    sp.revealed = true;
    return sp;
  }

  /** A wild spawn record (placement decided now from the tile). */
  newSpawn(item, tile, t) {
    return { id: this.rng.uuid(), itemID: item.id, tile, spawnedAt: t, placement: this.resolvePlacement(item, this.tileStats(tile, t)) };
  }

  // ---- stats
  /**
   * Tiles a soil boost reaches. A plain boost (landmark aura, gem) covers its own tile plus a square of
   * its radius at full strength. A buried school seed (b.seed) spreads with the creature falloff over
   * its radius instead. Each tile comes with its share w (0..1) of the boost's stats.
   */
  boostTiles(b) {
    const r = b.radius || 0;
    if (b.seed) {
      const reach = this.stats.reach(r), R = Math.ceil(reach), out = [];
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const t = { x: b.tile.x + dx, y: b.tile.y + dy };
        const w = this.stats.falloff(Math.hypot(dx, dy), r);
        if (w > 0 && this.inBounds(t)) out.push({ ...t, w });
      }
      return out;
    }
    if (!r) return this.inBounds(b.tile) ? [{ ...b.tile, w: 1 }] : [];
    const out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const t = { x: b.tile.x + dx, y: b.tile.y + dy, w: 1 };
      if (this.inBounds(t)) out.push(t);
    }
    return out;
  }
  /** A boost's share (0..1) on one tile: the same shape as boostTiles. */
  boostWeight(b, t) {
    const dx = t.x - b.tile.x, dy = t.y - b.tile.y;
    if (b.seed) return this.stats.falloff(Math.hypot(dx, dy), b.radius || 0);
    return Math.max(Math.abs(dx), Math.abs(dy)) <= (b.radius || 0) ? 1 : 0;
  }
  /** A boost's strength now (0..1): plain boosts are full while active; a buried seed ramps in, holds, then fades. */
  boostLevel(b, now) {
    if (!b.seed) return 1;
    const ramp = Math.max(1, b.rampMs || 0), fade = Math.max(1, b.fadeMs || 0);
    const up = Math.min(1, Math.max(0, (now - b.appliedAt) / ramp));
    const down = b.fullUntil != null && now > b.fullUntil ? Math.max(0, 1 - (now - b.fullUntil) / fade) : 1;
    return Math.min(up, down);
  }
  /** Stats a boost gives one of its tiles right now. */
  boostStatsAt(b, w, now) {
    const m = w * this.boostLevel(b, now), out = {};
    for (const k in b.stats) out[k] = b.stats[k] * m;
    return out;
  }
  activeBoosts(now) { return this.state.soilBoosts.filter((b) => now >= b.appliedAt && (b.expiresAt == null || now < b.expiresAt)); }

  // ---- school seeds (tuning.schoolSeeds): buried from the Bag, saved as soil boosts with a seed
  get seedCfg() { return this.t.schoolSeeds || {}; }
  /** Buried school seeds still in the ground (ramping, holding or fading). */
  buriedSeeds() { return this.state.soilBoosts.filter((b) => b.seed); }
  buriedSeedAt(t) { return this.state.soilBoosts.find((b) => b.seed && sameTile(b.tile, t)) || null; }
  /** Its stage right now: 'rooting' (ramping in), 'growing' (full), 'fading', and ms until the next change. */
  seedPhase(b, now) {
    if (now < b.appliedAt + (b.rampMs || 0)) return { phase: 'rooting', left: b.appliedAt + b.rampMs - now, ends: b.expiresAt - now };
    if (now < b.fullUntil) return { phase: 'growing', left: b.fullUntil - now, ends: b.expiresAt - now };
    return { phase: 'fading', left: b.expiresAt - now, ends: b.expiresAt - now };
  }
  /** The school a find belongs to: its highest stat need (null for finds that need nothing). */
  schoolOf(item) {
    const req = (item && item.spawn && item.spawn.requires) || {};
    let top = null, best = 0;
    for (const k in req) { const m = req[k].min ?? 0; if (m > best && CORE_STATS.includes(k)) { best = m; top = k; } }
    return top;
  }

  /** Bury a school seed on an open tile: its school's stat grows around it, then fades (tuning.schoolSeeds). */
  burySeed(itemID, tile, now) {
    const def = this.content.items[itemID], cfg = this.seedCfg;
    if (!def || !def.use || def.use.type !== 'bury') throw new GameError("That can't be buried.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    if (!tile || !this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    const max = cfg.maxBuried ?? 6;
    if (this.buriedSeeds().length >= max) throw new GameError(`Only ${max} seeds can be buried at once. Wait for one to fade.`);
    this.consume(itemID);
    this.bump('bury');
    const hour = 3600 * 1000;
    const rampMs = (cfg.rampHours ?? 3) * hour, fullUntil = now + (cfg.durationHours ?? 72) * hour;
    const b = {
      id: this.rng.uuid(), tile: { ...tile }, seed: itemID, school: def.school, stats: { [def.school]: cfg.strength ?? 12 },
      appliedAt: now, rampMs, fullUntil, fadeMs: (cfg.fadeHours ?? 6) * hour,
      radius: (cfg.radius ?? 1.5) + this.upgradeTier('wideSpread') * ((this.upgradeDef('wideSpread') || {}).radiusPerTier ?? 1),
    };
    b.expiresAt = b.fullUntil + b.fadeMs;
    this.state.soilBoosts.push(b);
    this.statCache = this.statField(now);
    return b;
  }

  /** Tile stats for every tile. Values below intensity.minInfluence are 0 (inactive) unless opts.raw. */
  statField(now, opts = {}) {
    const f = this.stats.field(this.state.size, this.effectivePlacements(now), now);
    for (const b of [...this.activeBoosts(now), ...this.landmarkAuras()]) for (const t of this.boostTiles(b)) f.add(t.x, t.y, this.boostStatsAt(b, t.w, now));
    // Ambient Spore (seeped and pooled water) on top of what creatures give.
    const amb = this.state.ambientSpore || {}, kd = f.keys.indexOf('spore'), KK = f.keys.length, idx = this.tileKeys.index;
    for (const key in amb) {
      const i = idx.get(key);
      if (i != null) f.values[i * KK + kd] += amb[key];
    }
    // Nothing reaches past the treeline; newly revealed tiles fade in.
    const K = f.keys.length, W = this.state.size.width, c = this.state.clearing;
    const ramp = ((this.t.expansion && this.t.expansion.revealRampSeconds) || 0) * 1000;
    const rev = this.state.revealed || {};
    for (let y = 0; y < this.state.size.height; y++) for (let x = 0; x < W; x++) {
      if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) { x = c.x1; continue; }   // skip across the clearing
      const o = (y * W + x) * K;
      for (let i = 0; i < K; i++) f.values[o + i] = 0;
    }
    if (ramp > 0) for (const key in rev) {
      const m = Math.min(1, Math.max(0, (now - rev[key]) / ramp));
      if (m >= 1) continue;
      const [x, y] = key.split(',').map(Number);
      if (x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1) continue;
      const o = (y * W + x) * K;
      for (let i = 0; i < K; i++) f.values[o + i] *= m;
    }
    f.clamp(this.t.statCap);
    if (!opts.raw) {
      const floor = this.minInfluence;
      for (let i = 0; i < f.values.length; i++) if (f.values[i] < floor) f.values[i] = 0;
    }
    return f;
  }
  /** Below this a stat has no influence anywhere (tuning.intensity.minInfluence). */
  get minInfluence() { return (this.t.intensity && this.t.intensity.minInfluence) ?? 6; }
  field(now) { return this.statCache || (this.statCache = this.statField(now)); }

  tileStats(tile, now, opts = {}) {
    const s = this.stats.statsAt(tile, this.effectivePlacements(now), now);
    for (const b of [...this.activeBoosts(now), ...this.landmarkAuras()]) {
      const w = this.boostWeight(b, tile);
      if (w > 0) { const add = this.boostStatsAt(b, w, now); for (const k in add) s[k] = (s[k] || 0) + add[k]; }
    }
    s.spore = (s.spore || 0) + this.ambientAt(tile.x, tile.y);
    const m = this.revealFactor(tile.x, tile.y, now);
    const floor = opts.raw ? 0 : this.minInfluence;
    for (const k in s) { s[k] = Math.min(this.t.statCap, Math.max(0, s[k] * m)); if (s[k] < floor) s[k] = 0; }
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
    // Real time away (developer time speed and skips don't count as being away).
    const realNow = now - (this.state.debugTimeOffset || 0);
    const lastReal = this.state.lastRealSeen ?? ((this.state.lastUpdated ?? now) - (this.state.debugTimeOffset || 0));
    const away = Math.max(0, realNow - lastReal);
    // Revealed tiles that have finished fading in no longer need tracking (keeps per-tile scans fast).
    const ramp = ((this.t.expansion && this.t.expansion.revealRampSeconds) || 0) * 1000;
    for (const k in this.state.revealed || {}) if (now - this.state.revealed[k] >= ramp) delete this.state.revealed[k];
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
      this.ambientTick(t);
      report.spawned += this.spawnTick(t);
      report.spawned += this.interactionTick(t, now - t < 15 * 60000);
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

    // The return harvest: extra growth for real time away, mostly on relic ground.
    const harvest = this.returnHarvest(now, away);
    if (harvest) report.harvest = harvest;
    // Visitors: interest checks on their schedule (offline catch-up included).
    this.visitorTick(now);
    this.state.lastRealSeen = realNow;

    this.state.lastUpdated = now;
    this.statCache = this.statField(now);
    this.checkProgress(now);
    return report;
  }

  // ---- visitors (Content/visitors.json, tuning.visitors): forest animals drawn by the grotto's ground
  get guestCfg() { return this.t.visitors || {}; }
  guestDefs() { return this.content.visitorList || []; }
  guestDef(id) { return this.guestDefs().find((v) => v.id === id) || null; }
  guest(id) {
    const g = this.state.guests[id] = this.state.guests[id] || { interest: 0, known: [], befriended: false, present: null, presDay: -1, presCount: 0 };
    return g;
  }
  /** Its preference keys, in the order clues reveal them (school or terrain first). */
  guestPrefKeys(def) { return ['school', 'terrain', 'min', 'find', 'time', 'rain'].filter((k) => def.likes[k] != null && def.likes[k] !== false && !(k === 'min' && def.likes.terrain)); }
  /** Tiles that meet a visitor's ground preference (its school at its minimum, or its named terrain). */
  guestTiles(def, field) {
    const out = [], c = this.clearing, L = def.likes;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const st = field.statsAt(x, y);
      if (L.school ? (st[L.school] || 0) >= (L.min ?? this.minInfluence) : L.terrain ? (this.terrainAt(st) || {}).id === L.terrain : false) out.push({ x, y });
    }
    return out;
  }
  /** Its stage now, from its interest (and presence): none, signs, clues, present (or ready: interested enough to come). */
  guestStage(id, now) {
    const g = this.guest(id), st = this.guestCfg.stages || {};
    if (g.present && now >= g.present.from && now < g.present.until) return 'present';
    if (g.interest >= (st.present ?? 60)) return 'ready';
    if (g.interest >= (st.clues ?? 20)) return 'clues';
    if (g.interest >= (st.signs ?? 10)) return 'signs';
    return 'none';
  }
  presentGuests(now) { return this.guestDefs().filter((d) => this.guestStage(d.id, now) === 'present').map((d) => ({ def: d, g: this.guest(d.id) })); }
  trackAt(t) { return this.state.guestTracks.find((x) => sameTile(x.tile, t)) || null; }

  /**
   * Interest checks every visitors.checkMinutes of game time, catching up offline (up to maxCatchUpDays).
   * Each check's random choices are seeded from the forest, the visitor and the check's time, so it's
   * deterministic from timestamps. Ground is read once per call (relics are permanent; finds and
   * weather are read per check).
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
    const field = this.statField(now);
    const tiles = new Map(defs.map((d) => [d.id, this.guestTiles(d, field)]));
    const saved = this.rng;
    try {
      for (let k = k0; k <= k1; k++) {
        const t = k * step;
        const life = ((cfg.tracks || {}).hours ?? 24) * HOUR;
        this.state.guestTracks = this.state.guestTracks.filter((x) => t - x.at < life);
        defs.forEach((d, i) => { this.rng = new RNG({ rng: hash32(this.state.seed, i + 1, k) }); this.guestCheck(d, t, tiles.get(d.id)); });
      }
    } finally { this.rng = saved; }
    this.state.guestsAt = k1 * step;
  }

  guestCheck(def, t, tiles) {
    const cfg = this.guestCfg, g = this.guest(def.id), L = def.likes, I = cfg.interest || {}, S = cfg.stages || {};
    const raining = this.isRaining(t);
    const findOn = L.find ? this.state.spawns.filter((sp) => sp.itemID === L.find && sp.spawnedAt <= t && tiles.some((x) => sameTile(x, sp.tile))) : [];
    const met = tiles.length >= (cfg.minTiles ?? 2) && (!L.find || findOn.length > 0);
    const gain = (I.gain ?? 1.5) * (L.rain && raining ? (I.rainMult ?? 2) : 1);
    g.interest = Math.max(0, Math.min(I.max ?? 100, g.interest + (met ? gain : -(I.decay ?? 1))));
    if (g.present && t >= g.present.until) g.present = null;
    const inWindow = this.dayPhase(t) === L.time && (!L.rain || raining);
    if (!met || !inWindow) return;
    // Signs: tracks on its ground, laid only while it's here (so their time and weather clues are true).
    const tr = cfg.tracks || {};
    if (g.interest >= (S.signs ?? 10) && this.state.guestTracks.filter((x) => x.visitorID === def.id).length < (tr.maxPerVisitor ?? 3) && this.rng.chance(tr.chance ?? 0.35)) {
      this.layTrack(def, t, tiles, findOn, raining);
    }
    // Present: in its window, interested enough, a few times a day at most.
    const pr = cfg.presence || {}, day = Game.dayNumber(t);
    if (g.presDay !== day) { g.presDay = day; g.presCount = 0; }
    const perDay = g.befriended ? (pr.befriendedPerDay ?? 2) : (pr.perDay ?? 1);
    const chance = (pr.chance ?? 0.35) * (g.befriended ? (pr.befriendedChanceMult ?? 2) : 1);
    if (!g.present && g.interest >= (S.present ?? 60) && g.presCount < perDay && this.rng.chance(chance)) this.startPresence(def, t, tiles);
  }

  /** A clue it can honestly leave right now, preferring one the player doesn't know yet. */
  pickClue(def, raining, canNibble) {
    const g = this.guest(def.id);
    const honest = this.guestPrefKeys(def).filter((k) => (k !== 'rain' || raining) && (k !== 'find' || canNibble));
    const fresh = honest.filter((k) => !g.known.includes(k));
    const pool = fresh.length ? fresh : honest.filter((k) => k !== 'find');
    return pool.length ? pool[this.rng.int(0, pool.length - 1)] : null;
  }

  layTrack(def, t, tiles, findOn, raining) {
    const g = this.guest(def.id), S = this.guestCfg.stages || {};
    const readable = g.interest >= (S.clues ?? 20);
    const clue = readable ? this.pickClue(def, raining, findOn.length > 0) : null;
    if (clue === 'find') {                 // its liked find gets nibbled (a tiny mark; picking it reads the clue)
      const sp = findOn[this.rng.int(0, findOn.length - 1)];
      sp.nibbled = def.id;
      return;
    }
    const free = tiles.filter((x) => this.isFree(x) && !this.trackAt(x));
    const pool = free.length ? free : tiles;
    if (!pool.length) return;
    const tile = pool[this.rng.int(0, pool.length - 1)];
    this.state.guestTracks.push({ id: this.rng.uuid(), visitorID: def.id, tile: { ...tile }, at: t, clue });
  }

  startPresence(def, t, tiles) {
    const g = this.guest(def.id), pr = this.guestCfg.presence || {};
    const mins = range(pr.minutes || [20, 40]);
    const tile = tiles.length ? tiles[this.rng.int(0, tiles.length - 1)] : this.clearingTiles()[0];
    g.present = { from: t, until: t + this.rng.range(mins[0], mins[1]) * 60000, tile: { ...tile } };
    g.presCount++;
    g.visits = (g.visits || 0) + 1;
    g.firstSeen = g.firstSeen || t;
    g.lastPresence = { ...g.present };
    // A befriended visitor sometimes leaves a gift: its liked find nearby, or a school seed.
    if (g.befriended && this.rng.chance((this.guestCfg.gift || {}).chance ?? 0.5)) {
      const item = def.likes.find && this.content.items[def.likes.find];
      const spot = item && [tile, ...tiles].find((x) => this.isFree(x));
      if (spot) { const sp = this.newSpawn(item, spot, t); sp.gift = def.id; this.state.spawns.push(sp); }
      else if (def.gift && this.content.items[def.gift]) this.grant([{ item: def.gift, count: 1 }]);
      this.events.push({ type: 'visitorGift', id: def.id, item: spot ? def.likes.find : def.gift });
    }
  }

  /** Reading tracks: the clue is recorded in the visitor's Field Guide page. Returns the clue text. */
  readTrack(trackID) {
    const tr = this.state.guestTracks.find((x) => x.id === trackID);
    if (!tr) throw new GameError('The tracks have faded.');
    const def = this.guestDef(tr.visitorID);
    if (!def) return '';
    if (!tr.clue) return (this.content.story?.visitors || {}).faint || 'Small tracks, too faint to read.';
    const g = this.guest(def.id);
    if (!g.known.includes(tr.clue)) g.known.push(tr.clue);
    return tr.text || def.clues[tr.clue] || '';
  }

  /** Picking a nibbled find reads its clue (its visitor likes this find). */
  readNibble(spawn) {
    const def = spawn.nibbled && this.guestDef(spawn.nibbled);
    if (!def) return null;
    const g = this.guest(def.id);
    if (!g.known.includes('find')) g.known.push('find');
    return def.clues.find || null;
  }

  /** Tapping a present visitor befriends it. */
  befriendGuest(id, now) {
    const def = this.guestDef(id);
    if (!def || this.guestStage(id, now) !== 'present') throw new GameError('It has gone.');
    const g = this.guest(id);
    if (g.befriended) return { def, again: true };
    g.befriended = now;
    for (const k of this.guestPrefKeys(def)) if (!g.known.includes(k)) g.known.push(k);
    this.discover('visitor:' + id.replace(/^visitor\./, ''));
    this.bump('befriend');
    return { def, again: false };
  }

  /** First return after the first relic: the visitor of its school takes an interest, and its tracks circle the relic. */
  firstVisitorSigns(relic, now) {
    const def = this.guestDefs().find((d) => d.likes.school === relic.school && d.rarity === 'common');
    if (!def) return;
    const fv = this.guestCfg.firstVisitor || {}, g = this.guest(def.id);
    g.interest = Math.max(g.interest, fv.interest ?? 22);
    // Close around the relic, on open ground where possible (so the tracks can be seen and read).
    const ring = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) ring.push({ x: relic.tile.x + dx, y: relic.tile.y + dy });
    const spots = ring.filter((x) => this.inClearing(x) && !this.landmarkAt(x) && !this.relicAt(x) && !this.trackAt(x));
    spots.sort((a, b) => (this.isFree(b) ? 0 : 1) - (this.isFree(a) ? 0 : 1) || dist(a, relic.tile) - dist(b, relic.tile));
    const first = (this.content.story?.visitors || {}).firstClue || 'Small tracks circle the place where you buried the relic.';
    spots.slice(0, fv.tracks ?? 3).forEach((tile) => this.state.guestTracks.push({ id: this.rng.uuid(), visitorID: def.id, tile: { ...tile }, at: now, clue: 'school', text: first }));
  }

  // ---- the return harvest (tuning.returnHarvest)
  get harvestCfg() { return this.t.returnHarvest || {}; }
  /**
   * Extra growth for time away. Deterministic: its random choices are seeded from the forest and the away
   * window, and it runs once per return (state.lastRealSeen moves on), so reloading never grants twice.
   * Returns a summary for the morning reveal (and pushes a returnHarvest event), or null.
   */
  returnHarvest(now, awayMs) {
    const cfg = this.harvestCfg;
    if (!cfg.perHour || awayMs < (cfg.minAwayMinutes ?? 45) * 60000) return null;
    const hours = Math.min(awayMs / HOUR, cfg.maxHours ?? 10);
    const start = now - hours * HOUR;
    const saved = this.rng;
    this.rng = new RNG({ rng: hash32(this.state.seed, Math.floor(start / 60000), Math.floor(now / 60000)) });
    const made = [];
    try {
      const field = this.statField(now);
      const st = this.t.spawns, c = this.clearing, area = (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
      const cap = Math.min(st.maxTotal, Math.max(st.minCap || 3, Math.round(area * (st.maxPerOpenTile || 0.1)))) + (cfg.overCap ?? 0);
      const occ = this.occupied(), minTotal = cfg.minStatTotal ?? 6;
      const cands = [];
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        if (occ.has(x + ',' + y)) continue;
        const sv = field.statsAt(x, y);
        const total = CORE_STATS.reduce((a, k) => a + (sv[k] || 0), 0);
        if (total >= minTotal) cands.push({ tile: { x, y }, w: total, stats: sv });
      }
      const when = () => start + this.rng.next() * (now - start);
      const put = (item, tile, t) => {
        const sp = this.newSpawn(item, tile, t);
        sp.harvest = true;
        this.state.spawns.push(sp);
        made.push(sp);
        const i = cands.findIndex((x) => sameTile(x.tile, tile));
        if (i >= 0) cands.splice(i, 1);
      };
      // The first return after the first relic: its ground is thick with finds of its school.
      const h = this.state.harvest = this.state.harvest || {};
      const first = (this.state.relics || [])[0];
      if (first && !h.firstDone) {
        const fr = cfg.firstReturn || {};
        const near = cands.filter((x) => (x.stats[first.school] || 0) > 0 && dist(x.tile, first.tile) < this.stats.reach(this.relicTier(first.tier).radius))
          .sort((a, b) => (b.stats[first.school] || 0) - (a.stats[first.school] || 0));
        const ofSchool = (tile, t, minRarity) => this.spawnDetails(tile, t)
          .filter((d) => this.schoolOf(d.item) === first.school && rarityIndex(d.item.rarity) >= rarityIndex(minRarity)).map((d) => [d.item, d.weight]);
        let uncommon = 0, n = 0;
        for (const x of [...near]) {
          if (n >= (fr.minFinds ?? 8) || this.state.spawns.length >= cap) break;
          const t = when();
          const wantRare = uncommon < (fr.minUncommon ?? 1);
          const item = (wantRare && weightedPick(ofSchool(x.tile, t, 'uncommon'), this.rng)) || weightedPick(ofSchool(x.tile, t, 'common'), this.rng);
          if (!item) continue;
          if (rarityIndex(item.rarity) >= 1) uncommon++;
          put(item, x.tile, t);
          n++;
        }
        h.firstDone = now;
        this.firstVisitorSigns(first, now);
      }
      // Then growth for the time away, weighted by how developed each tile is.
      let budget = Math.round(hours * cfg.perHour) - made.length;
      while (budget-- > 0 && cands.length && this.state.spawns.length < cap) {
        const pick = weightedPick(cands.map((x) => [x, x.w]), this.rng);
        if (!pick) break;
        const t = when();
        const item = this.pickSpawn(pick.tile, t);
        if (!item) { cands.splice(cands.indexOf(pick), 1); continue; }
        put(item, pick.tile, t);
      }
    } finally {
      this.rng = saved;
    }
    if (!made.length) return null;
    // The best find: the rarest, nearest a relic.
    const relicDist = (t) => Math.min(99, ...(this.state.relics || []).map((r) => dist(r.tile, t)));
    const best = [...made].sort((a, b) => rarityIndex(this.content.items[b.itemID].rarity) - rarityIndex(this.content.items[a.itemID].rarity) || relicDist(a.tile) - relicDist(b.tile))[0];
    const fresh = made.filter((sp) => !this.discovered.has('item:' + sp.itemID));
    const summary = {
      at: now, hours: Math.round(hours * 10) / 10, finds: made.length,
      uncommon: made.filter((sp) => rarityIndex(this.content.items[sp.itemID].rarity) >= 1).length,
      best: { itemID: best.itemID, tile: best.tile }, somethingNew: fresh.length > 0,
      newNearRelic: fresh.some((sp) => relicDist(sp.tile) <= 4),
    };
    this.state.harvest.last = summary;
    this.events.push({ type: 'returnHarvest', ...summary });
    return summary;
  }

  // ---- progression: slots, blend, expansion, first-uncommon hint
  /**
   * Terrain discovery (Field Guide → Terrain): a terrain is discovered the first time it shows up
   * in your clearing (a stat reaching Low intensity, or a combo forming). Stored with the other
   * guide discoveries ("terrain:<id>"), so it's saved and never needs rediscovering.
   */
  discoverTerrain(now) {
    const list = this.content.terrain || [];
    if (!list.length || list.every((t) => this.discovered.has('terrain:' + t.id))) return [];
    const found = [];
    const mark = (id) => { if (this.discover('terrain:' + id)) found.push(id); };
    for (const t of list) if (t.kind === 'base' || t.kind === 'treeline') mark(t.id);
    const field = this.field(now), c = this.clearing;
    const wantStat = list.filter((t) => t.kind === 'stat' && !this.discovered.has('terrain:' + t.id));
    const wantCombo = list.filter((t) => t.kind === 'combo' && !this.discovered.has('terrain:' + t.id));
    const wantNamed = list.filter((t) => t.kind === 'terrain' && !this.discovered.has('terrain:' + t.id));
    if (wantStat.length || wantCombo.length || wantNamed.length) {
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        const st = field.statsAt(x, y);
        for (const t of wantStat) if ((st[t.stat] || 0) > 0) mark(t.id);
        if (wantCombo.length) { const cs = this.combosAt(st); for (const t of wantCombo) if (cs.includes(t.combo)) mark(t.id); }
        if (wantNamed.length) { const ter = this.terrainAt(st); if (ter) for (const t of wantNamed) if (t.terrain === ter.id) mark(t.id); }
      }
    }
    for (const id of found) this.events.push({ type: 'terrainDiscovered', id });
    return found;
  }

  checkProgress(now) {
    const s = this.state;
    this.discoverTerrain(now);
    if (this.inTutorial) this.tutorialTick(now);

    if (!s.milestones.blend) {
      const tiles = this.blendedTiles(now);
      if (tiles.length) { s.milestones.blend = now; this.events.push({ type: 'blend', tiles }); }
    }
    if (!this.inTutorial) this.checkExpansion(now);
    this.checkLandmarks(now);
    this.checkTasks();
    if (!s.milestones.uncommonHint) {
      const tile = this.firstUncommonTile(now);
      if (tile) { s.milestones.uncommonHint = now; this.events.push({ type: 'uncommonHint', tile }); }
    }
  }

  /** Tiles where at least two placed creatures each contribute blend.minEach or more. */
  blendedTiles(now) {
    const active = this.effectivePlacements(now).filter((p) => p.removedAt == null);
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
    this.discoverSpiritWell(now, added);
    return added;
  }

  /** Automatic expansion is off by default (tuning.expansion.automatic): the treeline is pushed back by buying 'Room to grow' in the Store. */
  checkExpansion(now) { if ((this.t.expansion || {}).automatic && this.expansionReady(now)) this.expand(now); }
  get forestFullyOpen() { const c = this.clearing, s = this.state.size; return c.x0 <= 0 && c.y0 <= 0 && c.x1 >= s.width - 1 && c.y1 >= s.height - 1; }

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

  /** How long an unpicked find lasts: its own lifetimeHours, else by rarity (tuning.spawns.wilting). */
  lifetime(itemID) {
    const def = this.content.items[itemID];
    const h = def?.spawn?.lifetimeHours;
    if (h != null) return h * HOUR;
    const w = this.t.spawns.wilting || {};
    if (def && w[def.rarity] != null) return w[def.rarity] * HOUR;
    return this.t.spawns.lifetimeSeconds * 1000;
  }

  expireSpawns(t) {
    if (this.state.buffs && this.state.buffs.length) this.state.buffs = this.state.buffs.filter((b) => b.expiresAt > t);
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
    let loc = null, field = null;
    const shared = () => field || (field = this.statField(t));
    for (let i = 0; i < st.attemptsPerTick; i++) {
      if (this.state.spawns.length >= cap) break;
      if (!this.rng.chance(Math.min(1, st.spawnChance * this.buffMult('lively', t)))) continue;
      // Where: weighted towards tiles with active effects (see spawnLocations). The free/area
      // check keeps the overall spawn rate the same as picking any tile at random.
      loc = loc || this.spawnLocations(t, shared());
      if (!loc.tiles.length || !this.rng.chance(loc.tiles.length / area)) continue;
      const picked = weightedPick(loc.tiles.map((x) => [x, x.weight]), this.rng);
      if (!picked || !this.isFree(picked.tile)) continue;
      const tile = picked.tile;
      // Untouched ground is quieter: only some attempts there produce anything.
      if (!(picked.effects > 0) && !this.rng.chance(st.blankTileSpawnChance ?? 1)) continue;
      const item = this.pickSpawn(tile, t);
      if (item) {
        this.state.spawns.push(this.newSpawn(item, tile, t));
        made++;
      }
    }
    made += this.growthBonuses(t, cap, shared());
    return made;
  }



  /**
   * Category growth bonuses, proportional per tile (so a few qualifying tiles never hog the forest):
   * each qualifying free tile gets an extra chance this tick of `normal per-tile spawn rate × bonus`,
   * restricted to its category. Spore tiles grow mushrooms faster (terrain.spore.mushroomGrowth);
   * wild meadows sprout plants faster (combos.meadow.plantGrowth).
   */
  growthBonuses(t, cap, field) {
    const st = this.t.spawns, c = this.clearing;
    const area = (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
    const perTile = (st.attemptsPerTick * st.spawnChance * this.buffMult('lively', t)) / Math.max(1, area);   // the normal rate for one tile
    const mg = (this.terrain.spore || {}).mushroomGrowth || {};
    const meadow = this.combo('meadow'), pg = meadow.plantGrowth || {};
    const K = field.keys.length, W = this.state.size.width, names = this.tileKeys.names;
    const kd = field.keys.indexOf('spore'), kb = field.keys.indexOf('bloom'), kv = field.keys.indexOf('verdure');
    const mreq = Object.entries(meadow.requires || {}).map(([k, b]) => [field.keys.indexOf(k), b]);
    const occ = this.occupied();
    let made = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      if (this.state.spawns.length >= cap) return made;
      const o = (y * W + x) * K;
      const spore = field.values[o + kd] || 0;
      if (spore < (mg.minSpore ?? 6) && !(field.values[o + kb] > 0)) continue;     // most tiles: nothing to do
      const isMeadow = mreq.length && mreq.every(([ki, b]) => ki >= 0 && boundMatches(b, field.values[o + ki]));
      let cat = null, bonus = 0;
      if (spore >= (mg.minSpore ?? 6)) { cat = 'mushroom'; bonus = Math.min(mg.maxBonus ?? 2, spore * (mg.perPoint ?? 0.08)); }
      if (isMeadow) {
        const b = Math.min(pg.maxBonus ?? 2.5, ((field.values[o + kb] || 0) + (field.values[o + kv] || 0)) * (pg.perPoint ?? 0.06));
        if (b > bonus || this.rng.chance(0.5)) { cat = 'plant'; bonus = b; }
      }
      if (!cat || bonus <= 0 || !this.rng.chance(perTile * bonus) || occ.has(names[y * W + x])) continue;
      const tile = { x, y };
      const item = weightedPick(this.spawnDetails(tile, t).filter((d) => d.item.category === cat).map((d) => [d.item, d.weight]), this.rng);
      if (!item) continue;
      this.state.spawns.push(this.newSpawn(item, tile, t));
      occ.add(names[y * W + x]);
      made++;
    }
    return made;
  }



  /**
   * Spawn-location weights for every free tile in the clearing, from the garden's live effect data:
   *   effects  = creatures whose influence reaches the tile + active soil boosts on it
   *            + creature special-effect areas covering it + combo tiles (pool, moss, meadow)
   *   general  = generalByEffectCount[min(effects, last)]          (1, 1.5, 2, 2.5 by default)
   *            × (1 + min(maxIntensityBonus, perStatPoint × tile stat total))
   *   weight   = base × general, capped at maxWeight              (spawns.locationWeighting)
   * The general bonus makes effect-bearing tiles likelier to get a spawn of any category; which
   * category then comes from the tile's own stats (spawns.categoryScaling, combos), so specialised
   * tiles keep their identity. With nothing active every tile weighs `base` (the old uniform pick).
   * Everything is derived from saved state (placements, boosts, stats), so it is rebuilt exactly after
   * a reload, and follows effects as they ramp, decay, move or expire. Spawns themselves add nothing,
   * so there is no runaway feedback.
   */
  spawnLocations(t, field = null) {
    const lw = (this.t.spawns && this.t.spawns.locationWeighting) || {};
    const on = lw.enabled !== false;
    const base = lw.base ?? 1, perPt = lw.perStatPoint ?? 0, max = lw.maxWeight ?? Infinity;
    const table = lw.generalByEffectCount || [1, 1.5, 2, 2.5], maxInt = lw.maxIntensityBonus ?? Infinity;
    const W = this.state.size.width, H = this.state.size.height, c = this.clearing;
    const sources = new Float32Array(W * H), fx = new Float32Array(W * H);
    if (on) {
      field = field || this.statField(t);
      for (const p of this.effectivePlacements(t)) {
        if (this.stats.level(p, t) <= 0.01) continue;
        const reach = this.stats.reach(p.radius), r = Math.ceil(reach);
        const sp = this.species(p);
        const areaFx = (p.removedAt == null && sp && sp.effects ? sp.effects : []).filter((e) => e.scope !== 'forest' && e.scope !== 'tile').length;
        for (let y = Math.max(c.y0, p.tile.y - r); y <= Math.min(c.y1, p.tile.y + r); y++) {
          for (let x = Math.max(c.x0, p.tile.x - r); x <= Math.min(c.x1, p.tile.x + r); x++) {
            if (Math.hypot(x - p.tile.x, y - p.tile.y) >= reach) continue;
            sources[y * W + x] += 1;
            fx[y * W + x] += areaFx;
          }
        }
      }
      for (const b of [...this.activeBoosts(t), ...this.landmarkAuras()]) if (this.boostLevel(b, t) > 0) for (const bt of this.boostTiles(b)) sources[bt.y * W + bt.x] += 1;
    }
    const tiles = [];
    let total = 0;
    const occ = this.occupied();
    // Per-tick constants (Glow by day/night and Spirit, Bloom's cycle) instead of per tile.
    const K = on ? field.keys.length : 0;
    const coreIdx = on ? CORE_STATS.map((k) => field.keys.indexOf(k)) : [];
    const spiritIdx = on ? field.keys.indexOf('spirit') : -1;
    const bloomF = this.bloomFactor(t), gc = this.terrain.glowCycle || {}, night = this.isNight(t);
    const gN = gc.nightFactor ?? 1.6, gD = gc.dayFactor ?? 0.4, gFull = Math.max(1, gc.spiritForFullGlow ?? 40);
    const glowAt = (spirit) => (night ? gN : gD + (gN - gD) * Math.min(1, spirit / gFull));
    const comboReqs = on ? Object.entries(this.t.combos || {}).filter(([id]) => !id.startsWith('_'))
      .map(([id, cb]) => [id, Object.entries(cb.requires || {}).map(([k, b]) => [field.keys.indexOf(k), b])]) : [];
    const terReqs = on ? this.terrainDefs.map((d) => [d, Object.entries(d.requires).map(([k, b]) => [field.keys.indexOf(k), b])]) : [];
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const tile = { x, y };
        if (occ.has(x + ',' + y) || !this.inBounds(tile)) continue;
        let weight = base, intensity = 0, effects = 0, general = 1;
        const i = y * W + x;
        if (on) {
          const o = i * K;
          for (let ki = 0; ki < coreIdx.length; ki++) {
            const v = field.values[o + coreIdx[ki]] || 0;
            if (!v) continue;
            const k = CORE_STATS[ki];
            intensity += v * (k === 'glow' ? glowAt(field.values[o + spiritIdx] || 0) : k === 'bloom' ? bloomF : 1);
          }
          let combos = 0;
          for (const [, reqs] of comboReqs) if (reqs.every(([ki, b]) => ki >= 0 && boundMatches(b, field.values[o + ki]))) combos++;
          // A named terrain counts as one more effect, and some draw spawns more (rule.location).
          let terN = 0, terSum = -1, terLoc = 1;
          if (intensity > 0) {
            for (let ti = 0; ti < terReqs.length; ti++) {
              const reqs = terReqs[ti][1];
              if (reqs.length < terN) continue;
              let sum = 0, okT = true;
              for (let r = 0; r < reqs.length; r++) {
                const ki = reqs[r][0], v = ki >= 0 ? field.values[o + ki] : 0;
                if (ki < 0 || !boundMatches(reqs[r][1], v)) { okT = false; break; }
                sum += v;
              }
              if (okT && (reqs.length > terN || sum > terSum)) { terN = reqs.length; terSum = sum; const d = terReqs[ti][0]; terLoc = (d.rule && d.rule.location) || 1; }
            }
          }
          if (terN) combos++;
          // A tile with no stat at or above the influence floor is blank: no effects count there.
          effects = intensity > 0 || combos > 0 ? sources[i] + fx[i] + combos : 0;
          general = table[Math.min(table.length - 1, Math.round(effects))] * (1 + Math.min(maxInt, perPt * intensity));
          weight = Math.min(max, base * general * terLoc);
        }
        tiles.push({ tile, weight, intensity, effects, general, sources: sources[i] });
        total += weight;
      }
    }
    return { tiles, total };
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
    // Glow counts for more at night (and in Spirit), Bloom follows its daily cycle.
    const fac = this.statFactors(t, s);
    const varietyExp = this.varietyExponent(s, t);
    const out = [];
    const isPool = this.combosAt(s).includes('pool');
    // Named terrain (tuning.terrains): its home items are likelier, more so at its time (night/day/rain).
    const ter = this.terrainAt(s);
    let homeMult = 1;
    if (ter) {
      const r = ter.rule || {};
      homeMult = (this.t.terrains.homeMult ?? 1) * (night ? (r.night ?? 1) : (r.day ?? 1)) * (raining ? (r.rain ?? 1) : 1);
    }
    // Terrain affinity (spawns.terrainAffinity): the tile's intensity levels, and which categories it favours.
    const aff = (this.t.spawns && this.t.spawns.terrainAffinity) || null;
    const lvl = {}; let maxLvl = 0;
    for (const k of CORE_STATS) { lvl[k] = intensityOf(s[k] || 0, this.t).level; maxLvl = Math.max(maxLvl, lvl[k]); }
    const cs = (this.t.spawns && this.t.spawns.categoryScaling) || {};
    const favoured = new Set(Object.keys(cs).filter((cat) => typeof cs[cat] === 'object' && Object.keys(cs[cat]).some((k) => lvl[k] > 0)));
    const pool = isPool && this.combo('pool').onlySporeItems;
    const keenFor = {};
    for (const [id, u] of Object.entries(this.t.upgrades || {})) if (u && u.category && this.upgradeTier(id)) keenFor[u.category] = (keenFor[u.category] || 0) + this.upgradeTier(id) * (u.perTierPerRarity ?? 0);
    for (const item of opts.items || this.content.spawnableItems) {
      const rule = item.spawn;
      if (!rule) continue;
      if (pool && !(rule.requires && rule.requires.spore)) continue;   // shallow water: only Spore-loving things
      if (rule.terrain === 'pool' && !isPool) continue;                // e.g. Water Reed: shallow pools only
      if (rule.time === 'night' && !night) continue;
      if (rule.time === 'day' && night) continue;
      if (!opts.seed && rule.rain && !raining) continue;
      if (!opts.seed && rule.oneAtATime && onMap.has(item.id)) continue;
      const req = rule.requires || {};
      const stats = new Set([...Object.keys(req), ...Object.keys(rule.statScaling || {})]);
      let ok = true, unmet = false;
      // From seed, common/uncommon flowers grow even where their needs aren't met (just less likely).
      const soft = opts.seed && rule.seedOnly && rarityIndex(item.rarity) <= rarityIndex((this.t.seeds && this.t.seeds.softNeedsUpTo) || 'uncommon');
      const mins = {}, vals = {};
      for (const stat of stats) {
        const b = { ...(req[stat] || {}) };
        for (const e of offsetFx) if (e.stat === stat && Game.effectMatches(e, item) && b.min != null) b.min = Math.max(0, b.min + (e.offset || 0));
        let v = s[stat] || 0;
        for (const e of subFx) if (e.from === stat && Game.effectMatches(e, item) && e.to) v = Math.max(v, s[e.to] || 0);
        if (req[stat] && !boundMatches(b, v)) { if (soft) unmet = true; else { ok = false; break; } }
        mins[stat] = b.min || 0;
        vals[stat] = v;
      }
      if (!ok) continue;
      let raw = 1;
      for (const stat in rule.statScaling || {}) raw += (rule.statScaling[stat] / 100) * Math.max(0, vals[stat] - mins[stat]) * (fac[stat] ?? 1);
      const mult = Math.min(hi, Math.max(lo, raw));
      let fx = 1;
      for (const e of weightFx) if (Game.effectMatches(e, item)) fx *= e.mult ?? 1;
      let weight = rule.baseWeight * mult * fx;
      let affinity = 1;
      if (unmet) {
        affinity = (this.t.seeds && this.t.seeds.unmetFactor) ?? 1;
        weight *= affinity;
      } else if (aff) {
        const needs = Object.keys(req);
        if (needs.length) {
          // Its home terrain: rarer items are weighted much more heavily where their needs are met.
          const extra = needs.reduce((a, k) => a + Math.max(0, lvl[k] - intensityOf(mins[k] || 0, this.t).level), 0) / needs.length;
          // Matching ground boosts the item (more for rarer ones, a little more per level above its need, up
          // to extraLevelCap); ground far richer than the item needs (beyond overshootGrace levels) fades it,
          // so a strong terrain shows the items made for it rather than the same low-need commons.
          const boost = 1 + (aff.perExtraLevel ?? 0) * Math.min(extra, aff.extraLevelCap ?? Infinity);
          const fade = Math.max(aff.genericMinFactor ?? 0.1, 1 - (aff.overshootFadePerLevel ?? 0) * Math.max(0, extra - (aff.overshootGrace ?? Infinity)));
          affinity = (aff.byRarity[item.rarity] ?? 1) * boost * fade;
        } else if (maxLvl > 0 && !favoured.has(item.category)) {
          // Plain-forest items fade on ground with a character that favours something else.
          affinity = Math.max(aff.genericMinFactor ?? 0.1, 1 - (aff.genericFadePerLevel ?? 0.3) * maxLvl);
        }
        weight *= affinity;
      }
      const home = ter && ter.home.has(item.id) ? homeMult : 1;
      weight *= home;
      // Keen Eye upgrades: that category's uncommon and rarer finds weigh more, more for rarer ones.
      const keen = keenFor[item.category];
      if (keen && rarityIndex(item.rarity) > 0) weight *= 1 + keen * rarityIndex(item.rarity);
      // Clustering plants (reeds): likelier next to one of their own.
      if (rule.cluster && this.state.spawns.some((x) => x.itemID === item.id && Math.max(Math.abs(x.tile.x - tile.x), Math.abs(x.tile.y - tile.y)) === 1)) {
        weight *= this.combo('pool').clusterBonus ?? 2.5;
      }
      // High Bloom: a wider variety of plants (weights flattened toward each other).
      const variety = item.category === 'plant' ? varietyExp : 1;
      if (variety !== 1 && weight > 0) weight = Math.pow(weight, variety);
      if (weight > 0) out.push({ item, base: rule.baseWeight, rawMult: raw, mult, clamped: raw !== mult, fx, variety, affinity, home, terrain: ter ? ter.id : null, weight });
    }
    return out;
  }

  spawnWeights(tile, t) { return this.spawnDetails(tile, t).map((d) => [d.item, d.weight]); }

  /**
   * Category weights for a tile: spawns.categoryWeights × a stat multiplier, so a category's own
   * stats (spawns.categoryScaling, % per point) make it likelier there. E.g. Shimmer/Spirit from
   * Geode Critters tilt the area towards geodes. Clamped to categoryScaling.min/maxMultiplier.
   */
  categoryDetails(details, stats, t = null) {
    const fac = t != null && stats ? this.statFactors(t, stats) : {};
    const cw = (this.t.spawns && this.t.spawns.categoryWeights) || {};
    const cs = (this.t.spawns && this.t.spawns.categoryScaling) || {};
    const lo = cs.minMultiplier ?? 0.25, hi = cs.maxMultiplier ?? 6;
    const cats = [...new Set(details.map((d) => d.item.category))];
    const meadow = stats && this.combosAt(stats).includes('meadow') ? (this.combo('meadow').plantCategoryMult ?? 1) : 1;
    const ter = stats ? this.terrainAt(stats) : null;
    const terCat = (ter && ter.rule && ter.rule.category) || {};
    const rows = cats.map((c) => {
      let raw = c === 'plant' ? meadow : 1;
      for (const stat in cs[c] || {}) raw += (cs[c][stat] / 100) * ((stats && stats[stat]) || 0) * (fac[stat] ?? 1);
      // A named terrain's category tilt applies after the clamp, so it still counts on strong ground.
      const mult = Math.min(hi, Math.max(lo, raw)) * (terCat[c] ?? 1);
      const veins = c === 'geode' ? this.buffMult('deepVeins', t ?? this.now()) : 1;   // Spirit Well buff
      return { category: c, base: cw[c] ?? 1, mult: mult * veins, weight: (cw[c] ?? 1) * mult * veins };
    });
    const total = rows.reduce((x, r) => x + r.weight, 0) || 1;
    for (const r of rows) r.share = r.weight / total;
    return rows;
  }

  categoryOdds(details, stats, t = null) {
    return Object.fromEntries(this.categoryDetails(details, stats, t).map((r) => [r.category, r.share]));
  }

  /** Category first (mushroom / plant / geode, tilted by the tile's stats), then the item within it by effective weight. */
  pickSpawn(tile, t) {
    const details = this.spawnDetails(tile, t);
    if (!details.length) return null;
    const cats = this.categoryDetails(details, this.tileStats(tile, t), t);
    const cat = weightedPick(cats.map((r) => [r.category, r.weight]), this.rng);
    return weightedPick(details.filter((d) => d.item.category === cat).map((d) => [d.item, d.weight]), this.rng);
  }

  /** What a Mystery Seed planted on this tile now would grow into (plants it qualifies for). */
  /**
   * What a Mystery Seed can grow into: only the seed flowers (spawn.seedOnly), never wild plants like
   * Clover. Common and uncommon seed flowers can grow anywhere (their stat needs only make them
   * likelier on matching ground, tuning.seeds.softNeedsUpTo); rarer ones need their terrain.
   */
  seedDetails(tile, t) {
    const pool = this.content.itemList.filter((i) => i.category === 'plant' && i.spawn && i.spawn.seedOnly);
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
    if (!this.creaturesOn) return 0;
    const field = this.statField(t);
    const loc = new Map(this.spawnLocations(t, field).tiles.map((x) => [x.tile.x + ',' + x.tile.y, x.weight]));
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
      // Wanderers also favour tiles with active effects (same weights as wild spawns).
      // Bloom attracts wanderers: blooming tiles draw them, and raise the arrival chance.
      const bonus = (this.terrain.bloom || {}).wandererBonusPerPoint ?? 0;
      const bloomAt = (tl) => 1 + bonus * (field.statsAt(tl.x, tl.y).bloom || 0);
      const tile = weightedPick(tiles.map((x) => [x, (loc.get(x.x + ',' + x.y) ?? 1) * bloomAt(x)]), this.rng);
      const chance = (def.chance || 0) * bloomAt(tile) * this.mult(this.effects('creatureChance', tile).filter((e) => !e.family || e.family === def.family));
      if (this.rng.chance(chance)) {
        this.state.visitors.push({ id: this.rng.uuid(), speciesID: def.id, tile, arrivedAt: t });
        arrived++;
      }
    }
    return arrived;
  }

  visitorAt(t) { return this.creaturesOn ? this.state.visitors.find((v) => sameTile(v.tile, t)) || null : null; }

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
    if (!this.creaturesOn) return null;                 // creature finds (and their eggs) are off
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
      if (this.rng.chance(Math.min(1, (def.chance || 0) * m * this.buffMult('luckyFinds', now)))) { hit = def; break; }
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
    return hit ? this.findResult(hit, sourceItem, now) : null;
  }

  // ---- eggs (tuning.creatureFinds "egg"): finds give eggs; eggs hatch in nests from the nest tile's stats
  get eggMode() { return (this.t.creatureFinds || 'egg') === 'egg' && (this.content.eggs || []).length > 0; }
  /** Creatures shape the land only while tuning.creaturePlacement.enabled (off: relics do). */
  get creaturesOn() { return (this.t.creaturePlacement || {}).enabled !== false; }
  /** The egg system (finds give eggs, nests) runs only while creatures are on and tuning.eggs.enabled. */
  get eggsOn() { return this.creaturesOn && (this.t.eggs || {}).enabled !== false; }
  get eggCfg() { return this.t.eggs || {}; }
  eggDef(id) { return (this.content.eggs || []).find((e) => e.id === id) || null; }

  /** What a find gives: the creature itself ("instant"), or an egg of its family and tier. Pending loot. */
  findResult(def, sourceItem, now) {
    if (!this.eggMode) return { creature: this.makeCreature(def.id, sourceItem, now) };
    return { item: this.eggFor(def.family, def.rarity), count: 1 };
  }

  /**
   * The egg for a foraged find. Its tier is the found species' rarity, but rare and rarer tiers are
   * kept only with that egg's foraging weight (otherwise it's an uncommon egg); a per-family pity
   * (tuning.pity.rareEgg) keeps the tier after a run of misses.
   */
  eggFor(family, rarity) {
    const eggs = (this.content.eggs || []).filter((e) => e.family === family);
    let tier = rarity;
    if (rarityIndex(tier) >= rarityIndex('rare')) {
      const egg = eggs.find((e) => e.tier === tier);
      const key = 'rareEgg:' + family, threshold = this.t.pity.rareEgg || 0;
      const misses = this.state.pity[key] || 0;
      const keep = (threshold > 0 && misses + 1 >= threshold) || this.rng.chance(egg ? egg.foragingWeight ?? 1 : 1);
      this.state.pity[key] = keep ? 0 : misses + 1;
      if (!keep) tier = 'uncommon';
    }
    const pick = eggs.find((e) => e.tier === tier)
      || eggs.filter((e) => rarityIndex(e.tier) <= rarityIndex(tier)).sort((a, b) => rarityIndex(b.tier) - rarityIndex(a.tier))[0] || eggs[0];
    return pick ? pick.id : null;
  }

  /** The opening's guaranteed egg: its family (or a random one, tuning.start.eggFamily "random"); nesting it hatches quickly. */
  starterEgg(family, rarity) {
    const st = this.t.start || {};
    const fams = [...new Set((this.content.eggs || []).map((e) => e.family))];
    const fam = st.eggFamily === 'random' && fams.length ? fams[this.rng.int(0, fams.length - 1)] : (st.eggFamily || family);
    const id = (this.content.eggs || []).find((e) => e.family === fam && e.tier === (rarity || 'common'))?.id || this.eggFor(fam, rarity || 'common');
    this.state.quickEggs = (this.state.quickEggs || 0) + 1;
    return { item: id, count: 1 };
  }

  get nestSlots() { return (this.eggCfg.baseNests ?? 1) + (this.state.unlocks.nests || 0) + this.landmarkEffects('extraNest').reduce((a, [e]) => a + (e.add || 1), 0); }
  nestAt(t) { return this.eggsOn ? this.state.nests.find((n) => sameTile(n.tile, t)) || null : null; }
  nestProgress(n, now) { return Math.min(1, Math.max(0, (now - n.startedAt) / (Math.max(1, n.hatchSeconds) * 1000))); }

  /** Put an egg from the Bag in a nest on an open tile. */
  nestEgg(eggID, tile, now) {
    const egg = this.eggDef(eggID);
    if (!egg) throw new GameError("That isn't an egg.");
    if (!(this.state.inventory[eggID] > 0)) throw new GameError("You don't have that.");
    if (this.state.nests.length >= this.nestSlots) throw new GameError('Every nest is in use. Earn another nest in the Store.');
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    this.consume(eggID);
    let hatchSeconds = (egg.hatchHours || 6) * 3600 / (1 + this.upgradeTier('hatchSpeed') * ((this.upgradeDef('hatchSpeed') || {}).perTier ?? 0)) / this.buffMult('warmBrood', now);   // Warm Nest, Warm brood
    // The opening's egg hatches while the player is away the first time (tuning.start.firstEggHatchMinutes).
    if (this.state.quickEggs > 0) { this.state.quickEggs--; hatchSeconds = ((this.t.start || {}).firstEggHatchMinutes ?? 45) * 60; }
    const n = { id: this.rng.uuid(), eggID, tile: { ...tile }, startedAt: now, hatchSeconds, glimmer: false };
    this.state.nests.push(n);
    this.bump('nest');
    return n;
  }

  /**
   * Species an egg could hatch into on a tile right now, with weights: its family, at or below its
   * tier, whose tile conditions the stats meet. Weight = the species' find chance, boosted for the
   * egg's own tier (eggs.sameTierBoost) and the tier just below (eggs.tierBelowBoost). If nothing
   * qualifies, the family's most common species with no conditions (so an egg never fails).
   */
  hatchCandidates(eggID, stats, t, startedAt = t) {
    const egg = this.eggDef(eggID);
    if (!egg) return [];
    const cfg = this.eggCfg, top = rarityIndex(egg.tier);
    const fam = this.content.creatureList.filter((d) => d.family === egg.family && !d.notYet && rarityIndex(d.rarity) <= top);
    const out = [];
    for (const d of fam) {
      if (!groupMatches(d.requires || {}, stats)) continue;
      if (d.plantedTime && (d.plantedTime === 'night') !== this.isNight(startedAt)) continue;
      if (d.unique && this.ownsSpecies(d.id)) continue;
      const ri = rarityIndex(d.rarity);
      const boost = ri === top ? (cfg.sameTierBoost ?? 1) : ri === top - 1 ? (cfg.tierBelowBoost ?? 1) : 1;
      out.push({ def: d, weight: (d.chance || 0.01) * boost });
    }
    if (!out.length) {
      const plain = fam.filter((d) => !d.requires || !Object.keys(d.requires).length).sort((a, b) => (b.chance || 0) - (a.chance || 0));
      const fb = plain[0] || fam[0];
      if (fb) out.push({ def: fb, weight: 1, fallback: true });
    }
    return out;
  }

  /** Hatch odds for an egg on a tile (same maths as hatching, incl. the new-species pity). */
  hatchPreview(eggID, tile, t, startedAt = t) {
    let list = this.hatchCandidates(eggID, this.tileStats(tile, t), t, startedAt);
    const egg = this.eggDef(eggID);
    if (egg && this.newSpeciesPityDue(egg.family)) {
      const fresh = list.filter((x) => !this.discovered.has('creature:' + x.def.id));
      if (fresh.length) list = fresh;
    }
    const tot = list.reduce((a, x) => a + x.weight, 0) || 1;
    return list.map((x) => ({ def: x.def, p: x.weight / tot, fallback: !!x.fallback })).sort((a, b) => b.p - a.p);
  }

  newSpeciesPityDue(family) {
    const n = this.t.pity.hatchNewSpecies || 0;
    return n > 0 && (this.state.pity['hatch:' + family] || 0) >= n;
  }

  /** Hatch a ready nest: the species comes from the nest tile's stats now. */
  hatch(nestID, now) {
    const i = this.state.nests.findIndex((n) => n.id === nestID);
    if (i < 0) throw new GameError('Unknown nest.');
    const n = this.state.nests[i];
    if (this.nestProgress(n, now) < 1) throw new GameError("It isn't ready to hatch yet.");
    const egg = this.eggDef(n.eggID);
    const list = this.hatchPreview(n.eggID, n.tile, now, n.startedAt);
    if (!list.length) throw new GameError('Nothing can hatch from that egg.');
    const def = weightedPick(list.map((x) => [x.def, x.p]), this.rng);
    const key = 'hatch:' + egg.family;
    const isNewSpecies = !this.discovered.has('creature:' + def.id);
    this.state.pity[key] = isNewSpecies ? 0 : (this.state.pity[key] || 0) + 1;
    // A Moonwell nearby makes a Glimmer likelier (landmark effect glimmerBoost).
    const well = this.landmarkEffects('glimmerBoost').filter(([e, lm]) => dist(lm.tile, n.tile) <= (e.range || 0)).reduce((m, [e]) => Math.max(m, e.mult || 1), 1);
    const boosted = well > 1 && this.rng.chance(Math.min(1, (this.t.glimmerChance || 0) * well));
    const creature = n.glimmer || boosted ? this.rollCreature(def.id, 'egg', now, true) : this.makeCreature(def.id, 'egg', now);
    this.state.nests.splice(i, 1);
    this.bump('hatch');
    const results = this.grant([{ creature }]);
    this.events.push({ type: 'hatched', creatureID: creature.id, tile: n.tile });
    return results;
  }

  /** A Moonfall Shard on a nest: what hatches there is a Glimmer. */
  shardNest(nestID) {
    const n = this.state.nests.find((x) => x.id === nestID);
    if (!n) throw new GameError('Unknown nest.');
    if (n.glimmer) throw new GameError('This nest already holds a Glimmer.');
    const shard = Object.values(this.content.items).find((i) => i.use && i.use.type === 'nextGlimmer');
    if (!shard || !(this.state.inventory[shard.id] > 0)) throw new GameError("You don't have a Moonfall Shard.");
    this.consume(shard.id);
    n.glimmer = true;
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
  /** There is no cap on creatures in the forest any more. */
  get freeSlotCount() { return Infinity; }
  inBounds(t) { return t.x >= 0 && t.y >= 0 && t.x < this.state.size.width && t.y < this.state.size.height; }
  creatureAt(t) { return this.state.placements.find((p) => p.removedAt == null && sameTile(p.tile, t)) || null; }
  spawnAt(t) { return this.state.spawns.find((s) => sameTile(s.tile, t)) || null; }
  seedAt(t) { return this.state.plantedSeeds.find((s) => sameTile(s.tile, t)) || null; }
  sceneryAt(t) { return (this.state.scenery || []).find((d) => sameTile(d.tile, t)) || null; }
  decorAt(t) { return this.state.decor.placed.find((d) => sameTile(d.tile, t)) || null; }
  /** Every occupied tile ("x,y"), built once so whole-map scans don't search lists per tile. */
  occupied() {
    const s = this.state, out = new Set();
    for (const l of s.landmarks || []) for (const t of this.landmarkTiles(l)) out.add(t.x + ',' + t.y);
    for (const p of this.activePlacements) out.add(p.tile.x + ',' + p.tile.y);
    for (const x of s.spawns) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of s.plantedSeeds) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of s.visitors || []) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of (s.decor && s.decor.placed) || []) out.add(x.tile.x + ',' + x.tile.y);
    if (this.eggsOn) for (const x of s.nests || []) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of s.relics || []) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of s.scenery || []) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of s.soilBoosts || []) if (x.seed) out.add(x.tile.x + ',' + x.tile.y);
    return out;
  }

  isFree(t) { return this.inBounds(t) && this.inClearing(t) && !this.landmarkAt(t) && !this.creatureAt(t) && !this.spawnAt(t) && !this.seedAt(t) && !this.visitorAt(t) && !this.decorAt(t) && !this.nestAt(t) && !this.sceneryAt(t) && !this.buriedSeedAt(t) && !this.relicAt(t); }
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

  /**
   * After a creature rebalance (tuning.creatureRoll.balanceVersion), owned creatures take their
   * species' new values: each keeps a stable roll quality (from its id), its glimmer status, name,
   * origin and placement; placements (including fading ones) are updated to match. Runs once.
   */
  rebalanceOwnedCreatures() {
    const roll = this.t.creatureRoll || {};
    const version = roll.balanceVersion || 1;
    const s = this.state;
    if ((s.balanceVersion || 1) >= version) return;
    const [lo, hi] = roll.bonusRange || [0.8, 1];
    for (const c of s.creatures) {
      const def = this.content.creatures[c.typeID];
      if (!def) continue;
      const q = lo + (hi - lo) * (hashStr(c.id) / 4294967296);
      const contributions = {};
      for (const stat in def.bonuses || {}) {
        let v = def.bonuses[stat] * q;
        if (c.isGlimmer) v *= roll.glimmerBonusMult ?? 1.5;
        contributions[stat] = Math.round(v * 10) / 10;
      }
      for (const stat in def.extraContributions || {}) {
        const v = def.extraContributions[stat];
        contributions[stat] = (contributions[stat] || 0) + (c.isGlimmer ? v * (roll.glimmerBonusMult ?? 1.5) : v);
      }
      c.contributions = contributions;
      c.radius = Math.round(((def.radius ?? 2) + (c.isGlimmer ? roll.glimmerRadiusBonus ?? 0 : 0)) * 10) / 10;
      c.rampHours = def.rampHours ?? c.rampHours;
      for (const p of s.placements) if (p.creatureID === c.id) { p.contributions = { ...contributions }; p.radius = c.radius; if (p.removedAt == null && c.rampHours) p.rampSeconds = c.rampHours * 3600; }
    }
    s.balanceVersion = version;
    this.statCache = null;
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
    const cap = this.creatureCap(now);
    if (cap != null && this.activePlacements.length >= cap) throw new GameError('Every creature slot is in use. Bring one home, or earn another slot in the Store.');
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
    if (this.state.spawns[i].opening) throw new GameError('It waits to be asked.');
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
        // The starter's guaranteed creature comes straight away; other finds are eggs (tuning.creatureFinds).
        const gc = spawn.forcedCreature && !this.eggMode && this.guaranteedCreature('mushroom', def.id, spawn.forcedCreature.rarity, now);
        const c = spawn.forcedCreature && this.eggMode ? this.starterEgg('fungling', spawn.forcedCreature.rarity)
          : gc ? { creature: gc } : this.findCreature('mushroom', def.id, spawn.tile, stats, now);
        if (c) pending.push(c);
      }
      // Verdure: plants on lush tiles drop extra seeds.
      if (def.category === 'plant') {
        const v = this.terrain.verdure || {};
        const chance = Math.min(v.maxExtraSeedChance ?? 0.6, (stats.verdure || 0) * (v.extraSeedPerPoint ?? 0));
        const seed = Object.values(this.content.items).find((i) => i.category === 'seed');
        if (seed && chance > 0 && this.rng.chance(chance)) pending.push({ item: seed.id, count: 1, extraSeed: true });
      }
    }
    if (spawn.placement === 'buried') this.bump('dig');
    for (const e of this.effects('bonusDrop', spawn.tile)) {
      if ((e.items || []).includes(def.id) && e.table && this.rng.chance(e.chance || 0)) pending.push(...this.rollTable(e.table, def.id, now));
    }
    // On mature, strong relic ground a find very occasionally holds a relic (tuning.relics.findDrop).
    const relicDrop = !spawn.forced && this.relicFromFind(spawn.tile, stats, now);
    if (relicDrop) pending.push({ item: relicDrop, count: 1 });
    // A find of a garden school sometimes drops that school's seed (tuning.schoolSeeds.dropChance).
    const school = this.schoolOf(def), seedID = school && this.content.schoolSeedFor && this.content.schoolSeedFor[school];
    if (seedID && !spawn.forced && this.rng.chance(this.seedCfg.dropChance ?? 0)) pending.push({ item: seedID, count: 1 });
    // Guaranteed drops (the opening's finds): make sure each forced item is included at least once.
    for (const f of spawn.forced || []) {
      if (!pending.some((x) => x.item === f.item)) pending.push({ item: f.item, count: f.count || 1 });
    }
    if (def.inGuide !== false) this.discover('item:' + def.id);
    if (spawn.nibbled) this.events.push({ type: 'nibbleClue', text: this.readNibble(spawn) });
    // Tracks under a find are read as it's picked.
    const track = this.trackAt(spawn.tile);
    if (track) this.events.push({ type: 'nibbleClue', text: this.readTrack(track.id) });
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
    this.plantAt(itemID, tile, now);
    this.bump('plant');
    if (this.state.tutorial.step === 'plant') this.enterTutorialStep('dig', now);
  }

  /** Put a seed in the ground (shared by planting from the bag and bonus seeds from creatures). */
  plantAt(itemID, tile, now, extra = {}) {
    // Verdure: plants grow faster on lush tiles.
    const verdure = this.tileStats(tile, now).verdure || 0;
    const meadow = this.combosAt(this.tileStats(tile, now)).includes('meadow') ? (this.combo('meadow').flowerGrowthMult ?? 1) : 1;
    const speed = this.mult(this.effects('seedGrowth', tile)) * (1 + verdure * ((this.terrain.verdure || {}).seedGrowthPerPoint ?? 0)) * meadow;
    const quick = 1 + this.upgradeTier('seedSpeed') * ((this.upgradeDef('seedSpeed') || {}).perTier ?? 0);   // Quick Roots
    const grow = this.rng.range(...range(this.t.seeds.growSeconds)) / Math.max(0.01, speed * quick * this.buffMult('quickSprouts', now));
    // The plant is chosen now (tile stats + time of day at planting), so its growth stages can show it.
    const plantID = this.choosePlant(tile, now);
    const seed = { id: this.rng.uuid(), seedItemID: itemID, tile: { ...tile }, plantedAt: now, growSeconds: grow, plantID, ...extra };
    this.state.plantedSeeds.push(seed);
    return seed;
  }

  // ---- creature interactions (rewards; the cosmetic moments are drawn by the renderer)

  /** Pairs of active creatures whose influence reaches overlap. */
  interactionPairs(t) {
    const ps = this.activePlacements.filter((p) => this.stats.level(p, t) > 0.2);
    const out = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (dist(a.tile, b.tile) < this.stats.reach(a.radius) + this.stats.reach(b.radius)) out.push([a, b]);
    }
    return out;
  }

  /**
   * Once per spawn tick: each eligible pair (off cooldown) may interact (pairChancePerTick). Some
   * interactions leave a bonus seed planted or a geode dug up near them (rewardChance x rarity bonus),
   * at most maxRewardsPerDay. Rewards go through the normal seed/spawn systems on a free clearing tile,
   * and are saved like any other. `live` adds an event so the renderer can animate it.
   */
  interactionTick(t, live = false) {
    const cfg = this.t.interactions;
    if (!cfg) return 0;
    const st = this.state.interactions || (this.state.interactions = { cooldowns: {}, day: Game.dayNumber(t), rewards: 0 });
    const day = Game.dayNumber(t);
    if (st.day !== day) { st.day = day; st.rewards = 0; }
    for (const k in st.cooldowns) if (st.cooldowns[k] <= t) delete st.cooldowns[k];
    let made = 0;
    for (const [a, b] of this.interactionPairs(t)) {
      const key = [a.creatureID, b.creatureID].sort().join('|');
      if (st.cooldowns[key] > t || !this.rng.chance(cfg.pairChancePerTick ?? 0.05)) continue;
      st.cooldowns[key] = t + (cfg.pairCooldownMinutes ?? 90) * 60000;
      if (st.rewards >= (cfg.maxRewardsPerDay ?? 3)) continue;
      const bonus = cfg.rarityRewardBonus || {};
      const rb = ((bonus[this.species(a)?.rarity] ?? 1) + (bonus[this.species(b)?.rarity] ?? 1)) / 2;
      if (!this.rng.chance((cfg.rewardChance ?? 0.35) * rb)) continue;
      const mid = { x: Math.round((a.tile.x + b.tile.x) / 2), y: Math.round((a.tile.y + b.tile.y) / 2) };
      const tile = this.isFree(mid) ? mid : this.freeNear(mid);
      if (!tile || !this.inClearing(tile)) continue;
      const w = cfg.rewardWeights || { seed: 0.6, geode: 0.4 };
      const kind = weightedPick(Object.entries(w), this.rng);
      let itemID = null;
      if (kind === 'seed') {
        const seedDef = Object.values(this.content.items).find((i) => i.category === 'seed');
        if (!seedDef) continue;
        this.plantAt(seedDef.id, tile, t, { bonus: true });
        itemID = seedDef.id;
      } else {
        const pick = weightedPick(this.spawnDetails(tile, t).filter((d) => d.item.category === 'geode').map((d) => [d.item, d.weight]), this.rng)
          || Object.values(this.content.items).find((i) => i.category === 'geode' && i.spawn && (!i.spawn.requires || !Object.keys(i.spawn.requires).length));
        if (!pick) continue;
        this.state.spawns.push({ ...this.newSpawn(pick, tile, t), placement: 'surface', bonus: true });
        itemID = pick.id;
      }
      st.rewards++;
      made++;
      this.bump('interactionReward');
      if (live) this.events.push({ type: 'interaction', a: a.id, b: b.id, kind, tile, itemID });
    }
    return made;
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
    if (c) return this.grant([c]);
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
    if (found && found.forcedCreature && this.eggMode) return this.grant([this.starterEgg('geodeCritter', found.forcedCreature.rarity)]);
    if (found && found.forcedCreature) return this.crackGuaranteed(found, now, opts.family);
    const tile = found ? found.foundTile : null;
    const c = this.findCreature('geode', itemID, tile, found ? found.foundStats : {}, now);
    if (c) return this.grant([c]);
    const up = tile ? Math.max(0, ...this.effects('gemUpgrade', tile).map((e) => e.chance || 0)) : 0;
    return this.grant(this.rollTable(def.onCrack, itemID, now, { gemUpgradeChance: up }));
  }

  /**
   * Crack several of one geode at once (up to tuning.geodes.batchMax, and never more than you own).
   * Each geode goes through crack() on its own (its own find record, rolls and modifiers), and its
   * rewards are granted right then, exactly once; the result is one entry per geode for display.
   */
  crackMany(itemID, count, now, opts = {}) {
    const max = ((this.t.geodes || {}).batchMax) ?? 5;
    const n = Math.max(0, Math.min(count, max, this.state.inventory[itemID] || 0));
    if (!n) throw new GameError("You don't have that.");
    const out = [];
    for (let i = 0; i < n; i++) out.push({ itemID, rewards: this.crack(itemID, now, opts) });
    return out;
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

  /** Use an item from the bag. Soil boosts and school seeds need a tile; a Moonfall Shard doesn't. */
  use(itemID, tile, now) {
    const def = this.content.items[itemID];
    if (!def || !def.use) throw new GameError("That can't be used.");
    if (!(this.state.inventory[itemID] > 0)) throw new GameError("You don't have that.");
    const use = def.use;
    if (use.type === 'bury') {
      const b = this.burySeed(itemID, tile, now);
      const hours = Math.round((b.fullUntil - now) / 3600000);
      return `${def.name} buried. ${def.school.charAt(0).toUpperCase() + def.school.slice(1)} will grow around it over the next few hours, and last about ${Math.round(hours / 24)} days.`;
    }
    if (use.type === 'soilBoost') {
      if (!tile || !this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
      this.consume(itemID);
      this.bump('use');
      this.state.soilBoosts.push({
        id: this.rng.uuid(), tile: { ...tile }, stats: { ...use.stats }, appliedAt: now,
        radius: use.radius || 0,
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

  // ---- temporary buffs (a small reusable framework; the Spirit Well grants them)
  // state.buffs: [{ id, mult, startedAt, expiresAt }]. Each type multiplies one existing calculation
  // (tuning.spiritWell.buffs): lively → spawn chance, luckyFinds → creature/egg find chance,
  // deepVeins → geode category weight, quickSprouts → seed growth, warmBrood → egg hatching.
  buffDef(id) { return ((this.t.spiritWell || {}).buffs || {})[id] || null; }
  activeBuffs(now) { return (this.state.buffs || []).filter((b) => now >= b.startedAt && now < b.expiresAt); }
  buffMult(id, now) { const b = (this.state.buffs || []).find((x) => x.id === id && now >= x.startedAt && now < x.expiresAt); return b ? b.mult : 1; }

  /** Starts a buff, or refreshes it: the stronger multiplier is kept and the time is extended, up to maxHours. */
  addBuff(id, now, opts = {}) {
    const def = this.buffDef(id);
    if (!def) throw new GameError('Unknown effect.');
    const mult = opts.mult ?? def.mult ?? 1, hours = opts.hours ?? def.hours ?? 4, max = (def.maxHours ?? hours * 2) * HOUR;
    this.state.buffs = (this.state.buffs || []).filter((b) => b.expiresAt > now);
    const cur = this.state.buffs.find((b) => b.id === id);
    if (cur) {
      cur.mult = Math.max(cur.mult, mult);
      cur.expiresAt = Math.min(now + max, Math.max(cur.expiresAt, now) + hours * HOUR);
      return cur;
    }
    const b = { id, mult, startedAt: now, expiresAt: now + Math.min(max, hours * HOUR) };
    this.state.buffs.push(b);
    return b;
  }

  // ---- the Spirit Well (tuning.spiritWell): offerings for rewards, with a hidden value system
  get wishCfg() { return this.t.spiritWell || {}; }
  get spiritWell() { return this.state.landmarks.find((l) => l.id === 'landmark.spirit-well') || null; }

  /** The first forest expansion reveals a small clearing with the Spirit Well (once). */
  discoverSpiritWell(now, tiles) {
    if (this.state.wish.discovered || this.spiritWell) return null;
    const def = (this.content.landmarks || []).find((d) => d.id === 'landmark.spirit-well');
    if (!def) return null;
    const c = this.clearing;
    const blocked = (t) => this.landmarkAt(t) || this.creatureAt(t) || this.nestAt(t) || this.decorAt(t) || this.seedAt(t) || this.visitorAt(t);
    // Prefer the newly revealed ground, one tile in from the treeline; else anywhere near the edge.
    const inner = (t) => t.x > c.x0 && t.x < c.x1 && t.y > c.y0 && t.y < c.y1;
    let pool = (tiles || []).filter((t) => inner(t) && !blocked(t));
    if (!pool.length) pool = this.clearingTiles().filter((t) => inner(t) && !blocked(t) && Math.min(t.x - c.x0, c.x1 - t.x, t.y - c.y0, c.y1 - t.y) <= 2);
    if (!pool.length) pool = this.clearingTiles().filter((t) => !blocked(t));
    if (!pool.length) return null;
    // Keep away from the old log so it feels like its own clearing.
    const log = this.state.landmarks.find((l) => l.id === 'landmark.old-log');
    pool.sort((a, b) => (log ? dist(b, log.tile) - dist(a, log.tile) : 0));
    const top = pool.slice(0, Math.max(1, Math.ceil(pool.length / 3)));
    const tile = top[this.rng.int(0, top.length - 1)];
    // A small clearing: spawns around it make way, and a few ferns and stones ring it.
    this.state.spawns = this.state.spawns.filter((sp) => Math.max(Math.abs(sp.tile.x - tile.x), Math.abs(sp.tile.y - tile.y)) > 1);
    this.state.scenery = (this.state.scenery || []).filter((d) => !sameTile(d.tile, tile));
    this.state.landmarks.push({ id: def.id, tile: { ...tile }, formedAt: now });
    const ring = [[-2, 0], [2, 0], [0, -2], [-2, -1], [2, 1]];
    for (const [dx, dy] of ring) {
      const t = { x: tile.x + dx, y: tile.y + dy };
      if (this.inClearing(t) && this.isFree(t) && this.rng.chance(0.6)) this.state.scenery.push({ tile: t, sprite: ['deco.fern.a', 'deco.mossrock.a', 'deco.lichen.a'][this.rng.int(0, 2)], flip: this.rng.chance(0.5) });
    }
    this.state.wish.discovered = now;
    this.discover('landmark:spirit-well');
    const area = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) area.push({ x: tile.x + dx, y: tile.y + dy });
    this.events.push({ type: 'spiritWellFound', tile, tiles: area });
    return tile;
  }

  /** Which of the well's groups (mushrooms / plants / gems) an item belongs to, by its item category; null if none. */
  wishGroup(itemID) {
    const def = this.content.items[itemID];
    if (!def) return null;
    for (const [g, cats] of Object.entries(this.wishCfg.categories || {})) if (cats.includes(def.category)) return g;
    return null;
  }

  /** Whether an item can be offered at all (a well group, not on the exclude list). */
  wishEligible(itemID) { return !!this.wishGroup(itemID) && !(this.wishCfg.exclude || []).includes(itemID); }

  /** Hidden value of one of an item. Never shown to the player. */
  wishValue(itemID) {
    const cfg = this.wishCfg, def = this.content.items[itemID];
    if (!def || !this.wishEligible(itemID)) return 0;
    return (cfg.itemValues || {})[itemID] ?? (cfg.values || {})[def.rarity || 'common'] ?? 1;
  }

  /** The local half-day index (midnight-noon, noon-midnight) for a time. DST/time-zone safe. */
  static halfDay(t) { return Game.dayNumber(t) * 2 + (new Date(t).getHours() >= 12 ? 1 : 0); }

  /** The group the well wants this half-day: picked at random when the half-day begins, then saved. */
  wishDemand(now) {
    const w = this.state.wish, iv = Game.halfDay(now);
    if (!w.demand || w.demand.interval !== iv) {
      const groups = Object.keys(this.wishCfg.categories || {});
      w.demand = { interval: iv, group: groups[this.rng.int(0, groups.length - 1)] };
    }
    return w.demand.group;
  }

  /** Items the player could offer, with how many they own. */
  wishInventory() {
    return Object.entries(this.state.inventory).filter(([id, n]) => n > 0 && this.wishEligible(id)).map(([id, n]) => ({ item: id, owned: n }));
  }

  /** Normalises a selection [{item, count}] (merges repeats, whole numbers) or throws if it's invalid. */
  wishSelection(selection) {
    const merged = new Map();
    for (const x of selection || []) {
      if (!x || typeof x.item !== 'string') throw new GameError('That offering is not valid.');
      const n = Number(x.count);
      if (!Number.isInteger(n) || n < 0) throw new GameError('That offering is not valid.');
      if (n) merged.set(x.item, (merged.get(x.item) || 0) + n);
    }
    const out = [...merged.entries()].map(([item, count]) => ({ item, count }));
    if (!out.length) throw new GameError('Choose something to offer first.');
    for (const x of out) {
      if (!this.content.items[x.item] || !this.wishEligible(x.item)) throw new GameError("The well won't take that.");
      if ((this.state.inventory[x.item] || 0) < x.count) throw new GameError(`You don't have ${x.count} ${this.content.items[x.item].name}.`);
    }
    return out;
  }

  /**
   * What needs an extra confirmation before it's offered: unusually valuable items (confirmRarities), and
   * items an open Old Log request or upgrade still asks for, if the offering would leave too few.
   */
  wishWarnings(selection, now) {
    const sel = this.wishSelection(selection);
    const rare = new Set(this.wishCfg.confirmRarities || []);
    const need = {};
    // One-off requests and upgrade tiers that are open now (repeatable shop listings don't count).
    for (const st of this.requestBoard(now)) if (!st.done && !st.locks.length && st.req.kind !== 'shop') for (const x of st.req.items) need[x.item] = Math.max(need[x.item] || 0, x.count);
    const out = [];
    for (const x of sel) {
      const def = this.content.items[x.item];
      const reasons = [];
      if (rare.has(def.rarity)) reasons.push('rare');
      if (need[x.item] && (this.state.inventory[x.item] || 0) - x.count < need[x.item]) reasons.push('needed');
      if (reasons.length) out.push({ item: x.item, count: x.count, reasons });
    }
    return out;
  }

  /** Effective (hidden) value of an offering: Σ count × value, × demandMult for the wanted group. */
  wishRawValue(sel, now) {
    const cfg = this.wishCfg, want = this.wishDemand(now);
    let v = 0;
    for (const x of sel) v += x.count * this.wishValue(x.item) * (this.wishGroup(x.item) === want ? (cfg.demandMult ?? 1) : 1);
    return v;
  }

  /** Effective value s in 0..1 for an offering (demand applied, capped with diminishing returns). */
  wishStrength(sel, now) {
    const cfg = this.wishCfg;
    const v = this.wishRawValue(sel, now);
    const scale = cfg.valueScale || 10, cap = cfg.valueCap || 400;
    return Math.min(1, Math.log(1 + v / scale) / Math.log(1 + cap / scale));
  }

  /** A reward tier for strength s: weights blend from tierWeightsLow to tierWeightsHigh. */
  wishTier(s) {
    const cfg = this.wishCfg, tiers = cfg.tiers || ['common'];
    const lo = cfg.tierWeightsLow || [], hi = cfg.tierWeightsHigh || [];
    return weightedPick(tiers.map((t, i) => [t, (lo[i] || 0) * (1 - s) + (hi[i] || 0) * s]), this.rng) || tiers[0];
  }

  /** One reward from a tier's pool (respecting progression); empty tiers fall to the one below. */
  wishRollReward(tier) {
    const cfg = this.wishCfg, tiers = cfg.tiers || [];
    const guide = this.guideCount;
    for (let i = tiers.indexOf(tier); i >= 0; i--) {
      const pool = ((cfg.rewards || {})[tiers[i]] || []).filter((r) => (r.minGuide || 0) <= guide && this.wishRewardValid(r));
      const r = weightedPick(pool.map((x) => [x, x.weight || 1]), this.rng);
      if (!r) continue;
      const out = { type: r.type, tier: tiers[i] };
      if (r.type === 'item') { out.item = r.item; out.count = this.rng.int((r.count || [1, 1])[0], (r.count || [1, 1])[1]); }
      if (r.type === 'egg') {
        const eggs = (this.content.eggs || []).filter((e) => e.tier === r.tier);
        out.type = 'item'; out.item = eggs[this.rng.int(0, eggs.length - 1)].id; out.count = 1;
      }
      if (r.type === 'buff') { out.buff = r.buff; if (r.mult) out.mult = r.mult; if (r.hours) out.hours = r.hours; }
      if (r.type === 'relic') {                         // a relic of that tier, of a school chosen at random
        out.type = 'item'; out.item = 'relic.' + CORE_STATS[this.rng.int(0, CORE_STATS.length - 1)] + '.' + (r.tier || 'common'); out.count = 1;
      }
      return out;
    }
    return { type: 'item', item: 'seed.mystery-seed', count: 1, tier: tiers[0] || 'common' };
  }

  wishRewardValid(r) {
    if (r.type === 'item') return !!this.content.items[r.item] && (this.eggsOn || this.content.items[r.item].category !== 'egg');
    if (r.type === 'egg') return this.eggsOn && (this.content.eggs || []).some((e) => e.tier === r.tier);
    if (r.type === 'relic') return CORE_STATS.every((k) => this.content.items['relic.' + k + '.' + (r.tier || 'common')]);
    if (r.type === 'buff') return !!this.buffDef(r.buff);
    return false;
  }

  /**
   * Make an offering (one atomic transaction): validate, take the items, roll one primary reward and any
   * bonus rewards, grant them, and save the result as the pending gift until the player has seen it. A new
   * offering waits until the last one is acknowledged, so nothing can be offered or granted twice.
   */
  makeOffering(selection, now, opts = {}) {
    const w = this.state.wish;
    if (!this.spiritWell) throw new GameError('There is no well here yet.');
    if (w.pending && !w.pending.seen) throw new GameError('The well is still answering your last offering.');
    const sel = this.wishSelection(selection);
    if (!opts.confirmed && this.wishWarnings(sel, now).length) throw new GameError('Confirm the offering first.');
    // Too little and the water doesn't stir (keeps tiny offerings from beating the shop's prices). Nothing is taken.
    if (this.wishRawValue(sel, now) < (this.wishCfg.minValue ?? 0)) throw new GameError(((this.content.story || {}).wish || {}).tooLittle || "The water doesn't stir. It wants more than that.");
    const s = this.wishStrength(sel, now);
    for (const x of sel) { const n = (this.state.inventory[x.item] || 0) - x.count; if (n > 0) this.state.inventory[x.item] = n; else delete this.state.inventory[x.item]; }
    const cfg = this.wishCfg, b = cfg.bonus || {};
    const rewards = [{ ...this.wishRollReward(this.wishTier(s)), primary: true }];
    const chance = (b.baseChance ?? 0.05) + ((b.maxChance ?? 0.4) - (b.baseChance ?? 0.05)) * s;
    for (let i = 0; i < (b.max ?? 2); i++) {
      if (!this.rng.chance(chance / (i + 1))) break;            // each extra bonus is half as likely as the last
      rewards.push(this.wishRollReward(this.wishTier(s * (b.tierShift ?? 0.5))));
    }
    for (const r of rewards) {
      if (r.type === 'item') r.isNew = this.grant([{ item: r.item, count: r.count }])[0].isNew;
      else if (r.type === 'buff') { const bf = this.addBuff(r.buff, now, { mult: r.mult, hours: r.hours }); r.expiresAt = bf.expiresAt; }
    }
    w.pending = { id: this.rng.uuid(), at: now, offered: sel, rewards, strength: Math.round(s * 100) / 100, seen: false };
    w.count = (w.count || 0) + 1;
    this.bump('wish');
    return w.pending;
  }

  /** The player has seen an offering's result: the well is ready for the next one. */
  acknowledgeOffering(id) {
    const p = this.state.wish.pending;
    if (p && p.id === id) p.seen = true;
  }

  // ---- earned landmarks (landmarks.json "earned"): they form where two stats are strong across a
  // whole size×size patch, then stay for good, each with its own purpose (effect) and maybe an aura.
  landmarkDef(id) { return (this.content.landmarks || []).find((d) => d.id === id) || null; }

  /** [effect, landmark] for every formed landmark whose effect has this type. */
  landmarkEffects(type) {
    const out = [];
    for (const l of this.state.landmarks || []) {
      const def = this.landmarkDef(l.id);
      if (def && def.effect && def.effect.type === type) out.push([def.effect, l]);
    }
    return out;
  }

  /** Landmark auras as permanent boosts: { tile, stats, radius }. */
  landmarkAuras() {
    const out = [];
    for (const l of this.state.landmarks || []) {
      const def = this.landmarkDef(l.id);
      if (def && def.aura) out.push({ tile: l.tile, stats: def.aura.stats, radius: def.aura.radius || 0 });
    }
    return out;
  }

  /** Where an earned landmark could form right now: the centre of the first patch that qualifies, or null. */
  landmarkSite(def, field) {
    const e = def.earned, n = e.size || 3, h = Math.floor(n / 2), c = this.clearing;
    for (let y = c.y0 + h; y <= c.y1 - h; y++) for (let x = c.x0 + h; x <= c.x1 - h; x++) {
      if (!groupMatches(e.requires, field.statsAt(x, y))) continue;   // quick check on the centre first
      let all = true;
      for (let dy = -h; dy <= h && all; dy++) for (let dx = -h; dx <= h && all; dx++) if (!groupMatches(e.requires, field.statsAt(x + dx, y + dy))) all = false;
      if (!all) continue;
      // The landmark takes a tile in the patch that nothing permanent is on (spawns and seeds make way).
      const spots = [{ x, y }];
      for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) if (dx || dy) spots.push({ x: x + dx, y: y + dy });
      const tile = spots.find((t) => !this.landmarkAt(t) && !this.creatureAt(t) && !this.nestAt(t) && !this.decorAt(t) && !this.sceneryAt(t));
      if (tile) return { tile, centre: { x, y }, size: n };
    }
    return null;
  }

  /** Forms any earned landmarks whose conditions are met, and lets formed ones produce. */
  checkLandmarks(now) {
    // Saves from before the Spirit Well: a forest that has already grown finds it now.
    if (!this.state.wish.discovered && ((this.state.unlocks.expansions || 0) > 0 || Object.keys(this.state.revealed || {}).length)) this.discoverSpiritWell(now, null);
    const defs = (this.content.landmarks || []).filter((d) => d.earned);
    if (!defs.length) return;
    let field = null;
    for (const def of defs) {
      const have = this.state.landmarks.filter((l) => l.id === def.id).length;
      if (have >= (def.earned.max ?? 1)) continue;
      field = field || this.field(now);
      const site = this.landmarkSite(def, field);
      if (!site) continue;
      const t = site.tile;
      this.state.spawns = this.state.spawns.filter((sp) => !sameTile(sp.tile, t));
      this.state.plantedSeeds = this.state.plantedSeeds.filter((sp) => !sameTile(sp.tile, t));
      this.state.landmarks.push({ id: def.id, tile: { ...t }, formedAt: now, lastProduced: now });
      this.discover('landmark:' + def.id.replace(/^landmark\./, ''));
      const tiles = [];
      const h = Math.floor(site.size / 2);
      for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) tiles.push({ x: site.centre.x + dx, y: site.centre.y + dy });
      this.events.push({ type: 'landmarkFormed', id: def.id, tile: t, tiles });
      this.statCache = null;
    }
    // Producers (the cave, the fruit tree): one thing waiting at a time, next to the landmark.
    for (const [e, l] of this.landmarkEffects('produce')) {
      if (now - (l.lastProduced || l.formedAt || now) < (e.everyHours || 8) * HOUR) continue;
      if (this.state.spawns.some((sp) => sp.fromLandmark === l.id)) { l.lastProduced = now; continue; }
      const item = weightedPick((e.items || []).map((x) => [x.item, x.weight || 1]), this.rng);
      const def = item && this.content.items[item];
      const tile = def && this.freeNear(l.tile);
      if (!tile) continue;
      this.state.spawns.push({ id: this.rng.uuid(), itemID: item, tile, spawnedAt: now, keep: true, placement: 'surface', fromLandmark: l.id });
      l.lastProduced = now;
    }
  }

  // ---- offerings (the Old Log board: requests, rewards, decor, compost)
  get offeringsCfg() { return this.t.offerings || {}; }

  /** How many creature placements are allowed, or null when uncapped (tuning.creatureCap.enabled false). */
  creatureCap(now) {
    const c = this.t.creatureCap || {};
    if (!c.enabled) return null;
    return this.unlockedSlots(now) + (this.state.unlocks.slots || 0);
  }

  /** Field Guide entries found (items and creatures), for request gating. */
  get guideCount() { return [...this.discovered].filter((k) => k.startsWith('item:') || k.startsWith('creature:')).length; }
  forestDay(now) { return Math.floor((now - this.state.createdAt) / DAY) + 1; }
  requestDef(id) { return (this.content.requests || []).find((r) => r.id === id) || null; }
  isDelivered(id) { return !!this.state.offerings.delivered[id]; }

  /** A request right now: what it needs (have / need), what still locks it, and whether it can be delivered. */
  requestStatus(req, now) {
    const visitor = req.kind === 'visitor';
    const locks = visitor ? [] : this.requestLocks(req, now);
    if (req.reward && req.reward.type === 'unlock' && req.reward.id === 'expansion' && this.forestFullyOpen) locks.push({ type: 'full' });
    const items = req.items.map((x) => ({ item: x.item, count: x.count, have: Math.min(x.count, this.state.inventory[x.item] || 0), owned: this.state.inventory[x.item] || 0 }));
    const done = visitor ? this.visitorsToday(now).done.includes(req.id) : req.kind === 'shop' ? false : this.isDelivered(req.id);
    return { req, done, locks, items, ready: !done && !locks.length && items.every((x) => x.owned >= x.count) };
  }

  /** Every request with its status: open ones first, then locked, then delivered. */
  /** Listings that belong to switched-off systems (eggs, nests, creature slots) stay in the data but aren't offered. */
  requestHidden(req) {
    const r = req.reward || {};
    if (!this.eggsOn && (r.type === 'egg' || (r.type === 'item' && this.content.items[r.id]?.category === 'egg') || (r.type === 'unlock' && r.id === 'nest') || (r.type === 'upgrade' && r.id === 'hatchSpeed'))) return true;
    if (!this.creaturesOn && ((r.type === 'unlock' && (r.id === 'slot' || r.id === 'trowel')))) return true;
    return false;
  }

  requestBoard(now) {
    const list = (this.content.requests || []).filter((r) => r.kind !== 'visitor' && !this.requestHidden(r)).map((r) => this.requestStatus(r, now));
    const rank = (s) => (s.done ? 2 : s.locks.length ? 1 : 0);
    return list.sort((a, b) => rank(a) - rank(b));
  }

  // ---- traders: wanderers at the Old Log asking for items (requests of kind "visitor"; called Traders in the game)
  get visitorCfg() { return this.t.traders || {}; }   // Old Log traders (requests of kind "visitor")

  /** Today's visitors (local day): picked once a day from the visitor requests whose gating is met. */
  visitorsToday(now) {
    const day = Game.dayNumber(now);
    let v = this.state.visitorReqs;
    if (!v || v.day !== day) {
      v = this.state.visitorReqs = { day, offers: [], done: [], rerolls: 0 };
      const perDay = (this.visitorCfg.perDay ?? 2) + this.landmarkEffects('extraVisitor').reduce((a, [e]) => a + (e.add || 1), 0);
      for (let i = 0; i < perDay; i++) {
        const o = this.pickVisitor(now, hash32(this.state.seed, day, i));
        if (o) v.offers.push(o);
      }
    }
    return v;
  }

  /** One visitor request not already offered or done today (deterministic from `h`), with a wanderer to ask for it. */
  pickVisitor(now, h) {
    const v = this.state.visitorReqs;
    const taken = new Set([...(v ? v.offers.map((o) => o.requestID) : []), ...(v ? v.done : [])]);
    const pool = (this.content.requests || []).filter((r) => r.kind === 'visitor' && !this.requestHidden(r) && !taken.has(r.id) && !this.requestLocks(r, now).length);
    if (!pool.length) return null;
    const req = pool[h % pool.length];
    const wanderers = this.content.creatureList.filter((c) => c.family === 'wanderer');   // a trader's look (cosmetic)
    const w = wanderers.length ? wanderers[hash32(h, 7) % wanderers.length].id : null;
    return { requestID: req.id, wandererID: w };
  }

  /** Swap a visitor for another one (costs compost; a few times a day). */
  rerollVisitor(requestID, now) {
    const v = this.visitorsToday(now);
    const i = v.offers.findIndex((o) => o.requestID === requestID);
    if (i < 0) throw new GameError('That visitor has gone.');
    if (v.rerolls >= (this.visitorCfg.maxRerolls ?? 3)) throw new GameError('No more traders today. New ones come tomorrow.');
    const next = this.pickVisitor(now, this.rng.int(0, 1e9));
    if (!next) throw new GameError('Nobody else is visiting today.');
    this.spendCompost(this.visitorCfg.rerollCost ?? 0);
    v.offers[i] = next;
    v.rerolls++;
    return next;
  }

  requestLocks(req, now) {
    const need = req.requires || {};
    const locks = [];
    if (need.guide && this.guideCount < need.guide) locks.push({ type: 'guide', need: need.guide, have: this.guideCount });
    if (need.request && !this.isDelivered(need.request)) locks.push({ type: 'request', id: need.request, name: this.requestDef(need.request)?.name || need.request });
    if (need.day && this.forestDay(now) < need.day) locks.push({ type: 'day', need: need.day, have: this.forestDay(now) });
    return locks;
  }

  /** Deliver a request: the items are taken and the reward given. */
  deliver(id, now) {
    const req = this.requestDef(id);
    if (!req) throw new GameError('Unknown request.');
    if (req.kind === 'visitor') return this.deliverVisitor(req, now);
    const st = this.requestStatus(req, now);
    if (st.done) throw new GameError('Already delivered.');
    if (st.locks.length) throw new GameError("That request isn't open yet.");
    if (!st.ready) throw new GameError('You need more of the items it asks for.');
    for (const x of req.items) for (let i = 0; i < x.count; i++) this.consume(x.item);
    // Shop listings can be bought again and again; everything else is a one-off.
    if (req.kind === 'shop') { const b = this.state.offerings.bought; b[id] = (b[id] || 0) + 1; } else this.state.offerings.delivered[id] = now;
    this.bump('deliver');
    const reward = this.grantReward(req.reward, now);
    this.events.push({ type: 'delivered', id, reward });
    return reward;
  }

  deliverVisitor(req, now) {
    const v = this.visitorsToday(now);
    if (!v.offers.some((o) => o.requestID === req.id)) throw new GameError("That visitor isn't here today.");
    const st = this.requestStatus(req, now);
    if (st.done) throw new GameError('Already traded today.');
    if (!st.ready) throw new GameError('You need more of the items it asks for.');
    for (const x of req.items) for (let i = 0; i < x.count; i++) this.consume(x.item);
    v.done.push(req.id);
    this.bump('visitor');
    const reward = this.grantReward(req.reward, now);
    this.events.push({ type: 'delivered', id: req.id, reward, visitor: true });
    return reward;
  }

  /** Gives a request's reward. Returns { type, id, count, text } for the UI. */
  grantReward(r, now) {
    const out = { ...r };
    if (r.type === 'cosmetic') {
      this.state.decor.owned[r.id] = (this.state.decor.owned[r.id] || 0) + (r.count || 1);
    } else if (r.type === 'compost') {
      this.state.compost += r.count || 0;
    } else if (r.type === 'unlock') {
      const u = this.state.unlocks;
      if (r.id === 'trowel') u.trowel = true;
      else if (r.id === 'slot') u.slots += r.count || 1;
      else if (r.id === 'nest') u.nests += r.count || 1;
      else if (r.id === 'expansion') {
        u.expansions += r.count || 1;
        for (let i = 0; i < (r.count || 1); i++) out.tiles = (out.tiles || 0) + this.expand(now).length;
      }
    } else if (r.type === 'egg' || r.type === 'item') {
      out.results = this.grant([{ item: r.id, count: r.count || 1 }]);
    } else if (r.type === 'upgrade') {
      const u = this.state.unlocks.upgrades;
      const max = (this.upgradeDef(r.id) || {}).maxTier ?? Infinity;
      u[r.id] = Math.min(max, (u[r.id] || 0) + (r.count || 1));
      out.tier = u[r.id];
    }
    return out;
  }

  upgradeDef(id) { const u = (this.t.upgrades || {})[id]; return u && typeof u === 'object' ? u : null; }
  upgradeTier(id) { return id === 'expansion' ? (this.state.unlocks.expansions || 0) : (this.state.unlocks.upgrades || {})[id] || 0; }

  /** Compost value of one of an item (tuning.offerings.compost by rarity), or 0 if it can't be composted. */
  compostValue(itemID) {
    const def = this.content.items[itemID];
    const cfg = this.offeringsCfg;
    if (!def || !(cfg.compostCategories || []).includes(def.category)) return 0;
    return (cfg.compost || {})[def.rarity || 'common'] || 0;
  }

  /** Compost `count` of a spare item for points. */
  compost(itemID, count = 1) {
    if (this.offeringsCfg.compostEnabled === false) throw new GameError('The compost heap is closed for now.');
    const v = this.compostValue(itemID);
    if (!v) throw new GameError("That can't be composted.");
    const n = Math.min(count, this.state.inventory[itemID] || 0);
    if (n < 1) throw new GameError("You don't have that.");
    for (let i = 0; i < n; i++) this.consume(itemID);
    this.state.compost += v * n;
    this.bump('compost', n);
    return v * n;
  }

  spendCompost(n) {
    if (this.state.compost < n) throw new GameError(`That needs ${n} compost (you have ${this.state.compost}).`);
    this.state.compost -= n;
  }

  decorDef(id) { return (this.content.cosmetics || []).find((c) => c.id === id) || null; }

  /** Basic decor bought with compost (cosmetics.json "compost" price). */
  buyDecor(id) {
    const def = this.decorDef(id);
    if (!def || def.compost == null) throw new GameError("That can't be bought with compost.");
    this.spendCompost(def.compost);
    this.state.decor.owned[id] = (this.state.decor.owned[id] || 0) + 1;
  }

  placeDecor(id, tile) {
    if (!(this.state.decor.owned[id] > 0)) throw new GameError("You don't have that.");
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    this.state.decor.owned[id]--;
    if (!this.state.decor.owned[id]) delete this.state.decor.owned[id];
    const d = { id: this.rng.uuid(), decorID: id, tile: { ...tile }, color: 0 };
    this.state.decor.placed.push(d);
    return d;
  }

  moveDecor(placedID, tile) {
    const d = this.state.decor.placed.find((x) => x.id === placedID);
    if (!d) throw new GameError('Unknown decoration.');
    if (sameTile(d.tile, tile)) return d;
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    d.tile = { ...tile };
    return d;
  }

  removeDecor(placedID) {
    const i = this.state.decor.placed.findIndex((x) => x.id === placedID);
    if (i < 0) throw new GameError('Unknown decoration.');
    const [d] = this.state.decor.placed.splice(i, 1);
    this.state.decor.owned[d.decorID] = (this.state.decor.owned[d.decorID] || 0) + 1;
  }

  /** Recolour a placed prop to its next colour (costs compost, tuning.offerings.recolorCost). */
  recolorDecor(placedID) {
    const d = this.state.decor.placed.find((x) => x.id === placedID);
    if (!d) throw new GameError('Unknown decoration.');
    const def = this.decorDef(d.decorID);
    const n = (def && def.colors && def.colors.length) || 1;
    if (n < 2) throw new GameError('That only comes in one colour.');
    if (this.offeringsCfg.compostEnabled !== false) this.spendCompost(this.offeringsCfg.recolorCost ?? 0);
    d.color = ((d.color || 0) + 1) % n;
    return d;
  }

  /** The trowel (an Offerings unlock): move a placed creature; its influence keeps its strength. */
  moveCreature(creatureID, tile, now) {
    if (!this.state.unlocks.trowel) throw new GameError('You need the trowel for that.');
    const p = this.activePlacement(creatureID);
    if (!p) throw new GameError('That creature is resting at home.');
    if (sameTile(p.tile, tile)) return p;
    if (!this.inBounds(tile) || !this.inClearing(tile)) throw new GameError("That's outside the clearing.");
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    // Keep its strength: the ramp carries on from the level it had reached.
    p.startLevel = this.stats.level(p, now);
    p.placedAt = now;
    p.tile = { ...tile };
    this.bump('trowel');
    this.statCache = this.statField(now);
    this.checkProgress(now);
    return p;
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
  // ---- developer test forest (only ever called on the separate dev save; see main.js)
  get isDev() { return !!this.state.dev; }

  /** One of every species in the content (plus glimmers if asked), straight to the Burrow. */
  devUnlockCreatures(now, { glimmers = false } = {}) {
    const pending = [];
    for (const def of this.content.creatureList) {
      for (const g of glimmers ? [false, true] : [false]) {
        if (this.state.creatures.some((c) => c.typeID === def.id && !!c.isGlimmer === g)) continue;
        pending.push({ creature: this.rollCreature(def.id, 'debug', now, g) });
      }
    }
    return this.grant(pending).length;
  }

  /** Deliver requests without their items (open ones, or every one ignoring locks). Returns how many. */
  devCompleteRequests(now, all = false) {
    let n = 0;
    for (const r of this.content.requests || []) {
      if (r.kind === 'visitor' || r.kind === 'shop' || this.isDelivered(r.id)) continue;
      if (!all && this.requestStatus(r, now).locks.length) continue;
      this.state.offerings.delivered[r.id] = now;
      this.grantReward(r.reward, now);
      n++;
    }
    return n;
  }
  devGiveEggs(n = 1) { const list = this.content.eggs || []; this.grant(list.map((e) => ({ item: e.id, count: n }))); return list.length; }
  devHatchNow(now) { for (const n of this.state.nests) n.startedAt = now - n.hatchSeconds * 1000 - 1; return this.state.nests.length; }
  devResetRequests() { this.state.offerings.delivered = {}; }
  devNewVisitors(now) { this.state.visitorReqs = null; this.state.visitorReqs = { day: -1 }; return this.visitorsToday(now).offers.length; }
  devGrantDecor() { for (const c of this.content.cosmetics || []) this.state.decor.owned[c.id] = (this.state.decor.owned[c.id] || 0) + 1; return (this.content.cosmetics || []).length; }

  /** `count` of every item in the content (mushrooms, plants, seeds, geodes, gems, materials). */
  devGrantItems(count = 5) {
    const list = Object.values(this.content.items);
    this.grant(list.map((it) => ({ item: it.id, count })));
    return list.length;
  }

  /** Every Field Guide entry (items, creatures and their glimmers) marked as found. */
  devFillGuide() {
    for (const it of Object.values(this.content.items)) if (it.inGuide !== false) this.discover('item:' + it.id);
    for (const def of this.content.creatureList) { this.discover('creature:' + def.id); this.discover('creature:' + def.id + ':glimmer'); }
    for (const t of this.content.terrain || []) this.discover('terrain:' + t.id);
  }

  /** Grow the clearing to the whole forest (one expansion message instead of one per ring). */
  devOpenForest(now) {
    const s = this.state.size;
    let guard = 100;
    const before = this.events.length;
    while (guard-- > 0) {
      const c = this.clearing;
      if (c.x0 === 0 && c.y0 === 0 && c.x1 === s.width - 1 && c.y1 === s.height - 1) break;
      this.expand(now);
    }
    this.events.splice(before);
  }

  /** Creature slots for testing combinations (all open at once). */
  devSetSlots(n) {
    this.state.dev = { ...(this.state.dev || {}), slots: Math.max(1, Math.min(30, n)) };
    this.state.minUnlockedSlots = this.maxSlots;
    this.normalizeSlots();
    this.state.announcedSlots = this.unlockedSlots(Date.now() + (this.state.debugTimeOffset || 0));
  }

  /** Place a fresh creature of any species on a tile, optionally at full strength. */
  devPlace(typeID, tile, now, { full = true, glimmer = false } = {}) {
    if (!this.isFree(tile)) throw new GameError('Something is already there.');
    const c = this.rollCreature(typeID, 'debug', now, glimmer);
    this.grant([{ creature: c }]);
    this.place(c.id, tile, now);
    const placed = this.activePlacement(c.id);
    if (full && placed) { placed.startLevel = 1; this.statCache = this.statField(now); }
    return placed;
  }

  /** Take every creature out of the forest at once (no fade), freeing all slots. */
  devClearPlacements(now) {
    this.state.placements = [];
    for (const sl of this.state.slots) sl.placementID = null;
    this.statCache = this.statField(now);
  }

  devClearSpawns() { this.state.spawns = []; this.state.visitors = []; }

  /** Run `ticks` spawn ticks right now (to see where things turn up). */
  devSpawnTicks(now, ticks) {
    let made = 0;
    for (let i = 0; i < ticks; i++) made += this.spawnTick(now);
    return made;
  }

  /** Developer: put a visitor at an interest stage (signs, clues, ready to visit, or none). */
  devGuestStage(id, stage, now) {
    const S = this.guestCfg.stages || {}, g = this.guest(id);
    g.interest = { none: 0, signs: S.signs ?? 10, clues: S.clues ?? 20, ready: S.present ?? 60 }[stage] ?? g.interest;
    if (stage === 'none') { g.present = null; g.known = []; this.state.guestTracks = this.state.guestTracks.filter((x) => x.visitorID !== id); }
  }
  /** Developer: the visitor comes to the grotto right now, on ground it likes (or anywhere open). */
  devGuestPresent(id, now) {
    const def = this.guestDef(id);
    if (!def) throw new GameError('Unknown visitor.');
    const g = this.guest(id), tiles = this.guestTiles(def, this.statField(now));
    g.interest = Math.max(g.interest, (this.guestCfg.stages || {}).present ?? 60);
    const tile = tiles.find((x) => this.isFree(x)) || this.freeNear(this.state.landmarks[0].tile);
    const pr = this.guestCfg.presence || {};
    g.present = { from: now, until: now + ((pr.minutes || [20, 40])[1]) * 60000, tile: { ...tile } };
    g.firstSeen = g.firstSeen || now; g.lastPresence = { ...g.present };
  }

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
    // Seed-only garden flowers never spawn wild.
    this.spawnableItems = bundle.items.filter((i) => i.spawn && !i.spawn.seedOnly);
    // Gems and geode materials are kept to trade (tuning.gems.soilBoost false): their soil-boost use is set aside.
    if (bundle.tuning.gems && bundle.tuning.gems.soilBoost === false) {
      for (const i of bundle.items) if (i.use && i.use.type === 'soilBoost') { i.tradeOnly = true; delete i.use; }
    }
    this.landmarks = bundle.landmarks || [];
    this.story = bundle.story || {};
    this.tasks = bundle.tasks || [];
    this.terrain = bundle.terrain || [];
    this.requests = bundle.requests || [];
    this.cosmetics = bundle.cosmetics || [];
    this.eggs = bundle.eggs || [];
    // School seeds (schoolSeeds.json, from the Offerings spreadsheet): one per garden school. Buried
    // from the Bag, a seed starts its school's terrain around its tile (numbers: tuning.schoolSeeds).
    this.opening = bundle.opening || null;
    this.visitorList = bundle.visitors || [];
    this.schoolSeeds = bundle.schoolSeeds || [];
    this.schoolSeedFor = {};
    for (const sd of this.schoolSeeds) {
      this.schoolSeedFor[sd.school] = sd.id;
      if (this.items[sd.id]) continue;
      const name = sd.school.charAt(0).toUpperCase() + sd.school.slice(1);
      const it = { id: sd.id, category: 'schoolSeed', name: sd.name, rarity: 'common', sprite: sd.sprite, marker: sd.marker, school: sd.school, guideText: sd.text,
        howFound: `Sold at the Old Log. Finds that need ${name} sometimes drop one.`,
        use: { type: 'bury', verb: 'Bury', school: sd.school, text: `Bury it on an open tile to start ${name} ground around it.` } };
      this.itemList.push(it);
      this.items[sd.id] = it;
    }
    // Relics (relics.json) are Bag items you bury; relic.unknown is the opening's relic before it has a school.
    this.relicList = bundle.relics || [];
    for (const r of [...this.relicList, { id: 'relic.unknown', name: 'A strange relic', school: null, tier: 'common', sprite: 'relic.unknown', worldSprite: 'relic.unknown', inscription: '', inGuide: false }]) {
      if (this.items[r.id]) continue;
      const it = { id: r.id, category: 'relic', name: r.name, rarity: r.tier, sprite: r.sprite, worldSprite: r.worldSprite, school: r.school, tier: r.tier,
        inscription: r.inscription, guideText: r.inscription, use: { type: 'relic', verb: 'Bury' } };
      if (r.inGuide === false) it.inGuide = false;
      this.itemList.push(it);
      this.items[r.id] = it;
    }
    // Eggs are Bag items (category "egg"), built from eggs.json.
    for (const e of this.eggs) {
      if (this.items[e.id]) continue;
      const it = { id: e.id, category: 'egg', name: e.name, rarity: e.tier, sprite: e.sprite, inGuide: false, guideText: e.text, egg: { family: e.family, tier: e.tier, hatchHours: e.hatchHours } };
      this.itemList.push(it);
      this.items[e.id] = it;
    }
  }
  familyName(id) { return this.creatureList.find((c) => c.family === id)?.familyName || id; }
  itemsInGroup(g) { return this.itemList.filter((i) => i.groups && i.groups.includes(g)); }
}
