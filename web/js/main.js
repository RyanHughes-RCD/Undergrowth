// Undergrowth web game — boot, clock, saving, and player actions.
import { Content, Game, GameError, SAVE_VERSION, archiveKey } from './core.js';
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

  /** Called after the game opens or comes back to the front. Later systems hook the morning card here. */
  returned() {}

  // ---------------------------------------------------------------- state

  tick() {
    this.game.advance(this.game.now());
    this.view.sync();
    this.ui.render(false);
    this.processEvents();
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
    else if (e.type === 'expansion') { this.view.highlight(e.tiles, 4, '170,255,150'); ui.toast(ui.story('messages.expansion')); }
  }

  /** Call after any change. `persist=false` for pure UI changes. */
  changed(persist = true) {
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
    };
  }

  /** Taps on things in the garden: { kind: handler(tile) } by what was hit. Later systems add theirs. */
  tapThing(tile) {
    const g = this.game, ui = this.ui, now = g.now();
    const landmark = g.landmarkAt(tile);
    if (landmark) { ui.selectedTile = null; ui.open('offerings'); this.changed(false); return true; }
    if (g.tinAt(tile)) { ui.selectedTile = null; ui.openOpening(); return true; }
    const find = g.forageAt(tile);
    if (find) {
      const r = this.attempt(() => g.pickForage(find.id, now));
      if (r) { this.present(r); this.changed(); }
      return true;
    }
    const decor = g.decorAt(tile);
    if (decor) { ui.selectedTile = null; ui.open('decor', decor.id); this.changed(false); return true; }
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
    const what = r.type === 'cosmetic' ? `${g.decorDef(r.id)?.name || r.id} (in your Bag, under Decor)`
      : r.type === 'item' ? `${(r.count || 1) > 1 ? r.count + ' × ' : ''}${this.content.items[r.id]?.name || r.id}`
        : r.type === 'unlock' && r.id === 'expansion' ? 'more room: the treeline stepped back' : r.id;
    const sprite = r.type === 'cosmetic' ? g.decorDef(r.id)?.sprite : r.type === 'item' ? this.content.items[r.id]?.sprite : 'ui.icon.store';
    this.ui.toast(`${req.name}: done! You got ${what}.`, sprite);
    if (first) this.ui.celebrate('Your first trade', this.ui.story('messages.firstDelivery'));
    this.changed();
  }

  recolorDecor(placedID) { if (this.attempt(() => this.game.recolorDecor(placedID))) this.changed(); }
  removeDecor(placedID) {
    if (this.attempt(() => { this.game.removeDecor(placedID); return true; })) { this.ui.sheet = null; this.ui.close(); this.ui.toast('Put away in your Bag.'); this.changed(); }
  }
  renameForest(name) { this.game.renameForest(name); this.changed(); }

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
