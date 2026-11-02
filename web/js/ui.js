// DOM user interface: HUD, sheets (Creatures, Bag, Field Guide), geode cracking, reveals.
import { CORE_STATS, RARITIES, RARITY_NAMES, rarityIndex, intensityOf, requirementOf, decorVariant, itemHint } from './core.js';
import { paintWaterTile } from './render.js';

const g0 = (ui) => ui.game;

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const STAT_COLORS = { damp: '#4a7dff', glow: '#4fe3f0', bloom: '#ff79b8', verdure: '#4fcf4f', stone: '#a0a0b0', depth: '#9a5ad8' };
export const RARITY_COLORS = { common: '#a0a0a0', uncommon: '#5fd35a', rare: '#5a9cff', veryRare: '#c58cff', legendary: '#ffc84a' };
const rarityName = (r) => RARITY_NAMES[r] || r;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

const CATEGORY_TITLES = { egg: 'Eggs', supply: 'Soil packs', seed: 'Seeds', geode: 'Geodes to crack', gem: 'Gems', material: 'Materials', plant: 'Plants', mushroom: 'Mushrooms' };
const LANDMARK_TAB = 'landmarks';
const TERRAIN_TAB = 'terrain';
const FAMILY_TABS = [['fungling', 'Funglings'], ['sproutling', 'Sproutlings'], ['geodeCritter', 'Geode Critters'], ['wanderer', 'Wanderers']];
const catTitle = (c) => CATEGORY_TITLES[c] || cap(c);

/** Pixel-art icon from the sprite registry ("ui.icon.<name>"); scale = CSS px per art px. */
let SPRITES = null;
export const ic = (name, scale = 2, cls = '') => SPRITES.element('ui.icon.' + name, null, scale, 'icon ' + cls);

export class UI {
  constructor(app) {
    this.app = app;
    this.mode = null;            // { type: 'place', creatureID } | { type: 'plant', itemID }
    this.selectedTile = null;
    this.selectedCreatureID = null;
    this.statOverlay = false;
    this.sheet = null;           // { type, arg }
    this.guideTab = 'fungling';
    this.root = document.getElementById('ui');
    SPRITES = app.sprites;
    this.toastTimer = null;
  }

  get game() { return this.app.game; }
  get content() { return this.app.content; }
  get sprites() { return this.app.sprites; }

  // -------------------------------------------------------------- HUD

  render(withSheet = true) {
    const g = this.game;
    const now = g.now();
    const d = new Date(now);
    const clock = [ic(g.isNight(now) ? 'moon' : 'sun', 1), ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      g.isRaining(now) ? ic('rain', 1) : null, g.state.nextGlimmer ? ic('glimmer', 1) : null];
    const top = h('div', { class: 'hud-top' }, h('div', { class: 'hud-row' },
      h('button', { class: 'name-btn', onclick: () => this.open('rename') },
        h('div', { class: 'forest-name' }, g.forestName),
        h('div', { class: 'hint' }, ...clock, ' · tap to rename')),
      this.content.tuning.debugTools ? h('div', { class: 'dev' },
        h('button', { class: 'speed-btn' + (this.app.speed > 1 ? ' on' : ''), title: 'Time speed', onclick: () => this.app.cycleSpeed() },
          h('b', {}, ic('fast', 1), `${this.app.speed}×`),
          g.state.debugTimeOffset > 0 ? h('span', {}, `+${duration(g.state.debugTimeOffset / 1000)}`) : null),
        h('button', { class: 'round-btn' + (this.app.devMode ? ' dev-on' : ''), title: this.app.devMode ? 'Developer mode' : 'Debug', onclick: () => this.open('debug') },
          ic('bug', 2), this.app.devMode ? h('span', { class: 'dev-tag' }, 'DEV') : null)) : null,
    ), this.coachCard());

    const bottom = h('div', { class: 'hud-bottom' });
    if (this.mode) bottom.append(this.modeBanner());
    if (this.mode && this.mode.type === 'nest' && this.mode.tile) bottom.append(this.nestPreviewCard(this.mode.eggID, this.mode.tile, true));
    if (this.selectedTile) bottom.append(this.tileCard(this.selectedTile));
    const invCount = Object.values(g.state.inventory).reduce((a, b) => a + b, 0);
    const finds = g.state.spawns.length;
    if (finds >= 2 && !this.mode) {
      bottom.append(h('div', { class: 'collect-row' },
        h('button', { class: 'btn green collect-all', onclick: () => this.app.collectAll() }, ic('bag', 1), ` Collect all (${finds})`)));
    }
    bottom.append(h('div', { class: 'nav' },
      this.navButton('creatures', 'Creatures', g.state.creatures.length, () => this.open('creatures')),
      this.navButton('bag', 'Bag', invCount, () => this.open('bag')),
      this.navButton('guide', 'Guide', 0, () => this.open('guide')),
      g.inTutorial ? null : this.navButton('tasks', 'Tasks', g.activeTasks().filter((t) => t.done).length, () => this.open('tasks')),
    ));
    this.root.replaceChildren(top, bottom);
    if (this.sheet && withSheet) this.renderSheet();
  }

