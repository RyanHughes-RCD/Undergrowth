// Undergrowth web prototype — boot, clock, saving, and player actions.
import { Content, Game, GameError, SAVE_VERSION } from './core.js';
import { SpriteRegistry } from './sprites.js';
import { ForestView } from './render.js';
import { UI } from './ui.js';

const SAVE_KEY = 'undergrowth.forest.v1';

class App {
  async boot() {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`content.json: HTTP ${res.status}`);
    const bundle = await res.json();
    this.content = new Content(bundle);
    this.sprites = new SpriteRegistry(bundle.sprites, bundle.palettes);
    this.ui = new UI(this);

    const real = Date.now();
    const saved = this.load();
    this.game = saved ? new Game(this.content, saved) : Game.newForest(this.content, real);
    const report = this.game.advance(this.game.now(real));

    this.view = new ForestView(document.getElementById('forest'), this);
    this.view.sync();
    this.ui.render();
    if (saved && report.spawned > 0 && report.ticks > 2) {
      this.ui.toast(`While you were away, ${report.spawned} new thing${report.spawned === 1 ? '' : 's'} appeared.`);
    }
    if (!saved) this.ui.toast('Welcome! Open the Burrow and place a creature to start shaping your forest.');
    this.save();

    setInterval(() => this.tick(), Math.max(1, this.content.tuning.visuals.refreshSeconds) * 1000);
    document.addEventListener('visibilitychange', () => {
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
  }

  /** Call after any change. `persist=false` for pure UI changes. */
  changed(persist = true) {
    this.view.sync();
    this.ui.render();
    if (persist) this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.game.toJSON())); } catch (e) { console.warn('Save failed', e); }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s.version !== 'number' || s.version > SAVE_VERSION) return null;
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
  }

  // ---------------------------------------------------------------- actions

  handleTap(tile) {
    const g = this.game, ui = this.ui, now = g.now();
    if (!g.inBounds(tile)) return;
    if (ui.mode && ui.mode.type === 'place') {
      const ok = this.attempt(() => { g.place(ui.mode.creatureID, tile, now); return true; });
      if (ok) {
        const c = g.creature(ui.mode.creatureID);
        ui.mode = null;
        ui.selectedCreatureID = null;
        this.ui.toast(`${this.displayName(c)} settles in. Its influence will grow over the next few hours.`, this.art(c).sprite);
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
    const p = g.creatureAt(tile);
    if (p) {
      ui.selectedTile = null;
      ui.selectedCreatureID = p.creatureID;
      ui.open('creature', p.creatureID);
      this.changed(false);
      return;
    }
    const spawn = g.spawnAt(tile);
    if (spawn) {
      const name = this.content.items[spawn.itemID]?.name || 'something';
      const results = this.attempt(() => g.collect(spawn.id, now));
      if (results) { this.present(results, `a ${name}`); this.changed(); }
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
    if (this.game.freeSlotCount === 0) { this.ui.toast('All placement slots are full.'); return; }
    this.ui.sheet = null;
    this.ui.close();
    this.ui.selectedTile = null;
    this.ui.selectedCreatureID = null;
    this.ui.mode = { type: 'place', creatureID };
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
      this.ui.toast(`${this.displayName(c)} heads back to the Burrow. The land will slowly settle.`);
      this.changed();
    }
  }

  renameForest(name) { this.game.renameForest(name); this.changed(); }

  crack(itemID) {
    const r = this.attempt(() => this.game.crack(itemID, this.game.now())) || [];
    this.changed();
    return r;
  }

  // ---------------------------------------------------------------- debug

  debugSkip(hours) {
    this.game.debugSkip(hours * 3600);
    const r = this.game.advance(this.game.now());
    this.ui.toast(`Skipped ${hours} hour${hours === 1 ? '' : 's'}. ${r.spawned} new spawn${r.spawned === 1 ? '' : 's'}.`);
    this.changed();
  }

  debugGive(itemID, count) {
    this.game.debugGrant(itemID, count);
    this.ui.toast(`+${count} ${this.content.items[itemID]?.name || itemID}`);
    this.changed();
  }

  debugGiveCreature(typeID) {
    this.ui.sheet = null;
    this.ui.close();
    this.present(this.game.debugGrantCreature(typeID, true, this.game.now()), 'the debug menu');
    this.changed();
  }

  resetForest() {
    this.game = Game.newForest(this.content, Date.now());
    this.game.advance(this.game.now());
    Object.assign(this.ui, { mode: null, selectedTile: null, selectedCreatureID: null, sheet: null });
    this.ui.close();
    this.save();
    this.changed();
    this.ui.toast('A fresh forest.');
  }
}

const app = new App();
window.undergrowth = app; // handy for debugging in the console
app.boot().catch((e) => {
  console.error(e);
  document.getElementById('ui').innerHTML = `<div class="card error"><b>Couldn't load the forest</b><p>${String(e.message || e)}</p></div>`;
});
