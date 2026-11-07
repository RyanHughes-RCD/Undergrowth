// Undergrowth web game — boot, clock, saving, and player actions.
import { Content, Game, GameError, SAVE_VERSION, STUMP, WELL, archiveKey } from './core.js';
import { SpriteRegistry } from './sprites.js';
import { ForestView } from './render.js';
import { UI } from './ui.js';

const SAVE_KEY = 'undergrowth.forest.v1';
// Developer mode plays a separate test garden under its own key; the real save is never written while it's on.
const DEV_SAVE_KEY = 'undergrowth.forest.dev';
const DEV_MODE_KEY = 'undergrowth.devMode';
const DEV_SETUPS_KEY = 'undergrowth.dev.setups';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { console.warn('Storage failed', e); return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
};

class App {
  async boot() {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`content.json: HTTP ${res.status}`);
    const bundle = await res.json();
    this.content = new Content(bundle);
    this.sprites = new SpriteRegistry(bundle.sprites, bundle.palettes);
    this.ui = new UI(this);

    // Developer mode: ?dev=1 turns it on, ?dev=0 off (or use the Debug menu). It sticks until turned off.
    const q = new URLSearchParams(location.search).get('dev');
    if (q === '1' && this.content.tuning.debugTools) store.set(DEV_MODE_KEY, '1');
    if (q === '0') store.del(DEV_MODE_KEY);
    this.devMode = !!this.content.tuning.debugTools && store.get(DEV_MODE_KEY) === '1';
    const fresh = !store.get(this.saveKey);
    this.game = this.loadGame(Date.now());
    this.awayOnBoot = this.awayHours(Date.now());
    this.game.advance(this.game.now());

    this.speed = this.loadSpeed();
    this.view = new ForestView(document.getElementById('forest'), this);
    this.view.sync();
    this.ui.render();
    if (fresh) this.ui.toast(this.ui.story('messages.welcome'));
    this.processEvents();
    this.returned(this.awayOnBoot);
    this.save();

    // Clock: every second, apply the debug time speed; refresh the garden on its normal cadence
    // (or every second while time is sped up).
    this.lastReal = Date.now();
    let sinceRefresh = 0;
    const refresh = Math.max(1, this.content.tuning.visuals.refreshSeconds || 10);
    setInterval(() => {
      const real = Date.now();
      const dt = real - this.lastReal;
      this.lastReal = real;
      if (document.hidden) return;
      if (this.speed > 1) this.game.state.debugTimeOffset += dt * (this.speed - 1);
      sinceRefresh += dt / 1000;
      if (this.speed > 1 || sinceRefresh >= refresh) { sinceRefresh = 0; this.tick(); }
    }, 1000);
    document.addEventListener('visibilitychange', () => {
      this.lastReal = Date.now();
      if (this.view) this.view.lightAt = 0;   // re-read the clock for lighting on return
      if (document.hidden) { this.save(); return; }
      const away = this.awayHours(Date.now());
      this.game.advance(this.game.now());
      this.changed();
      this.returned(away);
    });
    window.addEventListener('pagehide', () => this.save());

