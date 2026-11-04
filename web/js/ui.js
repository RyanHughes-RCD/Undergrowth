// DOM user interface: HUD, sheets (Bag, Store, Old Log, Field Guide, developer tools), cards and toasts.
import { Game, SCHOOLS, PLANT_TIERS, TIER_NAMES, RARITY_NAMES, rarityIndex, decorVariant, schoolName } from './core.js';

const HOUR = 3600 * 1000;

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

export const SCHOOL_COLORS = { spore: '#c8a07a', glow: '#4fe3f0', bloom: '#ff79b8', verdure: '#4fcf4f', shimmer: '#b7a4e0', spirit: '#8a8ae0' };
export const RARITY_COLORS = { common: '#a0a0a0', uncommon: '#5fd35a', rare: '#5a9cff', veryRare: '#c58cff', legendary: '#ffc84a' };
const rarityName = (r) => RARITY_NAMES[r] || r;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SIL = { silhouette: [78, 84, 92] };

export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/** Pixel-art icon from the sprite registry ("ui.icon.<name>"); scale = CSS px per art px. */
let SPRITES = null;
export const ic = (name, scale = 2, cls = '') => SPRITES.element('ui.icon.' + name, null, scale, 'icon ' + cls);

const DEBRIS = { mossrock: 'A mossy rock', fern: 'A fern', bush: 'A scrubby bush', lichen: 'Lichen-crusted stones', roots: 'Old roots' };

export class UI {
  constructor(app) {
    this.app = app;
    this.mode = null;            // { type: 'decor' | 'decorMove' | ..., ... }
    this.selectedTile = null;
    this.sheet = null;           // { type, arg, stack }
    this.guideTab = null;
    this.storeTab = null;
    this.root = document.getElementById('ui');
    SPRITES = app.sprites;
    this.toastTimer = null;
  }

  get game() { return this.app.game; }
  get content() { return this.app.content; }
  get sprites() { return this.app.sprites; }

