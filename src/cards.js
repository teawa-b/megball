/* MEGABALL — cards.js
 * Active abilities the player triggers by tapping the tray.
 *
 * Two flavours:
 *   PLAYER CARDS — collected across the run and slotted into a loadout before
 *                  a level. Slots unlock with stars, so the deck grows.
 *   LEVEL CARDS  — one per level, always available, does not use a slot.
 *                  This is how each stage gets its own mechanical identity
 *                  without demanding the player own dozens of cards.
 *
 * Every card's `activate(w)` receives the game world interface from game.js.
 *
 * Attaches window.CARDS. Depends on: U, ENT.
 */
(function (global) {
  'use strict';

  var U = global.U, ENT = global.ENT, C = U.C;
  var CARDS = {};

  /* ---------------------------------------------------------------------- */
  /* Player cards                                                           */
  /* ---------------------------------------------------------------------- */

  CARDS.PLAYER = {
    slowtime: {
      id: 'slowtime',
      name: 'Slow Time',
      art: 'card_slowtime',
      color: C.frost,
      cd: 20,
      blurb: 'All enemies crawl for 4.5s.',
      long: 'Buys thinking time. Use it to read a messy board, line up a flipper save, or place a tower under pressure.',
      activate: function (w) {
        w.setGlobalSlow(0.34, 4.5);
        w.fx.flash({ color: C.frost, alpha: 0.3, life: 0.4 });
        w.fx.ring(360, 700, { r0: 40, r1: 900, color: C.frost, life: 0.7, width: 8 });
        w.sfx('slowmo_in');
      }
    },

    overcharge: {
      id: 'overcharge',
      name: 'Overcharge',
      art: 'card_overcharge',
      color: C.cyan,
      cd: 24,
      blurb: 'Paddles swing faster and hit far harder for 6s.',
      long: 'Turns a modest paddle line into a wall. Best right before a dense wave lands.',
      activate: function (w) {
        w.setOvercharge(6.0);
        w.fx.flash({ color: C.cyan, alpha: 0.26, life: 0.35 });
        for (var i = 0; i < w.towers.length; i++) {
          var t = w.towers[i];
          w.fx.ring(t.x, t.y, { r0: 10, r1: 90, color: C.cyan, life: 0.5, width: 5 });
        }
        w.sfx('card_use', { rate: 1.15 });
      }
    },

    megaball: {
      id: 'megaball',
      name: 'Megaball',
      art: 'card_megaball',
      color: C.power,
      cd: 26,
      blurb: 'Ignites the most dangerous enemy. It hunts the rest.',
      long: 'The signature play. An empowered ball destroys what it touches and chains — aim it into a crowd.',
      activate: function (w) {
        /* Pick the lowest ball: it is both the biggest threat and the one
         * with the most board left to travel back through. */
        var best = null;
        for (var i = 0; i < w.balls.length; i++) {
          var b = w.balls[i];
          if (b.dead || b.empowerT > 0) continue;
          if (!best || b.y > best.y) best = b;
        }
        if (!best) {
          /* Nothing on the board — bank it rather than wasting the card. */
          w.toast('No target — card held');
          return false;
        }
        ENT.empower(best, 6.0);
        best.vy = -Math.abs(best.vy) - 620;
        best.vx *= 0.5;
        w.fx.flash({ color: C.power, alpha: 0.4, life: 0.45 });
        w.fx.ring(best.x, best.y, { r0: 10, r1: 220, color: C.powerHot, life: 0.5, width: 10 });
        w.fx.burst(best.x, best.y, { count: 26, color: C.power, color2: C.powerHot, power: 340, life: 0.5 });
        w.fx.shake(11, 0.3);
        w.fx.hitstop(0.07);
        w.sfx('power_hit', { vol: 1.2 });
        return true;
      }
    },

    barrier: {
      id: 'barrier',
      name: 'Barrier',
      art: 'card_barrier',
      color: C.cyan,
      cd: 22,
      blurb: 'Seals the drain for 7s. Nothing gets out.',
      long: 'The panic button. Enemies that reach the bottom bounce back into play instead of costing a life.',
      activate: function (w) {
        w.setBarrier(7.0);
        w.fx.ring(360, 1196, { r0: 20, r1: 380, color: C.cyan, life: 0.6, width: 9 });
        w.sfx('card_use', { rate: 0.85 });
      }
    },

    magnet: {
      id: 'magnet',
      name: 'Magnetise',
      art: 'card_magnet',
      color: C.violet,
      cd: 20,
      blurb: 'Drags every enemy toward your defenses for 4s.',
      long: 'Pulls stragglers out of dead lanes and bunches enemies up — excellent setup for a Blast Bumper.',
      activate: function (w) {
        w.setMagnet(4.0);
        w.fx.flash({ color: C.violet, alpha: 0.2, life: 0.3 });
        w.sfx('card_use', { rate: 0.95 });
      }
    },

    shockwave: {
      id: 'shockwave',
      name: 'Shockwave',
      art: 'card_shockwave',
      color: C.violet,
      cd: 22,
      blurb: 'Blasts every enemy back to the top and stuns them.',
      long: 'A full board reset. Nothing dies, but you get the whole table back.',
      activate: function (w) {
        for (var i = 0; i < w.balls.length; i++) {
          var b = w.balls[i];
          if (b.dead) continue;
          var push = 640 + (b.y / U.VH) * 620;
          b.vy = -push / Math.max(0.6, b.mass * 0.55);
          b.vx += U.jit(200);
          ENT.damage(b, 1.5, 'card');
        }
        w.fx.flash({ color: C.violet, alpha: 0.34, life: 0.4 });
        w.fx.ring(360, 1150, { r0: 20, r1: 1000, color: C.violet, life: 0.75, width: 14 });
        w.fx.shake(14, 0.4);
        w.sfx('bumper_shock', { vol: 1.3 });
      }
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Level cards — free, always slotted, define the stage's flavour          */
  /* ---------------------------------------------------------------------- */

  CARDS.LEVEL = {
    kickback: {
      id: 'kickback',
      name: 'Kickback',
      art: 'card_shockwave',
      color: C.green,
      cd: 14,
      blurb: 'Punts every ball in the lower third straight back up.',
      activate: function (w) {
        var n = 0;
        for (var i = 0; i < w.balls.length; i++) {
          var b = w.balls[i];
          if (b.dead || b.y < 900) continue;
          b.vy = -980; b.vx += U.jit(160);
          w.fx.spark(b.x, b.y + b.r, { count: 10, color: C.green, dir: -Math.PI / 2, spread: 0.8, speed: 340, life: 0.35 });
          n++;
        }
        w.fx.ring(360, 1120, { r0: 30, r1: 460, color: C.green, life: 0.5, width: 8 });
        w.fx.shake(7, 0.22);
        w.sfx('launch_hit');
        if (!n) w.toast('Nothing down there');
      }
    },

    flashfreeze: {
      id: 'flashfreeze',
      name: 'Flash Freeze',
      art: 'card_slowtime',
      color: C.frost,
      cd: 16,
      blurb: 'Frost every enemy on the board.',
      activate: function (w) {
        for (var i = 0; i < w.balls.length; i++) {
          var b = w.balls[i];
          if (b.dead) continue;
          ENT.applySlow(b, 3.4, 0.38, 1);
          w.fx.ring(b.x, b.y, { r0: b.r, r1: b.r + 26, color: C.frost, life: 0.35, width: 4 });
        }
        w.fx.flash({ color: C.frost, alpha: 0.3, life: 0.4 });
        w.sfx('frost_hit', { vol: 1.2, rate: 0.8 });
      }
    },

    overdrive: {
      id: 'overdrive',
      name: 'Overdrive',
      art: 'card_overcharge',
      color: C.cyan,
      cd: 18,
      blurb: 'Every paddle fires on a hair trigger for 5s.',
      activate: function (w) {
        w.setOvercharge(5.0);
        w.fx.flash({ color: C.cyan, alpha: 0.22, life: 0.3 });
        w.sfx('upgrade', { rate: 1.2 });
      }
    },

    superheat: {
      id: 'superheat',
      name: 'Superheat',
      art: 'card_megaball',
      color: C.powerHot,
      cd: 20,
      blurb: 'Bumpers detonate on every hit for 6s.',
      activate: function (w) {
        w.setSuperheat(6.0);
        for (var i = 0; i < w.towers.length; i++) {
          var t = w.towers[i];
          if (t.family !== 'bumper') continue;
          w.fx.ring(t.x, t.y, { r0: 8, r1: 80, color: C.powerHot, life: 0.45, width: 6 });
        }
        w.fx.flash({ color: C.powerHot, alpha: 0.22, life: 0.35 });
        w.sfx('bumper_blast', { rate: 0.9 });
      }
    },

    lastline: {
      id: 'lastline',
      name: 'Last Line',
      art: 'card_barrier',
      color: C.magenta,
      cd: 24,
      blurb: 'Seals the drain AND freezes the board for 4s.',
      activate: function (w) {
        w.setBarrier(4.0);
        w.setGlobalSlow(0.4, 4.0);
        w.fx.flash({ color: C.magenta, alpha: 0.3, life: 0.4 });
        w.fx.ring(360, 1196, { r0: 20, r1: 420, color: C.magenta, life: 0.6, width: 10 });
        w.fx.shake(9, 0.3);
        w.sfx('card_use', { rate: 0.75 });
      }
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Runtime                                                                */
  /* ---------------------------------------------------------------------- */

  /* A card in play: definition + its own cooldown clock. */
  CARDS.instance = function (def, isLevelCard) {
    return {
      def: def,
      levelCard: !!isLevelCard,
      cd: 0,              // seconds remaining
      cdMax: def.cd,
      uses: 0,
      readyPulse: 0       // brief flourish when it comes back up
    };
  };

  CARDS.update = function (inst, dt) {
    if (inst.cd > 0) {
      inst.cd -= dt;
      if (inst.cd <= 0) {
        inst.cd = 0;
        inst.readyPulse = 0.6;
        return true;      // "just became ready" — caller plays a sound
      }
    }
    if (inst.readyPulse > 0) inst.readyPulse -= dt;
    return false;
  };

  CARDS.canUse = function (inst) { return inst.cd <= 0; };

  /* Fire a card. Returns true if it actually went off; a card that declines
   * (e.g. Megaball with no target) keeps its charge. */
  CARDS.use = function (inst, world) {
    if (inst.cd > 0) return false;
    var r = inst.def.activate(world);
    if (r === false) return false;
    inst.cd = inst.cdMax;
    inst.uses++;
    return true;
  };

  /* Everything the player can own, in unlock order. */
  CARDS.UNLOCK_ORDER = ['slowtime', 'barrier', 'overcharge', 'megaball', 'magnet', 'shockwave'];

  global.CARDS = CARDS;
})(typeof window !== 'undefined' ? window : this);
