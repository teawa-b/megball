# Pinball Tower Defense — Detailed Game Plan

## 1. High-Level Concept

**Working title:** Pinball Tower Defense  
**Genre:** Tower Defense & Strategy + Pinball hybrid  
**Platform:** Mobile web prototype  
**Orientation:** Portrait  
**Player count:** Single-player

### Core Pitch

A tower defense game where the battlefield is a vertical pinball table.

Enemy balls enter from the top of the board in increasingly difficult waves and try to escape through the bottom. The player defends the exit using:

- **Manual pinball flippers** controlled by tapping the left or right side of the screen.
- **Automatic defensive paddles** that act like towers and activate on their own.
- **Bumpers and other defensive objects** that can damage, redirect, slow, or modify enemy balls.
- **Cards and power-ups** that alter the board, the player's defenses, or the balls themselves.
- **Energy earned by destroying enemies**, which is spent on placing and upgrading defenses.

The important twist is that balls are not only enemies. Certain effects can turn a struck ball into a temporary weapon, allowing it to crash into other balls and create satisfying chain reactions.

The game should feel like a combination of:

- the physical satisfaction and unpredictability of pinball;
- the planning, economy, and upgrade decisions of tower defense;
- the excitement of card-based abilities;
- short mobile levels with strong replayability.

---

# 2. Why This Is Clearly a Tower Defense Game

The tower defense identity needs to stay obvious even though the moment-to-moment interaction feels like pinball.

The game therefore needs all three major tower defense pillars:

## Defenses the Player Places or Manages

The player's defensive systems include:

- automatic paddles;
- bumpers;
- elemental/special bumpers;
- upgraded variants of those defenses;
- manual bottom flippers;
- cards that modify defenses.

The automatic defenses are effectively the game's **towers**.

## Escalating Threats

Levels contain waves of enemy balls.

As a level progresses:

- more balls spawn;
- balls can become faster;
- tougher enemy types are introduced;
- enemies gain special properties;
- spawn patterns become more difficult;
- the player has less time to recover between threats.

## A Meaningful Economy

Destroying enemy balls generates **Energy**.

Energy can be spent during a level to:

- place automatic paddles;
- place bumpers;
- upgrade existing defenses;
- transform a standard defense into a specialized version;
- potentially refresh or activate certain abilities.

This means the player is constantly choosing between immediate survival and investing in stronger defenses.

---

# 3. Core Gameplay Loop

The main loop should be extremely easy to understand:

1. A wave begins.
2. Enemy balls enter from the top of the table.
3. Automatic defenses begin interacting with them.
4. The player uses the left and right manual flippers to prevent balls from escaping.
5. Defeated balls generate Energy.
6. The player spends Energy to place or upgrade defenses.
7. Cards and special effects create stronger combinations.
8. The wave becomes progressively harder.
9. The player survives the required number of waves.
10. The level ends and awards stars.
11. Stars and progression unlock additional cards, card slots, and future levels.

### Failure Condition

Enemy balls that pass through the bottom of the board count as **Leaks**.

The player has a limited amount of lives, for example:

- 5 lives at the beginning of a level;
- each escaped ball removes 1 life;
- dangerous enemy types may remove more than 1 life.

At 0 lives, the level is lost.

### Win Condition

Survive every wave in the level while keeping at least one life remaining.

---

# 4. Controls

The controls should require almost no explanation.

## Manual Flippers

The screen is divided vertically into two large invisible touch zones.

**Tap/hold left half of the screen**
- activates the left flipper.

**Tap/hold right half of the screen**
- activates the right flipper.

Both sides can be pressed simultaneously.

There should be no tiny virtual buttons for the flippers. The whole lower play area should behave as the control surface.

## Defense Placement

When build mode is available:

1. Tap a defense card/icon.
2. Valid placement positions become highlighted.
3. Tap a position on the board.
4. Energy is deducted.
5. The defense appears immediately.

The game should be designed so placement never interferes with flipper controls.

One option is to pause or heavily slow the game while a defense is selected.

---

# 5. Board Layout

The game should use the portrait orientation naturally rather than feeling like a landscape game squeezed onto a phone.

## Suggested Layout

### Top
- Wave number.
- Remaining lives.
- Energy.
- Optional remaining enemies indicator.

