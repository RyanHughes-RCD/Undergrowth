// DOM user interface: HUD, sheets (Bag, Store, Old Log, Field Guide, developer tools), cards and toasts.
import { SCHOOLS, RARITY_NAMES, rarityIndex, decorVariant, schoolName } from './core.js';

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
      this.content.tuning.debugTools ? h('div', { class: 'dev' },
        h('button', { class: 'speed-btn' + (this.app.speed > 1 ? ' on' : ''), title: 'Time speed', onclick: () => this.app.cycleSpeed() },
          h('b', {}, ic('fast', 1), `${this.app.speed}×`),
          g.state.debugTimeOffset > 0 ? h('span', {}, `+${duration(g.state.debugTimeOffset / 1000)}`) : null),
        h('button', { class: 'round-btn' + (this.app.devMode ? ' dev-on' : ''), title: this.app.devMode ? 'Developer mode' : 'Debug', onclick: () => this.open('debug') },
          ic('bug', 2), this.app.devMode ? h('span', { class: 'dev-tag' }, 'DEV') : null)) : null,
    ));
    const bottom = h('div', { class: 'hud-bottom' });
    if (this.mode) bottom.append(this.modeBanner());
    if (this.selectedTile) bottom.append(this.tileCard(this.selectedTile));
    const invCount = Object.values(g.state.inventory).reduce((a, b) => a + b, 0);
    bottom.append(h('div', { class: 'nav' },
      this.navButton('bag', 'Bag', invCount, () => this.open('bag')),
      this.navButton('store', 'Store', this.storeBadge(now), () => this.open('store')),
      this.navButton('guide', 'Guide', 0, () => this.open('guide'))));
    this.root.replaceChildren(top, bottom);
    if (this.sheet && withSheet) this.renderSheet();
  }

  /** Extra bits under the garden name (later systems add to it). */
  hudExtras() { return [' · tap to rename']; }

  navButton(icon, label, badge, onclick) {
    return h('button', { class: 'nav-btn', onclick }, ic(icon, 2), h('span', {}, label), badge > 0 ? h('span', { class: 'badge' }, badge) : null);
  }

  modeBanner() {
    const m = this.mode;
    const text = {
      decor: () => `Tap an open tile to place the ${this.game.decorDef(m.decorID)?.name || 'decoration'}`,
      decorMove: () => 'Tap an open tile to move it there',
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
  tileTitle(tile) { return this.game.inClearing(tile) ? 'Open ground' : 'The treeline'; }
  tileBody(tile) { return this.game.inClearing(tile) ? h('p', { class: 'sub' }, 'Soft, open ground.') : h('p', { class: 'sub' }, 'Dense shrubs. Room to grow opens more of the clearing.'); }

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
      offerings: () => ['The Old Log', this.oldLogBody()],
      store: () => ['Store', this.storeBody()],
      decor: () => this.decorBody(arg),
      visitor: () => this.visitorBody(arg),
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

  /** Bag sections, in order. Later systems add theirs in front. */
  bagSections() { return ['plant', 'mushroom']; }
  bagSectionTitle(cat) { return { plant: 'Plants and flowers', mushroom: 'Mushrooms' }[cat] || cap(cat); }
  /** Buttons for one Bag row (later systems add Plant, Use, Sell...). */
  bagActions() { return []; }

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
  bagLine(def) { return def.rarity ? h('div', { class: 'sub', style: `color:${RARITY_COLORS[def.rarity]}` }, rarityName(def.rarity)) : null; }

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
    if (r.type === 'cosmetic') return [this.sprites.element(g.decorDef(r.id)?.sprite || 'ui.icon.board', null, 2), ` ${g.decorDef(r.id)?.name || r.id}`];
    if (r.type === 'item') { const d = this.content.items[r.id]; return d ? [this.sprites.element(d.sprite, null, 2), ` ${d.name}${(r.count || 1) > 1 ? ' ×' + r.count : ''}`] : r.id; }
    if (r.type === 'unlock' && r.id === 'expansion') return 'The treeline steps back';
    return r.id || r.type;
  }

  lockText(locks) {
    return locks.map((l) => (l.type === 'guide' ? `${l.need} Field Guide entries (${l.have} so far)` : l.type === 'request' ? `“${l.name}” first`
      : l.type === 'full' ? 'nothing: the whole forest is open' : l.type === 'day' ? `garden day ${l.need}` : (l.text || ''))).join(', ');
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
  priceRows(st) { return st.items.map((x) => this.offerItemRow(x)); }

  /** Store listings the player could get right now (a badge on the nav). */
  storeBadge(now) { return this.game.requestBoard(now).filter((st) => st.ready).length; }

  /** The Old Log: notes and requests from neighbours, and the way into the Store. */
  oldLogBody() {
    return [
      h('p', { class: 'sub center' }, this.story('messages.offeringsIntro')),
      h('div', { class: 'row space' },
        h('button', { class: 'btn small grey', onclick: () => this.open('entry', { name: 'The Old Log', sprite: 'landmark.old-log', variant: null, text: this.story('guide.landmarks.landmark.old-log') || this.content.story?.guide?.landmarks?.['landmark.old-log'] }) }, 'About the log'),
        h('button', { class: 'btn small green', onclick: () => this.open('store') }, ic('store', 1), ' Open the Store')),
      ...this.oldLogSections(),
    ];
  }
  oldLogSections() { return []; }

  /** Store tabs: [id, label, body()]. */
  storeTabs() {
    const g = this.game, now = g.now();
    const board = g.requestBoard(now);
    const decor = board.filter((st) => st.req.reward.type === 'cosmetic');
    const grow = board.filter((st) => st.req.reward.type === 'unlock' && st.req.reward.id === 'expansion');
    return [
      ['decor', 'Decor', () => [h('p', { class: 'sub' }, 'Things to set out in your garden. Find them in your Bag under Decor.'),
        ...decor.filter((st) => !st.done).map((st) => this.offerCard(st, 'Get it')),
        decor.some((st) => st.done) ? [h('div', { class: 'section' }, 'Owned'), h('p', { class: 'sub' }, decor.filter((st) => st.done).map((st) => st.req.name).join(' · '))] : null]],
      ['grow', 'Room to grow', () => {
        const next = grow.find((st) => !st.done);
        return [h('p', { class: 'sub' }, 'The treeline steps back a little each time.'), next ? this.offerCard(next, 'Clear it') : h('p', { class: 'sub' }, 'The whole forest is open.')];
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
  storeHeader() { return []; }

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
  decorExtra() { return []; }

  // -------------------------------------------------------------- Field Guide

  /** Field Guide tabs: [id, label, entries()]. Later systems add theirs. */
  guideTabs() {
    const items = (cat) => this.content.itemList.filter((i) => i.inGuide !== false && i.category === cat)
      .map((i, idx) => ({ i, idx })).sort((a, b) => rarityIndex(a.i.rarity) - rarityIndex(b.i.rarity) || a.idx - b.idx)
      .map(({ i }) => ({ key: 'item:' + i.id, name: i.name, sprite: i.sprite, variant: i.variant || null, rarity: i.rarity, text: i.guideText, school: i.school }));
    return [
      ['mushroom', 'Mushrooms', () => items('mushroom')],
      ['plant', 'Plants', () => items('plant')],
      ['visitors', 'Visitors', () => (this.content.visitorList || []).map((v) => ({ key: 'visitor:' + v.id.replace(/^visitor\./, ''), name: v.name, sprite: v.sprite, visitor: v }))],
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
  guideHeader() { return []; }

  entryBody(e) {
    return [
      h('div', { class: 'hero' }, this.sprites.element(e.sprite, e.variant, 9)),
      e.rarity ? h('p', { class: 'rarity', style: `color:${RARITY_COLORS[e.rarity]}` }, rarityName(e.rarity).toUpperCase()) : null,
      e.school ? h('p', { class: 'sub center', style: `color:${SCHOOL_COLORS[e.school]}` }, `${schoolName(e.school)}`) : null,
      e.text ? h('p', { class: 'sub center' }, e.text) : null,
      ...(e.extra || []),
    ];
  }

  /** A visitor's page: its art and name once befriended, and every clue found so far. No numbers. */
  visitorBody(id) {
    const def = (this.content.visitorList || []).find((v) => v.id === id);
    if (!def) return ['Visitor', h('p', { class: 'sub' }, 'Unknown.')];
    const S = this.content.story?.visitors || {};
    const known = this.game.discovered.has('visitor:' + id.replace(/^visitor\./, ''));
    const clues = this.visitorClues(def);
    return [known ? def.name : '???', [
      h('div', { class: 'hero' }, this.sprites.element(def.sprite, known ? null : { silhouette: [40, 44, 52] }, 6, '', true)),
      h('p', { class: 'center' }, h('b', {}, known ? def.name : (S.unknownName || 'Someone small'))),
      known && def.text ? h('p', { class: 'sub center' }, def.text) : null,
      h('div', { class: 'section' }, 'Signs'),
      clues.length ? h('ul', { class: 'clues' }, clues.map((c) => h('li', {}, c))) : h('p', { class: 'sub' }, S.noClues || 'No signs of it yet.'),
    ]];
  }
  visitorClues() { return []; }

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
      b('Start a new garden', () => { if (confirm('Start a brand-new garden? This erases your progress.')) a.resetForest(); }, 'red'),
    ];
  }

  /** Developer-mode sections: [title, [nodes]]. Later systems add theirs. */
  devSections() {
    const a = this.app, g = this.game;
    const b = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    const cats = [...new Set(this.content.itemList.map((i) => i.category))];
    const itemSel = h('select', { class: 'select' }, cats.map((cat) => h('optgroup', { label: cap(cat) }, this.content.itemList.filter((i) => i.category === cat).map((i) => h('option', { value: i.id }, i.name)))));
    const decorSel = h('select', { class: 'select' }, (this.content.cosmetics || []).map((c) => h('option', { value: c.id }, c.name)));
    return [
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
        b('New blank test garden', () => { if (confirm('Replace the test garden with a blank one?')) a.resetDevForest('blank'); }),
        b('Copy my garden in', () => { if (confirm('Replace the test garden with a copy of your real garden?')) a.resetDevForest('copy'); })),
      ...this.devSections().flatMap(([title, nodes]) => [h('div', { class: 'section' }, title), ...nodes]),
      h('div', { class: 'section' }, 'Saved setups'),
      h('div', { class: 'row gap wrap' }, h('div', { class: 'field grow' }, setupName), b('Save setup', () => { a.saveDevSetup(setupName.value.trim()); this.renderSheet(); }, 'green')),
      Object.keys(setups).length ? Object.entries(setups).sort((x, y) => y[1].savedAt - x[1].savedAt).map(([name, st]) => h('div', { class: 'row gap setup-row' },
        h('span', { class: 'grow' }, name, h('span', { class: 'sub' }, ' · ' + new Date(st.savedAt).toLocaleString())),
        b('Load', () => a.loadDevSetup(name)),
        b('Delete', () => { if (confirm(`Delete setup “${name}”?`)) { a.deleteDevSetup(name); this.renderSheet(); } }, 'grey'))) : h('p', { class: 'sub' }, 'No saved setups yet.'),
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

  /** After an older save was archived: a fresh garden, with the Field Guide kept. */
  freshGardenCard(e) {
    this.celebrate('A fresh garden', h('div', {},
      h('p', { class: 'sub' }, 'The forest has changed a great deal since you were last here. Your old forest is kept safe, and a fresh garden is waiting around the old log.'),
      e.kept ? h('p', { class: 'sub' }, `Your Field Guide remembers everything you found (${e.kept} entries).`) : null), null, 'Begin');
  }
}
