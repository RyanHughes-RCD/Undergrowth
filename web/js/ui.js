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
const FAMILY_TABS = [['fungling', 'Funglings'], ['sproutling', 'Sproutlings'], ['geodeCritter', 'Geode Critters'], ['wanderer', 'Wanderers']];
const catTitle = (c) => CATEGORY_TITLES[c] || cap(c);

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
    const clock = `${g.isNight(now) ? '🌙' : '☀️'} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${g.isRaining(now) ? ' 🌧' : ''}${g.state.nextGlimmer ? ' ✨' : ''}`;
    const top = h('div', { class: 'hud-top' },
      h('button', { class: 'name-btn', onclick: () => this.open('rename') },
        h('div', { class: 'forest-name' }, g.forestName),
        h('div', { class: 'hint' }, `${clock} · tap to rename`)),
      this.content.tuning.debugTools ? h('div', { class: 'dev' },
        h('button', { class: 'speed-btn' + (this.app.speed > 1 ? ' on' : ''), title: 'Time speed', onclick: () => this.app.cycleSpeed() },
          h('b', {}, `⏩ ${this.app.speed}×`),
          g.state.debugTimeOffset > 0 ? h('span', {}, `+${duration(g.state.debugTimeOffset / 1000)}`) : null),
        h('button', { class: 'round-btn', title: 'Debug', onclick: () => this.open('debug') }, '🐞')) : null,
    );

    const bottom = h('div', { class: 'hud-bottom' });
    if (this.mode) bottom.append(this.modeBanner());
    if (this.selectedTile) bottom.append(this.tileCard(this.selectedTile));
    bottom.append(this.slotsBar());
    const invCount = Object.values(g.state.inventory).reduce((a, b) => a + b, 0);
    bottom.append(h('div', { class: 'nav' },
      this.navButton('🏠', 'Burrow', g.burrow.length, () => this.open('burrow')),
      this.navButton('🎒', 'Bag', invCount, () => this.open('bag')),
      this.navButton('📖', 'Guide', 0, () => this.open('guide')),
    ));
    this.root.replaceChildren(top, bottom);
    if (this.sheet && withSheet) this.renderSheet();
  }

  navButton(icon, label, badge, onclick) {
    return h('button', { class: 'nav-btn', onclick },
      h('span', { class: 'icon' }, icon), h('span', {}, label),
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
        h('button', { class: 'x', onclick: () => { this.selectedTile = null; this.app.changed(false); } }, '✕')),
      h('div', { class: 'stat-grid' }, CORE_STATS.map((k) => this.statBar(k, stats[k] || 0))),
      ...this.game.activeBoosts(this.game.now()).filter((b) => b.tile.x === tile.x && b.tile.y === tile.y).map((b) =>
        h('div', { class: 'sub' }, '💎 ' + Object.entries(b.stats).map(([k, v]) => `+${v} ${cap(k)}`).join(', ') +
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
      if (!c) return h('div', { class: 'slot empty' }, '+');
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
      entry: () => [arg.name, this.entryBody(arg)],
    }[type];
    if (!build) return;
    const [title, body] = build();
    const scrollTop = el.querySelector('.sheet-body')?.scrollTop || 0;
    el.replaceChildren(h('div', { class: 'sheet-panel' },
      h('div', { class: 'sheet-head' },
        this.sheet.stack ? h('button', { class: 'btn small grey', onclick: () => this.close() }, '‹ Back') : h('span'),
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
        h('div', {}, h('b', {}, this.app.displayName(c)), c.isGlimmer ? h('span', { class: 'glimmer' }, ' ✦ Glimmer') : null),
        h('div', { class: 'sub' }, this.speciesLine(c)),
        h('div', { class: 'sub' }, this.traitSummary(c)),
        p ? h('div', { class: 'sub' }, `Influence ${Math.round(g.level(p, g.now()) * 100)}%`) : null),
      h('span', { class: 'chev' }, '›'));
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
        h('button', { class: 'btn green', disabled: !free, onclick: () => { this.app.beginPlacing(c.id); } }, free ? '🌿 Place in forest' : 'All slots are full'),
      ];
    }
    const origin = c.origin === 'starter' ? 'Was here from the start' : c.origin === 'wanderer' ? 'Wandered in on its own'
      : this.content.items[c.origin] ? `From a ${this.content.items[c.origin].name}` : cap(c.origin || '');
    return [this.app.displayName(c), [
      h('div', { class: 'hero' }, this.sprites.element(art.sprite, art.variant, 7)),
      h('p', { class: 'sub center' }, this.speciesLine(c)),
      c.isGlimmer ? h('p', { class: 'glimmer' }, '✦ A glimmer! +50% bonuses and +1 radius.') : null,
      def && def.special ? h('div', { class: 'card special' }, h('b', {}, '✨ Special: '), def.special,
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
      }));
  }

  guideBody() {
    const content = this.content;
    const order = ['mushroom', 'plant', 'geode', 'gem', 'material'];
    const cats = [...new Set(content.itemList.filter((i) => i.inGuide !== false).map((i) => i.category))]
      .sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    const famTabs = FAMILY_TABS.filter(([id]) => content.creatureList.some((c) => c.family === id)).map(([id]) => id);
    if (this.guideTab === 'creatures') this.guideTab = famTabs[0];
    const tabs = [...famTabs, ...cats];
    const all = tabs.flatMap((t) => this.guideEntries(t));
    const found = all.filter((e) => this.game.discovered.has(e.key)).length;
    const sil = { silhouette: [78, 84, 92] };
    return [`Field Guide · ${found}/${all.length}`, [
      h('div', { class: 'tabs' }, tabs.map((t) => h('button', {
        class: 'tab' + (t === this.guideTab ? ' on' : ''), onclick: () => { this.guideTab = t; this.renderSheet(); },
      }, (FAMILY_TABS.find(([id]) => id === t) || [null, catTitle(t)])[1]))),
      h('div', { class: 'guide-grid' }, this.guideEntries(this.guideTab).map((e) => {
        const known = this.game.discovered.has(e.key);
        return h('button', { class: 'guide-cell' + (known ? '' : ' unknown') + (e.glimmer ? ' glim' : ''), onclick: () => { if (known) this.open('entry', e); } },
          this.sprites.element(e.sprite, known ? e.variant : sil, 4),
          h('span', {}, known ? e.name : '???'),
          e.rarity ? h('i', { class: 'dot', style: `background:${RARITY_COLORS[e.rarity]}` }) : e.glimmer ? h('i', { class: 'glimmer' }, '✦') : null);
      })),
    ]];
  }

  entryBody(e) {
    return [
      h('div', { class: 'hero' }, this.sprites.element(e.sprite, e.variant, 9)),
      e.rarity ? h('p', { class: 'rarity', style: `color:${RARITY_COLORS[e.rarity]}` }, rarityName(e.rarity).toUpperCase()) : null,
      e.howFound ? h('p', { class: 'sub center' }, e.howFound) : null,
      e.text ? h('p', { class: 'sub center' }, e.text) : null,
      e.special ? h('p', { class: 'center' }, '✨ ' + e.special) : null,
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
      b(this.statOverlay ? 'Hide stat overlay' : 'Show stat overlay', () => { this.statOverlay = !this.statOverlay; a.changed(false); this.renderSheet(); }),
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
      h('div', { class: 'section' }, 'Danger'),
      b('Reset forest', () => { if (confirm('Start a brand-new forest? This erases your progress.')) a.resetForest(); }, 'red'),
    ];
  }

  // -------------------------------------------------------------- reveals

  showReveal(creature, isNew, source) {
    const art = this.app.art(creature);
    const ov = document.getElementById('overlay');
    const done = () => { ov.classList.remove('show'); ov.replaceChildren(); };
    ov.replaceChildren(h('div', { class: 'reveal-card pop' },
      h('h2', { class: creature.isGlimmer ? 'glimmer' : '' }, creature.isGlimmer ? `✦ A glimmer ${this.app.displayName(creature)}! ✦` : `You found a ${this.app.displayName(creature)}!`),
      h('p', { class: 'sub' }, `It came from ${source}.`),
      h('div', { class: 'rays-wrap' }, h('div', { class: 'rays' + (creature.isGlimmer ? ' gold' : '') }), this.sprites.element(art.sprite, art.variant, 8, 'grow-in')),
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
    const cracks = [
      'M50 30 L45 45 L52 55 L47 70', 'M45 45 L32 50 L25 62', 'M52 55 L65 52 L72 62', 'M50 30 L60 40 L70 38', 'M47 70 L38 80',
    ];
    const rockWrap = h('div', { class: 'rock-wrap' });
    const hint = h('p', { class: 'hint-big' }, 'Tap the rock to crack it open');
    const stage = h('div', { class: 'crack-stage' }, rockWrap);
    const footer = h('div', { class: 'crack-footer' });

    const drawRock = () => {
      const svg = `<svg viewBox="0 0 100 100" class="cracks">${cracks.slice(0, hits).map((d) => `<path d="${d}"/>`).join('')}</svg>`;
      rockWrap.replaceChildren(this.sprites.element(def.sprite, null, 12));
      rockWrap.insertAdjacentHTML('beforeend', svg);
    };
    drawRock();

    const chips = () => {
      for (let i = 0; i < 4; i++) {
        const c = h('i', { class: 'chip' });
        c.style.setProperty('--dx', `${Math.random() * 280 - 140}px`);
        c.style.setProperty('--dy', `${Math.random() * 180 - 140}px`);
        stage.append(c);
        setTimeout(() => c.remove(), 500);
      }
    };

    const burst = () => {
      const results = app.crack(itemID);
      const flash = h('div', { class: 'flash' });
      ov.append(flash);
      setTimeout(() => flash.remove(), 700);
      if (navigator.vibrate) navigator.vibrate([20, 40, 60]);
      const left = this.sprites.element(def.sprite, null, 12, 'half left');
      const right = this.sprites.element(def.sprite, null, 12, 'half right');
      const r = results[0];
      let revealEl, text;
      if (!r) {
        revealEl = h('span');
        text = h('p', { class: 'hint-big' }, 'Just dust this time.');
      } else if (r.creature) {
        const art = app.art(r.creature);
        revealEl = h('div', { class: 'rays-wrap' }, h('div', { class: 'rays gold' }), this.sprites.element(art.sprite, art.variant, 10, 'grow-in'));
        text = h('div', { class: 'center' },
          h('h2', { class: 'glimmer' }, r.creature.isGlimmer ? `✦ A glimmer ${app.displayName(r.creature)} was inside! ✦` : `A ${app.displayName(r.creature)} was curled up inside!`),
          h('p', { class: 'sub' }, this.traitSummary(r.creature)),
          h('p', { class: 'sub' }, "It's waiting in your Burrow."),
          r.isNew ? h('p', { class: 'new' }, 'New Field Guide entry!') : null);
      } else {
        const gem = this.content.items[r.item];
        const color = RARITY_COLORS[gem?.rarity] || '#fff';
        revealEl = h('div', { class: 'rays-wrap' }, h('div', { class: 'rays', style: `--ray:${color}` }), this.sprites.element(gem?.sprite || '__missing', null, 10, 'grow-in'));
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
    ov.replaceChildren(h('div', { class: 'crack-screen' }, stage, hint, footer));
    ov.onclick = null;
    ov.classList.add('show');
  }
}

export { RARITIES };