    let lastFrame = 0;
    const loop = (t) => {
      if (t - lastFrame > 33) { lastFrame = t; this.view.draw(t); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- saving

  get saveKey() { return this.devMode ? DEV_SAVE_KEY : SAVE_KEY; }

  /**
   * Reads the save. A save from before the garden (older version) is kept under archiveKey and a fresh
   * garden starts, with the Field Guide carried over. A save we can't read is kept as <key>.corrupt.
   */
  loadGame(now) {
    const k = this.saveKey;
    const raw = store.get(k);
    let saved = null;
    if (raw) {
      try { saved = JSON.parse(raw); } catch (e) {
        console.warn('Could not read save; starting fresh', e);
        store.set(k + '.corrupt', raw);
      }
    }
    if (saved && typeof saved.version === 'number' && saved.version > SAVE_VERSION) {
      console.warn('Save is from a newer version; keeping it aside');
      store.set(k + '.newer', raw);
      saved = null;
    }
    const { game, archived } = Game.fromSave(this.content, saved, now);
    if (archived) {
      store.set(archiveKey(k, archived.version), raw);
      console.info(`Archived a version ${archived.version} save as ${archiveKey(k, archived.version)}`);
    }
    if (this.devMode && !game.state.dev) game.state.dev = { createdFrom: 'blank' };
    return game;
  }

  save() {
    // Belt and braces: a test garden (state.dev) can never be written over the real save.
    if (!this.devMode && this.game.state.dev) { console.warn('Refusing to save a test garden as the real one'); return; }
    this.game.state.lastRealSeen = Date.now();
    store.set(this.saveKey, JSON.stringify(this.game.toJSON()));
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }

  /** Real hours since the garden was last open (developer time skips don't count). */
  awayHours(real) {
    const seen = this.game.state.lastRealSeen;
    return seen ? Math.max(0, (real - seen) / 3600000) : 0;
  }

  /**
   * After the game opens or comes back to the front: if it was away long enough (real time,
   * tuning.garden.morning.minAwayHours), the morning card sums up what's ready (and the night's surprise).
   */
  returned(awayHours) {
    const shown = this.morningCheck(awayHours);
    if (!shown) this.visitorNews();
    // A tide that turned while the garden was open (or a short absence): just a note.
    if (!shown && this.nightNote) {
      const n = this.nightNote;
      this.ui.toast(n.taken.length ? `The tide turned. Soil spread to ${n.taken.length} tile${n.taken.length === 1 ? '' : 's'}.` : n.matured ? `The tide turned. The soil settled deeper.` : 'The tide turned quietly.', 'ui.icon.moon.' + n.moon);
    }
    this.nightNote = null;
  }

  morningCheck(awayHours) {
    const cfg = (this.content.tuning.garden || {}).morning || {};
    if (!(awayHours >= (cfg.minAwayHours ?? 4))) return false;
    const g = this.game, now = g.now();
    if (this.game.state.tin) return false;         // the first session ends on the tin, not a summary
    const m = g.morning(now);
    m.news = g.takeVisitorNews();
    if (!m.ready.length && !m.surprise && !m.growing && !this.nightNote && !m.news.length && !m.orchard) return false;
    const tiles = m.ready.flatMap((r) => r.tiles);
    if (m.surprise && m.surprise.tile) tiles.push(m.surprise.tile);
    if (tiles.length) this.view.highlight(tiles, 5, '255,236,140');
    if (m.surprise && m.surprise.tile) this.view.panTo(m.surprise.tile, 1.2);
    this.ui.morningCard(m, awayHours);
    this.changed();
    return true;
  }

  // ---------------------------------------------------------------- state

  tick() {
    this.game.advance(this.game.now());
    this.view.sync();
    this.ui.render(false);
    this.processEvents();
    if (this.nightNote) this.returned(0);
    else this.visitorNews();
  }

  /** Mementos, arrivals and departures since the player last looked: one card. */
  visitorNews() {
    const news = this.game.takeVisitorNews();
    if (!news.length) return;
    this.ui.visitorNewsCard(news);
    this.changed();
  }

  /** Shows one-shot game events. */
  processEvents() {
    const events = this.game.takeEvents();
    if (!events.length) return;
    for (const e of events) this.onEvent(e);
    this.ui.render(false);
  }

  onEvent(e) {
    const ui = this.ui;
    if (e.type === 'freshGarden') ui.freshGardenCard(e);
    else if (e.type === 'beautyTier') ui.beautyCard(e);
    else if (e.type === 'tides') {
      if (e.taken.length) this.view.highlight(e.taken.map((x) => x.tile), 6, '160,210,255');
      this.nightNote = e;
    }
    else if (e.type === 'collection') ui.collectionCard(e);
    else if (e.type === 'soilRetired') ui.celebrate('Soil, the old way', `Bags of soil aren't sold any more: trees, water and plants make their own soil now, spreading it around them as they grow. Your leftover bags were traded back for ${e.coins} coins. Look under Landscape in the Store.`, null, 'OK');
    else if (e.type === 'crossPollinated') {
      const v = this.game.varietyDef(e.variety);
      const it = v && this.content.items[v.produce];
      ui.toast(`A new colour came up beside its neighbour: ${v ? v.name : 'a rare colour'}.`, it ? it.sprite : null);
    }
    else if (e.type === 'companionFound') {
      const g = this.game;
      ui.toast(`The ${g.plantDef(e.plantID)?.name} did well beside the ${g.plantDef(e.with)?.name}. It's in your Field Guide.`, 'ui.icon.heart');
    }
    else if (e.type === 'expansion') {
      this.view.highlight(e.tiles, 4, '170,255,150');
      if (e.river && e.river.length) this.view.highlight(e.river, 6, '140,200,255');
      const f = e.feature && this.game.featureDef(e.feature);
      const block = (t) => [t, { x: t.x + 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x + 1, y: t.y + 1 }];
      if (e.stump) this.view.highlight(block(e.stump), 6, '255,236,140');
      if (e.well) this.view.highlight(block(e.well), 6, '160,220,255');
      const water = e.river && e.river.length ? ' The stream follows, out to the new edge.' : '';
      if (e.soil) {
        this.view.highlight(e.soilTiles, 6, '255,236,140');
        const s = e.soil.charAt(0).toUpperCase() + e.soil.slice(1);
        ui.celebrate('Room to grow', `The ${e.side ? e.side + ' ' : ''}trees step back. On the new ground: a patch of ${s} soil${f ? `, and beside it, ${f.name.charAt(0).toLowerCase() + f.name.slice(1)}` : ''}.${e.stump ? ' ' + ui.story('visitors.stumpFound') : ''}${e.well ? ' ' + ui.story('well.found') : ''}${water}`, e.well ? this.sprites.element('landmark.well', null, 2, 'grow-in') : f ? this.sprites.element(f.sprite, null, 4, 'grow-in') : e.stump ? this.sprites.element('landmark.stump', null, 2, 'grow-in') : null);
      } else ui.toast(ui.story('messages.expansion') + water);
    }
  }

  /** Call after any change. `persist=false` for pure UI changes. */
  changed(persist = true) {
    this.game.updateBeauty(this.game.now());
    this.view.sync();
    this.ui.render();
    this.processEvents();
    if (persist) this.scheduleSave();
  }

  attempt(fn) {
    try { return fn(); } catch (e) {
      if (e instanceof GameError) { this.ui.toast(e.message); return null; }
      throw e;
    }
  }

  /** A toast for things gained: "+2 Marigold · New!". */
  present(results) {
    const lines = [];
    let sprite = null;
    for (const r of results || []) {
      const def = this.content.items[r.item];
      sprite = sprite || def?.sprite;
      lines.push(`+${r.count} ${def ? def.name : r.item}${r.isNew ? ' · New!' : ''}`);
    }
    if (lines.length) this.ui.toast(lines.join('   '), sprite);
  }

  // ---------------------------------------------------------------- actions

  /** Modes that take a tile tap: { type: handler(tile) }. Later systems add theirs. */
  get modeHandlers() {
    const g = this.game, ui = this.ui;
    return {
      decor: (tile) => {
        const id = ui.mode.decorID;
        if (this.attempt(() => g.placeDecor(id, tile))) {
          if (!(g.state.decor.owned[id] > 0)) ui.mode = null;
          ui.toast(`${g.decorDef(id)?.name || 'Decoration'} placed. Tap it to move or recolour it.`, g.decorDef(id)?.sprite);
          this.changed();
        }
      },
      decorMove: (tile) => { if (this.attempt(() => g.moveDecor(ui.mode.placedID, tile))) { ui.mode = null; this.changed(); } },
      plant: (tile) => {
        const id = ui.mode.itemID;
        if (this.plantAt(id, tile, false) && !(g.state.inventory[id] > 0)) ui.mode = null;
        this.changed();
      },
      landscape: (tile) => {
        const id = ui.mode.itemID, it = this.content.items[id];
        const p = this.attempt(() => g.placeLandscape(id, tile, g.now()));
        if (p) {
          if (!(g.state.inventory[id] > 0)) ui.mode = null;
          const def = g.landscapeDef(p.defID);
          ui.toast(`${def.name} planted.${def.school ? ` ${def.school.charAt(0).toUpperCase() + def.school.slice(1)} soil will spread from it.` : ''}`, it && it.sprite);
          this.changed();
        }
      },
    };
  }

  /** Taps on things in the garden: { kind: handler(tile) } by what was hit. Later systems add theirs. */
  tapThing(tile) {
    const g = this.game, ui = this.ui, now = g.now();
    const landmark = g.landmarkAt(tile);
    if (landmark) { ui.selectedTile = null; if (landmark.id === STUMP) ui.open('stump'); else if (landmark.id === WELL) { ui.wellPick = {}; ui.open('well'); } else ui.forecastCard(); this.changed(false); return true; }
    // A landscape piece (only from its own tiles: a tree's canopy doesn't catch taps meant for the row above).
    const land = g.landscapeAt(tile);
    if (land) {
      ui.selectedTile = null;
      const cs = g.cropState(land, now);
      if (cs && cs.ready) { const r = this.attempt(() => g.harvestCrop(land.id, now)); if (r) { this.present(r); this.changed(); } return true; }   // a ripe crop plant: pick it
      ui.open('land', land.id); this.changed(false); return true;
    }
    // A resident: its Field Guide page.
    if (tile.hitKind === 'resident') { ui.selectedTile = null; ui.open('visitor', tile.hitKey); this.changed(false); return true; }
    if (g.tinAt(tile)) { ui.selectedTile = null; ui.openOpening(); return true; }
    const find = g.forageAt(tile);
    if (find) {
      const r = this.attempt(() => g.pickForage(find.id, now));
      if (r) { this.present(r); this.changed(); }
      return true;
    }
    const plant = g.plantAt(tile);
    if (plant && g.isReady(plant, now) && !(ui.selectedTile && ui.selectedTile.x === tile.x && ui.selectedTile.y === tile.y && ui.plantInspector)) { this.harvestAt(tile); return true; }
    // A wild feature uncovered by Room to grow: what it is.
    const wild = g.sceneryAt(tile);
    if (wild && wild.feature && g.featureDef(wild.feature)) {
      const f = g.featureDef(wild.feature);
      ui.selectedTile = null;
      ui.open('entry', { name: f.name, sprite: f.sprite, variant: null, text: f.text, extra: [ui.featureNote()] });
      this.changed(false);
      return true;
    }
    const decor = g.decorAt(tile);
    if (decor && !plant) { ui.selectedTile = null; ui.open('decor', decor.id); this.changed(false); return true; }
    return false;
  }

  handleTap(tile) {
    const g = this.game, ui = this.ui;
    if (!g.inBounds(tile)) return;
    if (ui.mode) { const fn = this.modeHandlers[ui.mode.type]; if (fn) fn(tile); return; }
    if (this.tapThing(tile)) return;
    ui.selectedTile = ui.selectedTile && ui.selectedTile.x === tile.x && ui.selectedTile.y === tile.y ? null : tile;
    this.changed(false);
  }

  beginPlanting(itemID) { this.beginMode({ type: 'plant', itemID }); }
  beginLandscape(itemID) { this.beginMode({ type: 'landscape', itemID }); }

  /** Plant a seed packet on a tile (from planting mode or a tile's card). */
  plantAt(itemID, tile, refresh = true) {
    const g = this.game;
    const p = this.attempt(() => g.plant(itemID, tile, g.now()));
    if (!p) return null;
    const def = g.plantDef(p.plantID), name = p.blind ? 'It' : def.name;
    const slow = !g.soilAt(tile);
    this.ui.toast(slow ? `Planted. ${name} grows slowly in plain soil; it likes ${def.school.charAt(0).toUpperCase() + def.school.slice(1)} soil.` : `Planted. ${p.blind ? 'Watch for its bud.' : `It'll be ready ${this.ui.roughly(g.readyAt(p) - g.now())}.`}`, this.content.items[itemID]?.sprite);
    if (refresh) { this.ui.selectedTile = null; this.changed(); }
    return p;
  }

  /** Dig a channel: the tile becomes water (its soil is lost). */
  clearDebrisAt(tile) {
    const d = this.attempt(() => this.game.clearDebris(tile));
    if (d) { this.view.dustAt(tile); this.ui.toast('Cleared. The ground is open.'); this.changed(); }
  }

  digAt(tile) {
    const cost = this.attempt(() => this.game.dig(tile, this.game.now()));
    if (cost) { this.view.dustAt(tile); this.ui.toast(`The water finds its way in. (${cost} coins)`); this.changed(); }
  }

  harvestAt(tile) {
    const g = this.game, p = g.plantAt(tile);
    if (!p) return;
    const r = this.attempt(() => g.harvest(p.id, g.now()));
    if (!r) return;
    this.view.dustAt(tile);
    this.present(r.results);
    if (this.ui.selectedTile && this.ui.selectedTile.x === tile.x && this.ui.selectedTile.y === tile.y) this.ui.selectedTile = null;
    this.changed();
  }

  clearPlant(plantID) {
    if (this.attempt(() => { this.game.clearPlant(plantID, this.game.now()); return true; })) { this.ui.selectedTile = null; this.changed(); }
  }

  sellItem(itemID, n) {
    const coins = this.attempt(() => this.game.sell(itemID, n));
    if (coins) { this.ui.toast(`Sold for ${coins} coins.`, 'ui.icon.coin'); this.changed(); }
  }
  sellAll() {
    const g = this.game;
    let total = 0;
    for (const [id, n] of Object.entries(g.state.inventory)) if (n > 0 && g.sellPrice(id)) total += this.attempt(() => g.sell(id, n)) || 0;
    if (total) { this.ui.toast(`Sold everything for ${total} coins.`, 'ui.icon.coin'); this.changed(); }
  }
  buyPacket(packetID) {
    const r = this.attempt(() => this.game.buyPacket(packetID, this.game.now()));
    if (r) { this.present(r); this.changed(); }
  }
  buyLandscape(itemID) {
    const r = this.attempt(() => this.game.buyLandscape(itemID));
    if (r) { this.present(r); this.changed(); }
  }
  buyOrchard(itemID) {
    const r = this.attempt(() => this.game.buyOrchard(itemID));
    if (r) { this.present(r); this.changed(); }
  }
  harvestCrop(placedID) {
    const r = this.attempt(() => this.game.harvestCrop(placedID, this.game.now()));
    if (r) { this.present(r); this.changed(); }
  }
  removeLandscape(placedID) {
    const r = this.attempt(() => this.game.removeLandscape(placedID, this.game.now()));
    if (r) { this.ui.sheet = null; this.ui.close(); this.present(r); this.changed(); }
  }

  beginMode(mode) { this.ui.sheet = null; this.ui.close(); this.ui.selectedTile = null; this.ui.mode = mode; this.changed(false); }
  beginDecor(id) { this.beginMode({ type: 'decor', decorID: id }); }
  beginDecorMove(placedID) { this.beginMode({ type: 'decorMove', placedID }); }

  openTin(answers, forceSchool = null) {
    const r = this.attempt(() => this.game.openTin(answers, this.game.now(), forceSchool));
    if (r) this.scheduleSave();
    return r;
  }

  deliverRequest(id) {
    const g = this.game;
    const first = !Object.keys(g.state.offerings.delivered).length;
    const r = this.attempt(() => g.deliver(id, g.now()));
    if (!r) return;
    const req = g.requestDef(id);
    const what = r.type === 'coins' ? `${r.count} coins` : r.type === 'cosmetic' ? `${g.decorDef(r.id)?.name || r.id} (in your Bag, under Decor)`
      : r.type === 'item' ? `${(r.count || 1) > 1 ? r.count + ' × ' : ''}${this.content.items[r.id]?.name || r.id}`
        : r.type === 'unlock' && r.id === 'expansion' ? 'more room: the treeline stepped back' : r.id;
    const sprite = r.type === 'cosmetic' ? g.decorDef(r.id)?.sprite : r.type === 'item' ? this.content.items[r.id]?.sprite : 'ui.icon.store';
    this.ui.toast(req.kind === 'shop' ? `${what.charAt(0).toUpperCase() + what.slice(1)}.` : `${req.name}: done! You got ${what}.`, sprite);
    if (first && req.kind === 'commission') this.ui.celebrate('Your first trade', this.ui.story('messages.firstDelivery'));
    this.changed();
  }

  /** Room to grow toward one side (the Store's Room to grow tab). */
  expandToward(id, side) {
    const g = this.game;
    const r = this.attempt(() => g.deliver(id, g.now(), { side }));
    if (!r) return;
    this.ui.sheet = null; this.ui.close();
    this.changed();
  }

  recolorDecor(placedID) { if (this.attempt(() => this.game.recolorDecor(placedID))) this.changed(); }
  removeDecor(placedID) {
    if (this.attempt(() => { this.game.removeDecor(placedID); return true; })) { this.ui.sheet = null; this.ui.close(); this.ui.toast('Put away in your Bag.'); this.changed(); }
  }
  renameForest(name) { this.game.renameForest(name); this.changed(); }

  /** Drop the chosen handful into the wishing well. */
  wish(pick) {
    const g = this.game, r = this.attempt(() => g.wish(pick, g.now()));
    if (!r) return;
    this.ui.wishCard(r);
    this.changed();
  }

  /** Leave something on the Stump, or take it back before nightfall. */
  offer(itemID) {
    const g = this.game, tr = this.attempt(() => g.offer(itemID, g.now()));
    if (!tr) return;
    this.ui.toast(this.ui.story('visitors.stumpWaiting'), this.content.items[itemID]?.sprite);
    this.changed();
  }
  takeBackOffering() {
    const r = this.attempt(() => this.game.takeBackOffering(this.game.now()));
    if (r) { this.present(r); this.changed(); }
  }

  // ---------------------------------------------------------------- developer mode

  newDevForest() {
    const g = Game.newGarden(this.content, Date.now());
    g.state.dev = { createdFrom: 'blank' };
    return g;
  }

  /** Switch the running game to another garden (keeps the view; clears selections). */
  swapGame(game) {
    this.game = game;
    this.game.advance(this.game.now());
    Object.assign(this.ui, { mode: null, selectedTile: null, sheet: null });
    this.ui.close();
    this.speed = this.loadSpeed();
    this.view.k = 0;
    this.view.fit();
    this.changed();
  }

  /** Enter developer mode: the real garden is saved (and a backup kept), then a separate test garden is used. */
  enterDevMode(from = 'resume') {
    if (this.devMode) return;
    this.save();
    const real = store.get(SAVE_KEY);
    if (real) store.set(SAVE_KEY + '.backup', real);
    this.devMode = true;
    store.set(DEV_MODE_KEY, '1');
    let game = null;
    if (from === 'copy' && real) {
      const s = JSON.parse(real);
      s.dev = { createdFrom: 'copy' };
      game = Game.fromSave(this.content, s, Date.now()).game;
    } else if (from === 'resume' && store.get(DEV_SAVE_KEY)) {
      game = this.loadGame(Date.now());
    }
    this.swapGame(game || this.newDevForest());
    this.save();
    this.ui.toast('Developer mode: this is a test garden. Your real garden is saved separately.');
  }

  exitDevMode() {
    if (!this.devMode) return;
    this.save();
    this.devMode = false;
    store.del(DEV_MODE_KEY);
    this.swapGame(this.loadGame(Date.now()));
    this.ui.toast('Back in your garden.');
  }

  resetDevForest(from = 'blank') {
    if (!this.devMode) return;
    let game;
    const real = store.get(SAVE_KEY);
    if (from === 'copy' && real) { const s = JSON.parse(real); s.dev = { createdFrom: 'copy' }; game = Game.fromSave(this.content, s, Date.now()).game; } else game = this.newDevForest();
    this.swapGame(game);
    this.save();
    this.ui.toast(from === 'copy' ? 'Test garden is now a copy of your garden.' : 'A blank test garden.');
  }

  devSetups() { try { return JSON.parse(store.get(DEV_SETUPS_KEY) || '{}'); } catch (_) { return {}; } }
  saveDevSetup(name) {
    if (!this.devMode || !name) return;
    const all = this.devSetups();
    all[name] = { savedAt: Date.now(), state: this.game.toJSON() };
    if (store.set(DEV_SETUPS_KEY, JSON.stringify(all))) this.ui.toast(`Saved setup “${name}”.`);
  }
  loadDevSetup(name) {
    const set = this.devSetups()[name];
    if (!this.devMode || !set) return;
    const s = JSON.parse(JSON.stringify(set.state));
    s.dev = s.dev || { createdFrom: 'setup' };
    this.swapGame(Game.fromSave(this.content, s, Date.now()).game);
    this.save();
    this.ui.toast(`Loaded setup “${name}”.`);
  }
  deleteDevSetup(name) { const all = this.devSetups(); delete all[name]; store.set(DEV_SETUPS_KEY, JSON.stringify(all)); }

  /** Run a developer action on the test garden, then refresh. */
  dev(fn, message) {
    if (!this.devMode) return;
    try {
      const r = fn(this.game, this.game.now());
      if (message) this.ui.toast(typeof message === 'function' ? message(r) : message);
    } catch (e) {
      if (e instanceof GameError) this.ui.toast(e.message); else throw e;
    }
    this.changed();
  }

  get speedKey() { return this.devMode ? 'undergrowth.speed.dev' : 'undergrowth.speed'; }
  get speeds() { return this.content.tuning.visuals.debugSpeeds || [1, 60, 600, 3600]; }
  loadSpeed() {
    if (!this.content.tuning.debugTools) return 1;
    const v = Number(store.get(this.speedKey)); return this.speeds.includes(v) ? v : 1;
  }
  setSpeed(v) {
    this.speed = v;
    store.set(this.speedKey, String(v));
    this.ui.toast(v === 1 ? 'Time runs normally.' : `Time ×${v}: 1 second = ${speedText(v)}.`);
    this.changed(false);
  }
  cycleSpeed() { const list = this.speeds; this.setSpeed(list[(list.indexOf(this.speed) + 1) % list.length]); }

  debugSkip(hours) {
    this.game.debugSkip(hours * 3600);
    this.view.lightAt = 0;
    this.game.advance(this.game.now());
    this.ui.toast(`Skipped ${hours} hour${hours === 1 ? '' : 's'}.`);
    this.changed();
  }

  /** Developer: as if the player closed the game for `hours` and came back now (counts as real time away). */
  debugReturn(hours) {
    const g = this.game;
    g.debugSkip(hours * 3600);
    this.view.lightAt = 0;
    g.advance(g.now());
    this.changed();
    this.returned(hours);
  }

  debugGive(itemID, count) {
    this.game.debugGrant(itemID, count);
    this.ui.toast(`+${count} ${this.content.items[itemID]?.name || itemID}`);
    this.changed();
  }

  resetForest() {
    if (this.devMode) { this.resetDevForest('blank'); return; }
    this.swapGame(Game.newGarden(this.content, Date.now()));
    this.save();
    this.ui.toast('A fresh garden.');
  }
}

function speedText(v) {
  if (v >= 3600) return `${v / 3600} hour${v === 3600 ? '' : 's'}`;
  if (v >= 60) return `${v / 60} minute${v === 60 ? '' : 's'}`;
  return `${v} seconds`;
}

const app = new App();
window.undergrowth = app; // handy for debugging in the console
app.boot().catch((e) => {
  console.error(e);
  document.getElementById('ui').innerHTML = `<div class="card error"><b>Couldn't load the garden</b><p>${String(e.message || e)}</p></div>`;
});