  /** Story/hint text from Content/story.json with {placeholders} filled in. */
  story(path, vars = {}) {
    let v = this.content.story;
    for (const k of path.split('.')) v = v && v[k];
    return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : '')) : '';
  }

  /** The tutorial's guidance card: one step per core loop, with an action button where needed. */
  coachCard() {
    const g = this.game;
    if (!g.inTutorial) return null;
    const step = g.tutorialStep;
    const tut = g.state.tutorial;
    const cr = tut.creatureID ? g.creature(tut.creatureID) : null;
    const vars = { creature: cr ? this.app.displayName(cr) : 'creature' };
    const text = this.story(`tutorial.${step}.text`, vars);
    if (!text) return null;
    const btnLabel = this.story(`tutorial.${step}.button`, vars);
    const a = this.app;
    let action = null;
    if (step === 'plant' && !this.mode) action = () => a.beginPlanting('seed.mystery-seed');
    if (step === 'crack') action = () => this.openCrack('geode.pebble-geode');
    if (step === 'place' && !this.mode) action = () => a.beginPlacing(tut.creatureID);
    if (step === 'wrap') action = () => { g.finishTutorial(); a.changed(); };
    let progress = null;
    if (step === 'watch' && tut.placementID) {
      const p = g.state.placements.find((x) => x.id === tut.placementID);
      const lv = p ? g.level(p, g.now()) : 0;
      progress = h('div', { class: 'progress' }, h('span', { style: `width:${Math.round(lv * 100)}%` }));
    }
    return h('div', { class: 'coach pop' },
      h('div', { class: 'coach-title' }, this.story(`tutorial.${step}.title`, vars)),
      h('div', { class: 'coach-text' }, text),
      progress,
      action && btnLabel ? h('button', { class: 'btn green small', onclick: action }, btnLabel) : null);
  }

  navButton(icon, label, badge, onclick) {
    return h('button', { class: 'nav-btn', onclick },
      ic(icon, 2), h('span', {}, label),
      badge > 0 ? h('span', { class: 'badge' }, badge) : null);
  }

  modeBanner() {
    const g = this.game;
    let text;
    if (this.mode.type === 'devPlace') {
      text = `Dev: tap tiles to place ${this.content.creatures[this.mode.typeID]?.name || 'creatures'}`;
      return h('div', { class: 'banner dev' }, h('span', {}, text),
        h('button', { class: 'btn small grey', onclick: () => { this.mode = null; this.app.changed(false); } }, 'Done'));
    }
    if (this.mode.type === 'place') {
      const c = g.creature(this.mode.creatureID);
      text = `Tap an empty tile to place ${c ? this.app.displayName(c) : 'creature'}`;
    } else if (this.mode.type === 'nest') {
      text = this.mode.tile ? 'Tap another tile to compare, or nest it here' : `Tap an open tile to see what the ${this.content.items[this.mode.eggID]?.name || 'egg'} could hatch into there`;
    } else if (this.mode.type === 'decor') {
      text = `Tap an open tile to place the ${this.game.decorDef(this.mode.decorID)?.name || 'decoration'}`;
    } else if (this.mode.type === 'decorMove') {
      text = 'Tap an open tile to move it there';
    } else if (this.mode.type === 'trowel') {
      const c = g.creature(this.mode.creatureID);
      text = `Tap an open tile to move ${c ? this.app.displayName(c) : 'it'} with the trowel`;
    } else if (this.mode.type === 'use') {
      const def = this.content.items[this.mode.itemID];
      text = `Tap a tile: ${def?.use?.verb || 'Use'} ${def?.name || ''} (${g.state.inventory[this.mode.itemID] || 0} left)`;
    } else {
      text = `Tap an empty tile to plant (${g.state.inventory[this.mode.itemID] || 0} left)`;
    }
    return h('div', { class: 'banner' }, h('span', {}, text),
      h('button', { class: 'btn small grey', onclick: () => { this.mode = null; this.app.changed(false); } }, 'Cancel'));
  }

  tileCard(tile) {
    const g = this.game, now = g.now();
    const stats = g.tileStats(tile, now);
    const terrains = this.terrainsOnTile(tile, stats);
    const active = CORE_STATS.filter((k) => (stats[k] || 0) > 0);
    return h('div', { class: 'card' },
      h('div', { class: 'row space' }, h('b', {}, terrains.length ? terrains.map((t) => t.name).join(' · ') : 'Blank ground'),
        h('button', { class: 'x', onclick: () => { this.selectedTile = null; this.app.changed(false); } }, ic('close', 1))),
      active.length ? h('div', { class: 'stat-grid' }, active.map((k) => this.intensityRow(k, stats[k])))
        : h('p', { class: 'sub' }, 'No intensity here yet. Creatures nearby will change this ground.'),
      ...g.activeBoosts(now).filter((b) => b.tile.x === tile.x && b.tile.y === tile.y).map((b) =>
        h('div', { class: 'sub boost' }, ic('gem', 1), this.joinNodes(Object.entries(b.stats).map(([k, v]) => this.amountText(k, v)), ', '),
          b.expiresAt ? ` · ${duration((b.expiresAt - now) / 1000)} left` : ' · permanent')));
  }

  /** A stat's intensity as a meter: name and pips (filled = reached, hollow = not; not colour alone). */
  intensityRow(stat, value) {
    const it = intensityOf(value, this.content.tuning);
    const n = ((this.content.tuning.intensity || {}).bands || []).length || 9;
    return h('div', { class: 'stat meter' },
      h('span', { class: 'stat-name' }, cap(stat)),
      h('span', { class: 'pips', title: it.label, 'aria-label': `${cap(stat)}: ${it.label}` }, Array.from({ length: n }, (_, i) =>
        h('i', { class: 'pip' + (i < it.level ? ' on' : ''), style: i < it.level ? `background:${STAT_COLORS[stat] || '#fff'}` : '' }))));
  }

  /**
   * A small inline meter. For a level (value) the reached pips are filled. For a requirement
   * (opts.min), pips below its band are filled and its own band's pip is half-filled when the true
   * threshold sits partway through that band, so the meter never overstates or understates it.
   */
  miniMeter(stat, value, opts = {}) {
    const T = this.content.tuning;
    const n = ((T.intensity || {}).bands || []).length || 9;
    let full, part = false, label;
    if (opts.min != null) { const r = requirementOf(opts.min, T); full = r.exact ? r.level : r.level - 1; part = !r.exact; label = `${cap(stat)} at least ${r.text}`; }
    else { const it = intensityOf(value, T); full = it.level; label = `${cap(stat)}: ${it.label}`; }
    const col = STAT_COLORS[stat] || '#fff';
    return h('span', { class: 'pips mini', title: label, 'aria-label': label }, Array.from({ length: n }, (_, i) =>
      h('i', { class: 'pip' + (i < full ? ' on' : part && i === full ? ' part' : ''), style: i < full ? `background:${col}` : part && i === full ? `--c:${col}` : '' })));
  }

  /** What a creature or gem adds: "Stone ▮▯▯…" (below the influence floor: "a touch of Stone"). */
  amountText(stat, value) {
    return intensityOf(value, this.content.tuning).level ? [cap(stat), ' ', this.miniMeter(stat, value)] : `a touch of ${cap(stat)}`;
  }

  /** A requirement as name + meter ("Damp ▮▮◧▯…" means at least that much). */
  requirementText(stat, min) {
    return h('span', { class: 'req' }, cap(stat), ' ', this.miniMeter(stat, 0, { min }));
  }

  /** Join nodes with a separator (for inline lists of meters). */
  joinNodes(list, sep) { return list.flatMap((x, i) => (i ? [sep, x] : [x])); }

  /** Gem/material use, with meters instead of raw amounts. */
  useText(use) {
    if (!use) return null;
    if (use.type !== 'soilBoost' || !use.stats) return use.text;
    const all = Object.keys(use.stats).length === CORE_STATS.length;
    const amount = all ? ['every stat ', this.miniMeter('stone', Object.values(use.stats)[0])] : this.joinNodes(Object.entries(use.stats).map(([k, v]) => this.amountText(k, v)), ' and ');
    const g = this.game;
    const r = use.verb === 'Spread' && g ? (use.radius || 0) + g.upgradeTier('wideSpread') * ((g.upgradeDef('wideSpread') || {}).radiusPerTier ?? 1) : 0;
    const where = r ? `a tile and the ${(2 * r + 1) ** 2 - 1} around it` : 'a tile';
    return [`${use.verb}: adds `, amount, ` to ${where} ${use.permanent ? 'for good' : use.hours ? `for ${use.hours}h` : ''}`.trimEnd() + '.'];
  }

  /** Developer-only: a raw stat value (with its intensity label). */
  statBar(stat, value, label = null) {
    return h('div', { class: 'stat' },
      h('span', { class: 'stat-name' }, cap(stat)),
      h('span', { class: 'bar' }, h('span', { style: `width:${Math.min(100, value)}%;background:${STAT_COLORS[stat] || '#fff'}` })),
      h('span', { class: 'stat-val' }, label ? `${value.toFixed(1)} ${label}` : Math.round(value)));
  }

  toast(text, sprite) {
    // A message that just appeared gets its turn: later ones wait (a few at most) instead of replacing it.
    const nowMs = performance.now();
    if (this.toastShownAt && nowMs - this.toastShownAt < 1500 && document.getElementById('toast').classList.contains('show')) {
      this.toastQueue = (this.toastQueue || []).slice(-2);
      this.toastQueue.push([text, sprite]);
      return;
    }
    this.showToast(text, sprite);
  }

  showToast(text, sprite) {
    this.toastShownAt = performance.now();
    const el = document.getElementById('toast');
    el.replaceChildren(sprite ? this.sprites.element(sprite, null, 2) : '', h('span', {}, text));
    // During the tutorial the coach card owns the top of the screen, so toasts sit low.
    el.classList.toggle('low', !!(this.game && this.game.inTutorial));
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      const next = (this.toastQueue || []).shift();
      if (next) this.showToast(...next); else el.classList.remove('show');
    }, 2800);
  }

  // -------------------------------------------------------------- sheets

  open(type, arg) {
    this.sheet = { type, arg, stack: this.sheet && type === 'creature' && this.sheet.type === 'creatures' ? 'creatures' : null };
    this.renderSheet();
  }

  close() {
    if (this.sheet && this.sheet.stack) { this.sheet = { type: this.sheet.stack }; this.renderSheet(); return; }
    this.sheet = null;
    if (this.selectedCreatureID && !this.mode) this.selectedCreatureID = null;
    const el = document.getElementById('sheet');
    el.classList.remove('show');
    el.replaceChildren();
    this.app.changed(false);
  }

  renderSheet() {
    const el = document.getElementById('sheet');
    if (!this.sheet) { el.classList.remove('show'); return; }
    const { type, arg } = this.sheet;
    const build = {
      creatures: () => ['Creatures', this.creaturesBody()],
      burrow: () => ['Creatures', this.creaturesBody()],
      creature: () => this.creatureBody(arg),
      bag: () => ['Bag', this.bagBody()],
      guide: () => this.guideBody(),
      rename: () => ['Rename forest', this.renameBody()],
      debug: () => [this.app.devMode ? 'Developer mode' : 'Debug', this.debugBody()],
      tasks: () => ['Tasks', this.tasksBody()],
      inspect: () => [`Spawns · tile ${arg.x}, ${arg.y}`, this.inspectBody(arg)],
      entry: () => [arg.name, this.entryBody(arg)],
      terrain: () => [(this.terrainDef(arg) || {}).name || 'Terrain', this.terrainBody(arg)],
      offerings: () => ['The Old Log', this.offeringsBody()],
      decor: () => this.decorBody(arg),
      nest: () => this.nestBody(arg),
    }[type];
    if (!build) return;
    const [title, body] = build();
    const scrollTop = el.querySelector('.sheet-body')?.scrollTop || 0;
    el.replaceChildren(h('div', { class: 'sheet-panel' },
      h('div', { class: 'sheet-head' },
        this.sheet.stack ? h('button', { class: 'btn small grey', onclick: () => this.close() }, ic('back', 1), 'Back') : h('span'),
        h('b', {}, title),
        h('button', { class: 'btn small', onclick: () => { this.sheet = null; this.close(); } }, 'Done')),
      h('div', { class: 'sheet-body' }, body)));
    el.querySelector('.sheet-body').scrollTop = scrollTop;
    el.classList.add('show');
    el.onclick = (e) => { if (e.target === el) { this.sheet = null; this.close(); } };
  }

  traitSummary(c) {
    const parts = Object.entries(c.contributions).sort((a, b) => b[1] - a[1]).map(([k, v]) => this.amountText(k, v));
    return this.joinNodes([...parts, `Radius ${c.radius.toFixed(1)}`], ' · ');
  }

  creatureRow(c) {
    const g = this.game;
    const art = this.app.art(c);
    const p = g.activePlacement(c.id);
    return h('button', { class: 'list-row', onclick: () => this.open('creature', c.id) },
      h('div', { class: 'thumb' }, this.sprites.element(art.sprite, art.variant, 3)),
      h('div', { class: 'grow' },
        h('div', {}, h('b', {}, this.app.displayName(c)), c.isGlimmer ? h('span', { class: 'glimmer' }, ' ', ic('glimmer', 1), 'Glimmer') : null),
        h('div', { class: 'sub' }, this.speciesLine(c)),
        h('div', { class: 'sub' }, this.traitSummary(c)),
        p ? h('div', { class: 'sub' }, `Influence ${Math.round(g.level(p, g.now()) * 100)}%`) : null),
      h('span', { class: 'chev' }, ic('chevron', 2)));
  }

  speciesLine(c) {
    const def = this.content.creatures[c.typeID];
    if (!def) return '';
    const name = c.nickname ? `${def.name} · ` : '';
    return `${name}${def.familyName || def.family} · ${rarityName(def.rarity)}`;
  }

  /** The Creatures tab: who's out in the forest (no limit) and who's resting. */
  creaturesBody() {
    const g = this.game;
    const placed = g.placedCreatures, resting = g.burrow;
    return [
      placed.length ? h('div', { class: 'section' }, `Out in the forest (${placed.length})`) : null,
      ...placed.map((c) => this.creatureRow(c)),
      h('div', { class: 'section' }, 'Resting'),
      resting.length ? resting.map((c) => this.creatureRow(c))
        : h('p', { class: 'sub' }, g.state.creatures.length ? 'Everyone is out in the forest.'
          : 'No creatures yet. Pick mushrooms (Funglings hide inside), plant seeds (Sproutlings grow from them) and crack geodes (Geode Critters sleep inside).'),
    ];
  }

  creatureBody(id) {
    const g = this.game, c = g.creature(id);
    if (!c) return ['Creature', h('p', {}, 'This creature has wandered off.')];
    const def = this.content.creatures[c.typeID];
    const art = this.app.art(c);
    const p = g.activePlacement(c.id);
    const now = g.now();
    const name = h('input', { type: 'text', value: c.nickname || '', placeholder: def ? def.name : 'Name', maxlength: 24 });
    name.addEventListener('change', () => { g.rename(c.id, name.value); this.app.changed(); });
    let status;
    if (p) {
      const lv = g.level(p, now);
      status = [
        h('div', { class: 'sub' }, `In the forest at ${p.tile.x}, ${p.tile.y}`),
        h('div', { class: 'progress' }, h('span', { style: `width:${lv * 100}%` })),
        h('div', { class: 'sub' }, lv < 1 ? `Influence ${Math.round(lv * 100)}% · full strength in about ${duration((1 - lv) * (p.rampSeconds || this.content.tuning.rampSecondsToFull))}` : 'At full strength.'),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn', onclick: () => { this.app.view.centerOn(p.tile); this.selectedCreatureID = c.id; this.sheet = null; this.close(); } }, 'Show in forest'),
          g.state.unlocks.trowel ? h('button', { class: 'btn green', onclick: () => this.app.beginTrowel(c.id) }, 'Move (trowel)') : null,
          h('button', { class: 'btn red', onclick: () => { this.app.recall(c.id); this.sheet = null; this.close(); } }, 'Bring home')),
        g.state.unlocks.trowel ? h('div', { class: 'sub' }, 'The trowel moves it without losing any of its influence.') : null,
      ];
    } else {
      status = [
        h('div', { class: 'sub' }, 'Resting.'),
        h('button', { class: 'btn green', onclick: () => { this.app.beginPlacing(c.id); } }, ic('leaf', 1), 'Place in forest'),
      ];
    }
    const origin = c.origin === 'starter' ? 'Was here from the start' : c.origin === 'wanderer' ? 'Wandered in on its own'
      : this.content.items[c.origin] ? `From a ${this.content.items[c.origin].name}` : cap(c.origin || '');
    return [this.app.displayName(c), [
      h('div', { class: 'hero' }, this.sprites.element(art.sprite, art.variant, 7)),
      h('p', { class: 'sub center' }, this.speciesLine(c)),
      c.isGlimmer ? h('p', { class: 'glimmer' }, ic('glimmer', 1), `A glimmer! +50% bonuses and +${(this.content.tuning.creatureRoll || {}).glimmerRadiusBonus ?? 1} radius.`) : null,
      def && def.special ? h('div', { class: 'card special' }, h('b', {}, ic('sparkle', 1), 'Special: '), def.special,
        def.notYet ? h('div', { class: 'sub' }, `Not in the game yet: ${def.notYet}`) : null) : null,
      h('label', { class: 'field' }, 'Name', name),
      h('div', { class: 'section' }, 'Traits'),
      h('p', { class: 'sub' }, 'At full strength, on its own tile:'),
      h('div', { class: 'stat-grid' }, Object.entries(c.contributions).sort((a, b) => b[1] - a[1]).map(([k, v]) => this.intensityRow(k, v))),
      h('div', { class: 'sub' }, `Influence radius ${c.radius.toFixed(1)} tiles · ramps up over ${def?.rampHours ?? '?'}h`),
      origin ? h('div', { class: 'sub' }, `Found: ${origin}`) : null,
      h('div', { class: 'section' }, 'Status'),
      ...status,
    ]];
  }

  bagBody() {
    const g = this.game;
    const owned = Object.entries(g.state.inventory).filter(([, n]) => n > 0)
      .map(([id, n]) => ({ def: this.content.items[id], n })).filter((e) => e.def);
    const decor = Object.entries(g.state.decor.owned).filter(([, n]) => n > 0).map(([id, n]) => ({ def: g.decorDef(id), n })).filter((e) => e.def);
    const compostOn = (this.content.tuning.offerings || {}).compostEnabled !== false;
    const head = compostOn ? [h('div', { class: 'row space compost-row' }, h('span', {}, ic('leaf', 1), ` Compost: ${g.state.compost}`),
      h('span', { class: 'sub' }, 'Spare finds turn into compost.'))] : [];
    if (decor.length) {
      head.push(h('div', { class: 'section' }, 'Decor'), ...decor.map(({ def, n }) => h('div', { class: 'list-row' },
        h('div', { class: 'thumb' }, this.sprites.element(def.sprite, null, 3)),
        h('div', { class: 'grow' }, h('b', {}, def.name), def.text ? h('div', { class: 'sub' }, def.text) : null),
        h('b', {}, `×${n}`),
        h('button', { class: 'btn green small', onclick: () => this.app.beginDecor(def.id) }, 'Place'))));
    }
    if (!owned.length) return [...head, h('p', { class: 'sub' }, 'Your bag is empty. Tap mushrooms, plants and geodes in the forest to collect them.')];
    const order = ['egg', 'seed', 'supply', 'geode', 'material', 'gem', 'plant', 'mushroom'];
    const cats = [...new Set(owned.map((e) => e.def.category))].sort((a, b) =>
      ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    return [...head, ...cats.map((cat) => [
      h('div', { class: 'section' }, catTitle(cat)),
      cat === 'egg' ? h('p', { class: 'sub' }, `Nests in use: ${g.state.nests.length} of ${g.nestSlots}. What hatches depends on the ground you nest an egg on.`) : null,
      ...owned.filter((e) => e.def.category === cat)
        .sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity) || a.def.name.localeCompare(b.def.name))
        .map(({ def, n }) => h('div', { class: 'list-row' },
          h('div', { class: 'thumb' }, this.sprites.element(def.sprite, null, 3)),
          h('div', { class: 'grow' }, h('b', {}, def.name),
            h('div', { class: 'sub', style: `color:${RARITY_COLORS[def.rarity]}` }, rarityName(def.rarity)),
            def.use ? h('div', { class: 'sub' }, this.useText(def.use)) : null,
            def.tradeOnly ? h('div', { class: 'sub' }, 'Worth keeping: the Old Log trades for it.') : null),
          h('b', {}, `×${n}`),
          def.onGrow ? h('button', { class: 'btn green small', onclick: () => this.app.beginPlanting(def.id) }, 'Plant') : null,
          def.egg ? h('button', { class: 'btn green small', disabled: g.state.nests.length >= g.nestSlots, onclick: () => this.app.beginNest(def.id) }, 'Nest') : null,
          def.onCrack ? h('div', { class: 'crack-btns' },
            h('button', { class: 'btn orange small', onclick: () => { this.sheet = null; this.close(); this.openCrack(def.id); } }, 'Crack'),
            n > 1 ? h('button', { class: 'btn orange small', title: `Crack ${Math.min(n, this.batchMax)} at once`, onclick: () => { this.sheet = null; this.close(); this.openBatchCrack(def.id, Math.min(n, this.batchMax)); } }, `×${Math.min(n, this.batchMax)}`) : null) : null,
          def.use ? h('button', { class: 'btn small', onclick: () => this.app.beginUsing(def.id) }, def.use.type === 'soilBoost' ? (def.use.verb === 'Set into a tile' ? 'Set' : def.use.verb === 'Spread' ? 'Spread' : 'Crush') : 'Use') : null,
          compostOn && g.compostValue(def.id) ? h('button', { class: 'btn grey small', title: `Compost one for ${g.compostValue(def.id)}`, onclick: () => this.app.compostItem(def.id) }, `+${g.compostValue(def.id)}`) : null)),
    ])];
  }

  // -------------------------------------------------------------- offerings (the Old Log board)

  /** An item in a request: its art (a silhouette until it's in the Field Guide), name or hint, and have/need. */
  offerItemRow(x) {
    const def = this.content.items[x.item];
    const known = this.game.discovered.has('item:' + x.item);
    const art = def ? this.sprites.element(def.sprite, known ? null : { silhouette: [40, 52, 36] }, 2) : '';
    const need = def && def.spawn && def.spawn.requires && Object.keys(def.spawn.requires).length
      ? this.joinNodes(Object.entries(def.spawn.requires).map(([k, v]) => this.requirementText(k, v.min)), ' ') : (def && def.spawn ? 'Grows anywhere.' : null);
    return h('div', { class: 'offer-item' + (x.owned >= x.count ? ' met' : '') },
      h('div', { class: 'thumb small' }, art),
      h('div', { class: 'grow' }, h('b', {}, known ? def.name : '???'),
        h('div', { class: 'sub' }, known ? need : (def ? itemHint(def, this.content.story) : x.item))),
      h('b', { class: 'count' }, `${Math.min(x.owned, x.count)}/${x.count}`));
  }

  rewardText(r) {
    const g = this.game;
    if (r.type === 'cosmetic') return [this.sprites.element(g.decorDef(r.id)?.sprite || 'ui.icon.board', null, 2), ` ${g.decorDef(r.id)?.name || r.id}`];
    if (r.type === 'compost') return `${r.count} compost`;
    if (r.type === 'egg' || r.type === 'item') { const d = this.content.items[r.id]; return d ? [this.sprites.element(d.sprite, null, 2), ` ${d.name}${(r.count || 1) > 1 ? ' ×' + r.count : ''}`] : r.id; }
    if (r.type === 'upgrade') { const u = g.upgradeDef(r.id) || {}; return [u.sprite ? this.sprites.element(u.sprite, null, 2) : '', ` ${u.text || u.name || r.id}`]; }
    const u = { trowel: "The gardener's trowel: move creatures without losing influence", slot: 'Another creature slot', nest: 'Another nest', expansion: 'The treeline steps back' };
    return u[r.id] || r.id;
  }

  offerCard(st) {
    const r = st.req, a = this.app;
    const lockText = st.locks.map((l) => (l.type === 'guide' ? `${l.need} Field Guide entries (${l.have} so far)` : l.type === 'request' ? `after “${l.name}”` : `forest day ${l.need}`)).join(', ');
    return h('div', { class: 'card offer' + (st.locks.length ? ' locked' : '') + (st.ready ? ' ready' : '') },
      h('div', { class: 'row space' }, h('b', {}, r.name), h('span', { class: 'sub reward' }, this.rewardText(r.reward))),
      r.text ? h('p', { class: 'sub' }, r.text) : null,
      st.locks.length ? h('p', { class: 'sub lock' }, ic('lock', 1), ` Opens with ${lockText}.`) : st.items.map((x) => this.offerItemRow(x)),
      st.locks.length ? null : h('div', { class: 'row end' },
        h('button', { class: 'btn ' + (st.ready ? 'green' : 'grey'), disabled: !st.ready, onclick: () => a.deliverRequest(r.id) }, 'Deliver')));
  }

  /** A shop listing or upgrade tier: what you give (have/need) and what you get, in one compact card. */
  shopCard(st, label = 'Trade') {
    const r = st.req, a = this.app;
    return h('div', { class: 'card offer shop' + (st.ready ? ' ready' : '') + (st.locks.length ? ' locked' : '') },
      h('div', { class: 'row space' }, h('b', {}, r.name), h('span', { class: 'sub reward' }, this.rewardText(r.reward))),
      st.locks.length ? h('p', { class: 'sub lock' }, ic('lock', 1), ' Opens with ', st.locks.map((l) => (l.type === 'guide' ? `${l.need} Field Guide entries (${l.have} so far)` : l.type === 'request' ? `“${l.name}” first` : l.type === 'full' ? 'nothing: the whole forest is open' : `forest day ${l.need}`)).join(', '), '.')
        : h('div', { class: 'price' }, st.items.map((x) => {
          const d = this.content.items[x.item], known = g0(this).discovered.has('item:' + x.item);
          return h('span', { class: 'price-item' + (x.owned >= x.count ? ' met' : ''), title: known && d ? d.name : (d ? itemHint(d, this.content.story) : x.item) },
            d ? this.sprites.element(d.sprite, known ? null : { silhouette: [40, 52, 36] }, 2) : '', h('b', {}, `${Math.min(x.owned, x.count)}/${x.count}`));
        }), h('span', { class: 'grow' }),
        h('button', { class: 'btn small ' + (st.ready ? 'green' : 'grey'), disabled: !st.ready, onclick: () => a.deliverRequest(r.id) }, label)));
  }

  /** Upgrade lines: each upgrade's next tier (or that it's maxed), with the tier reached so far. */
  upgradeSection(board) {
    const g = this.game;
    const ups = board.filter((s) => s.req.kind === 'upgrade');
    const lines = [...new Set(ups.map((s) => s.req.reward.id))];
    if (!lines.length) return [];
    return [h('div', { class: 'section' }, 'Upgrades'), ...lines.map((id) => {
      const u = g.upgradeDef(id) || { name: id };
      const tier = g.upgradeTier(id);
      const next = ups.find((s) => s.req.reward.id === id && !s.done);
      const roman = ['', 'I', 'II', 'III', 'IV', 'V'];
      if (!next) return h('div', { class: 'card offer shop locked' }, h('div', { class: 'row space' }, h('b', {}, `${u.name} ${roman[tier] || tier}`), h('span', { class: 'sub' }, 'Complete')));
      const card = this.shopCard(next, 'Upgrade');
      if (tier) card.prepend(h('div', { class: 'sub' }, `You have ${u.name} ${roman[tier] || tier}.`));
      return card;
    })];
  }

  offeringsBody() {
    const g = this.game, now = g.now();
    const all = g.requestBoard(now);
    const shopList = all.filter((s) => s.req.kind === 'shop');
    const board = all.filter((s) => s.req.kind !== 'shop' && s.req.kind !== 'upgrade');
    const open = board.filter((s) => !s.done && !s.locks.length);
    const locked = board.filter((s) => !s.done && s.locks.length);
    const done = board.filter((s) => s.done);
    const compostOn = (this.content.tuning.offerings || {}).compostEnabled !== false;
    const shop = compostOn ? (this.content.cosmetics || []).filter((c) => c.compost != null) : [];
    return [
      h('p', { class: 'sub center' }, this.story('messages.offeringsIntro')),
      h('div', { class: 'row space compost-row' }, compostOn ? h('span', {}, ic('leaf', 1), ` Compost: ${g.state.compost}`) : h('span'),
        h('button', { class: 'btn small grey', onclick: () => this.open('entry', { name: 'The Old Log', sprite: 'landmark.old-log', variant: null, text: this.content.story?.guide?.landmarks?.['landmark.old-log'] }) }, 'About the log')),
      ...this.visitorSection(),
      shopList.length ? [h('div', { class: 'section' }, 'Shop'), h('p', { class: 'sub' }, 'Trade your finds. These can be bought again whenever you like.'),
        ...shopList.filter((s) => !s.locks.length).map((st) => this.shopCard(st)),
        ...shopList.filter((s) => s.locks.length).map((st) => this.shopCard(st))] : null,
      ...this.upgradeSection(all),
      h('div', { class: 'section' }, 'Requests'),
      open.length ? open.map((st) => this.offerCard(st)) : h('p', { class: 'sub' }, 'Nothing open right now. New requests open as your Field Guide grows.'),
      locked.length ? [h('div', { class: 'section' }, 'Coming later'), ...locked.map((st) => this.offerCard(st))] : null,
      shop.length ? [h('div', { class: 'section' }, 'Compost heap'), h('p', { class: 'sub' }, this.story('messages.compostIntro')),
        ...shop.map((c) => h('div', { class: 'list-row' },
          h('div', { class: 'thumb' }, this.sprites.element(c.sprite, null, 3)),
          h('div', { class: 'grow' }, h('b', {}, c.name), c.text ? h('div', { class: 'sub' }, c.text) : null),
          h('button', { class: 'btn small ' + (g.state.compost >= c.compost ? 'green' : 'grey'), disabled: g.state.compost < c.compost, onclick: () => this.app.buyDecor(c.id) }, `${c.compost} compost`)))] : null,
      done.length ? [h('div', { class: 'section' }, `Delivered (${done.length})`), h('p', { class: 'sub' }, done.map((st) => st.req.name).join(' · '))] : null,
    ];
  }

  /** Today's visitors: wanderers asking for items, paying in eggs. New ones each day; can be swapped for compost. */
  visitorSection() {
    const g = this.game, now = g.now(), a = this.app;
    const v = g.visitorsToday(now);
    if (!v.offers.length) return [];
    const cfg = this.content.tuning.visitors || {};
    const left = (cfg.maxRerolls ?? 3) - v.rerolls;
    const cost = cfg.rerollCost ?? 0;
    return [h('div', { class: 'section' }, 'Visitors today'), h('p', { class: 'sub' }, 'Wanderers stop by the log to trade. New visitors come each day.'),
      ...v.offers.map((o) => {
        const req = g.requestDef(o.requestID);
        if (!req) return null;
        const st = g.requestStatus(req, now);
        const w = this.content.creatures[o.wandererID];
        const art = w ? this.app.artForType(w, false) : null;
        return h('div', { class: 'card offer visitor' + (st.ready ? ' ready' : '') + (st.done ? ' locked' : '') },
          h('div', { class: 'row gap' }, art ? h('div', { class: 'thumb small' }, this.sprites.element(art.sprite, art.variant, 2, '', true)) : null,
            h('div', { class: 'grow' }, h('b', {}, req.name), h('div', { class: 'sub' }, `${/^[aeiou]/i.test(w ? w.name : 'w') ? 'An' : 'A'} ${w ? w.name : 'wanderer'} stops by. ${req.text || ''}`))),
          h('div', { class: 'sub reward row gap' }, 'Pays: ', this.rewardText(req.reward)),
          st.done ? h('p', { class: 'sub' }, 'Traded. Thank you!') : [
            ...st.items.map((x) => this.offerItemRow(x)),
            h('div', { class: 'row end gap' },
              (this.content.tuning.offerings || {}).compostEnabled === false ? null : h('button', { class: 'btn grey small', disabled: left <= 0 || g.state.compost < cost, title: `${left} left today`, onclick: () => a.rerollVisitor(req.id) }, `Someone else (${cost} compost)`),
              h('button', { class: 'btn ' + (st.ready ? 'green' : 'grey'), disabled: !st.ready, onclick: () => a.deliverRequest(req.id) }, 'Trade'))]);
      })];
  }

  /** A placed decoration: move it, recolour it, or put it back in the Bag. */
  decorBody(placedID) {
    const g = this.game, a = this.app;
    const d = g.state.decor.placed.find((x) => x.id === placedID);
    if (!d) return ['Decoration', h('p', { class: 'sub' }, 'Gone.')];
    const def = g.decorDef(d.decorID) || { name: d.decorID, sprite: 'ui.icon.board' };
    const cols = def.colors || [];
    const cost = (this.content.tuning.offerings || {}).compostEnabled === false ? 0 : ((this.content.tuning.offerings || {}).recolorCost ?? 0);
    return [def.name, [
      h('div', { class: 'hero' }, this.sprites.element(def.sprite, decorVariant(def, d.color), 6)),
      def.text ? h('p', { class: 'sub center' }, def.text) : null,
      cols.length > 1 ? h('p', { class: 'sub center' }, `Colour: ${cols[d.color || 0].name}`) : null,
      h('div', { class: 'row gap wrap center' },
        h('button', { class: 'btn green', onclick: () => a.beginDecorMove(d.id) }, 'Move'),
        cols.length > 1 ? h('button', { class: 'btn', disabled: g.state.compost < cost, onclick: () => a.recolorDecor(d.id) }, cost ? `Recolour (${cost} compost)` : 'Recolour') : null,
        h('button', { class: 'btn grey', onclick: () => a.removeDecor(d.id) }, 'Put away')),
    ]];
  }

  /** Silhouettes (names once found) of what an egg could hatch into on a tile, with rough odds. */
  hatchOdds(eggID, tile, startedAt = null) {
    const g = this.game, now = g.now();
    const list = g.hatchPreview(eggID, tile, now, startedAt ?? now);
    const pct = (p) => (p >= 0.995 ? '100%' : p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);
    return h('div', { class: 'hatch-odds' }, list.slice(0, 8).map((x) => {
      const known = g.discovered.has('creature:' + x.def.id);
      const art = this.app.artForType(x.def, false);
      return h('div', { class: 'odds-cell', title: known ? x.def.name : 'Not met yet' },
        this.sprites.element(art.sprite, known ? art.variant : { silhouette: [40, 52, 36] }, 2),
        h('span', { class: 'sub' }, known ? x.def.name : '???'), h('b', {}, pct(x.p)));
    }), list.length > 8 ? h('span', { class: 'sub' }, `+${list.length - 8} more`) : null);
  }

  nestPreviewCard(eggID, tile, confirm) {
    const g = this.game, now = g.now();
    const stats = g.tileStats(tile, now);
    const terrains = this.terrainsOnTile(tile, stats);
    return h('div', { class: 'card' },
      h('div', { class: 'row space' }, h('b', {}, `Nest here: ${terrains.length ? terrains.map((t) => t.name).join(' · ') : 'blank ground'}`)),
      h('p', { class: 'sub' }, 'If it hatched on this ground now:'),
      this.hatchOdds(eggID, tile),
      confirm ? h('div', { class: 'row end gap' }, h('button', { class: 'btn green', onclick: () => this.app.nestHere() }, 'Nest it here')) : null);
  }

  nestBody(nestID) {
    const g = this.game, now = g.now(), a = this.app;
    const n = g.state.nests.find((x) => x.id === nestID);
    if (!n) return ['Nest', h('p', { class: 'sub' }, 'Empty.')];
    const egg = this.content.items[n.eggID];
    const p = g.nestProgress(n, now);
    const shard = Object.values(this.content.items).find((i) => i.use && i.use.type === 'nextGlimmer');
    const hasShard = shard && g.state.inventory[shard.id] > 0;
    return [egg ? egg.name : 'Nest', [
      h('div', { class: 'hero' }, this.sprites.element(egg ? egg.sprite : 'egg.nest', null, 6, '', true)),
      h('div', { class: 'progress' }, h('span', { style: `width:${p * 100}%` })),
      h('p', { class: 'sub center' }, p >= 1 ? 'Ready to hatch!' : `Hatches in about ${duration((1 - p) * n.hatchSeconds)}.`),
      n.glimmer ? h('p', { class: 'sub center glimmer' }, ic('glimmer', 1), ' A Moonfall Shard rests in this nest: it will hatch a Glimmer.') : null,
      h('div', { class: 'section' }, p >= 1 ? 'It could hatch into' : 'If it hatched now, it could be'),
      h('p', { class: 'sub' }, 'The species comes from this ground when it hatches, so the creatures around it still matter.'),
      this.hatchOdds(n.eggID, n.tile, n.startedAt),
      h('div', { class: 'row gap wrap center' },
        p >= 1 ? h('button', { class: 'btn green', onclick: () => a.hatchNest(n.id) }, 'Hatch') : null,
        !n.glimmer && hasShard ? h('button', { class: 'btn', onclick: () => a.shardNest(n.id) }, ic('glimmer', 1), ' Use a Moonfall Shard') : null),
    ]];
  }

  guideEntries(tab) {
    const content = this.content;
    if (tab === TERRAIN_TAB) {
      return (content.terrain || []).map((t) => ({ key: 'terrain:' + t.id, name: t.name, terrain: t }));
    }
    if (tab === LANDMARK_TAB) {
      return (content.landmarks || []).filter((l) => l.inGuide !== false).map((l) => ({
        key: 'landmark:' + l.id.replace(/^landmark\./, ''), name: l.name, sprite: l.sprite, variant: null,
        text: content.story?.guide?.landmarks?.[l.id] || null,
      }));
    }
    const fam = FAMILY_TABS.find(([id]) => id === tab);
    if (fam) {
      return content.creatureList.filter((def) => def.family === tab).flatMap((def) => [false, true].map((glimmer) => {
        const art = this.app.artForType(def, glimmer);
        return {
          key: `creature:${def.id}${glimmer ? ':glimmer' : ''}`, name: glimmer ? `Glimmer ${def.name}` : def.name, ...art,
          rarity: glimmer ? null : def.rarity, glimmer, howFound: def.howFound, special: def.special,
          text: def.requires && Object.keys(def.requires).length
            ? ['Needs a tile with ', this.joinNodes(Object.entries(def.requires).map(([k, v]) => this.requirementText(k, v.min)), ', ')] : null,
        };
      }));
    }
    return content.itemList.filter((i) => i.inGuide !== false && i.category === tab)
      .map((i, idx) => ({ i, idx })).sort((a, b) => rarityIndex(a.i.rarity) - rarityIndex(b.i.rarity) || a.idx - b.idx)
      .map(({ i }) => ({
        key: 'item:' + i.id, name: i.name, sprite: i.sprite, variant: null, rarity: i.rarity, text: i.guideText,
        howFound: i.howFound || (i.spawn && i.spawn.seedOnly ? ['Grows from Mystery Seeds', (i.spawn.requires && Object.keys(i.spawn.requires).length
          ? [', best where ', this.joinNodes(Object.entries(i.spawn.requires).map(([k, v]) => this.requirementText(k, v.min)), ', ')] : ' anywhere.')] : null) || (i.spawn ? ['Grows wild', (i.spawn.requires && Object.keys(i.spawn.requires).length
          ? [' where ', this.joinNodes(Object.entries(i.spawn.requires).map(([k, v]) => this.requirementText(k, v.min)), ', ')] : ' anywhere.')] : null),
        special: i.use ? this.useText(i.use) : null,
        teaser: content.story?.guide?.teasers?.[i.id] || null,
      }));
  }

  guideBody() {
    const content = this.content;
    const order = ['mushroom', 'plant', 'geode', 'gem', 'material'];
    const cats = [...new Set(content.itemList.filter((i) => i.inGuide !== false).map((i) => i.category))]
      .sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    const famTabs = FAMILY_TABS.filter(([id]) => content.creatureList.some((c) => c.family === id)).map(([id]) => id);
    if (this.guideTab === 'creatures') this.guideTab = famTabs[0];
    const tabs = [LANDMARK_TAB, TERRAIN_TAB, ...famTabs, ...cats];
    const all = tabs.flatMap((t) => this.guideEntries(t));
    const found = all.filter((e) => this.game.discovered.has(e.key)).length;
    const sil = { silhouette: [78, 84, 92] };
    return [`Field Guide · ${found}/${all.length}`, [
      h('div', { class: 'tabs' }, tabs.map((t) => h('button', {
        class: 'tab' + (t === this.guideTab ? ' on' : ''), onclick: () => { this.guideTab = t; this.renderSheet(); },
      }, t === LANDMARK_TAB ? 'Landmarks' : t === TERRAIN_TAB ? 'Terrain' : (FAMILY_TABS.find(([id]) => id === t) || [null, catTitle(t)])[1]))),
      this.guideTab === TERRAIN_TAB ? this.terrainGrid() : h('div', { class: 'guide-grid' }, this.guideEntries(this.guideTab).map((e) => {
        const known = this.game.discovered.has(e.key);
        // Undiscovered entries with a teaser (the Heartwood Sapling) can still be opened as a silhouette.
        const teaser = !known && e.teaser;
        return h('button', {
          class: 'guide-cell' + (known ? '' : ' unknown') + (e.glimmer ? ' glim' : '') + (teaser ? ' teaser' : ''),
          onclick: () => { if (known) this.open('entry', e); else if (teaser) this.open('entry', { name: '???', sprite: e.sprite, variant: sil, text: e.teaser }); },
        },
          this.sprites.element(e.sprite, known ? e.variant : sil, 4),
          h('span', {}, known ? e.name : '???', teaser ? ic('sparkle', 1) : null),
          e.rarity ? h('i', { class: 'dot', style: `background:${RARITY_COLORS[e.rarity]}` }) : e.glimmer ? ic('glimmer', 1) : null);
      })),
    ]];
  }

  entryBody(e) {
    return [
      h('div', { class: 'hero' }, this.sprites.element(e.sprite, e.variant, 9)),
      e.rarity ? h('p', { class: 'rarity', style: `color:${RARITY_COLORS[e.rarity]}` }, rarityName(e.rarity).toUpperCase()) : null,
      e.howFound ? h('p', { class: 'sub center' }, e.howFound) : null,
      e.text ? h('p', { class: 'sub center' }, e.text) : null,
      e.special ? h('p', { class: 'center' }, ic('sparkle', 1), ' ' + e.special) : null,
    ];
  }

  // -------------------------------------------------------------- terrain (Field Guide)

  terrainDef(id) { return (this.content.terrain || []).find((t) => t.id === id) || null; }

  /** Terrain types on a tile right now: its combos, then its active stats (strongest first). */
  terrainsOnTile(tile, stats) {
    const list = this.content.terrain || [];
    if (!this.game.inClearing(tile)) return list.filter((t) => t.kind === 'treeline');
    const combos = this.game.combosAt(stats);
    const ter = this.game.terrainAt(stats);
    const out = list.filter((t) => (t.kind === 'terrain' && ter && t.terrain === ter.id) || (t.kind === 'combo' && combos.includes(t.combo)));
    const stat = list.filter((t) => t.kind === 'stat' && (stats[t.stat] || 0) > 0).sort((a, b) => (stats[b.stat] || 0) - (stats[a.stat] || 0));
    return [...out, ...stat].slice(0, 3);
  }

  /**
   * A terrain illustration from the real game sprites: cols x rows tiles of ground, with the
   * terrain's overlay/decoration at rising intensity stages, or a joined pond for water. Crisp, no
   * smoothing.
   */
  terrainArt(def, cols, rows, scale) {
    const TS = 16, art = def.art || {};
    const head = art.deco ? 8 : 0;
    const c = document.createElement('canvas');
    c.width = cols * TS; c.height = rows * TS + head;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const frame = (id) => this.sprites.frames(id, null)[0];
    const n = cols * rows;
    const stages = n === 1 ? [6] : Array.from({ length: n }, (_, i) => Math.max(1, Math.round(2 + i * 7 / Math.max(1, n - 1))));
    const pool = cols === 1 ? [[1]] : [[1, 1, 0], [1, 1, 1]];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ground = (art.ground || ['tile.grass.a', 'tile.grass.b', 'tile.grass.c'])[(x + y * 2) % (art.ground || [1, 2, 3]).length];
      g.drawImage(frame(ground).canvas, x * TS, y * TS + head);
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x, st = stages[i];
      if (art.water) {
        const at = (dx, dy) => ((pool[y + dy] || [])[x + dx] ? 1 : 0);
        if (at(0, 0)) g.drawImage(paintWaterTile(at, x + 40, y + 40, this.content.tuning.visuals.water || {}), x * TS, y * TS + head);
      }
      if (art.overlay) g.drawImage(frame(art.overlay.replace('{n}', st).replace('{ab}', (x + y) % 2 ? 'b' : 'a')).canvas, x * TS, y * TS + head);
      if (art.glow) g.drawImage(frame(art.glow.replace('{ab}', (x + y) % 2 ? 'b' : 'a')).canvas, x * TS, y * TS + head);
      if (art.deco) {
        const id = art.deco.replace('{n}', Math.max(st, def.kind === 'treeline' ? 1 : st));
        const f = frame(id), a = this.sprites.anchor(id);
        g.drawImage(f.canvas, x * TS + 8 - a.x, y * TS + head + 14 - a.y);
      }
    }
    c.style.width = c.width * scale + 'px';
    c.style.height = c.height * scale + 'px';
    c.className = 'px terrain-art';
    return c;
  }

  terrainGrid() {
    const dev = this.app.devMode;
    return h('div', { class: 'guide-grid' }, this.guideEntries(TERRAIN_TAB).map((e) => {
      const known = this.game.discovered.has(e.key);
      const view = known || dev;                     // developer mode can read every entry (not saved as found)
      const art = this.terrainArt(e.terrain, 1, 1, 4);
      if (!known) art.style.filter = 'brightness(0.25) saturate(0)';
      return h('button', { class: 'guide-cell' + (known ? '' : ' unknown'), onclick: () => { if (view) this.open('terrain', e.terrain.id); } },
        art, h('span', {}, known ? e.name : dev ? `${e.name} (dev)` : '???'));
    }));
  }

  /** Category bonus a stat gives (spawns.categoryScaling), at a given raw level, clamped like the game. */
  categoryMultAt(cat, stat, value) {
    const cs = this.content.tuning.spawns.categoryScaling || {};
    const pct = (cs[cat] || {})[stat];
    if (!pct) return null;
    return Math.min(cs.maxMultiplier ?? 6, Math.max(cs.minMultiplier ?? 0.25, 1 + (pct / 100) * value));
  }

  terrainBody(id) {
    const def = this.terrainDef(id);
    if (!def) return [h('p', {}, 'Unknown terrain.')];
    const T = this.content.tuning, g = this.game, now = g.now();
    const band = (i) => ((T.intensity || {}).bands || [])[i] || { min: 6, label: 'Low' };
    const lines = { appears: [], spawns: [], other: [] };
    const known = (it) => g.discovered.has('item:' + it.id);
    const itemList = (items) => {
      const names = items.filter(known).map((i) => i.name);
      const hidden = items.length - names.length;
      return names.join(', ') + (hidden ? `${names.length ? ', ' : ''}${hidden} not yet found` : '');
    };
    const lw = T.spawns.locationWeighting || {}, table = lw.generalByEffectCount || [1, 1.5, 2, 2.5];
    const general = `Ground with active effects draws spawns of every kind: ×${table[1]} with one effect, ×${table[2]} with two, ×${table[3]} with three or more, and more as intensity rises (up to ×${lw.maxWeight} in all). It's a bonus, not a guarantee.`;
    const catName = { mushroom: 'Mushrooms', plant: 'Plants', geode: 'Geodes' };
    if (def.kind === 'base') {
      lines.appears.push('Every tile until a stat reaches Low intensity.');
      lines.spawns.push(`Can appear: ${itemList(this.content.spawnableItems.filter((i) => !i.spawn.requires || !Object.keys(i.spawn.requires).length))}.`);
      lines.spawns.push('Mushrooms, plants and geodes are equally likely to be the kind that turns up.');
    } else if (def.kind === 'stat') {
      const k = def.stat;
      lines.appears.push([this.requirementText(k, band(0).min), ' or more. It grows through every level of the meter.']);
      const needs = this.content.spawnableItems.filter((i) => i.spawn.requires && i.spawn.requires[k]);
      if (needs.length) lines.spawns.push(`Wild finds that need ${cap(k)}: ${itemList(needs)}. Each appears once its own need is met (see its Field Guide entry).`);
      for (const cat of ['mushroom', 'plant', 'geode']) {
        const lo = this.categoryMultAt(cat, k, band(0).min), mid = this.categoryMultAt(cat, k, band(3).min);
        if (lo) lines.spawns.push([`${catName[cat]} become likelier to be the kind chosen here: about ×${lo.toFixed(1)} at `, this.miniMeter(k, band(0).min), `, ×${mid.toFixed(1)} at `, this.miniMeter(k, band(3).min), `, up to ×${(T.spawns.categoryScaling || {}).maxMultiplier ?? 6}.`]);
      }
      lines.spawns.push(general);
      const tr = T.terrain || {};
      if (k === 'stone') {
        lines.other.push(`After its creature leaves, Stone fades ${Math.round(1 / ((tr.statDecayRate || {}).stone || 1))}× more slowly than other stats.`);
        lines.other.push('Where Stone is the strongest stat, geodes lie exposed on top: tap to collect.');
      }
      if (k === 'depth') {
        lines.other.push('Where Depth is the strongest stat, geodes are buried. Things whose main need is Depth are always buried: they show as loose soil, tap to dig.');
        lines.other.push('Depth lowers the ground, so water runs here and collects.');
      }
      if (k === 'damp') {
        const mg = (tr.damp || {}).mushroomGrowth || {};
        lines.spawns.push(['Damp grows mushrooms faster: from ', this.requirementText('damp', mg.minDamp ?? 6), `, each tile gets extra mushroom chances, up to ×${1 + (mg.maxBonus ?? 2)} its usual rate.`]);
        lines.other.push('Water slowly seeps to drier neighbours and runs downhill; high Stone blocks it.');
      }
      if (k === 'glow') {
        const gc = tr.glowCycle || {};
        lines.other.push(`Glow counts ×${gc.dayFactor ?? 0.4} by day and ×${gc.nightFactor ?? 1.6} at night toward spawns. On deep ground it counts in full even by day.`);
      }
      if (k === 'bloom') {
        const bc = tr.bloomCycle || {};
        lines.other.push(`Bloom opens from ${bc.openHour ?? 6}:00, peaks at ${bc.peakHour ?? 12}:00 and closes by ${bc.closeHour ?? 19}:00; its effect on spawns follows the same rhythm.`);
        lines.other.push('Strong Bloom brings a wider mix of plants, and draws wanderers.');
      }
      if (k === 'verdure') {
        const v = tr.verdure || {};
        lines.other.push(['From ', this.requirementText('verdure', v.hideThreshold ?? 30), ', things on the surface hide in tall grass until you tap the tile.']);
        lines.other.push('Seeds grow faster here, and plants picked here drop extra seeds more often.');
      }
    } else if (def.kind === 'combo') {
      const cb = g.combo(def.combo);
      for (const [k, b] of Object.entries(cb.requires || {})) lines.appears.push([this.requirementText(k, b.min), ' or more']);
      lines.appears.push('All of these on the same tile.');
      if (def.combo === 'pool') {
        lines.spawns.push(`Only things that need Damp can spawn on water: ${itemList(this.content.spawnableItems.filter((i) => i.spawn.requires && i.spawn.requires.damp))}.`);
        lines.spawns.push(`Water Reed grows only in pools, and is ×${cb.clusterBonus ?? 2.5} likelier beside another reed.`);
        const lp = cb.lilyPads || {};
        lines.other.push(`Pools that join into a pond of ${lp.minTiles ?? 6} or more tiles may grow lily pads (more in bigger ponds).`);
        lines.other.push('Creatures splash as they wade through.');
      }
      if (def.combo === 'moss') lines.other.push('Bugs gather over moss: beetles by day, fireflies at night. They are part of the scenery.');
      if (def.combo === 'meadow') {
        const pg = cb.plantGrowth || {};
        lines.spawns.push(`Plants are ×${cb.plantCategoryMult ?? 3} likelier to be the kind chosen here.`);
        lines.spawns.push(`Each meadow tile also grows extra plants, up to ×${1 + (pg.maxBonus ?? 2.5)} its usual rate.`);
        lines.other.push(`Mystery Seeds planted here grow ×${cb.flowerGrowthMult ?? 2.5} faster.`);
      }
      lines.spawns.push(general);
    } else if (def.kind === 'terrain') {
      const td = g.terrainDef(def.terrain) || { requires: {}, home: new Set(), rule: {} };
      const n = Object.keys(td.requires).length;
      for (const [k, b] of Object.entries(td.requires)) lines.appears.push([this.requirementText(k, b.min), ' or more']);
      lines.appears.push(`All of these on the same tile. Where several terrains could form, the one with ${n > 2 ? 'three' : 'more'} stats wins, then the strongest.`);
      const home = this.content.spawnableItems.filter((i) => td.home.has(i.id));
      const hm = (T.terrains || {}).homeMult ?? 1;
      if (home.length) lines.spawns.push(`Home finds, ×${hm} likelier here once their own needs are met: ${itemList(home)}.`);
      lines.spawns.push(`Rarer finds are favoured most on ground that suits them (rare ×${(T.spawns.terrainAffinity || {}).byRarity?.rare ?? 1} compared with common ×${(T.spawns.terrainAffinity || {}).byRarity?.common ?? 1}).`);
      const r = td.rule || {};
      if (r.night) lines.spawns.push(`At night its home finds are ×${r.night} likelier again.`);
      if (r.day) lines.spawns.push(`By day its home finds are ×${r.day} likelier again.`);
      if (r.rain) lines.spawns.push(`In the rain its home finds are ×${r.rain} likelier again.`);
      for (const [c, m] of Object.entries(r.category || {})) lines.spawns.push(`${catName[c] || c} are ×${m} likelier to be the kind chosen here.`);
      if (r.location) lines.other.push(`Spawns land here ×${r.location} as often as on other ground with the same effects.`);
      lines.other.push('Counts as one more effect when choosing where spawns land.');
      lines.spawns.push(general);
    } else if (def.kind === 'treeline') {
      lines.appears.push('Everywhere outside your clearing.');
      lines.spawns.push('Nothing spawns in the treeline, and creature influence stops at its edge.');
      const e = T.expansion || {};
      lines.other.push(e.automatic ? `The clearing pushes it back by ${e.ringTiles ?? 2} tiles on each side as the land develops.`
        : `Trade with the Old Log ("Room to grow") to push it back by ${e.ringTiles ?? 2} tiles on each side.`);
    }
    // Compare with the tile you have selected (required vs current), without raw values.
    let compare = null;
    const sel = this.selectedTile;
    const relevant = def.kind === 'stat' ? { [def.stat]: { min: band(0).min } } : def.kind === 'combo' ? (g.combo(def.combo).requires || {}) : def.kind === 'terrain' ? ((g.terrainDef(def.terrain) || {}).requires || {}) : null;
    if (relevant) {
      if (sel) {
        const st = g.tileStats(sel, now);
        compare = [h('div', { class: 'section' }, 'Your selected tile'),
          ...Object.entries(relevant).map(([k, b]) => {
            const okNow = (st[k] || 0) >= b.min;
            return h('div', { class: 'req-row' }, h('span', { class: 'grow' }, cap(k)),
              h('span', { class: 'req-col' }, h('span', { class: 'sub' }, 'needs'), this.miniMeter(k, 0, { min: b.min })),
              h('span', { class: 'req-col' }, h('span', { class: 'sub' }, 'has'), this.miniMeter(k, st[k] || 0)),
              h('span', { class: 'req-mark ' + (okNow ? 'ok' : 'no') }, okNow ? 'met' : 'not yet'));
          })];
      } else compare = [h('p', { class: 'sub' }, 'Tip: select a tile in the forest, then open this page to compare it with what this terrain needs.')];
    }
    const section = (title, arr) => (arr.length ? [h('div', { class: 'section' }, title), ...arr.map((t) => h('p', { class: 'guide-line' }, t))] : []);
    return [
      h('div', { class: 'hero terrain-hero' }, this.terrainArt(def, 3, 2, 4)),
      !g.discovered.has('terrain:' + id) && this.app.devMode ? h('p', { class: 'dev-note' }, 'Developer view: not discovered in this forest yet.') : null,
      h('p', { class: 'sub center' }, def.text),
      ...section('Appears when', lines.appears),
      ...section('Spawns', lines.spawns),
      ...section('Other properties', lines.other),
      ...(compare || []),
    ];
  }

  tasksBody() {
    const g = this.game;
    const tasks = g.activeTasks();
    if (!tasks.length) return h('p', { class: 'sub' }, 'All tasks done. Your forest is on its way!');
    return [
      h('p', { class: 'sub' }, 'Little goals to get your forest going. New ones appear as you finish these.'),
      ...tasks.map((t) => h('div', { class: 'list-row task' + (t.done ? ' done' : '') },
        h('div', { class: 'grow' },
          h('b', {}, t.text),
          h('div', { class: 'progress' }, h('span', { style: `width:${Math.round(t.progress / t.target * 100)}%` })),
          h('div', { class: 'sub reward' }, `${t.progress}/${t.target} · Reward: `,
            ...(t.reward || []).map((r) => {
              const def = this.content.items[r.item];
              return h('span', { class: 'reward-item' }, def ? this.sprites.element(def.sprite, null, 1) : '', `${r.count || 1}× ${def ? def.name : r.item}`);
            }))),
        t.done ? h('button', { class: 'btn green small', onclick: () => this.app.claimTask(t.id) }, 'Claim') : null)),
    ];
  }

  /** Debug: the spawn maths for one tile, right now. */
  inspectBody(tile) {
    const g = this.game, now = g.now();
    const stats = g.tileStats(tile, now);
    const details = g.spawnDetails(tile, now);
    const catRows = Object.fromEntries(g.categoryDetails(details, stats, now).map((r) => [r.category, r]));
    const fmt = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
    const table = (list, catShare) => {
      const total = list.reduce((a, d) => a + d.weight, 0) || 1;
      return list.sort((a, b) => b.weight - a.weight).map((d) => h('div', { class: 'inspect-row' },
        this.sprites.element(d.item.sprite, null, 1),
        h('span', { class: 'grow' }, d.item.name, h('span', { class: 'sub', style: `color:${RARITY_COLORS[d.item.rarity]}` }, ' ' + rarityName(d.item.rarity)),
          (() => { const v = g.spawnView({ itemID: d.item.id, tile, placement: g.resolvePlacement(d.item, stats) }, now, stats); return v === 'surface' ? null : h('span', { class: 'tag' }, v); })()),
        h('span', { class: 'num' }, fmt(d.base)),
        h('span', { class: 'num' + (d.clamped ? ' clamped' : '') }, '×' + d.mult.toFixed(2) + (d.clamped ? '*' : '') + (d.fx !== 1 ? ` ×${d.fx}` : '') + (d.affinity && d.affinity !== 1 ? ` t×${d.affinity.toFixed(2)}` : '') + (d.home && d.home !== 1 ? ` h×${+d.home.toFixed(2)}` : '')),
        h('span', { class: 'num' }, fmt(d.weight)),
        h('b', { class: 'num' }, (d.weight / total * 100).toFixed(1) + '%')));
    };
    const cats = ['mushroom', 'plant', 'geode'];
    const seed = g.seedDetails(tile, now);
    const raw = g.tileStats(tile, now, { raw: true });
    return [
      h('p', { class: 'sub' }, 'Developer view: raw values (players see intensity only). Below the influence floor a stat counts as 0.'),
      h('div', { class: 'stat-grid' }, CORE_STATS.map((k) => this.statBar(k, raw[k] || 0, intensityOf(stats[k] || 0, this.content.tuning).label))),
      h('p', { class: 'sub' }, `${g.isNight(now) ? 'Night' : 'Day'}${g.isRaining(now) ? ', raining' : ''} · ` +
        (g.inClearing(tile) ? (g.isFree(tile) ? 'open tile' : 'tile is occupied (nothing spawns here now)') : 'outside the clearing')),
      (() => {
        // Each stat's identity on this tile: elevation, seeped Damp, Glow/Bloom time factors, placement.
        const e = g.elevationOf(stats), sh = g.shares(stats);
        const amb = g.ambientAt(tile.x, tile.y);
        const gf = g.glowFactor(now, stats), bf = g.bloomFactor(now);
        const hideAt = (this.content.tuning.terrain?.verdure || {}).hideThreshold ?? 30;
        const surface = (stats.verdure || 0) >= hideAt ? 'hidden in tall grass (tap to reveal)' : 'on the surface';
        const geode = sh.dominant === 'depth' ? 'buried' : sh.dominant === 'stone' ? 'exposed on the rock' : 'half-sunk in a mound';
        const row = (k, v) => h('div', { class: 'inspect-kv' }, h('span', { class: 'sub' }, k), h('b', {}, v));
        return h('div', { class: 'inspect-terrain' },
          row('Elevation', `${e >= 0 ? '+' : ''}${e.toFixed(2)} ${e > 0.15 ? '(raised)' : e < -0.15 ? '(sunken)' : '(level)'}`),
          row('Dominant stat', sh.dominant ? `${cap(sh.dominant)} (${Math.round(sh[sh.dominant] * 100)}%)` : 'none'),
          row('Combo', (() => { const cs = g.combosAt(stats); return cs.length ? cs.map((id) => g.combo(id).name || id).join(', ') : 'none'; })()),
          row('Intensity stages', CORE_STATS.map((k) => {
            const th = this.content.tuning.visuals.intensityStages || [];
            const v = k === 'glow' ? (stats.glow || 0) * g.glowFactor(now, stats, 'visual') : k === 'bloom' ? (stats.bloom || 0) * g.bloomFactor(now) : (stats[k] || 0);
            const n = th.filter((x) => v >= x).length;
            return n ? `${cap(k)} ${n}` : null;
          }).filter(Boolean).join(' · ') || 'none'),
          row('Ambient Damp', `${amb.toFixed(1)} (seeped / pooled)`),
          row('Glow factor', `×${gf.toFixed(2)} ${g.isNight(now) ? '(night)' : (stats.depth || 0) > 0 ? '(day, deep tiles glow more)' : '(day)'}`),
          row('Bloom cycle', `×${bf.toFixed(2)}`),
          row('Spawns here', `${surface}; geodes ${geode}; Depth items buried`));
      })(),
      (() => {
        // Where-to-spawn weight for this tile (effect-aware), and its share of all spawn locations.
        const loc = g.spawnLocations(now);
        const me = loc.tiles.find((x) => x.tile.x === tile.x && x.tile.y === tile.y);
        if (!me) return null;
        const lw = this.content.tuning.spawns.locationWeighting || {};
        const table = lw.generalByEffectCount || [1, 1.5, 2, 2.5];
        const eff = Math.round(me.effects);
        return h('p', { class: 'sub' }, h('b', {}, `Location weight ${me.weight.toFixed(2)}`),
          ` = ${lw.base ?? 1} × ${table[Math.min(table.length - 1, eff)]} (${eff} effect${eff === 1 ? '' : 's'}) × ${(1 + Math.min(lw.maxIntensityBonus ?? 99, (lw.perStatPoint || 0) * me.intensity)).toFixed(2)} (${me.intensity.toFixed(0)} stat pts)` +
          ` · ${(me.weight / loc.total * 100).toFixed(2)}% of spawn picks (a blank tile: ${((lw.base ?? 1) / loc.total * 100).toFixed(2)}%)`);
      })(),
      h('div', { class: 'inspect-head' }, h('span', { class: 'grow' }, 'Item'), h('span', { class: 'num' }, 'Base'),
        h('span', { class: 'num' }, 'Mult'), h('span', { class: 'num' }, 'Weight'), h('span', { class: 'num' }, 'Chance')),
      ...cats.map((cat) => {
        const list = details.filter((d) => d.item.category === cat);
        return [
          h('div', { class: 'section' }, `${catTitle(cat)} · ${catRows[cat] ? (catRows[cat].share * 100).toFixed(0) + '% of rolls (×' + catRows[cat].mult.toFixed(2) + ')' : 'none qualify'}`),
          list.length ? table(list) : h('p', { class: 'sub' }, 'Nothing qualifies here.'),
        ];
      }),
      h('div', { class: 'section' }, 'A Mystery Seed planted here now could grow into'),
      seed.length ? table(seed) : h('p', { class: 'sub' }, 'No plant qualifies.'),
      h('p', { class: 'sub' }, '* multiplier clamped to the configured range. Chance is within the category; the category itself is picked first by spawns.categoryWeights × its stat multiplier (spawns.categoryScaling).'),
    ];
  }

  renameBody() {
    const g = this.game;
    const input = h('input', { type: 'text', value: g.state.customName || '', placeholder: g.generatedName, maxlength: 40 });
    return [
      h('label', { class: 'field' }, 'Forest name', input),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn green', onclick: () => { this.app.renameForest(input.value); this.sheet = null; this.close(); } }, 'Save'),
        h('button', { class: 'btn grey', onclick: () => { this.app.renameForest(null); this.sheet = null; this.close(); } }, 'Use its own name')),
      h('p', { class: 'sub' }, `Left unnamed, the forest names itself after its strongest qualities (right now: “${g.generatedName}”), and the name changes as the land does.`),
    ];
  }

  /** Time + view tools shared by the normal debug menu and developer mode. */
  timeAndViewTools() {
    const a = this.app;
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    return [
      h('div', { class: 'section' }, 'Time speed'),
      h('div', { class: 'row gap wrap' }, a.speeds.map((v) => b(`${v}×`, () => { a.setSpeed(v); this.renderSheet(); }, v === a.speed ? 'green' : 'grey'))),
      h('p', { class: 'sub' }, '60× = a minute per second · 3600× = an hour per second. Creatures take 12–48 forest-hours to reach full strength.'),
      h('div', { class: 'section' }, 'Skip ahead'),
      h('div', { class: 'row gap wrap' }, b('+1 hour', () => a.debugSkip(1)), b('+6 hours', () => a.debugSkip(6)), b('+1 day', () => a.debugSkip(24))),
      // Raw values (inspector, overlay, heatmap) are developer-only.
      ...(a.devMode ? this.devViewTools() : []),
    ];
  }

  devViewTools() {
    const a = this.app;
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    return [
      h('div', { class: 'section' }, 'View (raw values)'),
      h('div', { class: 'row gap wrap' },
        b(this.statOverlay ? 'Hide stat overlay' : 'Show stat overlay', () => { this.statOverlay = !this.statOverlay; a.changed(false); this.renderSheet(); }),
        b(this.spawnHeatmap ? 'Spawn heatmap: ON' : 'Spawn heatmap: off', () => { this.spawnHeatmap = !this.spawnHeatmap; a.changed(false); this.renderSheet(); }, this.spawnHeatmap ? 'orange' : ''),
        b(this.spawnInspector ? 'Spawn inspector: ON' : 'Spawn inspector: off', () => { this.spawnInspector = !this.spawnInspector; a.changed(false); this.renderSheet(); }, this.spawnInspector ? 'orange' : '')),
      h('p', { class: 'sub' }, 'Spawn heatmap: tints each open tile by how likely wild spawns are to land there (brighter = likelier). Spawn inspector: tap a tile for its stats, its location weight, and every item that can spawn there with its odds.'),
    ];
  }

  debugBody() {
    const a = this.app;
    if (a.devMode) return this.devBody();
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    return [
      h('div', { class: 'section' }, 'Developer mode'),
      h('p', { class: 'sub' }, 'Test everything in a separate test forest: unlock all creatures, items, slots and the whole map, and try any combination. Your real forest is saved first and is never changed while developer mode is on.'),
      h('div', { class: 'row gap wrap' },
        b('Enter developer mode', () => a.enterDevMode('resume'), 'orange'),
        b('…with a copy of my forest', () => a.enterDevMode('copy'))),
      ...this.timeAndViewTools(),
      h('p', { class: 'sub' }, 'Time tools here change your real forest. Item and creature gifts are in developer mode.'),
      h('div', { class: 'section' }, 'Tutorial'),
      h('div', { class: 'row gap wrap' },
        b('Replay tutorial (new forest)', () => { if (confirm('Start a fresh forest and replay the tutorial?')) a.resetForest(); }),
        this.game.inTutorial ? b('Skip tutorial', () => { this.game.finishTutorial(); this.sheet = null; this.close(); a.changed(); }) : null),
      h('div', { class: 'section' }, 'Danger'),
      b('Reset forest', () => { if (confirm('Start a brand-new forest? This erases your progress.')) a.resetForest(); }, 'red'),
    ];
  }

  /** Developer mode: unlocks and combination tools for the separate test forest. */
  devBody() {
    const a = this.app, g = this.game;
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    const done = () => { this.sheet = null; this.close(); };
    const speciesSelect = () => h('select', { class: 'select' }, FAMILY_TABS.map(([fid, fname]) =>
      h('optgroup', { label: fname }, this.content.creatureList.filter((c) => c.family === fid)
        .map((c) => h('option', { value: c.id }, `${c.name} (${rarityName(c.rarity)}, r${c.radius})`)))));
    const place = speciesSelect();
    const full = h('input', { type: 'checkbox', checked: true });
    const glim = h('input', { type: 'checkbox' });
    const give = speciesSelect();
    const itemSel = h('select', { class: 'select' }, ['mushroom', 'plant', 'seed', 'geode', 'gem', 'material'].map((cat) =>
      h('optgroup', { label: catTitle(cat) }, Object.values(this.content.items).filter((i) => i.category === cat)
        .map((i) => h('option', { value: i.id }, i.name)))));
    const setupName = h('input', { type: 'text', placeholder: 'Setup name', maxlength: 30 });
    const setups = a.devSetups();
    return [
      h('div', { class: 'dev-note' }, h('b', {}, 'Developer mode is on'),
        h('span', {}, ` · test forest (${g.state.dev?.createdFrom === 'copy' ? 'copied from your forest' : 'separate'}). Nothing here touches your real forest.`)),
      h('div', { class: 'row gap wrap' },
        b('Back to my forest', () => a.exitDevMode(), 'green'),
        b('New blank test forest', () => { if (confirm('Replace the test forest with a blank one?')) a.resetDevForest('blank'); }),
        b('Copy my forest in', () => { if (confirm('Replace the test forest with a copy of your real forest?')) a.resetDevForest('copy'); })),

      h('div', { class: 'section' }, 'Unlock'),
      h('div', { class: 'row gap wrap' },
        b('Unlock everything', () => a.dev((gm, t) => { gm.finishTutorial(); gm.devUnlockCreatures(t, { glimmers: true }); gm.devGrantItems(5); gm.devFillGuide(); gm.devOpenForest(t); },
          'Unlocked: all creatures + glimmers, 5 of every item, the whole Field Guide, the whole forest.'), 'orange'),
        b('All creatures', () => a.dev((gm, t) => gm.devUnlockCreatures(t), (n) => `+${n} creatures resting.`)),
        b('+ glimmers', () => a.dev((gm, t) => gm.devUnlockCreatures(t, { glimmers: true }), (n) => `+${n} creatures resting.`)),
        b('5 of every item', () => a.dev((gm) => gm.devGrantItems(5), (n) => `+5 of ${n} items.`)),
        b('Fill Field Guide', () => a.dev((gm) => gm.devFillGuide(), 'Field Guide complete.')),
        b('Whole forest open', () => a.dev((gm, t) => gm.devOpenForest(t), 'The clearing now covers the whole forest.')),
        g.inTutorial ? b('Finish tutorial', () => a.dev((gm) => gm.finishTutorial(), 'Tutorial finished.')) : null),

      h('div', { class: 'section' }, 'Try combinations'),
      h('p', { class: 'sub' }, 'Pick a species, then tap tiles to place new ones. There\'s no limit.'),
      h('div', { class: 'row gap wrap' }, place,
        h('label', { class: 'check' }, full, ' full strength'), h('label', { class: 'check' }, glim, ' glimmer'),
        b('Place on tiles', () => { this.mode = { type: 'devPlace', typeID: place.value, full: full.checked, glimmer: glim.checked }; this.selectedTile = null; done(); a.changed(false); }, 'orange')),
      h('div', { class: 'row gap wrap' },
        b('Remove all creatures', () => a.dev((gm, t) => gm.devClearPlacements(t), 'All creatures brought home (instantly, no fade).')),
        b('Max strength now', () => a.dev((gm, t) => { for (const p of gm.activePlacements) p.startLevel = 1; gm.statCache = gm.statField(t); }, 'All placed creatures at full strength.')),
        b('Clear wild spawns', () => a.dev((gm) => gm.devClearSpawns(), 'Wild spawns cleared.')),
        b('Run 20 spawn ticks', () => a.dev((gm, t) => gm.devSpawnTicks(t, 20), (n) => `${n} new spawns.`))),

      h('div', { class: 'section' }, 'Saved setups'),
      h('div', { class: 'row gap wrap' }, h('div', { class: 'field grow' }, setupName), b('Save setup', () => { a.saveDevSetup(setupName.value.trim()); this.renderSheet(); }, 'green')),
      Object.keys(setups).length ? Object.entries(setups).sort((x, y) => y[1].savedAt - x[1].savedAt).map(([name, st]) => h('div', { class: 'row gap setup-row' },
        h('span', { class: 'grow' }, name, h('span', { class: 'sub' }, ' · ' + new Date(st.savedAt).toLocaleString())),
        b('Load', () => { a.loadDevSetup(name); }),
        b('Delete', () => { if (confirm(`Delete setup “${name}”?`)) { a.deleteDevSetup(name); this.renderSheet(); } }, 'grey'))) : h('p', { class: 'sub' }, 'No saved setups yet. Save the current test forest to come back to it.'),

      h('div', { class: 'section' }, 'Offerings'),
      h('div', { class: 'row gap wrap' },
        b('+50 compost', () => a.dev((gm) => { gm.state.compost += 50; }, '+50 compost.')),
        b('Complete open requests', () => a.dev((gm, t) => gm.devCompleteRequests(t), (n) => `${n} request(s) completed.`)),
        b('Complete all requests', () => a.dev((gm, t) => gm.devCompleteRequests(t, true), (n) => `${n} request(s) completed.`)),
        b('Reset requests', () => a.dev((gm) => gm.devResetRequests(), 'Requests reset (rewards kept).')),
        b('New visitors', () => a.dev((gm, t) => gm.devNewVisitors(t), (n) => `${n} new visitor(s).`)),
        b('One of every decor', () => a.dev((gm) => gm.devGrantDecor(), (n) => `+${n} decor.`))),
      h('div', { class: 'section' }, 'Eggs'),
      h('div', { class: 'row gap wrap' },
        b('One of every egg', () => a.dev((gm) => gm.devGiveEggs(1), (n) => `+${n} eggs.`)),
        b('Hatch nests now', () => a.dev((gm, t) => gm.devHatchNow(t), (n) => `${n} nest(s) ready to hatch.`)),
        b('+2 nests', () => a.dev((gm) => { gm.state.unlocks.nests += 2; }, 'Two more nests.'))),

      h('div', { class: 'section' }, 'Give'),
      h('div', { class: 'row gap wrap' }, give,
        b('Give', () => a.debugGiveCreature(give.value, false)),
        b('Give glimmer', () => a.debugGiveCreature(give.value, true))),
      h('div', { class: 'row gap wrap' }, itemSel,
        b('+1', () => a.debugGive(itemSel.value, 1)), b('+5', () => a.debugGive(itemSel.value, 5))),

      ...this.timeAndViewTools(),
    ];
  }

  // -------------------------------------------------------------- reveals

  /** Stepped pixel rays behind a reveal, tinted via a palette swap (data sprite "ui.burst"). */
  burst(color, scale = 5) {
    const variant = color ? { swap: { 2: '#ffffff', 3: color } } : null;
    return this.sprites.element('ui.burst', variant, scale, 'burst', true);
  }

  /** A short celebratory card (blend moment). */
  celebrate(title, text) {
    const ov = document.getElementById('overlay');
    if (ov.classList.contains('show')) { this.toast(text); return; }
    const done = () => { ov.classList.remove('show'); ov.replaceChildren(); };
    ov.replaceChildren(h('div', { class: 'reveal-card pop' },
      h('div', { class: 'rays-wrap small' }, this.burst(null, 2.5), h('span', { class: 'row' }, ic('leaf', 4), ic('sparkle', 4))),
      h('h2', {}, title), h('p', { class: 'sub' }, text),
      h('button', { class: 'btn green', onclick: done }, 'Lovely')));
    ov.onclick = (e) => { if (e.target === ov) done(); };
    ov.classList.add('show');
  }

  showReveal(creature, isNew, source) {
    const ov = document.getElementById('overlay');
    // Several finds at once (Collect All): show them one after another.
    if (ov.classList.contains('show') && ov.querySelector('.reveal-card')) { (this.revealQueue = this.revealQueue || []).push([creature, isNew, source]); return; }
    const art = this.app.art(creature);
    const done = () => {
      ov.classList.remove('show'); ov.replaceChildren();
      const next = (this.revealQueue || []).shift();
      if (next) this.showReveal(...next);
    };
    ov.replaceChildren(h('div', { class: 'reveal-card pop' },
      h('h2', { class: creature.isGlimmer ? 'glimmer' : '' }, creature.isGlimmer ? [ic('glimmer', 2), `A glimmer ${this.app.displayName(creature)}!`, ic('glimmer', 2)] : `You found a ${this.app.displayName(creature)}!`),
      h('p', { class: 'sub' }, `It came from ${source}.`),
      h('div', { class: 'rays-wrap' }, this.burst(creature.isGlimmer ? null : '#ffffff'), this.sprites.element(art.sprite, art.variant, 8, 'grow-in', true)),
      h('p', { class: 'sub' }, this.traitSummary(creature)),
      isNew ? h('p', { class: 'new' }, 'New Field Guide entry!') : null,
      h('button', { class: 'btn green', onclick: done }, 'Lovely')));
    ov.onclick = (e) => { if (e.target === ov) done(); };
    ov.classList.add('show');
  }

  get batchMax() { return ((this.content.tuning.geodes || {}).batchMax) ?? 5; }

  /**
   * Batch cracking: up to five geodes. Rewards are granted first (exactly once), then shown on one
   * screen sized for five: a 3 + 2 grid of result cards that crack open in quick succession. Tap
   * anywhere to skip to the end; Continue is always there.
   */
  openBatchCrack(itemID, count) {
    const app = this.app;
    const ov = document.getElementById('overlay');
    const def = this.content.items[itemID];
    const results = app.crackMany(itemID, count);
    if (!results.length) return;
    const openID = def.openSprite && this.sprites.has(def.openSprite) ? def.openSprite : def.sprite;
    const timers = [];
    const cards = results.map((res, i) => {
      const body = h('div', { class: 'batch-body' });
      const rock = h('div', { class: 'batch-rock' }, this.sprites.element(def.sprite, null, 4));
      let best = -1;
      const lines = res.rewards.map((r) => {
        if (r.creature) {
          best = Math.max(best, 5);
          const art = app.art(r.creature);
          const cdef = this.content.creatures[r.creature.typeID];
          return h('div', { class: 'batch-line creature' + (r.creature.isGlimmer ? ' glimmer' : '') },
            this.sprites.element(art.sprite, art.variant, 3, '', true),
            h('div', {}, h('b', {}, app.displayName(r.creature)),
              h('span', { class: 'sub', style: `color:${RARITY_COLORS[cdef?.rarity] || '#fff'}` }, r.creature.isGlimmer ? 'Glimmer!' : rarityName(cdef?.rarity || 'common')),
              r.isNew ? h('span', { class: 'new' }, 'New!') : null));
        }
        const it = this.content.items[r.item];
        best = Math.max(best, rarityIndex(it?.rarity || 'common'));
        return h('div', { class: 'batch-line' },
          this.sprites.element(it?.sprite || '__missing', null, 3),
          h('div', {}, h('b', {}, `${it ? it.name : r.item}`, r.count > 1 ? ` ×${r.count}` : ''),
            h('span', { class: 'sub', style: `color:${RARITY_COLORS[it?.rarity] || '#fff'}` }, rarityName(it?.rarity || 'common')),
            r.isNew ? h('span', { class: 'new' }, 'New!') : null));
      });
      const special = best >= 2;                       // rare or better, or a creature: highlighted
      const card = h('div', { class: 'batch-card' + (special ? ' special' : '') + (best >= 5 ? ' has-creature' : '') },
        h('div', { class: 'batch-num' }, `#${i + 1}`), rock, body);
      const reveal = () => {
        if (card.classList.contains('open')) return;
        card.classList.add('open');
        rock.replaceChildren(this.sprites.element(openID, null, 4));
        body.replaceChildren(...(lines.length ? lines : [h('div', { class: 'sub' }, 'Just dust.')]));
      };
      card._reveal = reveal;
      timers.push(setTimeout(() => { card.classList.add('shake'); }, 120 + i * 260));
      timers.push(setTimeout(reveal, 380 + i * 260));
      return card;
    });
    const revealAll = () => { timers.forEach(clearTimeout); cards.forEach((c) => c._reveal()); };
    const left = app.game.state.inventory[itemID] || 0;
    const close = () => { revealAll(); ov.classList.remove('show'); ov.replaceChildren(); app.changed(false); };
    const panel = h('div', { class: 'batch-panel', onclick: (e) => { if (!e.target.closest('button')) revealAll(); } },
      h('h2', { class: 'center' }, `${results.length} × ${def.name}`),
      h('div', { class: 'batch-grid n' + results.length }, cards),
      h('p', { class: 'sub center' }, 'Tap to show everything at once. Creatures go to your Creatures tab.'),
      h('div', { class: 'batch-footer' },
        left > 1 ? h('button', { class: 'btn orange', onclick: () => { revealAll(); this.openBatchCrack(itemID, Math.min(left, this.batchMax)); } }, `Crack ${Math.min(left, this.batchMax)} more`) : null,
        left === 1 ? h('button', { class: 'btn orange', onclick: () => { revealAll(); this.openCrack(itemID); } }, 'Crack the last one') : null,
        h('button', { class: 'btn green', onclick: close }, 'Continue')));
    ov.replaceChildren(h('div', { class: 'batch-wrap' }, panel));
    ov.classList.add('show');
  }

  openCrack(itemID) {
    const app = this.app;
    const ov = document.getElementById('overlay');
    const def = this.content.items[itemID];
    let hits = 0;
    const needed = 3 + Math.floor(Math.random() * 3);
    // Pixel crack stages: a data sprite whose frames are the stages (two patterns per geode type).
    const crackSets = (def.crackSprites || []).filter((id) => this.sprites.has(id));
    const crackSprite = crackSets.length ? crackSets[Math.floor(Math.random() * crackSets.length)] : null;
    const crackFrames = crackSprite ? this.sprites.frames(crackSprite) : [];
    const stoneColour = (() => { const pal = this.sprites.palette(this.sprites.sprite(def.sprite)); const c = pal[4] || pal[2]; return `rgb(${c[0]},${c[1]},${c[2]})`; })();
    const rockWrap = h('div', { class: 'rock-wrap' });
    const hint = h('p', { class: 'hint-big' }, 'Tap the rock to crack it open');
    const stage = h('div', { class: 'crack-stage' }, rockWrap);
    const footer = h('div', { class: 'crack-footer' });
    const cfg = this.content.tuning.tutorial || {};
    let family = null;
    const needsChoice = cfg.creatureFamily === 'choose' && app.game.hasGuaranteedGeode(itemID);

    const drawRock = () => {
      const rock = this.sprites.element(def.sprite, null, 12, '', true);
      const layers = [rock];
      const stage = Math.min(crackFrames.length, Math.ceil(hits * crackFrames.length / needed));
      if (stage > 0) {
        const f = crackFrames[stage - 1];
        const c = document.createElement('canvas');
        c.width = f.w; c.height = f.h;
        c.getContext('2d').drawImage(f.canvas, 0, 0);
        c.style.width = f.w * 12 + 'px'; c.style.height = f.h * 12 + 'px';
        c.className = 'px crack-layer';
        layers.push(c);
      }
      rockWrap.replaceChildren(...layers);
    };
    drawRock();

    const chips = () => {
      for (let i = 0; i < 4; i++) {
        const c = h('i', { class: 'chip', style: `background:${stoneColour}` });
        c.style.setProperty('--dx', `${Math.random() * 280 - 140}px`);
        c.style.setProperty('--dy', `${Math.random() * 180 - 140}px`);
        stage.append(c);
        setTimeout(() => c.remove(), 500);
      }
    };

    const burst = () => {
      const results = app.crack(itemID, { family });
      const flash = h('div', { class: 'flash' });
      ov.append(flash);
      setTimeout(() => flash.remove(), 700);
      if (navigator.vibrate) navigator.vibrate([20, 40, 60]);
      // The opened geode (hollow lined with crystals) splits into two halves.
      const openID = def.openSprite && this.sprites.has(def.openSprite) ? def.openSprite : def.sprite;
      const left = this.sprites.element(openID, null, 12, 'half left');
      const right = this.sprites.element(openID, null, 12, 'half right');
      const r = results[0];
      let revealEl, text;
      if (!r) {
        revealEl = h('span');
        text = h('p', { class: 'hint-big' }, 'Just dust this time.');
      } else if (r.creature) {
        const art = app.art(r.creature);
        revealEl = h('div', { class: 'rays-wrap' }, this.burst(null), this.sprites.element(art.sprite, art.variant, 10, 'grow-in', true));
        text = h('div', { class: 'center' },
          h('h2', { class: 'glimmer' }, r.creature.isGlimmer ? [ic('glimmer', 2), `A glimmer ${app.displayName(r.creature)} was inside!`, ic('glimmer', 2)] : `A ${app.displayName(r.creature)} was curled up inside!`),
          h('p', { class: 'sub' }, this.traitSummary(r.creature)),
          h('p', { class: 'sub' }, "It's resting in your Creatures tab."),
          r.isNew ? h('p', { class: 'new' }, 'New Field Guide entry!') : null);
      } else {
        const gem = this.content.items[r.item];
        const color = RARITY_COLORS[gem?.rarity] || '#fff';
        revealEl = h('div', { class: 'rays-wrap' }, this.burst(color), this.sprites.element(gem?.sprite || '__missing', null, 10, 'grow-in', true));
        text = h('div', { class: 'center' },
          h('h2', {}, gem ? gem.name : r.item),
          gem ? h('p', { class: 'rarity', style: `color:${color}` }, rarityName(gem.rarity).toUpperCase()) : null,
          gem && gem.use ? h('p', { class: 'sub' }, this.useText(gem.use)) : null,
          r.isNew ? h('p', { class: 'new' }, 'New Field Guide entry!') : null);
      }
      rockWrap.replaceChildren(left, right, revealEl);
      requestAnimationFrame(() => rockWrap.classList.add('split'));
      hint.replaceWith(text);
      const left2 = app.game.state.inventory[itemID] || 0;
      footer.replaceChildren(...[
        left2 > 0 ? h('button', { class: 'btn orange', onclick: () => this.openCrack(itemID) }, `Crack another (${left2})`) : null,
        left2 > 1 ? h('button', { class: 'btn orange', onclick: () => this.openBatchCrack(itemID, Math.min(left2, this.batchMax)) }, `Crack ${Math.min(left2, this.batchMax)} at once`) : null,
        h('button', { class: 'btn grey', onclick: () => { ov.classList.remove('show'); ov.replaceChildren(); } }, 'Done'),
      ].filter(Boolean));
    };

    rockWrap.onclick = () => {
      if (needsChoice && !family) return;
      if (hits >= needed) return;
      hits++;
      rockWrap.classList.remove('shake');
      void rockWrap.offsetWidth;
      rockWrap.classList.add('shake');
      if (navigator.vibrate) navigator.vibrate(15);
      chips();
      if (hits >= needed) { rockWrap.onclick = null; setTimeout(burst, 120); } else { drawRock(); hint.textContent = 'Keep tapping…'; }
    };

    footer.replaceChildren(h('button', { class: 'btn grey', onclick: () => { ov.classList.remove('show'); ov.replaceChildren(); } }, 'Not now'));
    if (needsChoice) {
      // Test option: the player picks which family hatches from the tutorial geode.
      hint.textContent = this.story('tutorial.crack.choose');
      const families = cfg.families || ['fungling', 'sproutling', 'geodeCritter'];
      const pick = h('div', { class: 'family-pick' }, families.map((fam) => {
        const sample = this.content.creatureList.find((c) => c.family === fam && c.rarity === 'common');
        return h('button', { class: 'btn grey family', onclick: () => {
          family = fam;
          pick.remove();
          hint.textContent = 'Tap the rock to crack it open';
        } }, sample ? this.sprites.element(sample.sprite, null, 3) : '', h('span', {}, sample?.familyName || fam));
      }));
      hint.after(pick);
    }
    ov.replaceChildren(h('div', { class: 'crack-screen' }, stage, hint, footer));
    ov.onclick = null;
    ov.classList.add('show');
  }
}

export { RARITIES };