### Upper / Middle Board
- enemy spawn zones;
- automatic paddles;
- bumpers;
- obstacles;
- special stage mechanics;
- enemy balls.

### Lower Board
- left manual flipper;
- right manual flipper;
- guarded exit / drain.

### Bottom UI
A compact card/defense tray containing:

- player card slots;
- the level-specific card;
- defense placement buttons if needed.

The actual pinball board should occupy most of the screen.

---

# 6. Enemy Balls

Enemy balls should have strong visual identities so the board remains readable even when several are active.

## Basic Ball

The standard enemy.

- normal speed;
- normal health;
- predictable physics.

This is the primary enemy in early levels.

## Heavy Ball

A larger or visually denser ball.

- more health;
- slower movement;
- stronger momentum;
- harder for weaker paddles to redirect.

## Fast Ball

- low health;
- high movement speed;
- dangerous if it breaks through the defensive line.

## Armored Ball

- takes reduced damage;
- may require several collisions;
- armor visibly cracks as damage is dealt.

## Split Ball

When destroyed or heavily hit:

- divides into two smaller balls;
- smaller balls have less health but move faster.

Should be introduced later because it increases screen complexity.

## Elite / Boss Ball

A large threat used at the end of important levels.

Possible traits:

- multiple health phases;
- immune to certain status effects;
- periodically accelerates;
- damages/temporarily disables nearby defenses;
- spawns smaller enemy balls.

For the hackathon prototype, only one boss type is necessary.

---

# 7. Defenses

Automatic defensive objects are the game's equivalent of towers.

The player should be able to understand the role of each defense immediately.

## Automatic Paddle

A paddle placed somewhere on the board that activates automatically when a ball enters its detection zone.

### Base Automatic Paddle

Role:
- physical redirection;
- basic damage;
- reliable general-purpose defense.

Possible upgrades:
- faster activation;
- stronger hit force;
- more damage;
- shorter cooldown.

---

## Frost Paddle

A specialized automatic paddle.

When it strikes a ball:

- the struck ball is slowed;
- if that ball collides with other enemy balls while the effect is active, those balls are also slowed temporarily.

This creates a contagious crowd-control effect.

### Visual Feedback

The affected ball could have:

- an icy shell;
- cold particles;
- a blue-white trail;
- a clearly visible slow indicator.

The effect should be short enough that the game remains active rather than stopping completely.

---

## Power Paddle

A stronger offensive paddle.

When it hits a ball:

- applies additional force;
- empowers the struck ball for a few seconds;
- an empowered ball damages or destroys enemy balls it collides with.

This is one of the game's key signature mechanics.

The player can deliberately try to bounce an empowered ball into a cluster of enemies.

---

# 8. Bumpers

Bumpers also function as towers.

They require no direct player input once placed.

## Standard Bumper

- damages enemy balls;
- redirects them;
- generates satisfying physical reactions.

## Frost Bumper

When touched:

- slows the enemy ball;
- temporarily gives the ball a frost effect;
- collisions from that ball can spread the slow to nearby enemies.

## Blast Bumper

When triggered:

- releases a small radial explosion;
- damages nearby balls;
- has a visible cooldown.

Best against clustered enemies.

## Charge / Shock Bumper

When hit:

- sends a chain effect to nearby enemy balls;
- damage decreases for each chained target.

Useful for crowd control without creating huge explosions.

## Launch Bumper

Provides extremely strong knockback.

Its purpose is not necessarily damage.

Instead it:

- throws balls back toward the top of the level;
- buys the player time;
- creates opportunities for repeated collisions.

---

# 9. Defense Upgrades

The player earns Energy from defeated enemies and can invest it into defenses.

Each defense should have a small upgrade path rather than a huge tech tree.

Example:

### Automatic Paddle

**Level 1**
- standard automatic hit.

**Level 2**
Choose one:

- faster activation;
- increased force.

**Level 3**
Choose a specialization:

- Frost Paddle;
- Power Paddle.

This makes upgrades feel meaningful rather than simply increasing numbers.

For the prototype, even a simple two-stage system is enough:

**Base Defense → Specialized Defense**

---

# 10. Energy Economy

Energy is the main in-level currency.

## Earn Energy From

- destroying enemy balls;
- completing waves;
- possibly skill bonuses such as chain kills.

## Spend Energy On

