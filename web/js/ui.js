// DOM user interface: HUD, sheets (Burrow, Bag, Field Guide), geode cracking, reveals.
import { CORE_STATS, RARITIES, RARITY_NAMES, rarityIndex } from './core.js';

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

const CATEGORY_TITLES = { seed: 'Seeds', geode: 'Geodes to crack', gem: 'Gems', material: 'Materials', plant: 'Plants', mushroom: 'Mushrooms' };
const LANDMARK_TAB = 'landmarks';
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
        h('button', { class: 'round-btn', title: 'Debug', onclick: () => this.open('debug') }, ic('bug', 2))) : null,
    ), this.coachCard());

    const bottom = h('div', { class: 'hud-bottom' });
    if (this.mode) bottom.append(this.modeBanner());
    if (this.selectedTile) bottom.append(this.tileCard(this.selectedTile));
    bottom.append(this.slotsBar());
    const invCount = Object.values(g.state.inventory).reduce((a, b) => a + b, 0);
    bottom.append(h('div', { class: 'nav' },
      this.navButton('burrow', 'Burrow', g.burrow.length, () => this.open('burrow')),
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
    if (this.mode.type === 'place') {
      const c = g.creature(this.mode.creatureID);
      text = `Tap an empty tile to place ${c ? this.app.displayName(c) : 'creature'}`;
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
    const stats = this.game.tileStats(tile, this.game.now());
    return h('div', { class: 'card' },
      h('div', { class: 'row space' }, h('b', {}, `Tile ${tile.x}, ${tile.y}`),
        h('button', { class: 'x', onclick: () => { this.selectedTile = null; this.app.changed(false); } }, ic('close', 1))),
      h('div', { class: 'stat-grid' }, CORE_STATS.map((k) => this.statBar(k, stats[k] || 0))),
      ...this.game.activeBoosts(this.game.now()).filter((b) => b.tile.x === tile.x && b.tile.y === tile.y).map((b) =>
        h('div', { class: 'sub boost' }, ic('gem', 1), Object.entries(b.stats).map(([k, v]) => `+${v} ${cap(k)}`).join(', ') +
          (b.expiresAt ? ` · ${duration((b.expiresAt - this.game.now()) / 1000)} left` : ' · permanent'))));
  }

  statBar(stat, value) {
    return h('div', { class: 'stat' },
      h('span', { class: 'stat-name' }, cap(stat)),
      h('span', { class: 'bar' }, h('span', { style: `width:${Math.min(100, value)}%;background:${STAT_COLORS[stat] || '#fff'}` })),
      h('span', { class: 'stat-val' }, Math.round(value)));
  }

  slotsBar() {
    const g = this.game, now = g.now();
    return h('div', { class: 'slots' }, g.state.slots.map((slot) => {
      const p = slot.placementID && g.state.placements.find((x) => x.id === slot.placementID);
      const c = p && g.creature(p.creatureID);
      const open = g.unlockedSlots(now);
      const index = g.state.slots.indexOf(slot);
      if (index >= open) {
        return h('div', { class: 'slot locked' }, ic('lock', 2),
          h('span', { class: 'slot-day' }, this.story('messages.lockedSlot', { day: g.slotUnlockDay(index) ?? '?' })));
      }
      if (!c) return h('div', { class: 'slot empty' }, ic('plus', 2));
      const art = this.app.art(c);
      const lv = g.level(p, now);
      return h('button', { class: 'slot', onclick: () => { this.selectedTile = null; this.selectedCreatureID = c.id; this.open('creature', c.id); } },
        this.sprites.element(art.sprite, art.variant, 3),
        h('span', { class: 'mini-bar' }, h('span', { style: `width:${lv * 100}%` })));
    }));
  }

  toast(text, sprite) {
    const el = document.getElementById('toast');
    el.replaceChildren(sprite ? this.sprites.element(sprite, null, 2) : '', h('span', {}, text));
    // During the tutorial the coach card owns the top of the screen, so toasts sit low.
    el.classList.toggle('low', !!(this.game && this.game.inTutorial));
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // -------------------------------------------------------------- sheets

  open(type, arg) {
    this.sheet = { type, arg, stack: this.sheet && type === 'creature' && this.sheet.type === 'burrow' ? 'burrow' : null };
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
      burrow: () => ['Burrow', this.burrowBody()],
      creature: () => this.creatureBody(arg),
      bag: () => ['Bag', this.bagBody()],
      guide: () => this.guideBody(),
      rename: () => ['Rename forest', this.renameBody()],
      debug: () => ['Debug', this.debugBody()],
      tasks: () => ['Tasks', this.tasksBody()],
      inspect: () => [`Spawns · tile ${arg.x}, ${arg.y}`, this.inspectBody(arg)],
      entry: () => [arg.name, this.entryBody(arg)],
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
    const parts = Object.entries(c.contributions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${cap(k)} +${Math.round(v)}`);
    return [...parts, `Radius ${c.radius.toFixed(1)}`].join(' · ');
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

  burrowBody() {
    const g = this.game;
    const placed = g.placedCreatures, burrow = g.burrow;
    return [
      placed.length ? h('div', { class: 'section' }, `Out in the forest (${placed.length}/${g.state.slots.length})`) : null,
      ...placed.map((c) => this.creatureRow(c)),
      h('div', { class: 'section' }, 'In the Burrow'),
      burrow.length ? burrow.map((c) => this.creatureRow(c))
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
          h('button', { class: 'btn red', onclick: () => { this.app.recall(c.id); this.sheet = null; this.close(); } }, 'Return to Burrow')),
      ];
    } else {
      const free = g.freeSlotCount > 0;
      status = [
        h('div', { class: 'sub' }, 'Resting in the Burrow.'),
        h('button', { class: 'btn green', disabled: !free, onclick: () => { this.app.beginPlacing(c.id); } }, ...(free ? [ic('leaf', 1), 'Place in forest'] : ['All slots are full'])),
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
      ...Object.entries(c.contributions).sort((a, b) => b[1] - a[1]).map(([k, v]) => this.statBar(k, v)),
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
    if (!owned.length) return h('p', { class: 'sub' }, 'Your bag is empty. Tap mushrooms, plants and geodes in the forest to collect them.');
    const order = ['seed', 'geode', 'material', 'gem', 'plant', 'mushroom'];
    const cats = [...new Set(owned.map((e) => e.def.category))].sort((a, b) =>
      ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    return cats.map((cat) => [
      h('div', { class: 'section' }, catTitle(cat)),
      ...owned.filter((e) => e.def.category === cat)
        .sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity) || a.def.name.localeCompare(b.def.name))
        .map(({ def, n }) => h('div', { class: 'list-row' },
          h('div', { class: 'thumb' }, this.sprites.element(def.sprite, null, 3)),
          h('div', { class: 'grow' }, h('b', {}, def.name),
            h('div', { class: 'sub', style: `color:${RARITY_COLORS[def.rarity]}` }, rarityName(def.rarity)),
            def.use ? h('div', { class: 'sub' }, def.use.text) : null),
          h('b', {}, `×${n}`),
          def.onGrow ? h('button', { class: 'btn green small', onclick: () => this.app.beginPlanting(def.id) }, 'Plant') : null,
          def.onCrack ? h('button', { class: 'btn orange small', onclick: () => { this.sheet = null; this.close(); this.openCrack(def.id); } }, 'Crack') : null,
          def.use ? h('button', { class: 'btn small', onclick: () => this.app.beginUsing(def.id) }, def.use.type === 'soilBoost' ? (def.use.verb === 'Set into a tile' ? 'Set' : 'Crush') : 'Use') : null)),
    ]);
  }

  guideEntries(tab) {
    const content = this.content;
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
            ? 'Needs a tile with ' + Object.entries(def.requires).map(([k, v]) => `${cap(k)} ${v.min}+`).join(', ') + '.' : null,
        };
      }));
    }
    return content.itemList.filter((i) => i.inGuide !== false && i.category === tab)
      .map((i, idx) => ({ i, idx })).sort((a, b) => rarityIndex(a.i.rarity) - rarityIndex(b.i.rarity) || a.idx - b.idx)
      .map(({ i }) => ({
        key: 'item:' + i.id, name: i.name, sprite: i.sprite, variant: null, rarity: i.rarity, text: i.guideText,
        howFound: i.howFound || (i.spawn ? 'Grows wild' + (i.spawn.requires && Object.keys(i.spawn.requires).length
          ? ' where ' + Object.entries(i.spawn.requires).map(([k, v]) => `${cap(k)} ${v.min}+`).join(', ') : ' anywhere') + '.' : null),
        special: i.use ? i.use.text : null,
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
    const tabs = [LANDMARK_TAB, ...famTabs, ...cats];
    const all = tabs.flatMap((t) => this.guideEntries(t));
    const found = all.filter((e) => this.game.discovered.has(e.key)).length;
    const sil = { silhouette: [78, 84, 92] };
    return [`Field Guide · ${found}/${all.length}`, [
      h('div', { class: 'tabs' }, tabs.map((t) => h('button', {
        class: 'tab' + (t === this.guideTab ? ' on' : ''), onclick: () => { this.guideTab = t; this.renderSheet(); },
      }, t === LANDMARK_TAB ? 'Landmarks' : (FAMILY_TABS.find(([id]) => id === t) || [null, catTitle(t)])[1]))),
      h('div', { class: 'guide-grid' }, this.guideEntries(this.guideTab).map((e) => {
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
    const catRows = Object.fromEntries(g.categoryDetails(details, stats).map((r) => [r.category, r]));
    const fmt = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
    const table = (list, catShare) => {
      const total = list.reduce((a, d) => a + d.weight, 0) || 1;
      return list.sort((a, b) => b.weight - a.weight).map((d) => h('div', { class: 'inspect-row' },
        this.sprites.element(d.item.sprite, null, 1),
        h('span', { class: 'grow' }, d.item.name, h('span', { class: 'sub', style: `color:${RARITY_COLORS[d.item.rarity]}` }, ' ' + rarityName(d.item.rarity))),
        h('span', { class: 'num' }, fmt(d.base)),
        h('span', { class: 'num' + (d.clamped ? ' clamped' : '') }, '×' + d.mult.toFixed(2) + (d.clamped ? '*' : '') + (d.fx !== 1 ? ` ×${d.fx}` : '')),
        h('span', { class: 'num' }, fmt(d.weight)),
        h('b', { class: 'num' }, (d.weight / total * 100).toFixed(1) + '%')));
    };
    const cats = ['mushroom', 'plant', 'geode'];
    const seed = g.seedDetails(tile, now);
    return [
      h('div', { class: 'stat-grid' }, CORE_STATS.map((k) => this.statBar(k, stats[k] || 0))),
      h('p', { class: 'sub' }, `${g.isNight(now) ? 'Night' : 'Day'}${g.isRaining(now) ? ', raining' : ''} · ` +
        (g.inClearing(tile) ? (g.isFree(tile) ? 'open tile' : 'tile is occupied (nothing spawns here now)') : 'outside the clearing')),
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

  debugBody() {
    const a = this.app;
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    return [
      h('div', { class: 'section' }, 'Time speed'),
      h('div', { class: 'row gap wrap' }, a.speeds.map((v) => b(`${v}×`, () => { a.setSpeed(v); this.renderSheet(); }, v === a.speed ? 'green' : 'grey'))),
      h('p', { class: 'sub' }, '60× = a minute per second · 3600× = an hour per second. Creatures take 12–48 forest-hours to reach full strength.'),
      h('div', { class: 'section' }, 'Skip ahead'),
      h('div', { class: 'row gap wrap' }, b('+1 hour', () => a.debugSkip(1)), b('+6 hours', () => a.debugSkip(6)), b('+1 day', () => a.debugSkip(24))),
      h('div', { class: 'section' }, 'View'),
      h('div', { class: 'row gap wrap' },
        b(this.statOverlay ? 'Hide stat overlay' : 'Show stat overlay', () => { this.statOverlay = !this.statOverlay; a.changed(false); this.renderSheet(); }),
        b(this.spawnInspector ? 'Spawn inspector: ON' : 'Spawn inspector: off', () => { this.spawnInspector = !this.spawnInspector; a.changed(false); this.renderSheet(); }, this.spawnInspector ? 'orange' : '')),
      h('p', { class: 'sub' }, 'Spawn inspector: while on, tapping a tile shows its stats and every qualifying wild spawn with its effective weight and odds.'),
      h('div', { class: 'section' }, 'Give'),
      h('div', { class: 'row gap wrap' },
        b('3 Mystery Seeds', () => a.debugGive('seed.mystery-seed', 3)),
        b('3 Pebble Geodes', () => a.debugGive('geode.pebble-geode', 3)),
        b('1 Deep Geode', () => a.debugGive('geode.deep-geode', 1)),
        b('Heartstone Core', () => a.debugGive('material.heartstone-core', 1)),
        b('Moonfall Shard', () => a.debugGive('material.moonfall-shard', 1))),
      (() => {
        const sel = h('select', { class: 'select' }, FAMILY_TABS.map(([fid, fname]) =>
          h('optgroup', { label: fname }, this.content.creatureList.filter((c) => c.family === fid)
            .map((c) => h('option', { value: c.id }, `${c.name} (${rarityName(c.rarity)})`)))));
        return h('div', { class: 'row gap wrap' }, sel,
          b('Give', () => a.debugGiveCreature(sel.value, false)),
          b('Give glimmer', () => a.debugGiveCreature(sel.value, true)));
      })(),
      h('div', { class: 'section' }, 'Tutorial'),
      h('div', { class: 'row gap wrap' },
        b('Replay tutorial (new forest)', () => { if (confirm('Start a fresh forest and replay the tutorial?')) a.resetForest(); }),
        this.game.inTutorial ? b('Skip tutorial', () => { this.game.finishTutorial(); this.sheet = null; this.close(); a.changed(); }) : null),
      h('div', { class: 'section' }, 'Danger'),
      b('Reset forest', () => { if (confirm('Start a brand-new forest? This erases your progress.')) a.resetForest(); }, 'red'),
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
    const art = this.app.art(creature);
    const ov = document.getElementById('overlay');
    const done = () => { ov.classList.remove('show'); ov.replaceChildren(); };
    ov.replaceChildren(h('div', { class: 'reveal-card pop' },
      h('h2', { class: creature.isGlimmer ? 'glimmer' : '' }, creature.isGlimmer ? [ic('glimmer', 2), `A glimmer ${this.app.displayName(creature)}!`, ic('glimmer', 2)] : `You found a ${this.app.displayName(creature)}!`),
      h('p', { class: 'sub' }, `It came from ${source}.`),
      h('div', { class: 'rays-wrap' }, this.burst(creature.isGlimmer ? null : '#ffffff'), this.sprites.element(art.sprite, art.variant, 8, 'grow-in', true)),
      h('p', { class: 'sub' }, this.traitSummary(creature)),
      isNew ? h('p', { class: 'new' }, 'New Field Guide entry!') : null,
      h('button', { class: 'btn green', onclick: done }, 'Welcome to the Burrow')));
    ov.onclick = (e) => { if (e.target === ov) done(); };
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
          h('p', { class: 'sub' }, "It's waiting in your Burrow."),
          r.isNew ? h('p', { class: 'new' }, 'New Field Guide entry!') : null);
      } else {
        const gem = this.content.items[r.item];
        const color = RARITY_COLORS[gem?.rarity] || '#fff';
        revealEl = h('div', { class: 'rays-wrap' }, this.burst(color), this.sprites.element(gem?.sprite || '__missing', null, 10, 'grow-in', true));
        text = h('div', { class: 'center' },
          h('h2', {}, gem ? gem.name : r.item),
          gem ? h('p', { class: 'rarity', style: `color:${color}` }, rarityName(gem.rarity).toUpperCase()) : null,
          gem && gem.use ? h('p', { class: 'sub' }, gem.use.text) : null,
          r.isNew ? h('p', { class: 'new' }, 'New Field Guide entry!') : null);
      }
      rockWrap.replaceChildren(left, right, revealEl);
      requestAnimationFrame(() => rockWrap.classList.add('split'));
      hint.replaceWith(text);
      const left2 = app.game.state.inventory[itemID] || 0;
      footer.replaceChildren(...[
        left2 > 0 ? h('button', { class: 'btn orange', onclick: () => this.openCrack(itemID) }, `Crack another (${left2})`) : null,
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
