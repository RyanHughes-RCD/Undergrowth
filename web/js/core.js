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

  /** Fade-rate multiplier for a stat after its creature leaves (terrain.statDecayRate; Stone lingers). */
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
      // Per stat: after removal each stat fades at its own rate (Stone slowest).
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
 * "Grows where Stone meets deep soil." Used for items not yet in the Field Guide.
 */
export function itemHint(item, story) {
  const H = (story && story.hints) || {};
  const sp = item.spawn || {};
  const req = Object.entries(sp.requires || {}).filter(([, b]) => (b.min || 0) > 0).sort((a, b) => b[1].min - a[1].min);
  const words = req.map(([k]) => (H.stats || {})[k] || k);
  const verb = (H.verbs || {})[item.category] || 'Found';
  const fill = (tpl) => tpl.replace('{verb}', verb).replace('{a}', words[0]).replace('{b}', words[1]).replace('{c}', words[2]);
  let out;
  if (sp.terrain === 'pool') out = fill(H.pool || '{verb} in shallow pools');
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
    state.geodes = state.geodes || [];
    state.visitors = state.visitors || [];
    state.soilBoosts = state.soilBoosts || [];
    state.ambientDamp = state.ambientDamp || {};
    state.nextGlimmer = !!state.nextGlimmer;
    // Offerings (older saves start empty).
    state.offerings = state.offerings || { delivered: {} };
    state.offerings.delivered = state.offerings.delivered || {};
    state.unlocks = { slots: 0, nests: 0, expansions: 0, trowel: false, ...(state.unlocks || {}) };
    state.decor = state.decor || { owned: {}, placed: [] };
    state.decor.owned = state.decor.owned || {};
    state.decor.placed = state.decor.placed || [];
    state.compost = state.compost || 0;
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
    else g.placeStarters(now);
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
        this.state.spawns.push(sp);
        made.push(sp);
      }
    }
    const holders = made.filter((sp) => ['mushroom', 'geode'].includes(this.content.items[sp.itemID].category));
    if (holders.length) holders[this.rng.int(0, holders.length - 1)].forcedCreature = { rarity: st.guaranteedCreatureRarity || 'common' };
    return made;
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

  /** Elevation -1..1 from a tile's stats: Stone raises the ground, Depth sinks it. */
  elevationOf(stats) {
    const e = this.terrain.elevation || {};
    const v = (stats.stone || 0) * (e.stonePerPoint ?? 0.025) - (stats.depth || 0) * (e.depthPerPoint ?? 0.025);
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
    const k = Math.min(1, (stats.depth || 0) / Math.max(1, g.depthForFullGlow ?? 40));
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

  /** Ambient Damp (seeped/pooled water), separate from creature contributions. */
  ambientAt(x, y) { return (this.state.ambientDamp && this.state.ambientDamp[x + ',' + y]) || 0; }

  /**
   * One step of Damp spreading (per spawn tick). Each clearing tile takes in water from wetter
   * neighbours (spreadRate × difference), more easily downhill (downhillBoost) and hardly uphill
   * (uphillPenalty); water also runs down slopes on its own (gravityPerTick). High-Stone tiles
   * block seepage across them (none at stoneBlocksAt). It evaporates (evaporation), less on low
   * ground (lowGroundRetention), so hollows turn boggy. Creature Damp is a source; only this
   * ambient layer changes, so creature ramp/decay stays as it is.
   */
  ambientTick(t) {
    const cfg = this.terrain.ambientDamp || {};
    if (cfg.enabled === false) return;
    const W = this.state.size.width, c = this.clearing;
    const amb = this.state.ambientDamp || {};
    const field = this.statField(t, { raw: true });     // water physics uses the raw values
    const n = W * this.state.size.height;
    const D = new Float32Array(n), E = new Float32Array(n), S = new Float32Array(n);
    let any = false;
    const K = field.keys.length, kd = field.keys.indexOf('damp'), ks = field.keys.indexOf('stone'), kp = field.keys.indexOf('depth');
    const el = this.terrain.elevation || {}, sp = el.stonePerPoint ?? 0.025, dp = el.depthPerPoint ?? 0.025, em = el.max ?? 1;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const i = y * W + x, o = i * K;
      D[i] = field.values[o + kd]; S[i] = field.values[o + ks];
      E[i] = Math.max(-em, Math.min(em, S[i] * sp - field.values[o + kp] * dp));
      if (D[i] > 0) any = true;
    }
    if (!any) { this.state.ambientDamp = {}; return; }
    const rate = cfg.spreadRate ?? 0.05, down = cfg.downhillBoost ?? 2.5, up = cfg.uphillPenalty ?? 0.8;
    const grav = cfg.gravityPerTick ?? 0, block = Math.max(1, cfg.stoneBlocksAt ?? 40);
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
    this.state.ambientDamp = next;
  }

  /** Where a new spawn sits. Item data spawn.placement: surface | buried | auto (default). Auto:
   *  items whose highest requirement is Depth are buried; geodes are buried on Depth-dominant
   *  tiles and exposed on Stone-dominant ones; everything else is on the surface. */
  resolvePlacement(item, stats) {
    const p = (item.spawn && item.spawn.placement) || 'auto';
    if (p === 'surface' || p === 'buried') return p;
    const req = (item.spawn && item.spawn.requires) || {};
    let top = null, best = -1;
    for (const k in req) { const m = req[k].min ?? 0; if (m > best) { best = m; top = k; } }
    if (top === 'depth') return 'buried';
    if (item.category === 'geode' && this.shares(stats).dominant === 'depth') return 'buried';
    return 'surface';
  }

  /** How a spawn shows right now: 'surface', 'exposed' (geode on Stone), 'buried', or 'hidden' (tall grass). */
  spawnView(spawn, t, stats = null) {
    if (spawn.placement === 'buried') return 'buried';
    const st = stats || this.tileStats(spawn.tile, t);
    if (!spawn.tutorial && !spawn.revealed && (st.verdure || 0) >= ((this.terrain.verdure || {}).hideThreshold ?? 30)) return 'hidden';
    const def = this.content.items[spawn.itemID];
    if (def && def.category === 'geode' && this.shares(st).dominant === 'stone') return 'exposed';
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
  activeBoosts(now) { return this.state.soilBoosts.filter((b) => now >= b.appliedAt && (b.expiresAt == null || now < b.expiresAt)); }

  /** Tile stats for every tile. Values below intensity.minInfluence are 0 (inactive) unless opts.raw. */
  statField(now, opts = {}) {
    const f = this.stats.field(this.state.size, this.effectivePlacements(), now);
    for (const b of this.activeBoosts(now)) if (this.inBounds(b.tile)) f.add(b.tile.x, b.tile.y, b.stats);
    // Ambient Damp (seeped and pooled water) on top of what creatures give.
    const amb = this.state.ambientDamp || {}, kd = f.keys.indexOf('damp'), KK = f.keys.length, idx = this.tileKeys.index;
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
    const s = this.stats.statsAt(tile, this.effectivePlacements(), now);
    for (const b of this.activeBoosts(now)) if (sameTile(b.tile, tile)) for (const k in b.stats) s[k] = (s[k] || 0) + b.stats[k];
    s.damp = (s.damp || 0) + this.ambientAt(tile.x, tile.y);
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

    this.state.lastUpdated = now;
    this.statCache = this.statField(now);
    this.checkProgress(now);
    return report;
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
    let loc = null, field = null;
    const shared = () => field || (field = this.statField(t));
    for (let i = 0; i < st.attemptsPerTick; i++) {
      if (this.state.spawns.length >= cap) break;
      if (!this.rng.chance(st.spawnChance)) continue;
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
   * restricted to its category. Damp tiles grow mushrooms faster (terrain.damp.mushroomGrowth);
   * wild meadows sprout plants faster (combos.meadow.plantGrowth).
   */
  growthBonuses(t, cap, field) {
    const st = this.t.spawns, c = this.clearing;
    const area = (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
    const perTile = (st.attemptsPerTick * st.spawnChance) / Math.max(1, area);   // the normal rate for one tile
    const mg = (this.terrain.damp || {}).mushroomGrowth || {};
    const meadow = this.combo('meadow'), pg = meadow.plantGrowth || {};
    const K = field.keys.length, W = this.state.size.width, names = this.tileKeys.names;
    const kd = field.keys.indexOf('damp'), kb = field.keys.indexOf('bloom'), kv = field.keys.indexOf('verdure');
    const mreq = Object.entries(meadow.requires || {}).map(([k, b]) => [field.keys.indexOf(k), b]);
    const occ = this.occupied();
    let made = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      if (this.state.spawns.length >= cap) return made;
      const o = (y * W + x) * K;
      const damp = field.values[o + kd] || 0;
      if (damp < (mg.minDamp ?? 6) && !(field.values[o + kb] > 0)) continue;     // most tiles: nothing to do
      const isMeadow = mreq.length && mreq.every(([ki, b]) => ki >= 0 && boundMatches(b, field.values[o + ki]));
      let cat = null, bonus = 0;
      if (damp >= (mg.minDamp ?? 6)) { cat = 'mushroom'; bonus = Math.min(mg.maxBonus ?? 2, damp * (mg.perPoint ?? 0.08)); }
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
      for (const p of this.effectivePlacements()) {
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
      for (const b of this.activeBoosts(t)) if (this.inBounds(b.tile)) sources[b.tile.y * W + b.tile.x] += 1;
    }
    const tiles = [];
    let total = 0;
    const occ = this.occupied();
    // Per-tick constants (Glow by day/night and Depth, Bloom's cycle) instead of per tile.
    const K = on ? field.keys.length : 0;
    const coreIdx = on ? CORE_STATS.map((k) => field.keys.indexOf(k)) : [];
    const depthIdx = on ? field.keys.indexOf('depth') : -1;
    const bloomF = this.bloomFactor(t), gc = this.terrain.glowCycle || {}, night = this.isNight(t);
    const gN = gc.nightFactor ?? 1.6, gD = gc.dayFactor ?? 0.4, gFull = Math.max(1, gc.depthForFullGlow ?? 40);
    const glowAt = (depth) => (night ? gN : gD + (gN - gD) * Math.min(1, depth / gFull));
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
            intensity += v * (k === 'glow' ? glowAt(field.values[o + depthIdx] || 0) : k === 'bloom' ? bloomF : 1);
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
    // Glow counts for more at night (and in Depth), Bloom follows its daily cycle.
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
    const pool = isPool && this.combo('pool').onlyDampItems;
    for (const item of opts.items || this.content.spawnableItems) {
      const rule = item.spawn;
      if (!rule) continue;
      if (pool && !(rule.requires && rule.requires.damp)) continue;   // shallow water: only Damp-loving things
      if (rule.terrain === 'pool' && !isPool) continue;                // e.g. Water Reed: shallow pools only
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
      for (const stat in rule.statScaling || {}) raw += (rule.statScaling[stat] / 100) * Math.max(0, vals[stat] - mins[stat]) * (fac[stat] ?? 1);
      const mult = Math.min(hi, Math.max(lo, raw));
      let fx = 1;
      for (const e of weightFx) if (Game.effectMatches(e, item)) fx *= e.mult ?? 1;
      let weight = rule.baseWeight * mult * fx;
      let affinity = 1;
      if (aff) {
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
   * stats (spawns.categoryScaling, % per point) make it likelier there. E.g. Stone/Depth from
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
      return { category: c, base: cw[c] ?? 1, mult, weight: (cw[c] ?? 1) * mult };
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
  /** There is no cap on creatures in the forest any more. */
  get freeSlotCount() { return Infinity; }
  inBounds(t) { return t.x >= 0 && t.y >= 0 && t.x < this.state.size.width && t.y < this.state.size.height; }
  creatureAt(t) { return this.state.placements.find((p) => p.removedAt == null && sameTile(p.tile, t)) || null; }
  spawnAt(t) { return this.state.spawns.find((s) => sameTile(s.tile, t)) || null; }
  seedAt(t) { return this.state.plantedSeeds.find((s) => sameTile(s.tile, t)) || null; }
  decorAt(t) { return this.state.decor.placed.find((d) => sameTile(d.tile, t)) || null; }
  /** Every occupied tile ("x,y"), built once so whole-map scans don't search lists per tile. */
  occupied() {
    const s = this.state, out = new Set();
    for (const l of s.landmarks || []) out.add(l.tile.x + ',' + l.tile.y);
    for (const p of this.activePlacements) out.add(p.tile.x + ',' + p.tile.y);
    for (const x of s.spawns) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of s.plantedSeeds) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of s.visitors || []) out.add(x.tile.x + ',' + x.tile.y);
    for (const x of (s.decor && s.decor.placed) || []) out.add(x.tile.x + ',' + x.tile.y);
    return out;
  }

  isFree(t) { return this.inBounds(t) && this.inClearing(t) && !this.landmarkAt(t) && !this.creatureAt(t) && !this.spawnAt(t) && !this.seedAt(t) && !this.visitorAt(t) && !this.decorAt(t); }
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
      for (const p of s.placements) if (p.creatureID === c.id) { p.contributions = { ...contributions }; p.radius = c.radius; }
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
    if (cap != null && this.activePlacements.length >= cap) throw new GameError('Every creature slot is in use. Bring one home, or earn another slot at the Old Log.');
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
        const c = (spawn.forcedCreature && this.guaranteedCreature('mushroom', def.id, spawn.forcedCreature.rarity, now))
          || this.findCreature('mushroom', def.id, spawn.tile, stats, now);
        if (c) pending.push({ creature: c });
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
    const grow = this.rng.range(...range(this.t.seeds.growSeconds)) / Math.max(0.01, speed);
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
    const need = req.requires || {};
    const locks = [];
    if (need.guide && this.guideCount < need.guide) locks.push({ type: 'guide', need: need.guide, have: this.guideCount });
    if (need.request && !this.isDelivered(need.request)) locks.push({ type: 'request', id: need.request, name: this.requestDef(need.request)?.name || need.request });
    if (need.day && this.forestDay(now) < need.day) locks.push({ type: 'day', need: need.day, have: this.forestDay(now) });
    const items = req.items.map((x) => ({ item: x.item, count: x.count, have: Math.min(x.count, this.state.inventory[x.item] || 0), owned: this.state.inventory[x.item] || 0 }));
    const done = this.isDelivered(req.id);
    return { req, done, locks, items, ready: !done && !locks.length && items.every((x) => x.owned >= x.count) };
  }

  /** Every request with its status: open ones first, then locked, then delivered. */
  requestBoard(now) {
    const list = (this.content.requests || []).filter((r) => r.kind !== 'visitor').map((r) => this.requestStatus(r, now));
    const rank = (s) => (s.done ? 2 : s.locks.length ? 1 : 0);
    return list.sort((a, b) => rank(a) - rank(b));
  }

  /** Deliver a request: the items are taken and the reward given. */
  deliver(id, now) {
    const req = this.requestDef(id);
    if (!req) throw new GameError('Unknown request.');
    const st = this.requestStatus(req, now);
    if (st.done) throw new GameError('Already delivered.');
    if (st.locks.length) throw new GameError("That request isn't open yet.");
    if (!st.ready) throw new GameError('You need more of the items it asks for.');
    for (const x of req.items) for (let i = 0; i < x.count; i++) this.consume(x.item);
    this.state.offerings.delivered[id] = now;
    this.bump('deliver');
    const reward = this.grantReward(req.reward, now);
    this.events.push({ type: 'delivered', id, reward });
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
    } else if (r.type === 'egg') {
      out.results = this.grant([{ item: r.id, count: r.count || 1 }]);
    }
    return out;
  }

  /** Compost value of one of an item (tuning.offerings.compost by rarity), or 0 if it can't be composted. */
  compostValue(itemID) {
    const def = this.content.items[itemID];
    const cfg = this.offeringsCfg;
    if (!def || !(cfg.compostCategories || []).includes(def.category)) return 0;
    return (cfg.compost || {})[def.rarity || 'common'] || 0;
  }

  /** Compost `count` of a spare item for points. */
  compost(itemID, count = 1) {
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
    this.spendCompost(this.offeringsCfg.recolorCost ?? 0);
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
      if (r.kind === 'visitor' || this.isDelivered(r.id)) continue;
      if (!all && this.requestStatus(r, now).locks.length) continue;
      this.state.offerings.delivered[r.id] = now;
      this.grantReward(r.reward, now);
      n++;
    }
    return n;
  }
  devResetRequests() { this.state.offerings.delivered = {}; }
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
    this.terrain = bundle.terrain || [];
    this.requests = bundle.requests || [];
    this.cosmetics = bundle.cosmetics || [];
    this.eggs = bundle.eggs || [];
  }
  familyName(id) { return this.creatureList.find((c) => c.family === id)?.familyName || id; }
  itemsInGroup(g) { return this.itemList.filter((i) => i.groups && i.groups.includes(g)); }
}