- placing automatic paddles;
- placing bumpers;
- upgrading defenses;
- transforming defenses into specialized variants.

The player should regularly face decisions such as:

> Do I buy another bumper now, or save enough Energy to upgrade my existing paddle into a Frost Paddle?

That decision-making is important because it keeps the tower defense aspect central.

---

# 11. Player Cards

Cards are separate from the defenses themselves.

Cards provide active powers that the player deliberately triggers.

## Starting Progression

At the beginning of the game, the player starts with:

- **1 player card slot**;
- **1 level-specific card**.

As the player progresses, additional player card slots are unlocked.

Possible progression:

- Slot 1: available immediately.
- Slot 2: unlock through stars.
- Slot 3: unlock later.
- Additional cards are unlocked by completing levels or earning stars.

For the prototype, 2–3 total player slots is enough.

---

# 12. Example Player Cards

## Slow Time

Temporarily reduces the speed of all enemy balls.

Purpose:

- gives the player time to recover;
- creates breathing room when the board gets chaotic;
- allows the player to consider defense placement;
- makes difficult flipper shots easier.

### Feedback

When activated:

- gameplay visibly slows;
- subtle screen treatment shows the state;
- audio pitch may lower slightly;
- countdown ring shows remaining duration.

This is both a strategic ability and a readability tool.

---

## Overcharge

Temporarily boosts all automatic paddles.

Possible effects:

- faster activation;
- stronger hits;
- increased damage.

---

## Multiball Weapon

Select or automatically empower one friendly/struck ball.

For several seconds:

- collisions with enemy balls deal extreme damage;
- successful collisions create strong VFX;
- chains are rewarded.

This should create one of the game's biggest "wow" moments.

---

## Emergency Barrier

Creates a temporary barrier above the drain.

Any enemy reaching the bottom:

- bounces back into the board instead of escaping.

Useful as a panic button.

---

## Magnetic Pull

For a short period:

- enemy balls are subtly pulled toward defensive objects;
- reduces unlucky trajectories;
- creates clusters that work well with blast defenses.

---

# 13. Level-Specific Cards

Every level/world has a unique card that is automatically available.

This does **not** consume one of the player's normal card slots.

The level card:

- has a cooldown;
- regenerates automatically;
- reinforces the identity of that stage;
- gives the player a mechanic to experiment with during that specific level.

This allows every environment to feel mechanically different without requiring the player to own dozens of cards.

## Example Level Cards

### Ice Level — Flash Freeze

Temporarily slows every enemy ball.

### Factory Level — Overdrive

All automatic paddles activate much faster for a short period.

### Reactor Level — Shockwave

Creates a board-wide pulse that pushes all enemy balls upward.

### Volcano Level — Superheat

All bumpers deal increased damage and cause small explosions.

---

# 14. Balls Becoming Weapons

This should be treated as one of the central unique mechanics.

Normally:

**enemy ball = threat**

After certain hits/effects:

**enemy ball = temporary projectile**

For example:

1. A Power Paddle strikes an enemy.
2. The ball becomes energized.
3. Its trail and appearance change.
4. It flies back up the board.
5. It collides with several other enemies.
6. Those enemies explode.
7. The player receives Energy and a chain bonus.

This turns defense into offense and makes the physics interactions meaningful.

## Chain Reaction Feedback

A successful sequence could display:

- `CHAIN x2`
- `CHAIN x3`
- `CHAIN x5`
- `MEGA HIT`

This does not need to become a complicated score system. It exists primarily to make the player feel powerful.

---

# 15. Collision Feedback

Ball-to-ball and ball-to-defense collisions need to feel extremely satisfying.

This is one of the most important polish areas in the game.

Possible feedback:

- tiny hit-stop on strong impacts;
- camera shake on heavy collisions;
- squash/stretch on the ball;
- impact rings;
- particle bursts;
- short trails;
- sparks;
- sound variation depending on collision strength;
- stronger feedback when multiple enemies are destroyed.

## Major Chain Reaction

For especially strong moments:

1. Brief slow-motion begins.
2. The empowered ball hits the first enemy.
3. A visible shockwave appears.
4. Several balls collide.
5. Each destruction creates escalating feedback.
6. Normal speed quickly returns.

Slow-motion should be very short.

It should emphasize a moment rather than constantly interrupt gameplay.

---

