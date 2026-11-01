// Undergrowth web prototype — boot, clock, saving, and player actions.
import { Content, Game, GameError, SAVE_VERSION } from './core.js';
import { SpriteRegistry } from './sprites.js';
import { ForestView } from './render.js';
import { UI } from './ui.js';

const SAVE_KEY = 'undergrowth.forest.v1';
// Developer mode plays a separate test forest under its own key; the real save is never written while it's on.
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

    const real = Date.now();
    // Developer mode: ?dev=1 turns it on, ?dev=0 off (or use the Debug menu). It sticks until turned off.
    const q = new URLSearchParams(location.search).get('dev');
    if (q === '1' && this.content.tuning.debugTools) store.set(DEV_MODE_KEY, '1');
    if (q === '0') store.del(DEV_MODE_KEY);
    this.devMode = !!this.content.tuning.debugTools && store.get(DEV_MODE_KEY) === '1';
    const saved = this.load();
    this.game = saved ? new Game(this.content, saved) : (this.devMode ? this.newDevForest(real) : Game.newForest(this.content, real));
    const report = this.game.advance(this.game.now(real));

    this.speed = this.loadSpeed();
    this.view = new ForestView(document.getElementById('forest'), this);
    this.view.sync();
    this.ui.render();
    if (saved && report.spawned > 0 && report.ticks > 2) {
      this.ui.toast(`While you were away, ${report.spawned} new thing${report.spawned === 1 ? '' : 's'} appeared.`);
    }
    if (this.replanted) this.ui.toast('The forest has been replanted for the new spawn table. Creatures now hide in mushrooms, seeds and geodes.');
    else if (!saved && !this.game.inTutorial) this.ui.toast(this.ui.story('messages.welcome'));
    this.save();

    // Clock: every second, apply the debug time speed; refresh the forest on its normal cadence
    // (or every second while time is sped up).
    this.lastReal = Date.now();
    let sinceRefresh = 0;
    const refresh = Math.max(1, this.content.tuning.visuals.refreshSeconds);
    setInterval(() => {
      const real = Date.now();
      const dt = real - this.lastReal;
      this.lastReal = real;
      if (document.hidden) return;
      if (this.speed > 1) this.game.state.debugTimeOffset += dt * (this.speed - 1);
      sinceRefresh += dt / 1000;
      // Refresh every second while sped up or while a creature is fast-ramping (tutorial), so
      // the land visibly changes; otherwise on the normal cadence.
      const fast = this.game.state.placements.some((p) => p.removedAt == null && p.rampSeconds && p.rampSeconds < 600 && this.game.level(p, this.game.now()) < 1);
      const every = fast ? ((this.content.tuning.tutorial && this.content.tuning.tutorial.refreshSecondsWhileFast) || 1) : refresh;
      if (this.speed > 1 || sinceRefresh >= every) { sinceRefresh = 0; this.tick(); }
    }, 1000);
    document.addEventListener('visibilitychange', () => {
      this.lastReal = Date.now();
      if (this.view) this.view.lightAt = 0;   // re-read the clock for lighting on return
      if (document.hidden) { this.save(); return; }
      const before = this.game.state.lastUpdated;
      const r = this.game.advance(this.game.now());
      if (r.spawned > 0 && this.game.now() - before > 600000) {
        this.ui.toast(`While you were away, ${r.spawned} new thing${r.spawned === 1 ? '' : 's'} appeared.`);
      }
      this.changed();
    });
    window.addEventListener('pagehide', () => this.save());

    let lastFrame = 0;
    const loop = (t) => {
      if (t - lastFrame > 33) { lastFrame = t; this.view.draw(t); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- state

  tick() {
    this.game.advance(this.game.now());
    this.view.sync();
    this.ui.render(false);
    this.processEvents();
  }

  /** Shows one-shot game events: blend, expansion, tasks, hints. */
  processEvents() {
    const events = this.game.takeEvents();
    if (!events.length) return;
    const ui = this.ui;
    const cfg = this.content.tuning;
    for (const e of events) {
      if (e.type === 'interaction') {
        this.view.playInteraction(e);
        const name = (pid) => { const pl = this.game.state.placements.find((x) => x.id === pid); const c = pl && this.game.creature(pl.creatureID); return c ? this.displayName(c) : 'Two creatures'; };
        const it = this.content.items[e.itemID];
        ui.toast(e.kind === 'seed' ? `${name(e.a)} and ${name(e.b)} planted a seed together.` : `${name(e.a)} and ${name(e.b)} dug up a ${it ? it.name : 'geode'}!`, it ? it.sprite : null);
      } else if (e.type === 'terrainDiscovered') {
        const t = (this.content.terrain || []).find((x) => x.id === e.id);
        if (t) ui.toast(`New terrain in your Field Guide: ${t.name}.`);
      } else if (e.type === 'blend') {
        this.view.highlight(e.tiles, (cfg.blend && cfg.blend.highlightSeconds) || 5);
        ui.celebrate(ui.story('messages.blendTitle'), ui.story('messages.blend'));
      } else if (e.type === 'expansion') {
        this.view.highlight(e.tiles, 4, '170,255,150');
        ui.toast(ui.story('messages.expansion'));
      } else if (e.type === 'taskDone') {
        ui.toast(ui.story('messages.taskDone', { task: e.task.text }));
      } else if (e.type === 'tasksIntro') {
        ui.toast(ui.story('messages.tasksIntro'));
      } else if (e.type === 'uncommonHint') {
        this.view.highlight([e.tile], 6, '200,170,255');
        ui.toast(ui.story('messages.uncommonHint'));
      }
    }
    ui.render(false);
  }

  /** Call after any change. `persist=false` for pure UI changes. */
  changed(persist = true) {
    this.game.checkTasks();
    this.view.sync();
    this.ui.render();
    this.processEvents();
    if (persist) this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }

  get saveKey() { return this.devMode ? DEV_SAVE_KEY : SAVE_KEY; }

  save() {
    // Belt and braces: a test forest (state.dev) can never be written over the real save.
    if (!this.devMode && this.game.state.dev) { console.warn('Refusing to save a test forest as the real one'); return; }
    store.set(this.saveKey, JSON.stringify(this.game.toJSON()));
  }

  load() {
    const SAVE_KEY = this.saveKey;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s.version !== 'number' || s.version > SAVE_VERSION) return null;
      // v1 forests used creatures/items that no longer exist; v2 migrates in Game.migrate().
      if (s.version < 2) { this.replanted = true; return null; }
      return s;
    } catch (e) {
      console.warn('Could not read save; starting fresh', e);
      try { localStorage.setItem(SAVE_KEY + '.corrupt', localStorage.getItem(SAVE_KEY) || ''); } catch (_) { /* ignore */ }
      return null;
    }
  }

  // ---------------------------------------------------------------- helpers

  displayName(c) { return c.nickname || this.content.creatures[c.typeID]?.name || c.typeID; }

  artForType(def, glimmer) {
    if (glimmer) {
      if (def.glimmerSprite) return { sprite: def.glimmerSprite, variant: null };
      return { sprite: def.sprite, variant: def.glimmerPaletteSwap ? { swap: def.glimmerPaletteSwap } : null };
    }
    return { sprite: def.sprite, variant: null };
  }

  art(c) {
    const def = this.content.creatures[c.typeID];
    return def ? this.artForType(def, c.isGlimmer) : { sprite: '__missing', variant: null };
  }

  attempt(fn) {
    try { return fn(); } catch (e) {
      if (e instanceof GameError) { this.ui.toast(e.message); return null; }
      throw e;
    }
  }

  present(results, source) {
    const lines = [];
    let sprite = null;
    for (const r of results) {
      if (r.item) {
        const def = this.content.items[r.item];
        sprite = sprite || def?.sprite;
        lines.push(`+${r.count} ${def ? def.name : r.item}${r.isNew ? ' · New!' : ''}`);
      } else if (r.creature) {
        this.ui.showReveal(r.creature, r.isNew, source);
      }
    }
    if (lines.length) this.ui.toast(lines.join('   '), sprite);
    // The first egg ever: explain nesting once.
    const egg = results.find((r) => r.item && this.content.items[r.item]?.egg);
    if (egg && !this.game.state.milestones.firstEgg) {
      this.game.state.milestones.firstEgg = true;
      this.ui.celebrate(this.ui.story('messages.firstEggTitle'), this.ui.story('messages.firstEgg'));
    }
  }

  /**
   * Collect All: picks up every find in the clearing at once, including ones buried (dug up) and
   * hidden in tall grass. Items are summed into one toast; creatures found are shown one after another.
   */
  collectAll() {
    const g = this.game, now = g.now();
    const spawns = [...g.state.spawns];
    if (!spawns.length) return;
    const counts = new Map(), creatures = [];
    let n = 0;
    for (const sp of spawns) {
      if (!g.state.spawns.includes(sp)) continue;
      const view = g.spawnView(sp, now);
      const results = this.attempt(() => g.collect(sp.id, now));
      if (!results) continue;
      n++;
      if (view === 'buried') this.view.dustAt(sp.tile);
      const name = this.content.items[sp.itemID]?.name || 'something';
      for (const r of results) {
        if (r.item) counts.set(r.item, (counts.get(r.item) || 0) + r.count);
        else if (r.creature) creatures.push([r, view === 'buried' ? `a ${name}, dug up from the earth` : `a ${name}`]);
      }
    }
    const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const names = list.slice(0, 4).map(([id, c]) => `${c} ${this.content.items[id]?.name || id}`);
    if (list.length > 4) names.push(`${list.length - 4} more`);
    this.ui.toast(`Collected ${n} find${n === 1 ? '' : 's'}: ${names.join(', ')}.`, list.length ? this.content.items[list[0][0]]?.sprite : null);
    for (const [r, source] of creatures) this.ui.showReveal(r.creature, r.isNew, source);
    this.changed();
  }

  // ---------------------------------------------------------------- actions

  handleTap(tile) {
    const g = this.game, ui = this.ui, now = g.now();
    if (!g.inBounds(tile)) return;
    if (ui.spawnInspector && !ui.mode) {
      // Debug: inspect the spawn maths for this tile instead of interacting with it.
      ui.selectedTile = tile;
      ui.open('inspect', tile);
      this.changed(false);
      return;
    }
    if (ui.mode && ui.mode.type === 'devPlace') {
      // Developer: drop a creature of any species here; stays in this mode for quick combinations.
      const m = ui.mode;
      this.dev((gm, t) => gm.devPlace(m.typeID, tile, t, { full: m.full, glimmer: m.glimmer }),
        () => `Placed ${this.content.creatures[m.typeID]?.name || m.typeID}${m.full ? ' at full strength' : ''}.`);
      return;
    }
    if (ui.mode && ui.mode.type === 'place') {
      const ok = this.attempt(() => { g.place(ui.mode.creatureID, tile, now); return true; });
      if (ok) {
        const c = g.creature(ui.mode.creatureID);
        ui.mode = null;
        ui.selectedCreatureID = null;
        const p = g.activePlacement(c.id);
        const secs = (p && p.rampSeconds) || this.content.tuning.rampSecondsToFull;
        const when = secs < 3600 ? 'over the next minute' : `over about ${Math.round(secs / 3600)} hours`;
        this.ui.toast(`${this.displayName(c)} settles in. Its influence will grow ${when}.`, this.art(c).sprite);
        this.changed();
      }
      return;
    }
    if (ui.mode && ui.mode.type === 'use') {
      const item = ui.mode.itemID;
      const msg = this.attempt(() => g.use(item, tile, now));
      if (msg) {
        if (!(g.state.inventory[item] > 0)) ui.mode = null;
        ui.selectedTile = tile;
        this.ui.toast(msg, this.content.items[item]?.sprite);
        this.changed();
      }
      return;
    }
    if (ui.mode && ui.mode.type === 'nest') {
      // First tap: preview what would hatch there. "Nest it here" confirms.
      if (!g.isFree(tile) || !g.inClearing(tile)) { this.ui.toast(g.inClearing(tile) ? 'Something is already there.' : "That's outside the clearing."); return; }
      ui.mode = { ...ui.mode, tile };
      this.changed(false);
      return;
    }
    if (ui.mode && ui.mode.type === 'decor') {
      const id = ui.mode.decorID;
      const ok = this.attempt(() => g.placeDecor(id, tile));
      if (ok) {
        if (!(g.state.decor.owned[id] > 0)) ui.mode = null;
        this.ui.toast(`${g.decorDef(id)?.name || 'Decoration'} placed. Tap it to move or recolour it.`, g.decorDef(id)?.sprite);
        this.changed();
      }
      return;
    }
    if (ui.mode && ui.mode.type === 'decorMove') {
      const ok = this.attempt(() => g.moveDecor(ui.mode.placedID, tile));
      if (ok) { ui.mode = null; this.changed(); }
      return;
    }
    if (ui.mode && ui.mode.type === 'trowel') {
      const id = ui.mode.creatureID;
      const ok = this.attempt(() => g.moveCreature(id, tile, now));
      if (ok) {
        ui.mode = null;
        const c = g.creature(id);
        this.ui.toast(`${this.displayName(c)} moved, influence and all.`, this.art(c).sprite);
        this.changed();
      }
      return;
    }
    if (ui.mode && ui.mode.type === 'plant') {
      const item = ui.mode.itemID;
      const ok = this.attempt(() => { g.plantSeed(item, tile, now); return true; });
      if (ok) {
        if (!(g.state.inventory[item] > 0)) ui.mode = null;
        this.ui.toast('Planted. Check back in a little while.', this.content.items[item]?.growthSprites?.[0]);
        this.changed();
      }
      return;
    }
    const landmark = g.landmarkAt(tile);
    if (landmark) {
      const def = (this.content.landmarks || []).find((l) => l.id === landmark.id);
      // The Old Log is the trading place: its Offerings board (requests, compost heap).
      if (landmark.id === 'landmark.old-log' && (this.content.requests || []).length) { ui.selectedTile = null; ui.open('offerings'); this.changed(false); return; }
      if (def) ui.open('entry', { name: def.name, sprite: def.sprite, variant: null, text: this.content.story?.guide?.landmarks?.[def.id] });
      return;
    }
    const nest = g.nestAt(tile);
    if (nest) { ui.selectedTile = null; ui.open('nest', nest.id); this.changed(false); return; }
    const decor = g.decorAt(tile);
    if (decor) { ui.selectedTile = null; ui.open('decor', decor.id); this.changed(false); return; }
    const p = g.creatureAt(tile);
    if (p) {
      ui.selectedTile = null;
      ui.selectedCreatureID = p.creatureID;
      ui.open('creature', p.creatureID);
      this.changed(false);
      return;
    }
    const visitor = g.visitorAt(tile);
    if (visitor) {
      const results = this.attempt(() => g.befriend(visitor.id, now));
      if (results) { this.present(results, 'the wild (it wandered in on its own)'); this.changed(); }
      return;
    }
    const spawn = g.spawnAt(tile);
    if (spawn) {
      const name = this.content.items[spawn.itemID]?.name || 'something';
      const view = g.spawnView(spawn, now);
      if (view === 'hidden') {
        // Tall grass (high Verdure): the first tap parts the grass and shows what's there.
        this.attempt(() => g.revealSpawn(spawn.id));
        this.ui.toast(`Something was hiding in the tall grass: ${name}.`, this.content.items[spawn.itemID]?.sprite);
        this.changed();
        return;
      }
      const results = this.attempt(() => g.collect(spawn.id, now));
      if (results) {
        if (view === 'buried') this.view.dustAt(spawn.tile);
        this.present(results, view === 'buried' ? `a ${name}, dug up from the earth` : `a ${name}`);
        this.changed();
      }
      return;
    }
    const seed = g.seedAt(tile);
    if (seed) {
      const prog = g.seedProgress(seed, now);
      if (prog < 1) {
        const remaining = (seed.plantedAt + seed.growSeconds * 1000 - now) / 1000;
        const mins = remaining / 60;
        this.ui.toast(`Growing… ${Math.floor(prog * 100)}% (about ${mins < 60 ? Math.ceil(mins) + 'm' : Math.floor(mins / 60) + 'h ' + Math.round(mins % 60) + 'm'} left)`);
        return;
      }
      const results = this.attempt(() => g.harvestSeed(seed.id, now));
      if (results) { this.present(results, 'a sprouting seed'); this.changed(); }
      return;
    }
    ui.selectedCreatureID = null;
    ui.selectedTile = ui.selectedTile && ui.selectedTile.x === tile.x && ui.selectedTile.y === tile.y ? null : tile;
    this.changed(false);
  }

  beginPlacing(creatureID) {
    this.ui.sheet = null;
    this.ui.close();
    this.ui.selectedTile = null;
    this.ui.selectedCreatureID = null;
    this.ui.mode = { type: 'place', creatureID };
    this.changed(false);
  }

  // ---- offerings
  deliverRequest(id) {
    const g = this.game;
    const first = !Object.keys(g.state.offerings.delivered).length;
    const r = this.attempt(() => g.deliver(id, g.now()));
    if (!r) return;
    const req = g.requestDef(id);
    const what = r.type === 'cosmetic' ? `${g.decorDef(r.id)?.name || r.id} (in your Bag, under Decor)`
      : r.type === 'compost' ? `${r.count} compost`
        : r.type === 'egg' ? (this.content.items[r.id]?.name || r.id)
          : { trowel: 'the gardener\'s trowel: open a placed creature to move it', slot: 'another creature slot', nest: 'another nest', expansion: 'more room: the treeline stepped back' }[r.id] || r.id;
    this.ui.toast(`${req.name}: delivered! You got ${what}.`, r.type === 'cosmetic' ? g.decorDef(r.id)?.sprite : 'ui.icon.board');
    if (first) this.ui.celebrate('The old log creaks', this.ui.story('messages.firstDelivery'));
    this.changed();
  }

  rerollVisitor(requestID) {
    const g = this.game;
    const next = this.attempt(() => g.rerollVisitor(requestID, g.now()));
    if (next) { { const nm = this.content.creatures[next.wandererID]?.name || 'new visitor'; this.ui.toast(`${/^[aeiou]/i.test(nm) ? 'An' : 'A'} ${nm} wanders over instead.`); } this.changed(); }
  }

    compostItem(itemID) {
    const n = this.attempt(() => this.game.compost(itemID, 1));
    if (n) { this.ui.toast(`+${n} compost (${this.game.state.compost} in all).`, this.content.items[itemID]?.sprite); this.changed(); }
  }

  buyDecor(id) {
    const ok = this.attempt(() => { this.game.buyDecor(id); return true; });
    if (ok) { this.ui.toast(`${this.game.decorDef(id)?.name} is in your Bag, under Decor.`, this.game.decorDef(id)?.sprite); this.changed(); }
  }

  beginNest(eggID) { this.ui.sheet = null; this.ui.close(); this.ui.selectedTile = null; this.ui.mode = { type: 'nest', eggID }; this.changed(false); }

  nestHere() {
    const g = this.game, m = this.ui.mode;
    if (!m || m.type !== 'nest' || !m.tile) return;
    const n = this.attempt(() => g.nestEgg(m.eggID, m.tile, g.now()));
    if (!n) return;
    this.ui.mode = null;
    this.ui.toast(`Nested. It hatches in about ${Math.round(n.hatchSeconds / 3600)} hours. Tap the nest to see what it could be.`, this.content.items[m.eggID]?.sprite);
    this.changed();
  }

  hatchNest(nestID) {
    const g = this.game;
    const n = g.state.nests.find((x) => x.id === nestID);
    if (!n) return;
    const tile = n.tile;
    const terrains = this.ui.terrainsOnTile(tile, g.tileStats(tile, g.now()));
    const first = !g.counterValue('hatch');
    const results = this.attempt(() => g.hatch(nestID, g.now()));
    if (!results) return;
    this.ui.sheet = null; this.ui.close();
    this.view.dustAt(tile);
    this.present(results, `an egg nested on ${terrains.length ? terrains[0].name.toLowerCase() : 'blank ground'}`);
    if (first) this.ui.toast(this.ui.story('messages.firstHatch'));
    this.changed();
  }

  shardNest(nestID) {
    const ok = this.attempt(() => { this.game.shardNest(nestID); return true; });
    if (ok) { this.ui.toast('The shard settles into the nest. A Glimmer will hatch.'); this.changed(); }
  }

  beginDecor(id) { this.ui.sheet = null; this.ui.close(); this.ui.selectedTile = null; this.ui.mode = { type: 'decor', decorID: id }; this.changed(false); }
  beginDecorMove(placedID) { this.ui.sheet = null; this.ui.close(); this.ui.selectedTile = null; this.ui.mode = { type: 'decorMove', placedID }; this.changed(false); }
  beginTrowel(creatureID) { this.ui.sheet = null; this.ui.close(); this.ui.selectedTile = null; this.ui.mode = { type: 'trowel', creatureID }; this.changed(false); }

  recolorDecor(placedID) {
    const ok = this.attempt(() => { this.game.recolorDecor(placedID); return true; });
    if (ok) this.changed();
  }

  removeDecor(placedID) {
    const ok = this.attempt(() => { this.game.removeDecor(placedID); return true; });
    if (ok) { this.ui.sheet = null; this.ui.close(); this.ui.toast('Put away in your Bag.'); this.changed(); }
  }

  beginUsing(itemID) {
    const def = this.content.items[itemID];
    if (def?.use?.type !== 'soilBoost') {
      const msg = this.attempt(() => this.game.use(itemID, null, this.game.now()));
      if (msg) { this.ui.toast(msg, def?.sprite); this.changed(); }
      return;
    }
    this.ui.sheet = null;
    this.ui.close();
    this.ui.selectedCreatureID = null;
    this.ui.mode = { type: 'use', itemID };
    this.changed(false);
  }

  beginPlanting(itemID) {
    this.ui.sheet = null;
    this.ui.close();
    this.ui.selectedTile = null;
    this.ui.mode = { type: 'plant', itemID };
    this.changed(false);
  }

  recall(creatureID) {
    const c = this.game.creature(creatureID);
    if (this.attempt(() => { this.game.recall(creatureID, this.game.now()); return true; })) {
      this.ui.selectedCreatureID = null;
      this.ui.toast(`${this.displayName(c)} heads home to rest. The land will slowly settle.`);
      this.changed();
    }
  }

  claimTask(id) {
    const results = this.attempt(() => this.game.claimTask(id, this.game.now()));
    if (results) { this.present(results, 'a task reward'); this.changed(); }
  }

  renameForest(name) { this.game.renameForest(name); this.changed(); }

  crack(itemID, opts = {}) {
    const r = this.attempt(() => this.game.crack(itemID, this.game.now(), opts)) || [];
    this.changed();
    return r;
  }

  /** Crack up to five at once; rewards are granted and saved before anything is shown. */
  crackMany(itemID, count) {
    const r = this.attempt(() => this.game.crackMany(itemID, count, this.game.now())) || [];
    this.changed();
    this.save();
    return r;
  }

  // ---------------------------------------------------------------- debug

  get speedKey() { return this.devMode ? 'undergrowth.speed.dev' : 'undergrowth.speed'; }

  // ---------------------------------------------------------------- developer mode

  /** A blank test forest: tutorial done, marked as a test forest. */
  newDevForest(real) {
    const g = Game.newForest(this.content, real);
    g.finishTutorial();
    g.state.dev = { createdFrom: 'blank' };
    return g;
  }

  /** Switch the running game to another forest (keeps the view; clears selections). */
  swapGame(game) {
    this.game = game;
    this.game.advance(this.game.now());
    Object.assign(this.ui, { mode: null, selectedTile: null, selectedCreatureID: null, sheet: null });
    this.ui.close();
    this.speed = this.loadSpeed();
    this.view.k = 0;
    this.view.fit();
    this.changed();
  }

  /**
   * Enter developer mode. The real forest is saved (and a backup copy kept) first, then a separate
   * test forest is used: a blank one, a copy of the real forest, or the last test forest.
   */
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
      game = new Game(this.content, s);
    } else if (from === 'resume') {
      const s = this.load();
      game = s ? new Game(this.content, s) : null;
    }
    this.swapGame(game || this.newDevForest(Date.now()));
    this.save();
    this.ui.toast('Developer mode: this is a test forest. Your real forest is saved separately.');
  }

  /** Leave developer mode: save the test forest, reload the real one exactly as it was. */
  exitDevMode() {
    if (!this.devMode) return;
    this.save();
    this.devMode = false;
    store.del(DEV_MODE_KEY);
    Object.assign(this.ui, { spawnInspector: false, spawnHeatmap: false, statOverlay: false });   // raw views are dev-only
    const s = this.load();
    this.swapGame(s ? new Game(this.content, s) : Game.newForest(this.content, Date.now()));
    this.ui.toast('Back in your forest.');
  }

  /** Replace the test forest (blank, or a fresh copy of the real one). */
  resetDevForest(from = 'blank') {
    if (!this.devMode) return;
    let game;
    const real = store.get(SAVE_KEY);
    if (from === 'copy' && real) { const s = JSON.parse(real); s.dev = { createdFrom: 'copy' }; game = new Game(this.content, s); }
    else game = this.newDevForest(Date.now());
    this.swapGame(game);
    this.save();
    this.ui.toast(from === 'copy' ? 'Test forest is now a copy of your forest.' : 'A blank test forest.');
  }

  // Saved test setups (whole test-forest snapshots), for flipping between garden configurations.
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
    this.swapGame(new Game(this.content, s));
    this.save();
    this.ui.toast(`Loaded setup “${name}”.`);
  }
  deleteDevSetup(name) {
    const all = this.devSetups();
    delete all[name];
    store.set(DEV_SETUPS_KEY, JSON.stringify(all));
  }

  /** Run a developer action on the test forest, then refresh. */
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

  cycleSpeed() {
    const list = this.speeds;
    this.setSpeed(list[(list.indexOf(this.speed) + 1) % list.length]);
  }

  debugSkip(hours) {
    this.game.debugSkip(hours * 3600);
    this.view.lightAt = 0;
    const r = this.game.advance(this.game.now());
    this.ui.toast(`Skipped ${hours} hour${hours === 1 ? '' : 's'}. ${r.spawned} new spawn${r.spawned === 1 ? '' : 's'}.`);
    this.changed();
  }

  debugGive(itemID, count) {
    this.game.debugGrant(itemID, count);
    this.ui.toast(`+${count} ${this.content.items[itemID]?.name || itemID}`);
    this.changed();
  }

  debugGiveCreature(typeID, glimmer = true) {
    this.ui.sheet = null;
    this.ui.close();
    this.present(this.game.debugGrantCreature(typeID, glimmer, this.game.now()), 'the debug menu');
    this.changed();
  }

  resetForest() {
    if (this.devMode) { this.resetDevForest('blank'); return; }
    this.game = Game.newForest(this.content, Date.now());
    this.game.advance(this.game.now());
    Object.assign(this.ui, { mode: null, selectedTile: null, selectedCreatureID: null, sheet: null });
    this.ui.close();
    this.save();
    this.changed();
    this.ui.toast('A fresh forest.');
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
  document.getElementById('ui').innerHTML = `<div class="card error"><b>Couldn't load the forest</b><p>${String(e.message || e)}</p></div>`;
});
