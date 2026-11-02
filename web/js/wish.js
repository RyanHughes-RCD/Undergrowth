// The Spirit Well's Wishing screen: a top-down view of the well, a cryptic line about what it wants,
// the player's offerable items with quantity controls, and the offering ritual (items fall into the
// water, the well answers, rewards rise). All values, odds and the current demand stay hidden.
import { h, RARITY_COLORS, ic } from './ui.js';
import { hash32 } from './core.js';

const W = 112, H = 88;               // the well canvas's pixel resolution (scaled up, crisp)
const TIER_COLORS = { common: '#cfd8c8', uncommon: '#5fd35a', rare: '#5a9cff', epic: '#c58cff', legendary: '#ffc84a' };

export class WishScreen {
  constructor(app) {
    this.app = app;
    this.sel = new Map();             // itemID → count chosen
    this.state = 'select';            // select | confirm | offering | summary
    this.el = null;
    this.raf = 0;
    this.fx = { ripples: [], sparks: [], falling: [], glow: 0, rising: null };
  }

  get game() { return this.app.game; }
  get content() { return this.app.content; }
  get sprites() { return this.app.sprites; }
  get story() { return (this.content.story || {}).wish || {}; }
  get reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } }

  open() {
    if (this.el) return;
    this.el = h('div', { id: 'wish', class: 'wish' });
    document.body.append(this.el);
    this.sel.clear();
    // A result that was committed but not seen yet (the app was closed mid-ritual): show it now.
    const p = this.game.state.wish.pending;
    this.state = p && !p.seen ? 'summary' : 'select';
    this.message = this.pickMessage();
    this.build();
    this.loop();
  }

  close() {
    if (!this.el || this.state === 'offering') return;      // the ritual finishes first (its result is already saved)
    cancelAnimationFrame(this.raf);
    this.el.remove();
    this.el = null;
    this.app.changed(false);
  }

  /** A line hinting at the half-day's demand (never naming it); varies each visit. */
  pickMessage() {
    const g = this.game, now = g.now();
    const group = g.wishDemand(now);
    this.app.scheduleSave();
    const lines = ((this.story.demand || {})[group]) || ['The water is very still.'];
    this.visits = (this.visits || 0) + 1;
    return lines[hash32(g.state.wish.demand.interval, this.visits, g.state.seed) % lines.length];
  }

  // ---------------------------------------------------------------- layout

  build() {
    const g = this.game;
    this.canvas = h('canvas', { class: 'wish-well px', width: W, height: H });
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.body = h('div', { class: 'wish-body' });
    this.foot = h('div', { class: 'wish-foot' });
    this.el.replaceChildren(
      h('div', { class: 'wish-head' }, h('b', {}, this.story.title || 'The Spirit Well'),
        h('button', { class: 'btn small', onclick: () => this.close() }, 'Done')),
      h('div', { class: 'wish-stage' }, this.canvas, this.revealEl = h('div', { class: 'wish-reveal' })),
      this.msgEl = h('p', { class: 'wish-msg' }, this.message),
      this.body, this.foot);
    this.render();
    if (this.state === 'summary') this.showSummary(g.state.wish.pending);
  }

  /** The selection list and the footer (re-rendered on every change; no layout jumps). */
  render() {
    if (!this.el) return;
    if (this.state === 'select') {
      const g = this.game;
      const inv = g.wishInventory();
      const order = { mushrooms: 0, plants: 1, gems: 2 };
      const RI = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];
      inv.sort((a, b) => (order[g.wishGroup(a.item)] - order[g.wishGroup(b.item)]) || (RI.indexOf(this.content.items[a.item].rarity) - RI.indexOf(this.content.items[b.item].rarity)) || this.content.items[a.item].name.localeCompare(this.content.items[b.item].name));
      // Drop selections the player no longer owns enough of.
      for (const [id, n] of this.sel) { const own = g.state.inventory[id] || 0; if (n > own) { if (own) this.sel.set(id, own); else this.sel.delete(id); } }
      const scroll = this.body.scrollTop;
      this.body.replaceChildren(...(inv.length ? inv.map((x) => this.row(x)) : [h('p', { class: 'sub center' }, this.story.empty || 'Nothing to offer.')]));
      this.body.scrollTop = scroll;
      const total = [...this.sel.values()].reduce((a, b) => a + b, 0);
      const kinds = [...this.sel.values()].filter(Boolean).length;
      this.foot.replaceChildren(
        h('span', { class: 'sub' }, total ? `${total} item${total > 1 ? 's' : ''}${kinds > 1 ? ` of ${kinds} kinds` : ''} chosen` : 'Choose what to offer.'),
        total ? h('button', { class: 'btn small grey', onclick: () => { this.sel.clear(); this.render(); } }, 'Clear') : null,
        h('button', { class: 'btn green', disabled: !total, onclick: () => this.offer() }, 'Make an Offering'));
    }
  }

  row(x) {
    const def = this.content.items[x.item];
    const n = this.sel.get(x.item) || 0;
    const set = (v) => { v = Math.max(0, Math.min(x.owned, v)); if (v) this.sel.set(x.item, v); else this.sel.delete(x.item); this.render(); };
    return h('div', { class: 'wish-row' + (n ? ' on' : '') },
      h('div', { class: 'thumb small' }, this.sprites.element(def.sprite, null, 2)),
      h('div', { class: 'grow' }, h('b', {}, def.name), h('div', { class: 'sub', style: `color:${RARITY_COLORS[def.rarity] || '#aaa'}` }, `You have ${x.owned}`)),
      h('div', { class: 'qty' },
        h('button', { class: 'btn small grey', disabled: !n, onclick: () => set(n - 1), 'aria-label': 'One less' }, '−'),
        h('b', { class: 'qty-n' + (n ? ' on' : '') }, String(n)),
        h('button', { class: 'btn small', disabled: n >= x.owned, onclick: () => set(n + 1), 'aria-label': 'One more' }, '+'),
        h('button', { class: 'btn small', disabled: n >= x.owned, onclick: () => set(n + 5) }, '+5'),
        h('button', { class: 'btn small', disabled: n >= x.owned, onclick: () => set(x.owned) }, 'All'),
        n ? h('button', { class: 'btn small grey', onclick: () => set(0), 'aria-label': 'Remove' }, '×') : null));
  }

  selection() { return [...this.sel.entries()].filter(([, n]) => n > 0).map(([item, count]) => ({ item, count })); }

  // ---------------------------------------------------------------- offering

  offer() {
    if (this.state !== 'select') return;
    const g = this.game, now = g.now();
    let warnings;
    try { warnings = g.wishWarnings(this.selection(), now); } catch (e) { this.app.ui.toast(e.message); this.render(); return; }
    if (warnings.length) { this.confirm(warnings); return; }
    this.commit(false);
  }

  /** Extra confirmation for valuable items or ones the Old Log still asks for (no values or odds shown). */
  confirm(warnings) {
    this.state = 'confirm';
    const names = this.selection().map((x) => `${x.count} × ${this.content.items[x.item].name}`).join(', ');
    const notes = warnings.map((w) => `${this.content.items[w.item].name}${w.reasons.includes('needed') ? ` (${this.story.neededNote || 'still needed elsewhere'})` : ' (rare)'}`).join(', ');
    this.foot.replaceChildren(h('div', { class: 'wish-confirm' },
      h('b', {}, this.story.confirmTitle || 'Offer these?'),
      h('p', { class: 'sub' }, `${this.story.confirmText || 'These will be gone for good:'} ${names}.`),
      h('p', { class: 'sub' }, `Take care with: ${notes}.`),
      h('div', { class: 'row gap end' },
        h('button', { class: 'btn grey', onclick: () => { this.state = 'select'; this.render(); } }, 'Keep them'),
        h('button', { class: 'btn orange', onclick: () => this.commit(true) }, 'Offer them'))));
  }

  /** Commits the offering (once, saved straight away), then plays the ritual from the saved result. */
  commit(confirmed) {
    const g = this.game;
    const sel = this.selection();
    let result;
    try { result = g.makeOffering(sel, g.now(), { confirmed }); } catch (e) {
      this.state = 'select'; this.render(); this.app.ui.toast(e.message);
      if (/still answering/.test(e.message) && g.state.wish.pending) this.showSummary(g.state.wish.pending);
      return;
    }
    this.state = 'offering';
    this.sel.clear();
    this.app.changed();             // saves now: the offering and its rewards are committed before anything plays
    this.foot.replaceChildren(h('span', { class: 'sub center grow' }, '…'));
    this.body.replaceChildren();
    this.play(result);
  }

  /** The ritual: items fall in (grouped), the water answers, the primary reward rises, then any bonuses. */
  async play(result) {
    const fast = this.reduced;
    const wait = (ms) => new Promise((r) => setTimeout(r, fast ? Math.min(ms, 120) : ms));
    const groups = result.offered.slice(0, 8);
    groups.forEach((x, i) => this.fx.falling.push({ sprite: this.content.items[x.item].sprite, count: x.count, start: performance.now() + (fast ? 0 : i * 320), dur: fast ? 150 : 900, x: 20 + ((i * 37) % (W - 40)), done: false }));
    await wait(groups.length * 320 + 950);
    await wait(250);
    this.fx.glow = 0.4 + 0.6 * Math.min(1, result.strength || 0.2);   // a brighter answer for a bigger offering (no numbers shown)
    for (let i = 0; i < 3; i++) this.fx.ripples.push({ t: performance.now() + i * 180, r0: 3, big: true });
    await wait(900);
    for (const [i, r] of result.rewards.entries()) {
      const d = this.rewardArt(r);
      this.fx.rising = { sprite: d.sprite, tier: r.tier, start: performance.now(), primary: !!r.primary };
      this.revealEl.replaceChildren(h('div', { class: 'wish-reveal-text' + (r.primary ? '' : ' bonus') },
        h('span', { class: 'sub' }, r.primary ? 'The well gives' : 'And something more'),
        h('b', { style: `color:${TIER_COLORS[r.tier] || '#fff'}` }, d.label)));
      await wait(r.primary ? (['rare', 'epic', 'legendary'].includes(r.tier) ? 1500 : 1000) : 800);
      if (i < result.rewards.length - 1) await wait(150);
    }
    this.fx.rising = null;
    this.fx.glow = 0;
    this.revealEl.replaceChildren();
    if (this.el) this.showSummary(result);
  }

  rewardArt(r) {
    if (r.type === 'buff') {
      const b = this.game.buffDef(r.buff) || {};
      return { sprite: b.sprite || 'ui.icon.sparkle', label: `${b.name || r.buff} (${Math.round(r.hours || b.hours || 0)}h)` };
    }
    const d = this.content.items[r.item] || {};
    return { sprite: d.sprite || 'ui.icon.sparkle', label: `${r.count > 1 ? r.count + ' × ' : ''}${d.name || r.item}` };
  }

  /** Summary: the primary reward, any bonus rewards, and buffs with how long they last. */
  showSummary(result) {
    this.state = 'summary';
    const line = (r) => {
      const d = this.rewardArt(r);
      const b = r.type === 'buff' ? this.game.buffDef(r.buff) : null;
      return h('div', { class: 'wish-row' + (r.primary ? ' primary' : '') },
        h('div', { class: 'thumb small' }, this.sprites.element(d.sprite, null, 2)),
        h('div', { class: 'grow' }, h('b', { style: `color:${TIER_COLORS[r.tier] || '#fff'}` }, d.label),
          b ? h('div', { class: 'sub' }, `${b.text}. Lasts until ${new Date(r.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`) : null,
          r.isNew ? h('div', { class: 'sub new' }, 'New!') : null));
    };
    const [first, ...bonus] = result.rewards;
    this.body.replaceChildren(...[
      h('div', { class: 'section' }, 'The well gives'), line(first),
      ...(bonus.length ? [h('div', { class: 'section' }, bonus.length > 1 ? 'And more besides' : 'And something more'), ...bonus.map(line)] : [])]);
    this.foot.replaceChildren(h('button', { class: 'btn green grow', onclick: () => this.continue(result) }, 'Return to the Well'));
  }

  continue(result) {
    this.game.acknowledgeOffering(result.id);
    this.app.changed();
    this.state = 'select';
    this.message = this.pickMessage();
    if (this.msgEl) this.msgEl.textContent = this.message;
    this.render();
  }

  // ---------------------------------------------------------------- drawing (the well from above)

  loop() {
    const tick = (ms) => { if (!this.el) return; this.draw(ms); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }

  draw(ms) {
    const c = this.ctx, t = ms / 1000, cx = W / 2, cy = H / 2;
    c.fillStyle = '#16241a'; c.fillRect(0, 0, W, H);
    // a little moss and grass around the stones
    for (let i = 0; i < 70; i++) { const hx = hash32(i, 3) % W, hy = hash32(i, 7) % H; c.fillStyle = i % 3 ? '#21361f' : '#2c4a26'; c.fillRect(hx, hy, 2, 1); }
    // water: stepped circles (pixel style), deeper toward the middle, with a slow shimmer
    const R = 22, glow = this.fx.glow * (0.8 + 0.2 * Math.sin(t * 6));
    const rings = ['#1d5e6a', '#1a5260', '#164552', '#123844', '#0e2c38'];
    for (let i = 0; i < rings.length; i++) { c.fillStyle = rings[i]; disc(c, cx, cy, R - i * 4); }
    if (glow > 0) { c.globalAlpha = Math.min(0.75, glow * 0.6); c.fillStyle = '#9ff4e8'; disc(c, cx, cy, R - 2); c.globalAlpha = 1; }
    c.globalAlpha = 0.18 + 0.08 * Math.sin(t * 1.3); c.fillStyle = '#9ff4e8'; disc(c, cx - 6, cy - 6, 5); c.globalAlpha = 1;
    // ambient ripples now and then, sparkles on the surface
    if (Math.random() < 0.012) this.fx.ripples.push({ t: ms, r0: 2, x: cx + (Math.random() * 20 - 10), y: cy + (Math.random() * 16 - 8) });
    if (Math.random() < 0.05) this.fx.sparks.push({ t: ms, x: cx + Math.random() * 30 - 15, y: cy + Math.random() * 26 - 13 });
    this.fx.ripples = this.fx.ripples.filter((r) => ms - r.t < 1600);
    for (const r of this.fx.ripples) {
      if (ms < r.t) continue;
      const k = (ms - r.t) / 1600, rad = r.r0 + k * (r.big ? 20 : 8);
      c.globalAlpha = (1 - k) * (r.big ? 0.9 : 0.5); c.strokeStyle = '#bff8f0'; c.lineWidth = 1;
      ring(c, r.x ?? cx, r.y ?? cy, rad); c.globalAlpha = 1;
    }
    this.fx.sparks = this.fx.sparks.filter((s) => ms - s.t < 700);
    for (const s of this.fx.sparks) { c.globalAlpha = 1 - (ms - s.t) / 700; c.fillStyle = '#e8fff8'; c.fillRect(Math.round(s.x), Math.round(s.y), 1, 1); c.globalAlpha = 1; }
    // the stone rim
    const rim = this.sprites.frames('wish.well-top', null)[0];
    if (rim) c.drawImage(rim.canvas, Math.round(cx - 32), Math.round(cy - 32));
    // offered items falling in: shrink and fade as they reach the water, then a splash
    for (const f of this.fx.falling) {
      if (ms < f.start || f.done) continue;
      const k = Math.min(1, (ms - f.start) / f.dur);
      const fr = this.sprites.frames(f.sprite, null)[0];
      if (k >= 1) { f.done = true; this.fx.ripples.push({ t: ms, r0: 2 }); continue; }
      const ease = k * k, sx = f.x + (cx - f.x) * ease, sy = 10 + (cy - 10) * ease, sc = 1.2 - 0.9 * ease;
      c.globalAlpha = 1 - 0.6 * ease;
      if (fr) c.drawImage(fr.canvas, Math.round(sx - fr.w * sc / 2), Math.round(sy - fr.h * sc / 2), Math.max(1, Math.round(fr.w * sc)), Math.max(1, Math.round(fr.h * sc)));
      if (f.count > 1 && k < 0.6) { c.fillStyle = '#fff'; c.font = '6px sans-serif'; c.fillText('×' + f.count, Math.round(sx + 6), Math.round(sy - 4)); }
      c.globalAlpha = 1;
    }
    this.fx.falling = this.fx.falling.filter((f) => !f.done || ms - f.start < f.dur + 50);
    // a reward rising from the water, with rays for rarer ones
    if (this.fx.rising) {
      const r = this.fx.rising, k = Math.min(1, (ms - r.start) / 600), fr = this.sprites.frames(r.sprite, null)[0];
      const rare = ['rare', 'epic', 'legendary'].includes(r.tier);
      if (rare) {
        c.globalAlpha = 0.35 * k; c.strokeStyle = TIER_COLORS[r.tier]; c.lineWidth = 1;
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + t; c.beginPath(); c.moveTo(cx, cy - 10 * k); c.lineTo(cx + Math.cos(a) * 30, cy - 10 * k + Math.sin(a) * 30); c.stroke(); }
        c.globalAlpha = 1;
      }
      if (fr) { const sc = 0.4 + 0.8 * k; c.drawImage(fr.canvas, Math.round(cx - fr.w * sc / 2), Math.round(cy - 10 * k - fr.h * sc / 2), Math.round(fr.w * sc), Math.round(fr.h * sc)); }
    }
  }
}

function disc(c, x, y, r) { c.beginPath(); c.arc(Math.round(x), Math.round(y), Math.max(0, r), 0, Math.PI * 2); c.fill(); }
function ring(c, x, y, r) { c.beginPath(); c.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, r, 0, Math.PI * 2); c.stroke(); }