# 16. Readability and Preventing Visual Overload

The game must never become an unreadable cloud of tiny balls.

Chaos should feel exciting, not confusing.

## Hard Concurrent Enemy Cap

Do not spawn unlimited enemies.

Suggested early prototype ranges:

- Early level: 3–5 simultaneous enemy balls.
- Mid level: 5–8.
- Difficult moments: approximately 8–12 maximum.

The exact number should be adjusted through playtesting.

Difficulty should not come only from adding more objects.

---

## Use Different Ball Sizes

Threat type should be readable through silhouette.

For example:

- basic = medium;
- fast = small;
- heavy = large;
- boss = very large.

---

## Strong State Changes

Status effects need obvious visual changes.

Examples:

**Slowed**
- icy overlay;
- altered trail.

**Empowered**
- bright energy ring;
- strong trail;
- pulse.

**Armored**
- visible shell.

**Low health**
- cracks.

---

## Spawn in Patterns

Avoid dumping ten balls onto the table simultaneously.

Use readable formations:

- one-by-one stream;
- pairs;
- alternating lanes;
- triangle formation;
- short burst;
- heavy ball followed by fast balls.

This lets players learn wave patterns.

---

## Use Slow Time as a Safety Valve

The Slow Time card lets the player intentionally reduce complexity when the board becomes difficult to read.

This is valuable because the player controls when they need additional thinking time.

---

## Prioritize Gameplay Objects

Particles should disappear quickly.

Effects should never cover:

- enemy trajectories;
- paddles;
- important bumpers;
- the bottom drain.

The ball should remain readable even during large visual effects.

---

# 17. Level Structure

The game should use fixed levels rather than relying only on an endless mode.

Each level should teach or test a specific idea.

## Example Prototype Progression

### Level 1 — First Bounce

Teaches:

- left/right flippers;
- enemy balls;
- lives;
- basic automatic paddle;
- basic Energy.

Enemies:
- Basic Ball.

Goal:
- survive 3 waves.

---

### Level 2 — Build the Board

Introduces:

- placing a defense;
- spending Energy;
- first bumper.

Enemies:
- Basic Ball;
- Fast Ball.

Goal:
- survive 4 waves.

---

### Level 3 — Cold Front

Introduces:

- Frost Paddle;
- slow effects;
- Frost level card.

Enemies:
- Basic Ball;
- Heavy Ball;
- Fast Ball.

Goal:
- survive escalating waves and defeat a final heavy group.

---

### Level 4 — Chain Reaction

Introduces:

- Power Paddle;
- empowered balls;
- chain kills.

Enemy formations are specifically designed to encourage ball-to-ball collisions.

---

### Level 5 — Pinball Siege

Final prototype challenge.

Uses:

- mixed enemy types;
- all available defenses;
- faster escalation;
- one boss ball.

The player needs to use the economy, flippers, card timing, and defense placement together.

---

# 18. Star Rating

Each completed level awards 1–3 stars.

Example criteria:

### 1 Star
Complete the level.

### 2 Stars
Complete the level with at least 50% of lives remaining.

### 3 Stars
Complete the level with very few or zero leaks.

Stars provide a simple reason to replay levels.

They can also unlock:

- new cards;
- card slots;
- new levels.

For the hackathon prototype, star rewards should be immediately visible within the playable session.

---

# 19. Progression

The progression system should stay simple.

Example:

## Starting State

Player owns:
- Slow Time card.
- 1 card slot.

## After Early Levels

Player unlocks:
- second card slot;
- another player card;
- new defense specialization.

## Later

Player unlocks:
- third slot;
- stronger/more strategic cards.

The point is not to build a huge meta-progression system.

The point is to show that the game has somewhere to grow.

---

# 20. Difficulty Progression

Difficulty should come from combinations of systems rather than just spawning absurd numbers of balls.

Possible difficulty levers:

- increased enemy speed;
- more enemy health;
- more complex trajectories;
- new enemy types;
- mixed enemy formations;
- shorter gaps between waves;
- fewer safe areas;
- harder spawn positions;
- enemies with resistance to certain defenses;
- boss mechanics.

A difficult level should make the player reconsider their defensive setup.

---

# 21. Wave Structure

A level can contain several short waves.

Example:

**Wave 1**
- 3 basic balls.