  /** Story/hint text from Content/story.json with {placeholders} filled in. */
  story(path, vars = {}) {
    let v = this.content.story;
    for (const k of path.split('.')) v = v && v[k];
    return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : '')) : '';
  }

  // -------------------------------------------------------------- HUD

  render(withSheet = true) {
    const g = this.game, now = g.now();
    const d = new Date(now);
    const clock = [ic(g.isNight(now) ? 'moon' : 'sun', 1), ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`];
    const top = h('div', { class: 'hud-top' }, h('div', { class: 'hud-row' },
      h('button', { class: 'name-btn', onclick: () => this.open('rename') },
        h('div', { class: 'forest-name' }, g.forestName),
        h('div', { class: 'hint' }, ...clock, ...this.hudExtras(now))),
      this.weatherButton(now),
      this.content.tuning.debugTools ? h('div', { class: 'dev' },
        h('button', { class: 'speed-btn' + (this.app.speed > 1 ? ' on' : ''), title: 'Time speed', onclick: () => this.app.cycleSpeed() },
          h('b', {}, ic('fast', 1), `${this.app.speed}×`),
          g.state.debugTimeOffset > 0 ? h('span', {}, `+${duration(g.state.debugTimeOffset / 1000)}`) : null),
        h('button', { class: 'round-btn' + (this.app.devMode ? ' dev-on' : ''), title: this.app.devMode ? 'Developer mode' : 'Debug', onclick: () => this.open('debug') },
          ic('bug', 2), this.app.devMode ? h('span', { class: 'dev-tag' }, 'DEV') : null)) : null,
    ));
    const pill = this.blessingPill(now);
    if (pill) top.append(h('div', { class: 'hud-row pills' }, pill));
    const bottom = h('div', { class: 'hud-bottom' });
    if (this.mode) bottom.append(this.modeBanner());
    if (this.selectedTile) bottom.append(this.tileCard(this.selectedTile));
    const invCount = Object.values(g.state.inventory).reduce((a, b) => a + b, 0);
    bottom.append(h('div', { class: 'nav' },
      this.navButton('bag', 'Bag', invCount, () => this.open('bag')),
      this.navButton('store', 'Store', this.storeBadge(now), () => this.open('store')),
      this.navButton('board', 'Notes', g.oldLogReady(now), () => this.open('offerings')),
      this.navButton('guide', 'Guide', 0, () => this.open('guide'))));
    this.root.replaceChildren(top, bottom);
    if (this.sheet && withSheet) this.renderSheet();
  }

  /** Extra bits under the garden name: coins and the beauty meter (a named tier and leaf pips, never a number). */
  hudExtras(now) {
    return [' · ', ic('coin', 1), ` ${this.game.state.coins}`, ' · ', this.beautyMeter(now)];
  }
  /** A small pill under the HUD while the well's blessing is on: which schools, and for how long. Tap for the well. */
  blessingPill(now) {
    const g = this.game, b = g.blessings;
    if (!b.length) return null;
    const schools = [...new Set(b.flatMap((x) => x.schools))], until = Math.max(...b.map((x) => x.until));
    return h('button', { class: 'blessing-pill', title: 'The well has blessed these schools: they grow faster, on any soil.', onclick: () => { if (g.well) { this.wellPick = {}; this.open('well'); } } },
      ic('sparkle', 1), ...schools.flatMap((k, i) => [i ? ' &' : '', h('b', { style: `color:${SCHOOL_COLORS[k]}` }, ' ' + schoolName(k))]), h('span', { class: 'sub' }, ` · ${this.forAbout(until - now).replace(/^for /, '')}`));
  }
  beautyMeter(now) {
    const t = this.game.beautyTier(now), n = this.game.beautyTiers.length - 1;
    const pips = [];
    for (let i = 1; i <= n; i++) pips.push(h('i', { class: 'pip leaf' + (i <= t.index ? ' on' : i === t.index + 1 && t.frac >= 0.5 ? ' part' : '') }));
    return h('span', { class: 'beauty', title: 'How lovely the garden is' }, h('span', { class: 'pips mini' }, pips), ` ${t.name}`);
  }

  /** "about 3 hours", "less than an hour", "by tomorrow" for a time ahead (never exact for players). */
  roughly(ms) {
    const hrs = ms / HOUR;
    if (hrs <= 0) return 'now';
    if (hrs < 1) return 'within the hour';
    if (hrs < 1.5) return 'in about an hour';
    if (hrs < 20) return `in about ${Math.round(hrs)} hours`;
    return hrs < 36 ? 'in about a day' : `in about ${Math.round(hrs / 24)} days`;
  }
  /** "A Marigold", "An Ink Cap". */
  aName(name) { return `${/^[aeiou]/i.test(name) ? 'An' : 'A'} ${name}`; }
  /** Exact timer for the developer plant inspector. */
  timer(ms) { return duration(Math.max(0, ms) / 1000); }
  plantName(p, now = this.game.now()) { if (this.game.isHidden(p, now)) return `${schoolName(p.blind)} seedling`; const v = p.variety && this.game.varietyDef ? this.game.varietyDef(p.variety) : null; return v ? v.name : (this.game.plantDef(p.plantID)?.name || 'Plant'); }
  stageName(stage) { return { seed: 'Just planted', sprout: 'Sprouting', bud: 'In bud', bloom: 'Blooming', ready: 'Ready to harvest' }[stage] || stage; }
  growHoursText(plantID) {
    const c = this.game.plantCfg(plantID);
    return `${c.growHours}h on its own soil`;
  }

  navButton(icon, label, badge, onclick) {
    return h('button', { class: 'nav-btn', onclick }, ic(icon, 2), h('span', {}, label), badge > 0 ? h('span', { class: 'badge' }, badge) : null);
  }

  modeBanner() {
    const m = this.mode;
    const g = this.game, left = (id) => g.state.inventory[id] || 0;
    const text = {
      decor: () => `Tap an open tile to place the ${g.decorDef(m.decorID)?.name || 'decoration'}`,
      decorMove: () => 'Tap an open tile to move it there',
      plant: () => `Tap a lit tile to plant ${this.content.items[m.itemID]?.name || 'seeds'} (${left(m.itemID)} left)`,
      amend: () => `Tap a tile to spread ${this.content.items[m.itemID]?.name || 'it'} (${left(m.itemID)} left)`,
    }[m.type];
    return h('div', { class: 'banner' }, h('span', {}, text ? text() : this.modeText(m)),
      h('button', { class: 'btn small grey', onclick: () => { this.mode = null; this.app.changed(false); } }, m.done ? 'Done' : 'Cancel'));
  }
  /** Banner text for modes added by later systems. */
  modeText() { return 'Tap a tile'; }

  /** The card for a tapped empty tile: its soil and what can be done there. */
  tileCard(tile) {
    return h('div', { class: 'card' },
      h('div', { class: 'row space' }, h('b', {}, this.tileTitle(tile)),
        h('button', { class: 'x', onclick: () => { this.selectedTile = null; this.app.changed(false); } }, ic('close', 1))),
      this.tileBody(tile));
  }
  tileTitle(tile) {
    const g = this.game;
    if (!g.inClearing(tile)) return 'The treeline';
    if (g.isWet(tile)) return g.isPool(tile) ? 'The pool' : 'The stream';
    const deb = g.debrisAt(tile);
    if (deb) return DEBRIS[deb.sprite.split('.')[1]] || 'Debris';
    const p = g.plantAt(tile);
    if (p) return this.plantName(p);
    const soil = g.soilAt(tile);
    return soil ? `${this.levelName(tile)} ${schoolName(soil)} soil` : 'Plain soil';
  }
  /** Fresh, Settled, Rich, Deep (tuning.garden.soil.levels.names). */
  levelName(tile) { const names = ((this.game.gcfg.soil || {}).levels || {}).names || []; return names[this.game.soilLevel(tile) - 1] || ''; }
  /** Notes on how the water treats this tile, and the Dig button where it can be dug. */
  bankNotes(tile) {
    const g = this.game, a = this.app, out = [];
    if (g.isBank(tile)) out.push(h('p', { class: 'sub bank' }, ic('rain', 1), g.soilAt(tile) ? ' On the bank: the water carries this soil, and can carry another in.' : ' On the bank: the water may carry soil here.'));
    const dig = g.canDig(tile);
    if (dig.ok) out.push(h('div', { class: 'row end' }, h('button', { class: 'btn small', disabled: g.state.coins < dig.cost,
      onclick: () => this.ask('Dig a channel here?', `The soil here is lost, and the water takes its place. ${dig.cost} coins.`, 'Dig', () => a.digAt(tile)) }, ic('coin', 1), ` Dig a channel · ${dig.cost}`)));
    return out;
  }
  tileBody(tile) {
    const g = this.game, now = g.now(), a = this.app;
    if (!g.inClearing(tile)) return h('p', { class: 'sub' }, 'Dense shrubs. Room to grow (in the Store) opens more of the clearing.');
    if (g.isWet(tile)) return [h('p', { class: 'sub' }, `${g.isPool(tile) ? 'Clear water welling up from somewhere deep under the clearing. The streams run from here' : 'Water from the pool'}, running ${g.waterLevelOn(Game.dayNumber(now)).name.toLowerCase()} today. Soil spreads along the banks but not across the water, unless it runs high. When the treeline steps back, a stream follows it out to the new edge.`),
      h('div', { class: 'row end' }, h('button', { class: 'btn small', onclick: () => this.forecastCard() }, ic(this.game.weatherOn(Game.dayNumber(now)).icon, 1), ' Forecast'))];
    if (g.debrisAt(tile)) return [h('p', { class: 'sub' }, 'Left over from the wild grotto. Clear it away to free the ground.'),
      ...this.bankNotes(tile),
      h('div', { class: 'row end' }, h('button', { class: 'btn green small', onclick: () => a.clearDebrisAt(tile) }, 'Clear it away'))];
    const p = g.plantAt(tile);
    const soil = g.soilAt(tile);
    if (p) {
      const stage = g.stageOf(p, now), def = g.plantDef(p.plantID), hidden = g.isHidden(p, now);
      const slow = !soil;
      return [
        h('div', { class: 'row gap' }, h('div', { class: 'thumb small' }, this.sprites.element(this.app.view.plantSprite(p, now), this.app.view.plantVariant(p), 2)),
          h('div', { class: 'grow' }, h('b', {}, this.stageName(stage)),
            h('div', { class: 'sub' }, stage === 'ready' ? 'Tap it to harvest.' : hidden ? `It buds ${this.roughly(g.stageAt(p, g.gcfg.stages.bud ?? 0.45) - now)}.` : `Ready ${this.roughly(g.readyAt(p) - now)}.`))),
        hidden ? h('p', { class: 'sub' }, `What will it be? You'll know when it buds.`) : null,
        slow ? h('p', { class: 'sub' }, `Growing slowly on plain soil. ${hidden ? 'It' : def.name} likes ${schoolName(def.school)} soil.`) : null,
        ...(hidden ? [] : this.plantNotes(p, now)),
        ...this.bankNotes(tile),
        this.app.devMode && this.plantInspector ? this.inspectPlant(p, now) : null,
        h('div', { class: 'row end gap' }, stage === 'ready' ? h('button', { class: 'btn green small', onclick: () => a.harvestAt(tile) }, 'Harvest')
          : h('button', { class: 'btn grey small', onclick: () => { this.ask(`Dig up the ${hidden ? 'seedling' : def.name}?`, 'It will be lost.', 'Dig it up', () => a.clearPlant(p.id)); } }, 'Dig up')),
      ];
    }
    const packets = Object.keys(g.state.inventory).filter((id) => this.content.items[id]?.category === 'packet' && g.canPlantPacket(id, tile).ok);
    const amends = Object.keys(g.state.inventory).filter((id) => this.content.items[id]?.category === 'amendment' && (this.content.items[id].amend || null) !== soil);
    const blocked = !g.isFree(tile) && !g.hostsPlant(tile);
    return [
      h('p', { class: 'sub' }, soil ? `${schoolName(soil)} plants grow well here${g.soilLevel(tile) > 1 ? ', and better the longer it holds' : ''}. Other plants won't take.` : 'Anything grows here, but slowly. Plants grow best in their own soil.'),
      ...this.bankNotes(tile),
      blocked ? null : packets.length ? h('div', { class: 'row gap wrap' }, packets.map((id) => h('button', { class: 'btn green small', title: this.content.items[id].name, onclick: () => a.plantAt(id, tile) },
        this.sprites.element(this.content.items[id].sprite, null, 1), ' ', this.content.items[id].name.replace(/ seeds$/, ''))))
        : h('p', { class: 'sub' }, 'No seeds in your Bag that grow in this soil.'),
      blocked || !amends.length ? null : h('div', { class: 'row gap wrap' }, h('span', { class: 'sub' }, 'Change the soil: '), amends.map((id) => h('button', { class: 'btn small', title: this.content.items[id].name, onclick: () => a.amendAt(id, tile) },
        this.sprites.element(this.content.items[id].sprite, null, 1)))),
    ];
  }
  /** Extra lines on a growing plant's card: its companions (named once discovered) and a relic close by. */
  plantNotes(p) {
    const g = this.game, out = [];
    for (const c of g.activeCompanions(p)) {
      const known = g.discovered.has(g.companionKey(p.plantID, c.index));
      const partner = g.plantDef(c.rule.with)?.name || 'its neighbour';
      out.push(h('p', { class: 'sub companion' }, ic('heart', 1), known ? ` ${c.rule.effect === 'speed' ? 'Growing faster' : 'Will give more'} beside the ${partner}.` : ' It seems happy here.'));
    }
    if (g.ornamentFactor(p) > 1) out.push(h('p', { class: 'sub companion' }, ic('sparkle', 1), ' A relic nearby hums to it.'));
    return out;
  }
  /** Developer plant inspector: exact timers and rates. */
  inspectPlant(p, now) {
    const g = this.game;
    const row = (k, v) => h('div', { class: 'inspect-kv' }, h('span', {}, k), h('b', {}, v));
    return h('div', { class: 'dev-note' },
      row('Plant', `${g.plantDef(p.plantID)?.name}${p.blind ? ` (from ${p.from} ${p.blind} seeds)` : ''}`),
      row('Progress', `${(g.progress(p, now) * 100).toFixed(1)}% (${g.stageOf(p, now)}, ${p.cycle})`),
      row('Rate', `×${p.rate.toFixed(3)}`),
      row('Ready in', g.isReady(p, now) ? 'ready' : this.timer(g.readyAt(p) - now)),
      ...['sprout', 'bud', 'bloom'].map((st) => row(`${st} at`, g.stageAt(p, g.gcfg.stages[st]) <= now ? 'passed' : this.timer(g.stageAt(p, g.gcfg.stages[st]) - now))),
      row('Planted', new Date(p.plantedAt).toLocaleString()), row('Harvests', String(p.harvests)));
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
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      const next = (this.toastQueue || []).shift();
      if (next) this.showToast(...next); else el.classList.remove('show');
    }, 2800);
  }

  joinNodes(list, sep) { return list.flatMap((x, i) => (i ? [sep, x] : [x])); }

  // -------------------------------------------------------------- sheets

  open(type, arg) {
    // Opened from a list sheet, a detail sheet gets a Back button that returns to it as it was.
    const prev = this.sheet;
    const fromList = prev && prev.type !== type && ['guide', 'offerings', 'store', 'bag'].includes(prev.type);
    let stack = null;
    if (fromList) stack = { type: prev.type, arg: prev.arg, stack: prev.stack || null, scroll: document.querySelector('#sheet .sheet-body')?.scrollTop || 0 };
    this.sheet = { type, arg, stack };
    this.renderSheet();
  }

  close() {
    if (this.sheet && this.sheet.stack) {
      const back = this.sheet.stack;
      this.sheet = { type: back.type, arg: back.arg, stack: back.stack || null };
      this.renderSheet(back.scroll || 0);
      return;
    }
    this.sheet = null;
    const el = document.getElementById('sheet');
    el.classList.remove('show');
    el.replaceChildren();
    this.app.changed(false);
  }

  /** Sheet builders by type: each returns [title, body]. Later systems add their own. */
  sheetBuilders(arg) {
    return {
      bag: () => ['Bag', this.bagBody()],
      guide: () => this.guideBody(),
      rename: () => ['Rename garden', this.renameBody()],
      debug: () => [this.app.devMode ? 'Developer mode' : 'Debug', this.debugBody()],
      entry: () => [arg.name, this.entryBody(arg)],
      offerings: () => ['Notes', this.oldLogBody()],
      store: () => ['Store', this.storeBody()],
      decor: () => this.decorBody(arg),
      visitor: () => this.visitorBody(arg),
      stump: () => ['The Stump', this.stumpBody()],
      well: () => ['The Wishing Well', this.wellBody()],
    };
  }

  renderSheet(restoreScroll = null) {
    const el = document.getElementById('sheet');
    if (!this.sheet) { el.classList.remove('show'); return; }
    const { type, arg } = this.sheet;
    const build = this.sheetBuilders(arg)[type];
    if (!build) return;
    const [title, body] = build();
    const scrollTop = el.querySelector('.sheet-body')?.scrollTop || 0;
    el.replaceChildren(h('div', { class: 'sheet-panel' },
      h('div', { class: 'sheet-head' },
        this.sheet.stack ? h('button', { class: 'btn small grey', onclick: () => this.close() }, ic('back', 1), 'Back') : h('span'),
        h('b', {}, title),
        h('button', { class: 'btn small', onclick: () => { this.sheet = null; this.close(); } }, 'Done')),
      h('div', { class: 'sheet-body' }, body)));
    el.querySelector('.sheet-body').scrollTop = restoreScroll ?? scrollTop;
    el.classList.add('show');
    el.onclick = (e) => { if (e.target === el) { this.sheet = null; this.close(); } };
  }

  // -------------------------------------------------------------- Bag

  /** Bag sections, in order. */
  bagSections() { return ['packet', 'amendment', 'plant', 'mushroom']; }
  bagSectionTitle(cat) { return { packet: 'Seed packets', amendment: 'Soil', plant: 'Plants and flowers', mushroom: 'Mushrooms' }[cat] || cap(cat); }
  /** Buttons for one Bag row: plant seeds, spread soil, sell produce. */
  bagActions(def, n) {
    const a = this.app, g = this.game;
    if (def.category === 'packet') return [h('button', { class: 'btn green small', onclick: () => a.beginPlanting(def.id) }, 'Plant')];
    if (def.category === 'amendment') return [h('button', { class: 'btn small', onclick: () => a.beginAmend(def.id) }, 'Use')];
    const price = g.sellPrice(def.id);
    return price ? [h('button', { class: 'btn small', title: `Sell one for ${price} coins`, onclick: () => a.sellItem(def.id, 1) }, ic('coin', 1), ` ${price}`)] : [];
  }

  bagBody() {
    const g = this.game;
    const owned = Object.entries(g.state.inventory).filter(([, n]) => n > 0).map(([id, n]) => ({ def: this.content.items[id], n })).filter((e) => e.def);
    const decor = Object.entries(g.state.decor.owned).filter(([, n]) => n > 0).map(([id, n]) => ({ def: g.decorDef(id), n })).filter((e) => e.def);
    const out = [];
    const order = this.bagSections();
    const cats = [...new Set(owned.map((e) => e.def.category))].sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
    for (const cat of cats) {
      out.push(h('div', { class: 'section' }, this.bagSectionTitle(cat)));
      for (const { def, n } of owned.filter((e) => e.def.category === cat).sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity) || a.def.name.localeCompare(b.def.name))) {
        out.push(h('div', { class: 'list-row' },
          h('div', { class: 'thumb' }, this.sprites.element(def.sprite, def.variant || null, 3)),
          h('div', { class: 'grow' }, h('b', {}, def.name), this.bagLine(def)),
          h('b', {}, `×${n}`), ...this.bagActions(def, n)));
      }
    }
    if (decor.length) {
      out.push(h('div', { class: 'section' }, 'Decor'), ...decor.map(({ def, n }) => h('div', { class: 'list-row' },
        h('div', { class: 'thumb' }, this.sprites.element(def.sprite, null, 3)),
        h('div', { class: 'grow' }, h('b', {}, def.name), def.text ? h('div', { class: 'sub' }, def.text) : null),
        h('b', {}, `×${n}`),
        h('button', { class: 'btn green small', onclick: () => this.app.beginDecor(def.id) }, 'Place'))));
    }
    if (!out.length) return [h('p', { class: 'sub' }, 'Your bag is empty.')];
    return out;
  }
  /** The line under an item's name in the Bag. */
  bagLine(def) {
    if (def.category === 'packet' && def.blind) return h('div', { class: 'sub' }, h('span', { style: `color:${SCHOOL_COLORS[def.school]}` }, `${schoolName(def.school)} soil`), ` · ${def.text.replace(/^\w+ seeds\.? ?/, '')}`);
    if (def.category === 'packet') return h('div', { class: 'sub' }, h('span', { style: `color:${SCHOOL_COLORS[def.school]}` }, `${schoolName(def.school)} soil`), ` · ${this.growHoursText(def.plant)}`);
    if (def.category === 'amendment') return h('div', { class: 'sub' }, def.text);
    return def.rarity ? h('div', { class: 'sub', style: `color:${RARITY_COLORS[def.rarity]}` }, rarityName(def.rarity)) : null;
  }

  // -------------------------------------------------------------- the Old Log and the Store

  /** An item in a request: its art (a silhouette until it's in the Field Guide), name, and have/need. */
  offerItemRow(x) {
    const def = this.content.items[x.item];
    const known = this.game.discovered.has('item:' + x.item);
    return h('div', { class: 'offer-item' + (x.owned >= x.count ? ' met' : '') },
      h('div', { class: 'thumb small' }, def ? this.sprites.element(def.sprite, known ? null : { silhouette: [40, 52, 36] }, 2) : ''),
      h('div', { class: 'grow' }, h('b', {}, known && def ? def.name : '???'), def && def.school ? h('div', { class: 'sub' }, `${schoolName(def.school)} soil`) : null),
      h('b', { class: 'count' }, `${Math.min(x.owned, x.count)}/${x.count}`));
  }

  rewardText(r) {
    const g = this.game;
    if (r.type === 'coins') return [ic('coin', 1), ` ${r.count} coins`];
    if (r.type === 'cosmetic') return [this.sprites.element(g.decorDef(r.id)?.sprite || 'ui.icon.board', null, 2), ` ${g.decorDef(r.id)?.name || r.id}`];
    if (r.type === 'item') { const d = this.content.items[r.id]; return d ? [this.sprites.element(d.sprite, null, 2), ` ${d.name}${(r.count || 1) > 1 ? ' ×' + r.count : ''}`] : r.id; }
    if (r.type === 'unlock' && r.id === 'expansion') return 'The treeline steps back';
    return r.id || r.type;
  }

  lockText(locks) {
    return locks.map((l) => (l.type === 'guide' ? `${l.need} Field Guide entries (${l.have} so far)` : l.type === 'request' ? `“${l.name}” first`
      : l.type === 'full' ? 'nothing: the whole forest is open' : l.type === 'day' ? `garden day ${l.need}`
        : l.type === 'beauty' ? `a ${l.name.toLowerCase()} garden` : (l.text || ''))).join(', ');
  }

  offerCard(st, label = 'Deliver') {
    const r = st.req;
    return h('div', { class: 'card offer' + (st.locks.length ? ' locked' : '') + (st.ready ? ' ready' : '') },
      h('div', { class: 'row space' }, h('b', {}, r.name), h('span', { class: 'sub reward' }, this.rewardText(r.reward))),
      r.text ? h('p', { class: 'sub' }, r.text) : null,
      st.locks.length ? h('p', { class: 'sub lock' }, ic('lock', 1), ` Opens with ${this.lockText(st.locks)}.`) : this.priceRows(st),
      st.locks.length ? null : h('div', { class: 'row end' },
        h('button', { class: 'btn ' + (st.ready ? 'green' : 'grey'), disabled: !st.ready, onclick: () => this.app.deliverRequest(r.id) }, label)));
  }
  priceRows(st) {
    return [st.coins ? h('div', { class: 'offer-item' + (this.game.state.coins >= st.coins ? ' met' : '') }, h('div', { class: 'thumb small' }, ic('coin', 2)),
      h('div', { class: 'grow' }, h('b', {}, `${st.coins} coins`)), h('b', { class: 'count' }, `${Math.min(this.game.state.coins, st.coins)}/${st.coins}`)) : null,
    ...st.items.map((x) => this.offerItemRow(x))];
  }

  /** A Room to grow tier: its price, and one button per side that can still be cleared. */
  growCard(st) {
    const g = this.game, open = g.openSides(), r = st.req;
    const label = { top: ['up', 'Top'], left: ['back', 'Left'], right: ['chevron', 'Right'], bottom: ['down', 'Bottom'] };
    const side = (d) => h('button', { class: 'btn small ' + (st.ready && open.includes(d) ? 'green' : 'grey'), disabled: !st.ready || !open.includes(d),
      title: open.includes(d) ? `Clear the ${d} trees` : 'The forest ends on that side', onclick: () => this.app.expandToward(r.id, d) }, label[d][1]);
    return h('div', { class: 'card offer' + (st.locks.length ? ' locked' : '') + (st.ready ? ' ready' : '') },
      h('div', { class: 'row space' }, h('b', {}, r.name)),
      r.text ? h('p', { class: 'sub' }, r.text) : null,
      st.locks.length ? h('p', { class: 'sub lock' }, ic('lock', 1), ` Opens with ${this.lockText(st.locks)}.`) : this.priceRows(st),
      st.locks.length ? null : h('div', { class: 'grow-pad' },
        h('span'), side('top'), h('span'),
        side('left'), h('span', { class: 'grow-mid' }, ic('leaf', 2)), side('right'),
        h('span'), side('bottom'), h('span')));
  }

  /** The Old Log's badge: commissions you could deliver now (later). */
  storeBadge() { return 0; }

  /** One row in the Store: art, name, a line, and a Buy button with its price. */
  buyRow(sprite, name, line, price, onBuy, locks = [], variant = null) {
    const can = !locks.length && this.game.state.coins >= price;
    return h('div', { class: 'list-row' + (locks.length ? ' locked' : '') },
      h('div', { class: 'thumb' }, this.sprites.element(sprite, locks.length ? SIL : variant, 3)),
      h('div', { class: 'grow' }, h('b', {}, locks.length ? '???' : name), locks.length ? h('div', { class: 'sub lock' }, ic('lock', 1), ` Opens with ${this.lockText(locks)}.`) : line),
      locks.length ? null : h('button', { class: 'btn small ' + (can ? 'green' : 'grey'), disabled: !can, onclick: onBuy }, ic('coin', 1), ` ${price}`));
  }

  /** The Old Log: notes and requests from neighbours, and the way into the Store. */
  oldLogBody() {
    return [
      h('p', { class: 'sub center' }, this.story('messages.offeringsIntro')),
      h('div', { class: 'row space' },
        h('button', { class: 'btn small green', onclick: () => this.open('store') }, ic('store', 1), ' Open the Store')),
      ...this.oldLogSections(),
    ];
  }
  /** Today's orders and the commissions: requests for things you grow, paying coins (and opening Store items). */
  oldLogSections() {
    const g = this.game, b = g.oldLogBoard(g.now());
    const open = b.commissions.filter((st) => !st.done && !st.locks.length);
    const locked = b.commissions.filter((st) => !st.done && st.locks.length);
    const done = b.commissions.filter((st) => st.done);
    return [
      h('div', { class: 'section' }, "Today's orders"),
      b.orders.length ? b.orders.map((st) => this.offerCard(st, st.done ? 'Done' : 'Send')) : h('p', { class: 'sub' }, 'No orders yet. Neighbours order things you have grown before; new orders come each day.'),
      h('div', { class: 'section' }, 'Commissions'),
      open.length ? open.map((st) => this.offerCard(st, 'Deliver')) : h('p', { class: 'sub' }, 'No open commissions right now.'),
      locked.length ? [h('div', { class: 'section' }, 'Coming later'), ...locked.map((st) => this.offerCard(st))] : null,
      done.length ? [h('div', { class: 'section' }, `Done (${done.length})`), h('p', { class: 'sub' }, done.map((st) => st.req.name).join(' · '))] : null,
    ];
  }

  /** Store tabs: [id, label, body()]. */
  storeTabs() {
    const g = this.game, now = g.now(), a = this.app;
    const board = g.requestBoard(now, ['shop', 'upgrade']);
    const decor = board.filter((st) => st.req.reward.type === 'cosmetic');
    const grow = board.filter((st) => st.req.reward.type === 'unlock' && st.req.reward.id === 'expansion');
    const sellable = Object.entries(g.state.inventory).filter(([id, n]) => n > 0 && g.sellPrice(id)).map(([id, n]) => ({ def: this.content.items[id], n, price: g.sellPrice(id) }));
    return [
      ['seeds', 'Seeds', () => {
        // Every packet is its own item: grouped by tier, one row per school, each with its own packet.
        const rows = g.storePackets().filter((x) => !this.seedSchool || x.school === this.seedSchool);
        const chip = (id, label, color) => h('button', { class: 'tab' + ((this.seedSchool || null) === id ? ' on' : ''), style: color ? `color:${color}` : '', onclick: () => { this.seedSchool = id; this.renderSheet(); } }, label);
        return [h('p', { class: 'sub' }, "Every packet is a surprise: you won't know what it is until it buds. Better seeds have better odds of something rare, but nothing is ever certain."),
          h('div', { class: 'tabs seed-schools' }, chip(null, 'All'), ...SCHOOLS.map((k) => chip(k, schoolName(k), SCHOOL_COLORS[k]))),
          ...PLANT_TIERS.flatMap((tier) => {
            const list = rows.filter((x) => x.tier === tier);
            if (!list.length) return [];
            return [h('div', { class: 'section' }, `${TIER_NAMES[tier]} seeds`),
              ...list.map((x) => { const it = this.content.items[x.id];
                return this.buyRow(it.sprite, h('span', { style: `color:${SCHOOL_COLORS[x.school]}` }, it.name), h('div', { class: 'sub' }, it.text), x.price, () => a.buyPacket(x.id), x.locks); })];
          })];
      }],
      ['soil', 'Soil', () => [h('p', { class: 'sub' }, "Soil that changes a tile for good is hard to come by: the Store has a little each day. Room to grow sometimes uncovers some too."),
        ...g.soilStock(now).map((x) => { const am = this.content.items[x.id];
          return x.soldOut ? h('div', { class: 'list-row locked' }, h('div', { class: 'thumb' }, this.sprites.element(am.sprite, null, 3)), h('div', { class: 'grow' }, h('b', {}, am.name), h('div', { class: 'sub' }, 'Sold out until tomorrow.')))
            : this.buyRow(am.sprite, am.name, h('div', { class: 'sub' }, am.text), x.price, () => a.buyAmendment(x.id)); }),
        h('p', { class: 'sub' }, 'New soil comes in every morning.')]],
      ['decor', 'Decor', () => [h('p', { class: 'sub' }, 'Things to set out in your garden. Find them in your Bag under Decor.'),
        ...decor.map((st) => { const d = g.decorDef(st.req.reward.id) || {}; return this.buyRow(d.sprite || 'ui.icon.board', d.name || st.req.name, h('div', { class: 'sub' }, d.text || st.req.text || ''), st.coins, () => a.deliverRequest(st.req.id), st.locks); })]],
      ['sell', 'Sell', () => [h('p', { class: 'sub' }, 'The Store buys what you grow and find.'),
        sellable.length ? h('div', { class: 'row end' }, h('button', { class: 'btn green small', onclick: () => a.sellAll() }, `Sell everything (${sellable.reduce((t, x) => t + x.n * x.price, 0)} coins)`)) : h('p', { class: 'sub' }, 'Nothing to sell yet. Harvest your plants, then come back.'),
        ...sellable.map(({ def, n, price }) => h('div', { class: 'list-row' },
          h('div', { class: 'thumb' }, this.sprites.element(def.sprite, def.variant || null, 3)),
          h('div', { class: 'grow' }, h('b', {}, def.name), h('div', { class: 'sub' }, [ic('coin', 1), ` ${price} each`])),
          h('b', {}, `×${n}`),
          h('button', { class: 'btn small', onclick: () => a.sellItem(def.id, 1) }, 'Sell 1'),
          n > 1 ? h('button', { class: 'btn small', onclick: () => a.sellItem(def.id, n) }, `All ${n}`) : null))]],
      ['grow', 'Room to grow', () => {
        const next = grow.find((st) => !st.done);
        return [h('p', { class: 'sub' }, `Choose a side: its trees step back ${(this.content.tuning.expansion || {}).sideTiles || 3} rows, and the new ground has something wild on it.`),
          next ? this.growCard(next) : h('p', { class: 'sub' }, 'You have cleared all the room there is.')];
      }],
    ];
  }

  storeBody() {
    const tabs = this.storeTabs();
    if (!tabs.some(([id]) => id === this.storeTab)) this.storeTab = tabs[0][0];
    const [, , body] = tabs.find(([id]) => id === this.storeTab);
    return [
      h('div', { class: 'tabs store-tabs' }, tabs.map(([id, label]) => h('button', {
        class: 'tab' + (id === this.storeTab ? ' on' : ''), onclick: () => { this.storeTab = id; this.renderSheet(); } }, label))),
      ...this.storeHeader(), ...body(),
    ];
  }
  storeHeader() { return [h('div', { class: 'row space coins-row' }, h('b', {}, ic('coin', 2), ` ${this.game.state.coins} coins`))]; }

  /** A placed decoration: move it, recolour it, or put it back in the Bag. */
  decorBody(placedID) {
    const g = this.game, a = this.app;
    const d = g.state.decor.placed.find((x) => x.id === placedID);
    if (!d) return ['Decoration', h('p', { class: 'sub' }, 'Gone.')];
    const def = g.decorDef(d.decorID) || { name: d.decorID, sprite: 'ui.icon.board' };
    const cols = def.colors || [];
    return [def.name, [
      h('div', { class: 'hero' }, this.sprites.element(def.sprite, decorVariant(def, d.color), 6)),
      def.text ? h('p', { class: 'sub center' }, def.text) : null,
      ...this.decorExtra(def, d),
      cols.length > 1 ? h('p', { class: 'sub center' }, `Colour: ${cols[d.color || 0].name}`) : null,
      h('div', { class: 'row gap wrap center' },
        h('button', { class: 'btn green', onclick: () => a.beginDecorMove(d.id) }, 'Move'),
        cols.length > 1 ? h('button', { class: 'btn', onclick: () => a.recolorDecor(d.id) }, 'Recolour') : null,
        h('button', { class: 'btn grey', onclick: () => a.removeDecor(d.id) }, 'Put away')),
    ]];
  }
  /** What a decor piece does, in words, and (for a raised bed) its planting buttons. */
  decorExtra(def, d) {
    const g = this.game, k = g.decorKind(def), out = [];
    const does = def.kind === 'ornament' ? `${schoolName(def.school)} plants growing around it grow faster.`
      : k.holdsPlant ? 'Plant something in it: it gives a little more at harvest.'
        : k.glow ? 'It glows softly at dusk and through the night.' : k.ground ? 'A path to walk between the beds.' : null;
    if (does) out.push(h('p', { class: 'sub center' }, does));
    if (k.holdsPlant && !g.plantAt(d.tile)) out.push(this.tileBody(d.tile));
    return out;
  }

  // -------------------------------------------------------------- Field Guide

  /** Field Guide tabs: [id, label, entries()]. Later systems add theirs. */
  guideTabs() {
    const items = (cat) => this.content.itemList.filter((i) => i.inGuide !== false && i.category === cat)
      .map((i, idx) => ({ i, idx })).sort((a, b) => rarityIndex(a.i.rarity) - rarityIndex(b.i.rarity) || a.idx - b.idx)
      .map(({ i }) => ({ key: 'item:' + i.id, name: i.name, sprite: i.sprite, variant: i.variant || null, rarity: i.rarity, text: i.guideText, school: i.school }));
    const g = this.game;
    const garden = () => this.content.plantList.map((p) => {
      const item = this.content.items[p.item], c = g.plantCfg(p.id);
      const from = p.source === 'gift' ? 'Only a friend of the forest can bring its seeds.' : `It comes up from ${schoolName(p.school)} seeds${{ common: '', uncommon: ', now and then', rare: ', rarely', epic: ', very rarely, and more often from the finest packets', legendary: ', almost never, and only from the finest packets' }[p.tier || 'common']}.`;
      return { key: 'plant:' + p.id, name: p.name, sprite: item.sprite, school: p.school, text: item.guideText, rarity: p.tier,
        hint: `${schoolName(p.school)} soil. ${from}`,
        extra: [h('p', { class: 'sub center' }, `${p.kind === 'fungus' ? 'A fungus' : p.kind === 'leafy' ? 'A leafy plant' : 'A flower'}. ${this.growHoursText(p.id)}. Sells for ${c.sell} coins. ${from}`),
          ...this.plantGuideExtra(p)] };
    });
    return [
      ['garden', 'Garden', garden],
      ['varieties', 'Colours', () => Object.values(this.content.varieties).map((v) => {
        const it = this.content.items[v.produce];
        return { key: 'item:' + v.produce, name: v.name, sprite: it.sprite, variant: v.variant, school: it.school, text: it.guideText,
          hint: `A rare colour of ${g.plantDef(v.plantID)?.name}. Some say it comes from good neighbours.` };
      })],
      ['mushroom', 'Mushrooms', () => items('mushroom')],
      ['plant', 'Plants', () => items('plant')],
      ['visitors', 'Visitors', () => (this.content.visitorList || []).map((v) => ({ key: 'visitor:' + v.id.replace(/^visitor\./, ''), name: v.name, sprite: v.sprite, visitor: v, hint: g.guest(v.id).series > 0 ? 'mementos' : null }))],
    ];
  }

  guideBody() {
    const tabs = this.guideTabs();
    if (!tabs.some(([id]) => id === this.guideTab)) this.guideTab = tabs[0][0];
    const all = tabs.flatMap(([, , entries]) => entries());
    const found = all.filter((e) => this.game.discovered.has(e.key)).length;
    const entries = tabs.find(([id]) => id === this.guideTab)[2]();
    return [`Field Guide · ${found}/${all.length}`, [
      h('div', { class: 'tabs' }, tabs.map(([id, label]) => h('button', { class: 'tab' + (id === this.guideTab ? ' on' : ''), onclick: () => { this.guideTab = id; this.renderSheet(); } }, label))),
      ...this.guideHeader(this.guideTab, entries),
      h('div', { class: 'guide-grid' }, entries.map((e) => {
        const known = this.game.discovered.has(e.key);
        return h('button', {
          class: 'guide-cell' + (known ? '' : ' unknown') + (e.hint && !known ? ' teaser' : ''),
          onclick: () => { if (e.visitor) this.open('visitor', e.visitor.id); else if (known) this.open('entry', e); else if (e.hint) this.open('entry', { name: '???', sprite: e.sprite, variant: SIL, text: e.hint }); },
        }, this.sprites.element(e.sprite, known ? e.variant : SIL, 4),
          h('span', {}, known ? e.name : '???', !known && e.hint ? ic('sparkle', 1) : null),
          e.rarity ? h('i', { class: 'dot', style: `background:${RARITY_COLORS[e.rarity]}` }) : null);
      })),
    ]];
  }
  /** The Garden tab opens with each school's collection: plants grown of its set, and its reward. */
  guideHeader(tab) {
    if (tab !== 'garden') return [];
    const g = this.game;
    return [h('div', { class: 'collections' }, SCHOOLS.map((school) => {
      const st = g.collectionStatus(school);
      const relic = this.content.relicList.find((r) => r.school === school);
      return h('div', { class: 'collection' + (st.claimed ? ' done' : '') },
        relic ? this.sprites.element(relic.sprite, st.claimed ? null : SIL, 2) : null,
        h('span', { style: `color:${SCHOOL_COLORS[school]}` }, schoolName(school)),
        h('span', { class: 'progress' }, h('span', { style: `width:${Math.round(st.have / Math.max(1, st.total) * 100)}%` })),
        h('b', {}, `${st.have}/${st.total}`));
    })), h('p', { class: 'sub' }, "Grow and harvest every plant of a school to complete its set. Something old is waiting for whoever does.")];
  }
  /** More on a garden plant's Field Guide page: its companions (unknown ones stay hidden until found). */
  plantGuideExtra(p) {
    const g = this.game;
    const rules = (p.companions || []).map((rule, i) => {
      const known = g.discovered.has(g.companionKey(p.id, i));
      const partner = g.plantDef(rule.with);
      return h('li', {}, known ? `Beside the ${partner ? partner.name : rule.with}: ${rule.effect === 'speed' ? 'grows faster' : 'gives more'}.` : 'A neighbour it likes: not found yet.');
    });
    return rules.length ? [h('div', { class: 'section' }, 'Good neighbours'), h('ul', { class: 'clues' }, rules)] : [];
  }

  entryBody(e) {
    return [
      h('div', { class: 'hero' }, this.sprites.element(e.sprite, e.variant, 9)),
      e.rarity ? h('p', { class: 'rarity', style: `color:${RARITY_COLORS[e.rarity]}` }, rarityName(e.rarity).toUpperCase()) : null,
      e.school ? h('p', { class: 'sub center', style: `color:${SCHOOL_COLORS[e.school]}` }, `${schoolName(e.school)}`) : null,
      e.text ? h('p', { class: 'sub center' }, e.text) : null,
      ...(e.extra || []),
    ];
  }

  /**
   * A visitor's page: a silhouette until it has lived here, then its art, name and story. Every memento it
   * has left, in order, and the plainer hints and partings since. Its conditions are never listed.
   */
  visitorBody(id) {
    const def = (this.content.visitorList || []).find((v) => v.id === id);
    if (!def) return ['Visitor', h('p', { class: 'sub' }, 'Unknown.')];
    const g = this.game, st = g.guest(id), stage = g.guestStage(id);
    const known = g.discovered.has('visitor:' + id.replace(/^visitor\./, ''));
    const status = { resident: this.story('visitors.resident'), gone: this.story('visitors.gone'), visiting: this.story('visitors.visiting') }[stage];
    const label = { memento: null, restate: 'It came again', parting: 'When it left' };
    return [known ? def.name : '???', [
      h('div', { class: 'hero' }, this.sprites.element(def.sprite, known ? null : SIL, 6, '', true)),
      h('p', { class: 'center' }, h('b', {}, known ? def.name : this.story('visitors.unknownName'))),
      known && def.text ? h('p', { class: 'sub center' }, def.text) : null,
      status ? h('p', { class: 'sub center' }, status) : null,
      h('div', { class: 'section' }, 'Mementos'),
      st.notes.length ? h('ul', { class: 'clues' }, st.notes.map((n) => h('li', { class: 'memento-' + n.kind }, label[n.kind] ? h('b', {}, label[n.kind] + ': ') : null, n.text)))
        : h('p', { class: 'sub' }, this.story('visitors.noMementos')),
    ]];
  }

  /** One line of visitor news (a memento, a plainer hint, an arrival, a departure, the Stump's answer). */
  newsLine(n) {
    const g = this.game, def = n.visitor && g.guestDef(n.visitor);
    const known = def && g.discovered.has('visitor:' + def.id.replace(/^visitor\./, ''));
    const name = def ? def.name : '';
    if (n.type === 'stump') {
      const it = this.content.items[n.item];
      return h('div', { class: 'news' }, it ? this.sprites.element(it.sprite, it.variant || null, 2) : null, h('p', { class: 'sub' }, (this.content.story?.visitors?.stump || {})[n.reaction] || ''));
    }
    if (n.type === 'movedIn') {
      const gifts = (n.results || []).map((x) => { const d = this.content.items[x.item]; return d ? ` ${x.count} × ${d.name}` : ''; }).join(',');
      return h('div', { class: 'news arrival' }, this.sprites.element(def.sprite, null, 2, '', true),
        h('p', {}, h('b', {}, this.story('visitors.movedIn', { name })), ' ', h('span', { class: 'sub' }, this.story('visitors.movedInText') + (gifts ? ` It brought you${gifts}.` : ''))));
    }
    const head = n.type === 'parting' ? this.story('visitors.parting', { name })
      : this.story(`visitors.${n.type === 'restate' ? 'restate' : 'memento'}${known ? 'Known' : ''}`, { name });
    return h('div', { class: 'news' }, def ? this.sprites.element(def.sprite, known ? null : SIL, 2, '', true) : null,
      h('p', { class: 'sub' }, head, ' ', h('i', {}, n.text)));
  }
  /** Visitor news on its own card (when there's no morning card to carry it). */
  visitorNewsCard(news) {
    const arrival = news.find((n) => n.type === 'movedIn');
    const title = arrival ? this.story('visitors.movedIn', { name: this.game.guestDef(arrival.visitor)?.name || '' }) : news.some((n) => n.type === 'parting') ? 'Someone has gone' : 'Something was here';
    const art = arrival ? this.sprites.element(this.game.guestDef(arrival.visitor)?.sprite, null, 6, 'grow-in', true) : null;
    this.celebrate(title, h('div', { class: 'morning' }, news.map((n) => this.newsLine(n))), art, 'OK');
  }

  /** Blessing lines: which schools grow faster (and anywhere), and for how long. */
  blessingLines(now) {
    return this.game.blessings.map((b) => h('p', { class: 'sub blessing' },
      this.story('well.blessed', { schools: b.schools.map(schoolName).join(' and '), left: this.forAbout(b.until - now) })));
  }
  /** "for about 3 hours", "for less than an hour". */
  forAbout(ms) { const hrs = ms / HOUR; return hrs < 1 ? 'for less than an hour' : `for about ${Math.round(hrs)} hour${Math.round(hrs) === 1 ? '' : 's'}`; }
  /**
   * The wishing well: what it's drawn to now, a handful to choose (steppers), how lucky that handful feels
   * (in words, never numbers), and any blessing in force.
   */
  wellBody() {
    const g = this.game, now = g.now(), a = this.app, f = g.wellFocus(now);
    const pick = this.wellPick = this.wellPick || {};
    for (const id of Object.keys(pick)) if (!(pick[id] > 0) || !(g.state.inventory[id] > 0)) delete pick[id]; else pick[id] = Math.min(pick[id], g.state.inventory[id]);
    const items = g.wellItems().sort((x, y) => (g.wellDesire(y.id, now) - g.wellDesire(x.id, now)) || (g.sellPrice(y.id) - g.sellPrice(x.id)) || (x.id < y.id ? -1 : 1));
    const worth = g.wishWorth(pick, now), words = (this.content.story?.well || {}).luck || [];
    const focusColor = SCHOOL_COLORS[f.id] || '#e6dcc0';
    const set = (id, n) => { pick[id] = Math.max(0, Math.min(n, g.state.inventory[id] || 0)); this.renderSheet(); };
    const out = [h('div', { class: 'hero' }, this.sprites.element('landmark.well', null, 3)),
      h('p', { class: 'sub center' }, (g.landmarkDef('landmark.well') || {}).purpose || ''),
      h('p', { class: 'center' }, 'Right now the well is drawn to ', h('b', { style: `color:${focusColor}` }, { flora: 'all flora (plants and flowers)', fungi: 'all fungi (mushrooms)' }[f.id] || `${schoolName(f.id)} things`), '.'),
      h('p', { class: 'sub center' }, this.story('well.focusChange', { when: this.roughly(f.until - now) })),
      ...this.blessingLines(now)];
    if (!items.length) { out.push(h('p', { class: 'sub' }, this.story('well.nothing'))); return out; }
    out.push(h('p', { class: 'sub' }, this.story('well.pickIntro')));
    for (const x of items) {
      const it = this.content.items[x.id], n = pick[x.id] || 0, wanted = g.wellDesire(x.id, now) > 1;
      out.push(h('div', { class: 'list-row' + (wanted ? ' wanted' : '') },
        h('div', { class: 'thumb' }, this.sprites.element(it.sprite, it.variant || null, 2)),
        h('div', { class: 'grow' }, h('b', {}, it.name), h('div', { class: 'sub' }, wanted ? `The well wants this · ${x.n} in your Bag` : `${x.n} in your Bag`)),
        h('div', { class: 'qty' },
          h('button', { class: 'btn small grey', disabled: !n, onclick: () => set(x.id, n - 1) }, '−'),
          h('span', { class: 'qty-n' + (n ? ' on' : '') }, String(n)),
          h('button', { class: 'btn small', disabled: n >= x.n, onclick: () => set(x.id, n + 1) }, '+'),
          x.n > 1 ? h('button', { class: 'btn small grey', disabled: n >= x.n, onclick: () => set(x.id, x.n) }, 'All') : null)));
    }
    const word = worth.count ? words[Math.min(words.length - 1, Math.floor(worth.luck))] || '' : '';
    out.push(h('div', { class: 'wish-bar' },
      h('div', { class: 'grow' }, worth.count ? [h('b', {}, word), h('div', { class: 'sub' }, `${worth.count} thing${worth.count === 1 ? '' : 's'} to drop in`),
        h('span', { class: 'progress' }, h('span', { style: `width:${Math.round(worth.luck / ((this.content.tuning.well || {}).maxLuck || 5) * 100)}%` }))] : h('span', { class: 'sub' }, 'Nothing chosen yet.')),
      h('button', { class: 'btn green', disabled: !worth.count, onclick: () => { const p = { ...pick }; this.wellPick = {}; a.wish(p); } }, 'Drop them in')));
    return out;
  }
  /** What the well gave back. */
  wishCard(r) {
    const g = this.game;
    if (r.type === 'coins') this.celebrate('A wish', h('p', { class: 'sub' }, `${this.story('well.coins')} +${r.coins} coins.`), h('span', { class: 'row' }, ic('coin', 4)));
    else if (r.type === 'blessing') this.celebrate('A blessing', h('div', {}, h('p', { class: 'sub' }, this.story('well.blessing', { schools: r.schools.map(schoolName).join(' and ') })),
      h('p', { class: 'sub' }, `It lasts ${this.forAbout(r.until - g.now()).replace(/^for /, '')}.`)), h('span', { class: 'row' }, ...r.schools.map(() => ic('sparkle', 4))));
    else {
      const it = this.content.items[r.item];
      this.celebrate('A wish', h('div', {}, h('p', { class: 'sub' }, this.story('well.packet')), h('p', {}, h('b', {}, it ? it.name : r.item))), it ? this.sprites.element(it.sprite, null, 5, 'grow-in') : null);
    }
  }

  /** The Stump: what's on it, or what could go on it. */
  stumpBody() {
    const g = this.game, now = g.now(), tr = g.tributeState(now), a = this.app;
    const def = g.landmarkDef('landmark.stump') || {};
    const out = [h('div', { class: 'hero' }, this.sprites.element('landmark.stump', null, 4)), h('p', { class: 'sub center' }, def.purpose || '')];
    if (tr) {
      const it = this.content.items[tr.item];
      out.push(h('div', { class: 'reward-item' }, it ? this.sprites.element(it.sprite, it.variant || null, 2) : null, ` ${it ? it.name : tr.item}`),
        h('p', { class: 'sub' }, this.story(tr.phase === 'waiting' ? 'visitors.stumpWaiting' : 'visitors.stumpTaken')),
        tr.phase === 'waiting' ? h('button', { class: 'btn grey small', onclick: () => a.takeBackOffering() }, 'Take it back') : null);
      return out;
    }
    const last = g.state.lastTribute;
    if (last) out.push(h('p', { class: 'sub' }, h('b', {}, 'Last time: '), (this.content.story?.visitors?.stump || {})[last.reaction] || ''));
    const list = g.offerable().sort((x, y) => y.rank - x.rank || (this.content.items[x.id].name < this.content.items[y.id].name ? -1 : 1));
    out.push(h('p', { class: 'sub' }, this.story('visitors.stumpEmpty')));
    if (!list.length) out.push(h('p', { class: 'sub' }, 'You have nothing gathered to leave. Harvest something first.'));
    for (const x of list) {
      const it = this.content.items[x.id];
      out.push(h('div', { class: 'row item-row' }, this.sprites.element(it.sprite, it.variant || null, 2),
        h('span', { class: 'grow' }, `${it.name} `, h('span', { class: 'sub' }, `×${x.n}`)),
        h('button', { class: 'btn green small', onclick: () => a.offer(x.id) }, 'Leave it')));
    }
    return out;
  }

  collectionCard(e) {
    const relic = this.content.relicList.find((r) => r.id === e.relic);
    this.celebrate(`The ${schoolName(e.school)} set is complete`, h('div', {},
      relic ? h('p', { class: 'inscription' }, relic.inscription) : null,
      h('p', { class: 'sub' }, `${relic ? `The ${relic.name} is in your Bag, under Decor. Set it among ${schoolName(e.school)} plants and they grow faster. ` : ''}And ${e.coins} coins.`)),
      relic ? this.sprites.element(relic.sprite, null, 5, 'grow-in') : null);
  }

  // -------------------------------------------------------------- rename, debug, developer mode

  renameBody() {
    const g = this.game;
    const input = h('input', { type: 'text', value: g.state.customName || '', placeholder: g.generatedName, maxlength: 40 });
    return [
      h('label', { class: 'field' }, 'Garden name', input),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn green', onclick: () => { this.app.renameForest(input.value); this.sheet = null; this.close(); } }, 'Save'),
        h('button', { class: 'btn grey', onclick: () => { this.app.renameForest(null); this.sheet = null; this.close(); } }, 'Use its own name')),
      h('p', { class: 'sub' }, `Left unnamed, the garden names itself after its soils (right now: “${g.generatedName}”).`),
    ];
  }

  timeTools() {
    const a = this.app;
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    return [
      h('div', { class: 'section' }, 'Time speed'),
      h('div', { class: 'row gap wrap' }, a.speeds.map((v) => b(`${v}×`, () => { a.setSpeed(v); this.renderSheet(); }, v === a.speed ? 'green' : 'grey'))),
      h('p', { class: 'sub' }, '60× = a minute per second · 3600× = an hour per second.'),
      h('div', { class: 'section' }, 'Skip ahead'),
      h('div', { class: 'row gap wrap' }, b('+1 hour', () => a.debugSkip(1)), b('+6 hours', () => a.debugSkip(6)), b('+1 day', () => a.debugSkip(24))),
      h('div', { class: 'section' }, 'Come back after…'),
      h('p', { class: 'sub' }, 'As if you closed the game and came back later: real time away (the morning card counts it).'),
      h('div', { class: 'row gap wrap' }, [2, 10, 24].map((n) => b(`${n} hours`, () => { this.sheet = null; this.close(); a.debugReturn(n); }))),
    ];
  }

  debugBody() {
    const a = this.app;
    if (a.devMode) return this.devBody();
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    return [
      h('div', { class: 'section' }, 'Developer mode'),
      h('p', { class: 'sub' }, 'Test anything in a separate test garden. Your real garden is saved first and never changed while developer mode is on.'),
      h('div', { class: 'row gap wrap' }, b('Enter developer mode', () => a.enterDevMode('resume'), 'orange'), b('…with a copy of my garden', () => a.enterDevMode('copy'))),
      ...this.timeTools(),
      h('p', { class: 'sub' }, 'Time tools here change your real garden. Giving things is in developer mode.'),
      h('div', { class: 'section' }, 'Danger'),
      b('Start a new garden', () => { this.ask('Start a brand-new garden?', 'This erases your progress.', 'Start over', () => a.resetForest()); }, 'red'),
    ];
  }

  /** Developer-mode sections: [title, [nodes]]. Later systems add theirs. */
  devSections() {
    const a = this.app, g = this.game;
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    const cats = [...new Set(this.content.itemList.map((i) => i.category))];
    const itemSel = h('select', { class: 'select' }, cats.map((cat) => h('optgroup', { label: cap(cat) }, this.content.itemList.filter((i) => i.category === cat).map((i) => h('option', { value: i.id }, i.name)))));
    const decorSel = h('select', { class: 'select' }, (this.content.cosmetics || []).map((c) => h('option', { value: c.id }, c.name)));
    const packetSel = h('select', { class: 'select' }, [
      h('optgroup', { label: 'Blind packets' }, this.content.itemList.filter((i) => i.blind).map((i) => h('option', { value: i.id }, i.name))),
      h('optgroup', { label: 'Named packets (any plant)' }, this.content.plantList.map((p) => h('option', { value: 'packet.' + p.id }, `${p.name} seeds`)))]);
    const amendSel = h('select', { class: 'select' }, (this.content.amendmentList || []).map((x) => h('option', { value: x.id }, x.name)));
    return [
      ['Weather and water', [
        (() => {
          const ws = h('select', { class: 'select' }, Object.entries((this.content.tuning.weather || {}).types || {}).map(([k, v]) => h('option', { value: k }, v.name)));
          const ms = h('select', { class: 'select' }, ((this.content.tuning.moon || {}).phases || []).map((p, i) => h('option', { value: String(i), selected: i === 4 }, p.name)));
          return h('div', { class: 'row gap wrap' }, ws, ms, b('Run a tide now', () => a.dev((gm, t) => { const r = gm.runTide(Game.tideNumber(t), { weather: ws.value, moon: Number(ms.value) }); return r.taken.length; }, (n) => `The tide turns: soil spread to ${n} tile(s).`), 'orange'));
        })(),
        h('div', { class: 'row gap wrap' },
          b("Run a tide (today's sky)", () => a.dev((gm, t) => gm.runTide(Game.tideNumber(t)).taken.length, (n) => `The tide turns: soil spread to ${n} tile(s).`)),
          b('+5 dug', () => a.dev((gm) => { gm.state.coins += 200; }, '+200 coins for digging.'))),
        h('div', { class: 'row gap wrap' }, h('span', { class: 'sub' }, 'Show water: '),
          ...['Auto', ...(((this.content.tuning.water || {}).levels || []).map((l) => l.name))].map((nm, i) => b(nm, () => a.dev((gm) => { gm.state.dev = gm.state.dev || {}; gm.state.dev.waterLevel = i ? i - 1 : null; }, `Water shown: ${nm}.`)))),
        h('p', { class: 'sub' }, `Today ${g.forecast(g.now())[0].weather.name}, ${g.forecast(g.now())[0].moon.name}: power ${g.forecast(g.now())[0].power.toFixed(2)}. Tomorrow power ${g.forecast(g.now())[1].power.toFixed(2)}. Banks: ${g.bankTiles().length}, water tiles: ${g.state.water.length}.`)]],
      ['Garden', [
        h('div', { class: 'row gap wrap' },
          b('Grow all plants now', () => a.dev((gm, t) => gm.devGrowAll(t), (n) => `${n} plant(s) ready.`), 'orange'),
          b('+100 coins', () => a.dev((gm) => gm.devGiveCoins(100), '+100 coins.')),
          b('+1000 coins', () => a.dev((gm) => gm.devGiveCoins(1000), '+1000 coins.')),
          b('Relic ornaments', () => a.dev((gm) => gm.devGiveOrnaments(), (n) => `+${n} relic ornaments (Bag, Decor).`)),
          b(this.plantInspector ? 'Plant timers: ON' : 'Plant timers: off', () => { this.plantInspector = !this.plantInspector; this.renderSheet(); a.changed(false); }, this.plantInspector ? 'orange' : '')),
        h('p', { class: 'sub' }, 'Plant timers: tap a plant to see its exact progress, rate and stage times.'),
        h('div', { class: 'row gap wrap' }, h('span', { class: 'sub' }, `Beauty: score ${g.beautyScore(g.now())}, best tier ${g.beautyBest}. Unlock tier:`),
          ...g.beautyTiers.map((t, i) => b(String(i), () => a.dev((gm) => gm.devSetBeautyBest(i), `Best beauty tier: ${t.name}.`)))),
        h('div', { class: 'row gap wrap' }, packetSel, b('+1', () => a.debugGive(packetSel.value, 1)), b('+5', () => a.debugGive(packetSel.value, 5)),
          b('5 of every packet', () => a.dev((gm) => gm.devGivePackets(5), (n) => `+5 of ${n} packets.`))),
        h('div', { class: 'row gap wrap' }, amendSel, b('+1', () => a.debugGive(amendSel.value, 1)), b('+5', () => a.debugGive(amendSel.value, 5)),
          b('5 of every soil', () => a.dev((gm) => gm.devGiveAmendments(5), (n) => `+5 of ${n} amendments.`)))]],
      ['Visitors', [
        h('p', { class: 'sub' }, "Set a visitor's interest, make it visit now (its next memento, or moving in if it can stay), move it in regardless, or see which of its conditions hold."),
        (() => {
          const sel = h('select', { class: 'select' }, this.content.visitorList.map((v) => h('option', { value: v.id }, `${v.name} (${v.tier}, ${v.likes.plants.join(', ')}, ${v.likes.time})${g.isResident(v.id) ? ' · lives here' : ''}`)));
          const say = (c) => c.kind === 'soil' ? `${c.shape || c.tiles + ' tiles'} ${c.school} soil, level ${c.minLevel}+` : c.kind === 'bed' ? `raised bed with ${c.plant}` : c.kind === 'beauty' ? `beauty tier ${c.tier}+` : `${c.visitor} living here`;
          return h('div', { class: 'row gap wrap' }, sel,
            ...[['first', 'Ready for a memento'], ['visit', 'Ready to visit'], ['none', 'Reset']].map(([st, label]) => b(label, () => a.dev((gm) => gm.devGuestStage(sel.value, st), `${label}.`))),
            b('Visit now', () => { this.sheet = null; this.close(); a.dev((gm, t) => gm.devGuestVisit(sel.value, t)); }),
            b('Move in now', () => { this.sheet = null; this.close(); a.dev((gm, t) => gm.devGuestMoveIn(sel.value, t)); }),
            b('Conditions', () => a.dev((gm, t) => gm.devGuestConditions(sel.value, t), (r) => r.map((x) => `${x.ok ? '✓' : '✗'} ${say(x.c)}`).join(' · '))));
        })(),
        h('div', { class: 'row gap wrap' }, b('2 of every colour variety', () => a.dev((gm) => gm.devGiveVarieties(2), (n) => `+2 of ${n} variety packets.`)))]],
      ['Unlock', [h('div', { class: 'row gap wrap' },
        b('Fill Field Guide', () => a.dev((gm) => gm.devFillGuide(), 'Field Guide complete.')),
        b('Whole forest open', () => a.dev((gm, t) => gm.devOpenForest(t), 'The clearing now covers the whole forest.')))]],
      ['Give', [
        h('div', { class: 'row gap wrap' }, itemSel, b('+1', () => a.debugGive(itemSel.value, 1)), b('+5', () => a.debugGive(itemSel.value, 5))),
        h('div', { class: 'row gap wrap' }, decorSel, b('+1 decor', () => a.dev((gm) => { gm.state.decor.owned[decorSel.value] = (gm.state.decor.owned[decorSel.value] || 0) + 1; }, 'Decor added.')),
          b('One of every decor', () => a.dev((gm) => gm.devGrantDecor(), (n) => `+${n} decor.`)))]],
      ['Store and Old Log', [h('div', { class: 'row gap wrap' },
        b('Complete open listings', () => a.dev((gm, t) => gm.devCompleteRequests(t), (n) => `${n} done.`)),
        b('Reset listings', () => a.dev((gm) => gm.devResetRequests(), 'Listings reset (rewards kept).')))]],
      ['Opening', [h('p', { class: 'sub' }, g.state.tin ? 'Open the seed tin as a school, skipping the questions.' : 'The tin has been opened.'),
        g.state.tin ? h('div', { class: 'row gap wrap' }, SCHOOLS.map((k) => b(cap(k), () => { this.sheet = null; this.close(); this.openOpening(k); }))) : null]],
      ['Foraging patch', [h('div', { class: 'row gap wrap' }, b('Grow finds now', () => a.dev((gm, t) => gm.devForageNow(t), (n) => `${n} new find(s) by the treeline.`)))]],
    ];
  }

  devBody() {
    const a = this.app, g = this.game;
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    const setupName = h('input', { type: 'text', placeholder: 'Setup name', maxlength: 30 });
    const setups = a.devSetups();
    return [
      h('div', { class: 'dev-note' }, h('b', {}, 'Developer mode is on'),
        h('span', {}, ` · test garden (${g.state.dev?.createdFrom === 'copy' ? 'copied from your garden' : 'separate'}). Nothing here touches your real garden.`)),
      h('div', { class: 'row gap wrap' },
        b('Back to my garden', () => a.exitDevMode(), 'green'),
        b('New blank test garden', () => { this.ask('Replace the test garden?', 'It becomes a blank one.', 'Replace', () => a.resetDevForest('blank')); }),
        b('Copy my garden in', () => { this.ask('Replace the test garden?', 'It becomes a copy of your real garden.', 'Replace', () => a.resetDevForest('copy')); })),
      ...this.devSections().flatMap(([title, nodes]) => [h('div', { class: 'section' }, title), ...nodes]),
      h('div', { class: 'section' }, 'Saved setups'),
      h('div', { class: 'row gap wrap' }, h('div', { class: 'field grow' }, setupName), b('Save setup', () => { a.saveDevSetup(setupName.value.trim()); this.renderSheet(); }, 'green')),
      Object.keys(setups).length ? Object.entries(setups).sort((x, y) => y[1].savedAt - x[1].savedAt).map(([name, st]) => h('div', { class: 'row gap setup-row' },
        h('span', { class: 'grow' }, name, h('span', { class: 'sub' }, ' · ' + new Date(st.savedAt).toLocaleString())),
        b('Load', () => a.loadDevSetup(name)),
        b('Delete', () => { this.ask(`Delete setup “${name}”?`, '', 'Delete', () => { a.deleteDevSetup(name); this.renderSheet(); }); }, 'grey'))) : h('p', { class: 'sub' }, 'No saved setups yet.'),
      ...this.timeTools(),
    ];
  }

  // -------------------------------------------------------------- cards

  /** Stepped pixel rays behind a reveal, tinted via a palette swap (data sprite "ui.burst"). */
  burst(color, scale = 5) {
    const variant = color ? { swap: { 2: '#ffffff', 3: color } } : null;
    return this.sprites.element('ui.burst', variant, scale, 'burst', true);
  }

  /** Shows a card in the overlay, or queues it behind the one that's up. */
  showCard(build) {
    const ov = document.getElementById('overlay');
    if (ov.classList.contains('show')) { (this.cardQueue = this.cardQueue || []).splice(4); this.cardQueue.push(build); return; }
    const done = () => { ov.classList.remove('show'); ov.replaceChildren(); ov.onclick = null; this.nextCard(); };
    ov.replaceChildren(build(done));
    ov.onclick = (e) => { if (e.target === ov) done(); };
    ov.classList.add('show');
  }
  nextCard() { const next = (this.cardQueue || []).shift(); if (next) this.showCard(next); }

  /**
   * An in-game confirmation card (instead of the browser's confirm(), which embedded views such as
   * home-screen apps and artifact frames may refuse). Runs `onYes` only if the player confirms.
   */
  ask(title, text, yes, onYes) {
    const ov = document.getElementById('overlay');
    const close = () => { ov.classList.remove('show'); ov.replaceChildren(); ov.onclick = null; this.nextCard(); };
    ov.replaceChildren(h('div', { class: 'reveal-card pop' }, h('h2', {}, title), text ? h('p', { class: 'sub' }, text) : null,
      h('div', { class: 'row gap' },
        h('button', { class: 'btn grey', onclick: close }, 'Cancel'),
        h('button', { class: 'btn red', onclick: () => { close(); onYes(); } }, yes))));
    ov.onclick = (e) => { if (e.target === ov) close(); };
    ov.classList.add('show');
  }

  featureNote() { return h('p', { class: 'sub center' }, 'It grew here on its own. It stays where it is, and makes the garden lovelier.'); }

  /** A short celebratory card. */
  celebrate(title, text, art = null, button = 'Lovely') {
    this.showCard((done) => h('div', { class: 'reveal-card pop' },
      h('div', { class: 'rays-wrap small' }, this.burst(null, 2.5), art || h('span', { class: 'row' }, ic('leaf', 4), ic('sparkle', 4))),
      h('h2', {}, title), typeof text === 'string' ? h('p', { class: 'sub' }, text) : text,
      h('button', { class: 'btn green', onclick: done }, button)));
  }

  /**
   * The opening (Content/opening.json): the seed tin's card and the words on its lid, a few quiet
   * questions, then what's inside. Closing before the end changes nothing; the tin waits.
   */
  openOpening(forceSchool = null) {
    const o = this.content.opening, g = this.game;
    if (!o || !g.state.tin) return;
    const ov = document.getElementById('overlay');
    const answers = [];
    const close = () => { ov.classList.remove('show'); ov.replaceChildren(); ov.onclick = null; this.nextCard(); };
    const show = (...kids) => { ov.replaceChildren(h('div', { class: 'reveal-card pop opening' }, ...kids)); ov.classList.add('show'); };
    const tin = this.content.tuning.start?.tin?.sprite || 'relic.unknown';
    const reveal = () => {
      const r = this.app.openTin(answers, forceSchool);
      if (!r) { close(); return; }
      ov.onclick = null;
      show(h('div', { class: 'rays-wrap' }, this.burst(SCHOOL_COLORS[r.school]), this.sprites.element(tin, null, 8, 'grow-in', true)),
        h('p', { class: 'inscription' }, (o.reveal || {})[r.school] || ''),
        ...this.openingGifts(r),
        h('button', { class: 'btn green', onclick: () => { close(); this.app.changed(); } }, o.card.keep || 'Thank you'));
    };
    const ask = (i) => {
      const q = o.questions[i];
      if (!q) { reveal(); return; }
      show(this.sprites.element(tin, null, 5, '', true), h('h2', {}, q.text),
        h('div', { class: 'answers' }, q.answers.map((ans, k) => h('button', { class: 'btn answer', onclick: () => { answers.push(k); ask(i + 1); } }, ans.text))));
    };
    ov.onclick = (e) => { if (e.target === ov) close(); };
    if (forceSchool) { reveal(); return; }
    show(this.sprites.element(tin, null, 8, 'grow-in', true), h('h2', {}, o.card.title),
      h('p', { class: 'sub' }, o.card.intro), h('p', { class: 'inscription' }, o.card.inscription),
      h('button', { class: 'btn green', onclick: () => ask(0) }, o.card.begin || 'Open it'));
  }
  /** What the tin held, shown on its last card. */
  openingGifts(r) {
    const list = (r.results || []).map((x) => { const d = this.content.items[x.item]; return d ? h('div', { class: 'reward-item' }, this.sprites.element(d.sprite, d.variant || null, 2), ` ${x.count} × ${d.name}`) : null; });
    return list.length ? [h('div', { class: 'gifts' }, list)] : [h('p', { class: 'sub' }, this.story('messages.openingDone'))];
  }

  /** The weather-and-moon button in the HUD: today's weather and the moon; tap for the forecast. */
  weatherButton(now) {
    const f = this.game.forecast(now)[0];
    return h('button', { class: 'weather-btn', title: `${f.weather.name}, ${f.moon.name}. Tap for the forecast.`, onclick: () => this.forecastCard() },
      ic(f.weather.icon, 2), ic('moon.' + f.moon.index, 2));
  }
  /** The water's level on a day of this power, and what it does to the soil at each tide that day. */
  waterWords(power) {
    const lv = this.game.waterLevel(power);
    const note = power <= 0.05 ? 'still; soil creeps slowly' : lv.cross > 0.15 ? 'soil spreads fast and crosses the stream'
      : lv.cross > 0 ? 'soil may cross the stream' : power < 0.6 ? 'soil barely spreads' : 'soil spreads along the banks';
    return { name: lv.name, note };
  }
  forecastRows(now, compact = false) {
    return h('div', { class: 'forecast' + (compact ? ' compact' : '') }, this.game.forecast(now).map((f, i) => {
      const w = this.waterWords(f.power);
      return h('div', { class: 'forecast-row' },
        h('b', {}, i ? 'Tomorrow' : 'Today'),
        h('span', { class: 'fc-icons' }, ic(f.weather.icon, 2), ic('moon.' + f.moon.index, 2)),
        h('span', { class: 'grow' }, `${f.weather.name}, ${f.moon.name.toLowerCase()}. `, h('b', { class: 'lvl lvl-' + w.name.toLowerCase() }, `${w.name} water`), h('span', { class: 'sub' }, `: ${w.note}.`)));
    }));
  }
  forecastCard() {
    this.showCard((done) => h('div', { class: 'reveal-card pop' },
      h('h2', {}, 'The sky'),
      this.forecastRows(this.game.now()),
      h('p', { class: 'sub' }, 'Rain swells the pool and its streams, and so does the moon: the water rises from Low to Normal, High and Flood. Every six hours the tide turns: soil on the banks spreads along them and inland, but never through the water, unless it runs High or floods and carries soil to the far bank. Deep soil, and soil with roots in it, holds better.'),
      h('button', { class: 'btn green', onclick: done }, 'OK')));
  }
  /** What the tides did while you were away, for the return card. */
  tideLine(n) {
    if (!n || !n.tides) return null;
    const w = ((this.content.tuning.weather || {}).types || {})[n.weather] || {}, moon = (((this.content.tuning.moon || {}).phases || [])[n.moon] || {}).name || 'the moon';
    const carried = n.taken.length, lost = n.taken.filter((x) => x.from).length;
    const what = carried ? `soil spread along the banks to ${carried} tile${carried === 1 ? '' : 's'}${lost ? ` (${lost} changed school)` : ''}${n.crossed ? `, and high water carried it across the stream ${n.crossed === 1 ? 'once' : `${n.crossed} times`}` : ''}` : 'the soil stayed where it was';
    const when = n.tides === 1 ? 'The last tide' : `${n.tides} tides`;
    return h('p', { class: 'sub night' }, ic('moon.' + n.moon, 1), ` ${when} (${(w.name || 'calm').toLowerCase()}, ${moon.toLowerCase()}): ${what}${n.matured ? `; soil matured on ${n.matured} tile${n.matured === 1 ? '' : 's'}` : ''}.`);
  }

  /** The morning check: what's ready, what's still growing, and the night's surprise, if any. */
  morningCard(m, away) {
    const g = this.game, now = g.now();
    const phase = g.dayPhase(now);
    const title = { dawn: 'Good morning', day: 'Welcome back', dusk: 'Good evening', night: 'A quiet night' }[phase];
    const rows = m.ready.map((r) => {
      const def = this.game.plantDef(r.plantID), item = this.content.items[def.item];
      const v = r.variety && g.varietyDef ? g.varietyDef(r.variety) : null;
      return h('div', { class: 'reward-item' }, this.sprites.element(item.sprite, v ? v.variant : null, 2), ` ${v ? v.name : def.name}${r.count > 1 ? ` ×${r.count}` : ''}, ready to harvest`);
    });
    const body = h('div', { class: 'morning' },
      rows.length ? h('div', { class: 'gifts' }, rows) : h('p', { class: 'sub' }, g.state.plants.length ? 'Nothing is ready yet.' : 'The garden is waiting for seeds.'),
      m.growing ? h('p', { class: 'sub' }, `${m.growing} still growing. The next is ready ${this.roughly(m.next - now)}.`) : null,
      m.surprise ? this.surpriseLine(m.surprise) : null,
      ...(m.news || []).map((n) => this.newsLine(n)),
      this.tideLine(g.state.lastTides, now),
      this.forecastRows(now, true));
    this.celebrate(title, body, null, rows.length ? 'Lovely' : 'OK');
  }
  surpriseLine(s) {
    const g = this.game;
    if (s.type === 'selfSeed') return h('p', { class: 'surprise' }, ic('sparkle', 1), ` ${this.aName(g.plantDef(s.plantID)?.name || 'seedling')} has seeded itself nearby.`);
    if (s.type === 'gift') {
      const d = g.guestDef(s.visitor), it = this.content.items[s.item];
      return h('p', { class: 'surprise' }, ic('heart', 1), ` The ${d ? d.name : 'visitor'} left you ${it ? it.name : 'seeds'}.`);
    }
    if (s.type === 'rareColour') return h('p', { class: 'surprise' }, ic('sparkle', 1), ` One of your ${g.plantDef(s.plantID)?.name}s has come up ${g.varietyDef(s.variety)?.name.split(' ')[0].toLowerCase()}.`);
    return null;
  }

  /** A new beauty tier: a gentle card, and what it put in the Store. */
  beautyCard(e) {
    const list = e.opens.length ? h('p', { class: 'sub' }, `New in the Store: ${e.opens.join(', ')}.`) : null;
    this.celebrate(`The garden feels ${e.name.toLowerCase()}`, h('div', {}, h('p', { class: 'sub' }, 'More kinds of plants, flowers in bloom and things to sit by make it lovelier still.'), list));
  }

  /** After an older save was archived: a fresh garden, with the Field Guide kept. */
  freshGardenCard(e) {
    this.celebrate('A fresh garden', h('div', {},
      h('p', { class: 'sub' }, 'The forest has changed a great deal since you were last here. Your old forest is kept safe, and a fresh garden is waiting around the old log.'),
      e.kept ? h('p', { class: 'sub' }, `Your Field Guide remembers everything you found (${e.kept} entries).`) : null), null, 'Begin');
  }
}
