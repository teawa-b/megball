/* MEGABALL — entities.js
 * Definitions and factories for enemy balls and player towers.
 *
 * Behaviour that needs to see the whole board (dealing damage, spawning,
 * scoring) is injected as a `world` interface by game.js, so this file stays
 * pure data + local logic and is easy to read and rebalance.
 *
 * Attaches window.ENT. Depends on: U, PHYS.
 */
(function (global) {
  'use strict';

  var U = global.U, PHYS = global.PHYS, C = U.C;
  var ENT = {};

  /* ====================================================================== */
  /* ENEMY BALLS                                                            */
  /* ====================================================================== */

  /* Readability rule (docs/CONTRACT.md §3): every enemy is a WHITE ball with
   * a THICK BLACK OUTLINE. Type is read from size + an inner black glyph, and
   * status is read from rings drawn outside the outline. We therefore tune
   * radius as a gameplay AND a legibility parameter — the silhouette is the
   * only thing a player can parse at a glance when 10 balls are in flight. */
  ENT.BALL_TYPES = {
    basic: {
      name: 'Drone', r: 17, hp: 3, mass: 1.0, bounty: 10, lifeCost: 1,
      grav: 1.0, glyph: 'none', outline: 6
    },
    fast: {
      name: 'Runner', r: 14, hp: 2, mass: 0.7, bounty: 12, lifeCost: 1,
      grav: 1.45, drag: 0.7, glyph: 'speed', outline: 4.5
    },
    heavy: {
      name: 'Hauler', r: 26, hp: 12, mass: 2.8, bounty: 30, lifeCost: 2,
      grav: 0.88, glyph: 'ring', outline: 9
    },
    armored: {
      name: 'Bulwark', r: 19, hp: 9, mass: 1.6, bounty: 22, lifeCost: 1,
      grav: 0.95, glyph: 'plate', outline: 6.5,
      armor: 0.55,      // fraction of incoming damage ignored while plated
      armorHp: 5        // plating breaks after this much absorbed damage
    },
    splitter: {
      name: 'Divider', r: 20, hp: 7, mass: 1.2, bounty: 18, lifeCost: 1,
      grav: 1.0, glyph: 'split', outline: 6.5,
      splitInto: 'shard', splitCount: 2
    },
    shard: {
      name: 'Shard', r: 13, hp: 2, mass: 0.55, bounty: 6, lifeCost: 1,
      grav: 1.3, glyph: 'speed', outline: 4
    },
    boss: {
      name: 'Colossus', r: 46, hp: 240, mass: 7.0, bounty: 200, lifeCost: 3,
      grav: 0.7, glyph: 'crown', outline: 13,
      boss: true, phases: 3
    }
  };

  var nextId = 1;

  ENT.makeBall = function (type, x, y, opts) {
    var d = ENT.BALL_TYPES[type] || ENT.BALL_TYPES.basic;
    opts = opts || {};
    var hpMul = opts.hpMul || 1;
    var hp = Math.round(d.hp * hpMul);

    return {
      id: nextId++,
      kind: 'ball',
      type: type,
      def: d,
      x: x, y: y,
      vx: opts.vx || 0,
      vy: opts.vy || 0,
      r: d.r,
      mass: d.mass,
      grav: d.grav * (opts.gravMul || 1),

      hp: hp, maxHp: hp,
      armor: d.armor || 0,
      armorHp: d.armorHp || 0,
      armorMax: d.armorHp || 0,

      /* status timers, all in seconds */
      slowT: 0, slowMul: 1,
      empowerT: 0,
      chain: 0,
      contagion: 0,      // frost still able to spread from this ball
      magnetT: 0,

      /* visual state */
      rot: 0, spin: U.jit(2),
      hurtT: 0,           // white flash on damage
      spawnT: 0.35,       // drop-in animation
      squash: 0, squashX: 0, squashY: 0,

      /* boss */
      phase: 0,
      abilityCd: d.boss ? 6 : 0,

      dead: false,
      leaked: false,
      lifeCost: d.lifeCost,
      bounty: Math.round(d.bounty * (opts.bountyMul || 1))
    };
  };

  /* Effective time multiplier for one ball (frost slow). */
  ENT.ballSpeedMul = function (b) {
    return b.slowT > 0 ? b.slowMul : 1;
  };

  /* Apply damage. Returns the damage actually dealt after armour.
   * `src` is a tag ('paddle' | 'bumper' | 'chain' | 'blast' | 'card') used
   * only for feedback routing. */
  ENT.damage = function (b, amount, src) {
    if (b.dead || amount <= 0) return 0;

    var dealt = amount;
    if (b.armorHp > 0) {
      dealt = amount * (1 - b.armor);
      b.armorHp -= amount;
      if (b.armorHp <= 0) {
        b.armorHp = 0;
        b.armorBroke = true;   // renderer + audio read this once
      }
    }

    b.hp -= dealt;
    b.hurtT = 0.12;
    if (b.hp <= 0) { b.hp = 0; b.dead = true; }
    return dealt;
  };

  /* Frost. Contagious: a slowed ball passes a weaker slow to whatever it
   * hits, which is what makes the Frost line feel like crowd control rather
   * than a stat stick. */
  ENT.applySlow = function (b, dur, mul, contagion) {
    if (b.def.boss) { dur *= 0.45; mul = Math.min(1, mul + 0.25); }
    if (dur > b.slowT) b.slowT = dur;
    b.slowMul = Math.min(b.slowMul === 1 ? mul : Math.min(b.slowMul, mul), mul);
    b.contagion = Math.max(b.contagion, contagion === undefined ? 1 : contagion);
  };

  /* The signature mechanic: flip an enemy into a temporary friendly weapon. */
  ENT.empower = function (b, dur) {
    b.empowerT = Math.max(b.empowerT, dur);
    b.chain = 0;
    b.slowT = 0;           // being empowered burns off frost
    b.slowMul = 1;
  };

  ENT.isEmpowered = function (b) { return b.empowerT > 0 && !b.dead; };

  /* ====================================================================== */
  /* TOWERS                                                                 */
  /* ====================================================================== */

  /* Paddle `range` is the TRIGGER radius, and it must stay close to the arm's
   * actual reach (armLen + armRad + ball radius ~= 93). An early version used
   * 132, so paddles swung at balls they could never touch and then sat on
   * cooldown while the ball sailed past — they looked busy and did nothing.
   *
   * Two families, each with a base tier and specialisations. Every branch
   * solves a different problem — that is the design rule, no clones that
   * differ only by a damage number:
   *
   *   Paddle  → physical redirection. Frost = crowd control, Power = offence.
   *   Bumper  → passive attrition.    Blast = clusters, Shock = chains,
   *                                   Launch = time (throws balls back up).
   */
  ENT.TOWERS = {
    paddle: {
      name: 'Auto Paddle', family: 'paddle', tier: 1, cost: 55,
      blurb: 'Swings at anything nearby. Knocks it back up the table.',
      color: C.cyan,
      range: 100, dmg: 2.2, cd: 0.62, force: 700,
      upgrades: ['frost', 'power']
    },
    frost: {
      name: 'Frost Paddle', family: 'paddle', tier: 2, cost: 85,
      blurb: 'Slows what it hits. The chill spreads on impact.',
      color: C.frost,
      range: 106, dmg: 1.7, cd: 0.58, force: 560,
      slowDur: 2.6, slowMul: 0.42,
      upgrades: []
    },
    power: {
      name: 'Power Paddle', family: 'paddle', tier: 2, cost: 110,
      blurb: 'Turns the ball it hits into a weapon for 4 seconds.',
      color: C.power,
      range: 102, dmg: 3.2, cd: 0.95, force: 940,
      empowerDur: 4.0,
      upgrades: []
    },

    bumper: {
      name: 'Bumper', family: 'bumper', tier: 1, cost: 40,
      blurb: 'Always on. Damages and kicks whatever touches it.',
      color: C.cyan,
      r: 30, dmg: 1.6, kick: 560, restitution: 1.28, hitCd: 0.14,
      upgrades: ['blast', 'shock', 'launch']
    },
    blast: {
      name: 'Blast Bumper', family: 'bumper', tier: 2, cost: 80,
      blurb: 'Detonates on hit. Hurts everything in the blast.',
      color: C.magenta,
      r: 31, dmg: 1.4, kick: 520, restitution: 1.2, hitCd: 0.2,
      blastR: 122, blastDmg: 3.4, blastCd: 1.4,
      upgrades: []
    },
    shock: {
      name: 'Shock Bumper', family: 'bumper', tier: 2, cost: 75,
      blurb: 'Arcs lightning to nearby balls. Damage falls off per jump.',
      color: C.violet,
      r: 30, dmg: 1.2, kick: 500, restitution: 1.22, hitCd: 0.18,
      chainR: 175, chainDmg: 2.8, chainFalloff: 0.65, chainMax: 4, chainCd: 0.95,
      upgrades: []
    },
    launch: {
      name: 'Launch Bumper', family: 'bumper', tier: 2, cost: 65,
      blurb: 'Hurls balls back to the top. Buys you time, not kills.',
      color: C.green,
      r: 32, dmg: 0.5, kick: 1180, restitution: 1.05, hitCd: 0.3,
      launchUp: 1080,
      upgrades: []
    }
  };

  ENT.makeTower = function (kind, slot) {
    var d = ENT.TOWERS[kind];
    var t = {
      id: nextId++,
      kind: 'tower',
      type: kind,
      def: d,
      family: d.family,
      slot: slot,
      x: slot.x, y: slot.y,
      cd: 0,
      /* paddle state */
      angle: 0, restAngle: 0, activeAngle: 0, omega: 0,
      swingT: 0, dir: 1, armLen: 64, armRad: 12,
      /* bumper state */
      pulse: 0, abilityCd: 0,
      /* shared */
      buildT: 0.4,        // pop-in animation
      hitFlash: 0,
      kills: 0,
      hitCds: null        // per-ball cooldown map, lazily created
    };

    if (d.family === 'paddle') {
      /* Paddles on the left half swing up-and-right, on the right half
       * up-and-left. Both push enemies back toward the middle of the table
       * and away from the drain. */
      t.dir = slot.x < U.VW / 2 ? 1 : -1;
      t.restAngle = t.dir > 0 ? 0.62 : Math.PI - 0.62;
      t.activeAngle = t.dir > 0 ? -0.78 : Math.PI + 0.78;
      t.angle = t.restAngle;
    } else {
      t.r = d.r;
      t.hitCds = {};
    }
    return t;
  };

  /* Where a paddle's arm currently ends. Written into a scratch pair. */
  var armEnd = ENT.armEnd = [0, 0];
  ENT.paddleTip = function (t) {
    armEnd[0] = t.x + Math.cos(t.angle) * t.armLen;
    armEnd[1] = t.y + Math.sin(t.angle) * t.armLen;
    return armEnd;
  };

  /* Cost to place, accounting for the tier-1 credit when specialising. */
  ENT.upgradeCost = function (fromType, toType) {
    return ENT.TOWERS[toType].cost;
  };

  ENT.sellValue = function (t) {
    return Math.floor(t.def.cost * 0.55);
  };

  global.ENT = ENT;
})(typeof window !== 'undefined' ? window : this);
