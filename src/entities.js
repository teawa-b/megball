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
    /* Boss hit points are set against MEASURED damage, not by feel. A built
     * board lands about 1.5 damage per second on a boss, and that barely moves
     * with tower count (5 towers 1.66, 14 towers 1.38): what limits it is how
     * often the boss is in contact, not how much is on the table. At the old
     * 240 the Colossus needed ~160s of unbroken contact, so in practice it
     * never died - it drained, took three lives, and the wave cleared anyway.
     * These values put a boss at roughly 40-60s of tower fire, less once
     * chains and cards land. The two locked bosses are costed against the
     * board their lock demands, not a mixed one: Prism takes paddle damage
     * only (~1.1/s from a paddle board), Crucible bumper only (~2.7/s), so
     * equal hit points would have meant wildly unequal fights. Each number
     * below is set from a measured solo fight against the board its archetype
     * asks for, aimed at 30-50s; the Warden is deliberately shorter (~20s)
     * because it is the rehearsal for the real thing. Rimewall carries the
     * lowest total of the full bosses because its freeze halves your output
     * for the duration - at parity hit points it ran 78s against the
     * Colossus's 44s.
     */
    /* ---- Bosses -------------------------------------------------------
     * One archetype per question about the board the player has built, so a
     * boss is never just a Drone with more hit points:
     *
     *   Colossus — the plain wall. Everything works; bring enough of it.
     *   Warden   — the campaign mini-boss. A Colossus you can actually kill
     *              with a Level-3 board, so the real one is not a surprise.
     *   Rimewall — frost slides off it, and it freezes the defenses it
     *              passes, so a Frost-heavy board has to improvise.
     *   Breaker  — the demolisher. Tears durability out of whatever it
     *              touches, so the flippers (which it cannot break) fight it.
     *   Vector   — speed. Outruns a bumper nest; has to be intercepted.
     *   Prism    — only paddle-family damage lands on it.
     *   Crucible — only bumper-family damage lands on it.
     *
     * `weakTo` is the lock, and it never blocks the empowered-ball chain or a
     * card: the signature mechanic must always be an answer, or a lock turns
     * into an unwinnable wave for a board that happens to be the wrong shape.
     */
    boss: {
      name: 'Colossus', r: 46, hp: 58, mass: 7.0, bounty: 200, lifeCost: 3,
      grav: 0.7, glyph: 'crown', outline: 13,
      boss: true, phases: 3
    },
    bossWarden: {
      name: 'Warden', r: 31, hp: 30, mass: 3.4, bounty: 90, lifeCost: 2,
      grav: 0.88, glyph: 'crown', outline: 10,
      boss: true, mini: true, phases: 2
    },
    bossRime: {
      name: 'Rimewall', r: 44, hp: 55, mass: 7.4, bounty: 240, lifeCost: 3,
      grav: 0.66, glyph: 'crown', outline: 13,
      boss: true, phases: 3, tint: C.frost,
      frostProof: true,
      freezeR: 190, freezeDur: 3.2,  // stuns defenses it drifts past
      /* Frost embrittles: the pulse that grips a defense also CRACKS the two
       * nearest, hard. Deliberately delivered by the pulse rather than by
       * contact — see `contactWear` on the Breaker. A boss this heavy
       * (mass 7.4) rattling through a nest lands contacts constantly, so
       * putting the damage there made it a stray-bounce lottery that quietly
       * dissolved the whole board; on the pulse it is a visible, answerable
       * bill on two named towers. */
      /* 26 x 3, from a measured sweep of the FULL fight. An earlier pass tuned
       * this against a fixed 60-second window and read it backwards: harder
       * settings looked like they stopped the boss dying, when they were only
       * pushing the kill past the end of the window. Measured to the end of
       * the fight instead, 26 x 3 destroys nearly twice the towers of the 14 x 2
       * it replaces (6.7 of 16 against 3.7) and the boss still goes down in 2
       * runs of 3, with a couple of lives to spare. Three towers, not the
       * whole ring: spreading it walks the entire nest to zero in lockstep and
       * the board's output falls off a cliff mid-fight. */
      wrecker: 26, wreckN: 3
    },
    bossBreaker: {
      name: 'Breaker', r: 48, hp: 55, mass: 8.0, bounty: 260, lifeCost: 3,
      grav: 0.76, glyph: 'crown', outline: 14,
      boss: true, phases: 3, tint: C.amber,
      wrecker: 34,                   // durability its slam tears out of one tower
      /* Destruction by CONTACT is the Breaker's whole identity, so it keeps
       * the triple wear multiplier that used to be implied by `wrecker`. */
      contactWear: 3
    },
    bossVector: {
      name: 'Vector', r: 33, hp: 80, mass: 3.0, bounty: 230, lifeCost: 3,
      grav: 1.3, drag: 0.6, glyph: 'speed', outline: 10,
      boss: true, phases: 3, tint: C.green,
      dash: 780                      // sideways burst instead of a down-surge
    },
    bossPrism: {
      name: 'Prism', r: 43, hp: 38, mass: 6.4, bounty: 280, lifeCost: 3,
      grav: 0.72, glyph: 'plate', outline: 13,
      boss: true, phases: 3, tint: C.cyan,
      weakTo: 'paddle'
    },
    bossCrucible: {
      name: 'Crucible', r: 44, hp: 75, mass: 7.0, bounty: 280, lifeCost: 3,
      grav: 0.72, glyph: 'ring', outline: 13,
      boss: true, phases: 3, tint: C.magenta,
      weakTo: 'bumper'
    }
  };

  /* Which family a damage tag belongs to, for the `weakTo` lock. Anything
   * not listed is NEUTRAL and always lands — see the note on the roster. */
  var DMG_FAMILY = {
    paddle: 'paddle',
    bumper: 'bumper', blast: 'bumper', shock: 'bumper'
  };
  ENT.damageFamily = function (src) { return DMG_FAMILY[src] || null; };

  /* Does this damage tag actually hurt this ball? */
  ENT.damageLands = function (b, src) {
    if (!b.def.weakTo) return true;
    var fam = DMG_FAMILY[src];
    return !fam || fam === b.def.weakTo;
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
      /* Position at the start of the current substep — the swept flipper
       * test in game.js reads it to detect a ball and an arm swapping sides. */
      lastX: x, lastY: y,
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

    /* A locked boss shrugs the wrong family off entirely. Reported as a
     * refusal rather than a zero so the caller can say so on screen — a
     * player who cannot tell "immune" from "missed" will just keep doing the
     * thing that does not work. */
    if (!ENT.damageLands(b, src)) { b.deflected = true; return 0; }

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
    if (b.def.frostProof) return;          // Rimewall: the chill is its own
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
   *
   * DURABILITY (`dur`) is the throttle on both families. Every impact scuffs
   * the defense that took it, by the striking ball's MASS — so a Hauler
   * batters a bumper far harder than a Drone — and a defense with nothing
   * left comes apart. A bumper nest is still the strongest thing on the
   * table; it just cannot be the LAST thing you build.
   *
   * Bumpers are always on and register a hit per contact, so they wear fast.
   * A paddle only wears on its own swing, and carries a bigger pool on top,
   * which is what makes it the long-term investment. Every specialisation
   * buys a bigger pool as well, so upgrading is also buying staying power.
   */
  ENT.TOWERS = {
    paddle: {
      name: 'Auto Paddle', family: 'paddle', tier: 1, cost: 55,
      blurb: 'Swings at anything nearby. Knocks it back up the table.',
      color: C.cyan,
      range: 100, dmg: 2.05, cd: 0.68, force: 700, dur: 175,
      upgrades: ['frost', 'power']
    },
    frost: {
      name: 'Frost Paddle', family: 'paddle', tier: 2, cost: 85,
      blurb: 'Slows what it hits. The chill spreads on impact.',
      color: C.frost,
      range: 106, dmg: 1.65, cd: 0.64, force: 560, dur: 235,
      slowDur: 2.6, slowMul: 0.42,
      upgrades: []
    },
    power: {
      name: 'Power Paddle', family: 'paddle', tier: 2, cost: 110,
      blurb: 'Turns the ball it hits into a weapon for 4 seconds.',
      color: C.power,
      range: 102, dmg: 3.05, cd: 1.0, force: 940, dur: 225,
      empowerDur: 4.0,
      upgrades: []
    },

    /* The bumper's re-hit cooldown is its real balance number, not its
     * damage: at 0.14s a ball rattling in a nest took seven damage instances
     * a second and the board played itself. */
    bumper: {
      name: 'Bumper', family: 'bumper', tier: 1, cost: 40,
      blurb: 'Always on. Damages and kicks whatever touches it. Wears fast.',
      color: C.cyan,
      r: 30, dmg: 1.45, kick: 560, restitution: 1.2, hitCd: 0.2, dur: 120,
      upgrades: ['blast', 'shock', 'launch']
    },
    blast: {
      name: 'Blast Bumper', family: 'bumper', tier: 2, cost: 80,
      blurb: 'Detonates on hit. Hurts everything in the blast.',
      color: C.magenta,
      r: 31, dmg: 1.3, kick: 520, restitution: 1.16, hitCd: 0.22, dur: 155,
      blastR: 116, blastDmg: 3.1, blastCd: 2.9,
      upgrades: []
    },
    shock: {
      name: 'Shock Bumper', family: 'bumper', tier: 2, cost: 75,
      blurb: 'Arcs lightning to nearby balls. Damage falls off per jump.',
      color: C.violet,
      r: 30, dmg: 1.1, kick: 500, restitution: 1.18, hitCd: 0.2, dur: 150,
      chainR: 175, chainDmg: 2.5, chainFalloff: 0.62, chainMax: 4, chainCd: 1.15,
      upgrades: []
    },
    launch: {
      name: 'Launch Bumper', family: 'bumper', tier: 2, cost: 65,
      blurb: 'Hurls balls back to the top. Buys you time, not kills.',
      color: C.green,
      r: 32, dmg: 0.5, kick: 1180, restitution: 1.05, hitCd: 0.34, dur: 175,
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
      hitCds: null,       // per-ball cooldown map, lazily created

      /* durability */
      dur: d.dur, durMax: d.dur,
      wearFlash: 0,       // sparks-and-smoke pip after a scuff
      frozenT: 0,         // Rimewall stun: the tower is inert while this runs
      broken: false
    };

    if (d.family === 'paddle') {
      /* Paddles on the left half swing up-and-right, on the right half
       * up-and-left. Both push enemies back toward the middle of the table
       * and away from the drain. */
      t.dir = slot.x < U.VW / 2 ? 1 : -1;
      t.restAngle = t.dir > 0 ? 0.62 : Math.PI - 0.62;
      t.activeAngle = t.dir > 0 ? -0.78 : Math.PI + 0.78;
      t.angle = t.restAngle;
      t.hitCds = {};
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

  /* A worn-out tower refunds proportionally less: selling a wreck for the
   * same price as a fresh one would make wear a rounding error. */
  ENT.sellValue = function (t) {
    return Math.max(4, Math.floor(t.def.cost * 0.55 * (0.45 + 0.55 * ENT.condition(t))));
  };

  /* ---------------------------------------------------------------------- */
  /* Wear                                                                   */
  /* ---------------------------------------------------------------------- */

  /* 1 = factory fresh, 0 = about to come apart. */
  ENT.condition = function (t) {
    return t.durMax > 0 ? U.clamp(t.dur / t.durMax, 0, 1) : 1;
  };

  /* Four readable bands rather than a continuous number. The player needs to
   * decide "repair now or ride it out", and that is a four-way choice, not a
   * percentage: 0 fresh, 1 scuffed, 2 cracked, 3 failing. */
  ENT.WEAR_BANDS = ['GOOD', 'WORN', 'CRACKED', 'FAILING'];
  ENT.wearBand = function (t) {
    var c = ENT.condition(t);
    if (c > 0.66) return 0;
    if (c > 0.36) return 1;
    if (c > 0.15) return 2;
    return 3;
  };

  /* A tired defense hits softer before it dies, so the decline is something
   * the player feels rather than only reads. Never below 55%: a tower that
   * stopped mattering long before it broke would just be dead weight taking
   * up a slot. */
  ENT.outputMul = function (t) {
    return 0.55 + 0.45 * ENT.condition(t);
  };

  /* Scuff a tower. Returns true if this was the blow that broke it. */
  ENT.wear = function (t, amount) {
    if (t.broken || amount <= 0) return false;
    var before = t.dur;
    t.dur -= amount;
    if (t.dur < 0) t.dur = 0;
    /* Only flash on a band change, so the pip means "this got worse" instead
     * of strobing on every single contact. */
    if (ENT.wearBandOf(before, t.durMax) !== ENT.wearBand(t)) t.wearFlash = 0.5;
    if (t.dur <= 0) { t.broken = true; return true; }
    return false;
  };

  ENT.wearBandOf = function (dur, durMax) {
    var c = durMax > 0 ? U.clamp(dur / durMax, 0, 1) : 1;
    return c > 0.66 ? 0 : (c > 0.36 ? 1 : (c > 0.15 ? 2 : 3));
  };

  /* Repairing costs half of what the tower cost, scaled by how much is
   * missing — so topping up a lightly scuffed bumper is pocket change and
   * nursing a wreck is a real decision against just rebuilding it. */
  /* Specialised gear is expensive to keep running. The base half-of-cost
   * already scales with the tower's price, but that alone left a Power Paddle
   * cheap to nurse relative to what it does — an upgraded tower should be a
   * commitment, not just a better tower. Tier 2 therefore pays a maintenance
   * premium on top, which is also the counterweight to the bigger durability
   * pool upgrading buys. */
  ENT.REPAIR_TIER2 = 1.4;

  /* Endless raises the price of upkeep as a run goes on; game.js sets this
   * from the wave. Income climbs steeply out there — a cleared wave pays a
   * capped 240 and the kills pay more on top — so a FLAT repair bill stops
   * being a decision somewhere in the teens and the whole board just gets
   * nursed forever out of petty cash. The campaign leaves it at 1. */
  ENT.repairScale = 1;

  ENT.repairCost = function (t) {
    var missing = 1 - ENT.condition(t);
    if (missing <= 0.001) return 0;
    var tierMul = t.def.tier >= 2 ? ENT.REPAIR_TIER2 : 1;
    return Math.max(5, Math.round(t.def.cost * 0.5 * tierMul * ENT.repairScale * missing));
  };

  global.ENT = ENT;
})(typeof window !== 'undefined' ? window : this);