**Wave 2**
- 4 basic balls.
- 1 fast ball.

**Wave 3**
- 2 heavy balls.
- 3 basic balls.

**Wave 4**
- mixed formation.

**Final Wave**
- elite/boss encounter.

Between waves:

- allow a very short build window;
- show the next threat;
- let the player spend Energy;
- then quickly continue.

Avoid long menus that pull the player away from the pinball table.

---

# 22. Example Full Player Experience

The player enters a level with:

- 5 lives;
- 0 or a small amount of starting Energy;
- one selected card;
- one unique level card.

Three basic enemy balls fall onto the board.

The player's automatic paddle hits one while the player manually catches another with the left flipper.

The enemies are destroyed and generate Energy.

Before the next wave, the player buys a bumper.

The next wave contains several faster enemies.

The bumper redirects one toward the automatic paddle.

The player upgrades that paddle into a Power Paddle.

It hits an enemy and energizes it.

The energized enemy flies upward and smashes through two other balls.

A short slow-motion effect emphasizes the collision.

`CHAIN x3` appears.

The destroyed balls generate enough Energy for a second defense.

Later, the board becomes busy.

The player activates **Slow Time**, giving them enough time to choose a new bumper position.

The final wave introduces a huge armored ball.

The player uses their defenses, flippers, level card, and Energy upgrades together to defeat it.

The game displays:

- Level Complete;
- star rating;
- Energy/score summary;
- newly unlocked card or card slot.

Then the next level becomes available.

---

# 23. Visual Direction

The board should be colorful and toy-like rather than attempting realistic pinball.

Important visual priorities:

1. readable enemies;
2. readable defenses;
3. strong collision feedback;
4. clear trajectories;
5. attractive effects.

Possible visual theme:

- futuristic toy pinball machine;
- clean glowing bumpers;
- mechanical automatic paddles;
- highly readable enemy balls;
- satisfying neon-like impact trails.

The background should stay quieter than the gameplay pieces.

---

# 24. Audio Direction

Audio can make the game dramatically more satisfying without requiring lots of assets.

Useful sounds:

- flipper activation;
- bumper bounce;
- enemy damage;
- enemy destruction;
- Energy pickup;
- card activation;
- upgrade;
- wave start;
- life lost;
- chain escalation;
- victory;
- defeat.

The collision sound can vary slightly by velocity so repeated bounces do not become irritating.

---

# 25. UI Requirements

The player should be able to understand the state of the game at a glance.

Always visible:

- lives;
- Energy;
- wave number;
- player card(s);
- level card and cooldown.

When a defense is selected:

- show price;
- highlight valid positions;
- show cancel option.

When upgrading:

- display a very short description;
- show the new behavior rather than paragraphs of text.

Example:

**FROST UPGRADE — 80 Energy**  
`Hits slow enemies and spread slow on collision.`

---

# 26. Prototype Scope

The prototype should focus on depth around one polished core rather than trying to implement dozens of systems.

## Must Have

- portrait layout;
- manual left/right flippers;
- enemy balls entering from the top;
- lives/leak system;
- waves;
- win state;
- loss state;
- restart;
- Energy economy;
- at least one placeable automatic defense;
- at least one bumper;
- defense upgrades;
- at least 3 meaningfully different defensive options;
- Slow Time card;
- one level-specific ability;
- enemy escalation;
- strong collision feedback.

## Strong Additions

- Frost Paddle/Bumper;
- Power Paddle;
- balls becoming temporary weapons;
- chain reaction effects;
- 3–5 levels;
- star ratings;
- unlockable card slot;
- 3 enemy ball types;
- one boss.

## Only Add If Time Allows

- large card collection;
- elaborate upgrade trees;
- many worlds;
- large story/tutorial;
- endless mode;
- complex progression menus;
- dozens of enemy variants.

---

# 27. Recommended Hackathon Vertical Slice

If development time becomes tight, build one extremely polished level containing:

### Player Tools
- manual left/right flippers;
- standard auto paddle;
- standard bumper;
- Frost Bumper;
- Power Paddle;
- Slow Time card;
- one level card.

### Enemies
- basic;
- fast;
- heavy;
- boss.

### Level
- 5 escalating waves.

### Economy
- earn Energy through kills;
- buy defenses;
- upgrade at least one defense into a specialized form.

### Signature Moment
An empowered enemy ball is launched upward and destroys a cluster of other enemy balls in a satisfying chain reaction.

If this single level feels excellent, it proves the entire concept.

---

# 28. Hackathon Fit

The game should be submitted under **Tower Defense & Strategy**.

The competition guidance describes this genre around:

- defensive systems;
- unit variety;
- escalating waves;
- a simple economy;
- defenses the player places or manages;
- meaningful spending or upgrade decisions.

This concept directly supports those requirements through:

| Competition Requirement | Game System |
|---|---|
| Defenses the player places/manages | Automatic paddles, bumpers, upgrades |
| Unit/defense variety | Standard, Frost, Power, Blast, Shock, Launch variants |
| Escalation | Increasing waves and enemy variants |
| Economy | Energy from destroyed balls |
| Spending decisions | Place new defenses vs upgrade existing ones |
| Clear core action | Flippers + defense management |
| Goal | Prevent enemy balls escaping |
| Win/Lose states | Survive all waves / lose all lives |
| Session progression | Waves, upgrades, growing board strength |

The pinball mechanics are the **interaction twist**, but the underlying structure remains tower defense.

---

# 29. Competition Technical Constraints to Design Around

The current Meta Horizon Creator Competition guidance requires the prototype to be:

- single-player;
- fixed portrait orientation;
- playable as a complete session;
- fully self-contained/offline;
- packaged as a `.zip` no larger than 35 MB;
- built with readable game code inside a root-level `index.html`;
- free from runtime external network requests.

Because of that:

- do not rely on online APIs;
- do not load remote images, fonts, scripts, or CDNs;
- keep all assets local;
- keep the prototype lightweight;
- test the game offline before submission.

---

# 30. Development Order

The safest development approach is to build in small playable passes.

## Pass 1 — Core Pinball

Build:

- portrait board;
- gravity/physics;
- enemy ball;
- left/right manual flippers;
- bottom drain;
- life loss;
- restart.

Goal:

**The pinball interaction alone should already feel satisfying.**

---

## Pass 2 — Tower Defense Loop

Add:

- automatic paddle;
- bumper;
- enemy waves;
- Energy;
- placement;
- upgrading.

Goal:

**The player should clearly be managing defenses rather than merely playing pinball.**

---

## Pass 3 — Signature Mechanic

Add:

- Power Paddle;
- empowered ball state;
- enemy-to-enemy damage;
- chain reactions.

Goal:

**Create the game's most memorable mechanic.**

---

## Pass 4 — Strategic Depth

Add:

- Frost defense;
- Slow Time card;
- level card;
- more enemy types.

Goal:

**Make defensive choices meaningfully different.**

---

## Pass 5 — Progression

Add:

- multiple levels or one extended level;
- star system;
- additional card slot;
- boss/final wave.

---

## Pass 6 — Polish

Improve:

- collision particles;
- hit stop;
- short slow-motion moments;
- sound;
- UI clarity;
- enemy readability;
- transitions;
- tutorial prompts.

---

# 31. Design Principles

Whenever deciding whether to add something, use these rules:

### 1. Tower Defense First

The pinball interaction should enhance the tower defense loop, not replace it.

### 2. Physics Should Create Decisions

A bounce should matter because it:

- saves a life;
- triggers a tower;
- spreads an effect;
- creates a chain;
- buys time.

### 3. Every Defense Needs a Role

Do not create five paddles that only differ by damage numbers.

Each should solve a different problem.

### 4. Keep the Board Readable

Difficulty should come from interesting combinations, not visual clutter.

### 5. Make Big Hits Feel Huge

The game's strongest selling point is the satisfaction of turning incoming threats into weapons.

### 6. Keep Progression Visible During the Session

A judge should experience:

- stronger defenses;
- harder waves;
- new decisions;
- at least one major escalation;

within a single play session.

---

# 32. Core Game Identity

The simplest way to describe the game is:

> **A tower defense game played on a pinball table, where you build automatic paddles and bumpers, then use pinball physics to turn the invading enemy balls against each other.**

The three things the player should remember after playing are:

1. **I was building and upgrading a pinball machine as my defense.**
2. **I was still physically saving shots with the flippers myself.**
3. **The coolest moments came from launching enemy balls back into the swarm and causing massive chain reactions.**

That is the heart of the game.
