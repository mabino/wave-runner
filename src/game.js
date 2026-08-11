/**
 * Wave Runner game engine — a pure, deterministic simulation.
 *
 * All randomness flows through the injected rng and all time through tick(dt),
 * so tests can step the clock manually and force any scenario. The engine
 * never touches timers, sockets, or Date — the server drives it.
 *
 * World coordinates: 100 x 100 units. y=0 is the far ocean (top of screen),
 * y=100 the back of the beach. The sand occupies the lower third (y >= 66);
 * waves roll from the top and break at the sand line.
 */

const DAY_START_HOUR = 9;   // beach opens 9 AM
const DAY_END_HOUR = 19;    // end of the day 7 PM

const DEFAULTS = {
  dayLengthSec: 420,        // real seconds for the whole beach day
  maxHp: 100,

  beachY: 66,               // mean waterline; y >= waterline() is sand
  deepY: 22,                // y < deepY is too far out (lifeguard territory)
  flagMinX: 20,             // swim between the flags
  flagMaxX: 80,

  // Tide: the waterline breathes through the day, shrinking the beach at
  // high tide and slowing/speeding the surf.
  tideAmp: 8,               // waterline swing in world units
  tideCycles: 2,            // full high/low cycles per day
  tideSpeedGain: 0.25,      // wave speed factor at extreme tide

  waveSlopeStep: 0.05,      // per-wave drift of the approach angle
  waveSlopeCap: 0.1,        // extra slope allowance earned across the day

  waveIntervalMin: 3.5,     // seconds between wave spawns
  waveIntervalMax: 7,
  hitRange: 3,              // wave front proximity that triggers resolution

  jumpDuration: 0.9,        // airtime seconds
  diveDuration: 1.4,        // underwater seconds
  actionCooldown: 0.5,
  diveHpCost: 2,            // diving is tiring...
  diveRideBonus: 5,         // ...but pays better when it lands
  digDuration: 2,           // seconds buried when "diving" on the sand

  walkSpeed: 16,            // units/sec on sand
  swimSpeed: 10,            // units/sec in water
  runSpeedFactor: 1.6,      // hold-to-run / sprint-swim multiplier
  runHpPerSec: 1.5,         // running is tiring, but never drops below 1 HP
  runMaxSec: 2.5,           // continuous sprint budget before winding
  runCooldownSec: 3,        // breather before the next sprint
  washStunSec: 2,           // tumble time after a wipeout
  restRegenPerSec: 2.5,     // umbrella HP regen

  outWarnSec: 2,            // out-of-bounds grace before the whistle
  outPenaltySec: 6,         // ... before the lifeguard hauls you in
  outPenaltyDamage: 20,

  lightningMinGap: 4,       // seconds between strikes during a storm hour
  lightningMaxGap: 9,
  lightningDamage: 55,

  planeMinGap: 22,          // seconds between banner-plane passes
  planeMaxGap: 40,
  powerupDropDelay: 1.6,    // plane heard -> item splashes down
  powerupTtl: 12,           // seconds before an item washes away
  pickupRadius: 4.5,        // must actually intersect an item to grab it
  sunscreenHeal: 35,
  buffDurations: { bodysuit: 45, bodyboard: 20, blanket: 30 },

  // Salps: harmless drifting tentacle-clusters worth Pleasant Points to
  // anyone carrying a pail — except the odd one that is really a jellyfish
  // whose cap sits just under the surface.
  salpMinGap: 10,   salpMaxGap: 22,   salpTtl: 18,
  salpPoints: 15,   salpJellyChance: 0.2,

  // Shove acquisition range in world units. Precise touch positioning is
  // hard, so the shover LUNGES to the nearest swimmer in this range and
  // connects on contact — the range is what you'd read as "near me".
  // NPCs get no such generosity: they must genuinely close the distance.
  shoveRadius: 25,
  npcShoveRadius: 12,
  shoveCooldown: 3,
  shoveDamage: 5,

  // Wildlife hazards. Gaps are deliberately short — a beach day is only a
  // few real minutes, and creatures that first appear a minute in are
  // effectively invisible to players who wipe out early.
  hazardRadius: 5,
  sharkMinGap: 30,  sharkMaxGap: 60,  sharkSpeed: 22, sharkDamage: 30,
  jellyMinGap: 15,  jellyMaxGap: 30,  jellyTtl: 20,   jellyDamage: 12,
  crabMinGap: 12,   crabMaxGap: 30,   crabSpeed: 7,   crabDamage: 6,
  // The gull polls often; a raid fires whenever an unclaimed item is on the
  // ground. Approach time varies per raid so some birds are beatable sprints
  // and others are leisurely glides.
  gullMinGap: 6,    gullMaxGap: 12,   gullSnatchMin: 2.2,  gullSnatchMax: 4.5,
};

// Per-size wave characteristics. Bigger waves run faster, hit harder and pay
// better. The client renders the size difference subtly (foam height/shadow).
const WAVE_TYPES = {
  1: { speed: 9,  damage: 12, points: 10 },   // ripple  — survivable standing
  2: { speed: 11, damage: 24, points: 25 },   // roller  — jump or dive
  3: { speed: 13, damage: 36, points: 45 },   // thumper — dive only
};

const WEATHER = ['sunny', 'cloudy', 'storm'];

// Optional computer-controlled beachgoers, in escalating order of menace.
// aggression drives shoving and prey-stalking; skill drives wave reading;
// pace scales movement speed — Pete darts, Bruiser lumbers.
const NPC_ROSTER = [
  { id: 'npc-mel',     name: 'Mellow Mel',  aggression: 0.25, pace: 0.9,  avatar: { archetype: 5, skin: 1, outfit: 2 } },
  { id: 'npc-pete',    name: 'Pushy Pete',  aggression: 0.55, pace: 1.15, avatar: { archetype: 1, skin: 0, outfit: 3 } },
  { id: 'npc-bruiser', name: 'Big Bruiser', aggression: 0.9,  pace: 0.7,  avatar: { archetype: 3, skin: 2, outfit: 0 } },
];

class WaveRunnerGame {
  constructor(config = {}, rng = Math.random) {
    this.cfg = { ...DEFAULTS, ...config };
    this.rng = rng;
    this.t = 0;
    this.phase = 'running';           // 'running' | 'over'
    this.players = {};
    this.waves = [];
    this.powerups = [];
    this.hazards = [];                // sharks, jellyfish, crabs
    this.salps = [];                  // collectible drifters (some disguised)
    this.gullRaid = null;             // a seagull eyeing a power-up
    this.events = [];
    this.seq = 0;
    this.multiplayer = null;          // decided on the first tick
    this.waveSlope = 0;               // current approach angle (dy per dx)

    this.hours = this._generateWeather();
    this.nextWaveAt = this._rand(this.cfg.waveIntervalMin, this.cfg.waveIntervalMax);
    this.nextPlaneAt = this._rand(this.cfg.planeMinGap, this.cfg.planeMaxGap);
    this.pendingDropAt = null;
    this.nextLightningAt = null;
    this.nextSharkAt = this._rand(this.cfg.sharkMinGap, this.cfg.sharkMaxGap);
    this.nextJellyAt = this._rand(this.cfg.jellyMinGap, this.cfg.jellyMaxGap);
    this.nextCrabAt = this._rand(this.cfg.crabMinGap, this.cfg.crabMaxGap);
    this.nextGullAt = this._rand(this.cfg.gullMinGap, this.cfg.gullMaxGap);
    this.nextSalpAt = this._rand(this.cfg.salpMinGap, this.cfg.salpMaxGap);
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  _rand(min, max) { return min + this.rng() * (max - min); }

  _generateWeather() {
    // One slot per beach hour. The first two hours are always calm so nobody
    // is struck before the forecast bar has had a chance to matter.
    const slots = [];
    for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
      const i = h - DAY_START_HOUR;
      if (i < 2) {
        slots.push(this.rng() < 0.6 ? 'sunny' : 'cloudy');
      } else {
        const r = this.rng();
        slots.push(r < 0.25 ? 'storm' : r < 0.7 ? 'sunny' : 'cloudy');
      }
    }
    return slots;
  }

  addPlayer(id, name, avatar) {
    const n = Object.keys(this.players).length;
    this.players[id] = {
      id, name,
      avatar: avatar || { archetype: 0, skin: 0, outfit: 0 },
      x: 28 + ((n * 9) % 45),
      y: this.cfg.beachY + 10,
      hp: this.cfg.maxHp,
      score: 0,
      streak: 0,
      bestStreak: 0,
      wavesRidden: 0,
      powerupsCollected: 0,
      damageTaken: 0,
      state: 'idle',                 // idle | resting | washed | out
      facing: 'down',                // last direction of travel: up|down|left|right
      moving: false,
      running: false,
      runStartedAt: null,            // sprint stamina bookkeeping
      runReadyAt: 0,
      action: null,                  // { type, startedAt, until }
      cooldownUntil: 0,
      target: null,
      steer: null,                   // held-key direction vector
      pendingRest: false,
      pendingPickup: null,
      washedUntil: 0,
      buffs: { bodysuit: 0, bodyboard: 0, blanket: 0 },
      pail: false,                   // equipment, kept for the day
      shoveReadyAt: 0,
      outSince: null,
      whistled: false,
      eliminatedAtHour: null,
    };
  }

  removePlayer(id) { delete this.players[id]; }

  addNpcs(count) {
    for (const spec of NPC_ROSTER.slice(0, Math.max(0, Math.min(NPC_ROSTER.length, count)))) {
      this.addPlayer(spec.id, spec.name, spec.avatar);
      this.players[spec.id].npc = {
        aggression: spec.aggression,
        skill: 0.55 + 0.25 * spec.aggression,
        pace: spec.pace,
        nextDecisionAt: 0,
      };
    }
  }

  // ─── Clock & weather ──────────────────────────────────────────────────────

  clockHour() {
    return DAY_START_HOUR + (this.t / this.cfg.dayLengthSec) * (DAY_END_HOUR - DAY_START_HOUR);
  }

  hourIndex() {
    return Math.min(this.hours.length - 1, Math.floor(this.clockHour()) - DAY_START_HOUR);
  }

  weatherNow() { return this.hours[this.hourIndex()]; }

  // ─── Tide ─────────────────────────────────────────────────────────────────

  // -1 (low) .. +1 (high), sinusoidal across the day.
  tide() {
    return Math.sin(2 * Math.PI * this.cfg.tideCycles * (this.t / this.cfg.dayLengthSec));
  }

  tideRising() {
    return Math.cos(2 * Math.PI * this.cfg.tideCycles * (this.t / this.cfg.dayLengthSec)) > 0;
  }

  // The actual sand line right now: high tide pushes it down-screen,
  // eating beach space; low tide exposes more sand.
  waterline() {
    return this.cfg.beachY + this.cfg.tideAmp * this.tide();
  }

  forecast() {
    const i = this.hourIndex();
    return {
      now: this.hours[i],
      next1: this.hours[i + 1] || null,
      next2: this.hours[i + 2] || null,
    };
  }

  // ─── Input handlers (called by the server on socket events) ───────────────

  handleMove(id, x, y, run) {
    const p = this.players[id];
    if (!p || p.state === 'out' || p.state === 'washed' || this.phase !== 'running') return;
    if (p.state === 'resting') p.state = 'idle';   // stand up and walk
    p.pendingRest = false;
    p.pendingPickup = null;
    p.steer = null;
    p.target = {
      x: Math.max(2, Math.min(98, Number(x) || 0)),
      y: Math.max(8, Math.min(92, Number(y) || 0)),
      run: !!run,
    };
  }

  // Continuous movement (desktop WASD/arrows): a held direction vector.
  handleSteer(id, dx, dy, run) {
    const p = this.players[id];
    if (!p || p.state === 'out' || p.state === 'washed' || this.phase !== 'running') return;
    const vx = Number(dx) || 0;
    const vy = Number(dy) || 0;
    const mag = Math.hypot(vx, vy);
    if (!mag) { p.steer = null; return; }
    if (p.state === 'resting') p.state = 'idle';
    p.pendingRest = false;
    p.pendingPickup = null;
    p.target = null;
    p.steer = { x: vx / mag, y: vy / mag, run: !!run };
  }

  handleAction(id, type) {
    const p = this.players[id];
    if (!p || p.state === 'out' || p.state === 'washed' || p.state === 'resting') return;
    if (this.phase !== 'running') return;
    if (type === 'stand') {
      // Standing is a real recovery move, not just the idle default: bailing
      // out of a jump/dive collapses most of the remaining cooldown so a
      // misread can be corrected with a quick second action.
      if (p.action) {
        p.action = null;
        p.cooldownUntil = Math.min(p.cooldownUntil, this.t + 0.25);
      }
      return;
    }
    if (type !== 'jump' && type !== 'dive') return;
    if (this.t < p.cooldownUntil) return;
    if (type === 'dive' && p.y >= this.waterline()) {
      // On the sand, diving becomes digging in: a brief burrow that shrugs
      // off shoves, crab pinches, and lightning. Free, but you can't move.
      p.action = { type: 'dig', startedAt: this.t, until: this.t + this.cfg.digDuration };
      p.cooldownUntil = p.action.until + this.cfg.actionCooldown;
      p.target = null;
      p.steer = null;
      return;
    }
    const dur = type === 'jump' ? this.cfg.jumpDuration : this.cfg.diveDuration;
    // Exertion: each dive costs a little HP, but never knocks a player out.
    if (type === 'dive') p.hp = Math.max(1, p.hp - this.cfg.diveHpCost);
    p.action = { type, startedAt: this.t, until: this.t + dur };
    p.cooldownUntil = p.action.until + this.cfg.actionCooldown;
  }

  handleRest(id) {
    const p = this.players[id];
    if (!p || p.state === 'out' || p.state === 'washed' || this.phase !== 'running') return;
    if (p.state === 'resting') { p.state = 'idle'; return; }
    if (p.y >= this.waterline()) {
      p.state = 'resting';
      p.target = null;
      p.steer = null;
      p.action = null;
    } else {
      // Tapping the umbrella from the water: swim in, then settle.
      p.pendingRest = true;
      p.pendingPickup = null;
      p.steer = null;
      p.target = { x: Math.max(25, Math.min(75, p.x)), y: Math.min(90, this.waterline() + 10) };
    }
  }

  handleTapPowerup(id, powerupId) {
    const p = this.players[id];
    if (!p || p.state === 'out' || p.state === 'washed' || this.phase !== 'running') return;
    const pu = this.powerups.find(u => u.id === powerupId);
    if (!pu) return;
    // Tapping never grabs at range: it marks the item and walks the player
    // over; collection happens only on intersection.
    if (this._dist(p, pu) <= this.cfg.pickupRadius) {
      this._collect(p, pu);
    } else {
      if (p.state === 'resting') p.state = 'idle';
      p.pendingRest = false;
      p.pendingPickup = pu.id;
      p.target = { x: pu.x, y: pu.y };
    }
  }

  handleShove(id) {
    const p = this.players[id];
    if (!p || p.state !== 'idle' || this.phase !== 'running') return;
    if (this.t < p.shoveReadyAt) return;
    // No shoving from under the water or under the sand.
    if (this._actionActive(p, 'dive') || this._actionActive(p, 'dig')) return;

    // Nearest other beachgoer within arm's reach who is in the water —
    // and reachable: a diver is under the surface, a digger under the sand.
    // The lunge-assist range compensates humans for touch imprecision;
    // NPCs have perfect aim, so their reach is much shorter.
    let target = null;
    let best = p.npc ? this.cfg.npcShoveRadius : this.cfg.shoveRadius;
    for (const q of this._alivePlayers()) {
      if (q.id === id || q.state === 'washed' || q.y >= this.waterline()) continue;
      if (this._actionActive(q, 'dive') || this._actionActive(q, 'dig')) continue;
      const d = this._dist(p, q);
      if (d <= best) { best = d; target = q; }
    }
    if (!target) {
      // A whiffed shove costs nothing but tells the player it registered.
      this._emit({ type: 'shove-miss', playerId: id });
      return;
    }

    p.shoveReadyAt = this.t + this.cfg.shoveCooldown;

    // Lunge to contact: close the gap for the shover so touch positioning
    // doesn't have to be pixel-perfect.
    p.x = Math.max(2, Math.min(98, target.x + (p.x <= target.x ? -3 : 3)));
    p.y = Math.max(8, Math.min(92, target.y));
    p.target = null;
    p.pendingRest = false;
    p.pendingPickup = null;

    if (this.t < target.buffs.blanket) {
      this._emit({ type: 'shove', shoverId: id, playerId: target.id, blocked: true });
      return;
    }

    target.streak = 0;
    this._washAshore(target);
    this._emit({ type: 'shove', shoverId: id, playerId: target.id, blocked: false });
    this._applyDamage(target, this.cfg.shoveDamage, 'shove');
  }

  // ─── Simulation ───────────────────────────────────────────────────────────

  tick(dt) {
    if (this.phase !== 'running') return [];
    if (this.multiplayer === null) this.multiplayer = Object.keys(this.players).length >= 2;
    this.t += dt;

    if (this.clockHour() >= DAY_END_HOUR) {
      this._endGame('end-of-day');
      return this._drainEvents();
    }

    this._spawnWaves();
    this._advanceWaves(dt);
    this._npcTick();
    this._movePlayers(dt);
    this._lifeguard(dt);
    this._weatherHazards();
    this._planeAndPowerups();
    this._wildlife(dt);
    this._expireBuffsAndPowerups();

    const humans = Object.values(this.players).filter(p => !p.npc);
    if (this._allOut()) {
      this._endGame('wiped-out');
    } else if (humans.length > 0 && humans.every(h => h.state === 'out')) {
      // NPCs still splashing around don't keep a day alive once every real
      // beachgoer is out.
      this._endGame('wiped-out');
    } else if (this.multiplayer) {
      // A multiplayer day with one beachgoer left (others eliminated or
      // gone) ends immediately — last one standing wins by default.
      const active = Object.values(this.players).filter(p => p.state !== 'out');
      if (active.length === 1) this._endGame('last-one-standing');
    }
    return this._drainEvents();
  }

  _drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  _emit(ev) { this.events.push({ ...ev, t: this.t }); }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  _actionActive(p, type) {
    return !!p.action && p.action.type === type && this.t <= p.action.until;
  }

  // Dump a player onto the sand, briefly stunned — the shared fate of
  // wipeouts, lifeguard hauls, and shoves.
  _washAshore(p, clampX = null) {
    if (clampX) p.x = Math.max(clampX[0], Math.min(clampX[1], p.x));
    p.y = Math.min(90, this.waterline() + 8);
    p.state = 'washed';
    p.washedUntil = this.t + this.cfg.washStunSec;
    p.target = null;
    p.steer = null;
    p.action = null;
    p.pendingRest = false;
    p.pendingPickup = null;
  }

  _alivePlayers() {
    return Object.values(this.players).filter(p => p.state !== 'out');
  }

  _allOut() {
    const ps = Object.values(this.players);
    return ps.length > 0 && ps.every(p => p.state === 'out');
  }

  // ─── Waves ────────────────────────────────────────────────────────────────

  _spawnWaves() {
    while (this.t >= this.nextWaveAt) {
      // Ocean gets rougher as the day goes on: the large-wave share grows.
      const dayFrac = Math.min(1, this.t / this.cfg.dayLengthSec);
      const r = this.rng();
      const size = r < 0.45 - 0.15 * dayFrac ? 1 : r < 0.85 - 0.1 * dayFrac ? 2 : 3;
      // The approach angle wanders wave to wave, and the allowance grows as
      // the day goes on — late-day sets come in visibly slanted.
      const cap = 0.03 + this.cfg.waveSlopeCap * dayFrac;
      this.waveSlope = Math.max(-cap, Math.min(cap,
        this.waveSlope + this._rand(-this.cfg.waveSlopeStep, this.cfg.waveSlopeStep)));
      this.waves.push({
        id: `w${this.seq++}`,
        size,
        y: 0,
        slope: this.waveSlope,              // front tilt: dy per dx from center
        wobble: this.rng() * Math.PI * 2,   // client-side rendering phase
        resolved: new Set(),
      });
      this.nextWaveAt += this._rand(this.cfg.waveIntervalMin, this.cfg.waveIntervalMax);
    }
  }

  // A wave front's y position at a given x, honoring its tilt.
  _waveFrontY(w, x) {
    return w.y + (w.slope || 0) * (x - 50);
  }

  _advanceWaves(dt) {
    const waterline = this.waterline();
    // High tide runs faster surf; low tide drags it.
    const speedFactor = 1 + this.cfg.tideSpeedGain * this.tide();
    for (const w of this.waves) {
      w.y += WAVE_TYPES[w.size].speed * speedFactor * dt;
      for (const p of this._alivePlayers()) {
        if (p.y >= waterline) continue;                // on the sand — safe
        if (w.resolved.has(p.id)) continue;
        if (this._waveFrontY(w, p.x) >= p.y - this.cfg.hitRange) {
          w.resolved.add(p.id);
          this._resolveWave(w, p);
        }
      }
    }
    // A tilted wave is fully broken once its trailing edge passes the sand.
    this.waves = this.waves.filter(w => w.y - Math.abs(w.slope || 0) * 50 < this.waterline());
  }

  _resolveWave(w, p) {
    const spec = WAVE_TYPES[w.size];
    const boarding = this.t < p.buffs.bodyboard;
    const act = p.action && this.t <= p.action.until ? p.action : null;
    const survives = boarding
      || w.size === 1
      || (w.size === 2 && act && (act.type === 'jump' || act.type === 'dive'))
      || (w.size === 3 && act && act.type === 'dive');

    if (survives) {
      // Timing quality: acting in the first 60% of the window is a clean read
      // of the wave and pays a small bonus.
      const perfect = !!act && (this.t - act.startedAt) <= (act.until - act.startedAt) * 0.6;
      // Riding under a dive pays a premium — the flip side of its HP cost.
      const diveBonus = act && act.type === 'dive' ? this.cfg.diveRideBonus : 0;
      p.streak += 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.wavesRidden += 1;
      p.score += spec.points + 2 * (p.streak - 1) + (perfect ? 5 : 0) + diveBonus;
      this._emit({ type: 'wave-result', playerId: p.id, outcome: 'ride', size: w.size, perfect, streak: p.streak });
    } else {
      p.streak = 0;
      // Wiped out: washed up on the sand to sit it out for a moment.
      this._washAshore(p);
      this._emit({ type: 'wave-result', playerId: p.id, outcome: 'wiped', size: w.size });
      this._applyDamage(p, spec.damage, 'wave');
    }
  }

  // ─── Player movement & recovery ───────────────────────────────────────────

  _movePlayers(dt) {
    const waterline = this.waterline();
    for (const p of Object.values(this.players)) {
      // A sprint that stopped for any reason — released, arrived, washed,
      // resting — starts the breather before the next one.
      if (!p.running && p.runStartedAt !== null) {
        p.runReadyAt = this.t + this.cfg.runCooldownSec;
        p.runStartedAt = null;
      }
      p.moving = false;
      p.running = false;
      if (p.state === 'out') continue;

      if (p.state === 'washed') {
        if (this.t >= p.washedUntil) p.state = 'idle';
        continue;
      }

      if (p.state === 'resting') {
        // The rising tide can flood a napping spot — up you get.
        if (p.y < waterline) { p.state = 'idle'; continue; }
        p.hp = Math.min(this.cfg.maxHp, p.hp + this.cfg.restRegenPerSec * dt);
        continue;
      }

      if (p.action && this.t > p.action.until) p.action = null;

      // Buried players stay put until they surface.
      if (this._actionActive(p, 'dig')) continue;

      const wasX = p.x;
      const wasY = p.y;
      // The run flag stays on the input, so a sprint held through the
      // breather surges again the moment stamina returns.
      const wantsRun = !!(p.steer ? p.steer.run : p.target && p.target.run)
        && this.t >= p.runReadyAt;
      const speed = (p.y < waterline ? this.cfg.swimSpeed : this.cfg.walkSpeed)
        * (p.npc ? p.npc.pace : 1)
        * (wantsRun ? this.cfg.runSpeedFactor : 1);

      if (p.steer) {
        p.x = Math.max(2, Math.min(98, p.x + p.steer.x * speed * dt));
        p.y = Math.max(8, Math.min(92, p.y + p.steer.y * speed * dt));
      } else if (p.target) {
        const d = this._dist(p, p.target);
        const step = speed * dt;
        if (d <= step) {
          p.x = p.target.x;
          p.y = p.target.y;
          p.target = null;
          if (p.pendingRest && p.y >= waterline) {
            p.pendingRest = false;
            p.state = 'resting';
          }
        } else {
          p.x += ((p.target.x - p.x) / d) * step;
          p.y += ((p.target.y - p.y) / d) * step;
        }
      }

      // Orientation & animation flags come from actual displacement, so a
      // player pinned against the world edge stops "walking" in place.
      const mdx = p.x - wasX;
      const mdy = p.y - wasY;
      if (mdx || mdy) {
        p.moving = true;
        p.facing = Math.abs(mdx) >= Math.abs(mdy)
          ? (mdx > 0 ? 'right' : 'left')
          : (mdy > 0 ? 'down' : 'up');
        if (wantsRun) {
          p.running = true;
          if (p.runStartedAt === null) p.runStartedAt = this.t;
          // Sprinting burns HP, but like diving it can never knock you out.
          p.hp = Math.max(1, p.hp - this.cfg.runHpPerSec * dt);
          if (this.t - p.runStartedAt >= this.cfg.runMaxSec) {
            // Winded: the sprint expires on its own and needs a breather.
            p.running = false;
            p.runStartedAt = null;
            p.runReadyAt = this.t + this.cfg.runCooldownSec;
            this._emit({ type: 'winded', playerId: p.id });
          }
        }
      }

      if (p.pendingPickup && !this.powerups.find(u => u.id === p.pendingPickup)) {
        p.pendingPickup = null;
      }
      // Walk-over pickup: intersecting an item grabs it, tapped or not.
      for (const pu of [...this.powerups]) {
        if (this._dist(p, pu) <= this.cfg.pickupRadius) this._collect(p, pu);
      }
    }
  }

  // ─── NPC beachgoers ───────────────────────────────────────────────────────

  // Simple decision loop, run through the same input handlers as real
  // players so every rule (cooldowns, dive cost, lunge, blankets) applies.
  _npcTick() {
    const waterline = this.waterline();
    const speedFactor = 1 + this.cfg.tideSpeedGain * this.tide();

    for (const p of Object.values(this.players)) {
      if (!p.npc || p.state === 'out' || p.state === 'washed') continue;

      // Wave reading runs every tick — the reaction window is sub-second.
      if (p.state === 'idle' && p.y < waterline && !p.action) {
        let threat = null;
        let soonest = Infinity;
        for (const w of this.waves) {
          if (w.resolved.has(p.id) || w.size === 1) continue;
          const gap = (p.y - this.cfg.hitRange) - this._waveFrontY(w, p.x);
          if (gap <= 0) continue;
          const eta = gap / (WAVE_TYPES[w.size].speed * speedFactor);
          if (eta < soonest) { soonest = eta; threat = w; }
        }
        if (threat && soonest <= 0.45) {
          if (this.rng() < p.npc.skill) {
            this.handleAction(p.id, threat.size === 3 || this.rng() < 0.5 ? 'dive' : 'jump');
          } else if (this.rng() < 0.4) {
            this.handleAction(p.id, 'jump');   // panic jump — fatal vs thumpers
          }
        }
      }

      // Everything else on a coarser cadence.
      if (this.t < p.npc.nextDecisionAt) continue;
      p.npc.nextDecisionAt = this.t + 0.3;

      if (p.state === 'resting') {
        if (p.hp > 65) this.handleRest(p.id);   // rested enough — back at it
        continue;
      }

      // Self-preservation: lick wounds under the umbrella, flee storms
      // (the meaner they are, the longer they tempt the lightning).
      if (p.hp < 25 && !p.pendingRest) { this.handleRest(p.id); continue; }
      if (this.weatherNow() === 'storm' && p.y < waterline && !p.pendingRest
          && this.rng() < 0.3 * (1 - p.npc.aggression * 0.6)) {
        this.handleRest(p.id);
        continue;
      }

      // Aggression: shove anyone within (their shorter) reach.
      if (this.t >= p.shoveReadyAt && this.rng() < p.npc.aggression * 0.35) {
        const near = this._alivePlayers().some(q =>
          q.id !== p.id && q.state !== 'washed' && q.y < waterline &&
          this._dist(p, q) <= this.cfg.npcShoveRadius);
        if (near) { this.handleShove(p.id); continue; }
      }

      if (!p.target && !p.steer) {
        // Loot interest.
        if (this.powerups.length && this.rng() < 0.3) {
          const pu = this.powerups[Math.floor(this.rng() * this.powerups.length)];
          this.handleTapPowerup(p.id, pu.id);
          continue;
        }
        // Bullies stalk the nearest swimmer; everyone else just plays the surf.
        const prey = this._alivePlayers()
          .filter(q => q.id !== p.id && !q.npc && q.y < waterline)
          .sort((a, b) => this._dist(p, a) - this._dist(p, b))[0];
        if (prey && this.rng() < p.npc.aggression * 0.5) {
          this.handleMove(p.id, prey.x, prey.y);
        } else if (this.rng() < 0.5) {
          this.handleMove(p.id,
            this._rand(this.cfg.flagMinX + 5, this.cfg.flagMaxX - 5),
            this._rand(this.cfg.deepY + 8, waterline - 6));
        }
      }
    }
  }

  // ─── Lifeguard ────────────────────────────────────────────────────────────

  _lifeguard(dt) {
    for (const p of this._alivePlayers()) {
      const inWater = p.y < this.waterline();
      const outOfBounds = inWater &&
        (p.x < this.cfg.flagMinX || p.x > this.cfg.flagMaxX || p.y < this.cfg.deepY);

      if (!outOfBounds) {
        p.outSince = null;
        p.whistled = false;
        continue;
      }

      if (p.outSince === null) p.outSince = this.t;
      const overdue = this.t - p.outSince;

      if (!p.whistled && overdue >= this.cfg.outWarnSec) {
        p.whistled = true;
        this._emit({ type: 'whistle', playerId: p.id });
      }
      if (overdue >= this.cfg.outPenaltySec) {
        // Hauled back to the sand, shaken and docked.
        this._washAshore(p, [40, 60]);
        p.outSince = null;
        p.whistled = false;
        this._emit({ type: 'lifeguard-penalty', playerId: p.id });
        this._applyDamage(p, this.cfg.outPenaltyDamage, 'lifeguard');
      }
    }
  }

  // ─── Weather & lightning ──────────────────────────────────────────────────

  _weatherHazards() {
    if (this.weatherNow() !== 'storm') {
      this.nextLightningAt = null;
      return;
    }
    if (this.nextLightningAt === null) {
      this.nextLightningAt = this.t + this._rand(this.cfg.lightningMinGap, this.cfg.lightningMaxGap);
    }
    if (this.t >= this.nextLightningAt) {
      this.nextLightningAt = this.t + this._rand(this.cfg.lightningMinGap, this.cfg.lightningMaxGap);
      const swimmers = this._alivePlayers()
        .filter(p => p.y < this.waterline() && !this._actionActive(p, 'dig'));
      if (swimmers.length === 0) {
        this._emit({ type: 'lightning', playerId: null });
        return;
      }
      const target = swimmers[Math.floor(this.rng() * swimmers.length)];
      const blocked = this.t < target.buffs.bodysuit;
      this._emit({ type: 'lightning', playerId: target.id, blocked });
      if (!blocked) this._applyDamage(target, this.cfg.lightningDamage, 'lightning');
    }
  }

  // ─── Banner plane & power-ups ─────────────────────────────────────────────

  _planeAndPowerups() {
    if (this.t >= this.nextPlaneAt) {
      this.nextPlaneAt = this.t + this._rand(this.cfg.planeMinGap, this.cfg.planeMaxGap);
      this.pendingDropAt = this.t + this.cfg.powerupDropDelay;
      this._emit({ type: 'plane' });
    }
    if (this.pendingDropAt !== null && this.t >= this.pendingDropAt) {
      this.pendingDropAt = null;
      const r = this.rng();
      const type = r < 0.3 ? 'sunscreen'
        : r < 0.5 ? 'bodyboard'
        : r < 0.65 ? 'bodysuit'
        : r < 0.8 ? 'blanket'
        : 'pail';
      const pu = {
        id: `p${this.seq++}`,
        type,
        x: this._rand(12, 88),
        y: this._rand(this.cfg.deepY + 8, Math.min(88, this.waterline() + 14)),
        expiresAt: this.t + this.cfg.powerupTtl,
      };
      this.powerups.push(pu);
      this._emit({ type: 'powerup-drop', powerup: { id: pu.id, type: pu.type, x: pu.x, y: pu.y } });
    }
  }

  // ─── Wildlife: sharks, jellyfish, crabs, thieving gulls ──────────────────

  _wildlife(dt) {
    const cfg = this.cfg;
    const waterline = this.waterline();

    if (this.t >= this.nextSharkAt) {
      this.nextSharkAt = this.t + this._rand(cfg.sharkMinGap, cfg.sharkMaxGap);
      const fromLeft = this.rng() < 0.5;
      this.hazards.push({
        id: `h${this.seq++}`, kind: 'shark',
        x: fromLeft ? -4 : 104,
        y: this._rand(cfg.deepY + 4, waterline - 8),
        vx: (fromLeft ? 1 : -1) * cfg.sharkSpeed, vy: 0,
        hit: new Set(), expiresAt: Infinity,
      });
      this._emit({ type: 'shark' });
    }

    if (this.t >= this.nextJellyAt) {
      this.nextJellyAt = this.t + this._rand(cfg.jellyMinGap, cfg.jellyMaxGap);
      this.hazards.push({
        id: `h${this.seq++}`, kind: 'jelly',
        x: this._rand(12, 88),
        y: this._rand(cfg.deepY + 2, waterline - 8),
        vx: this._rand(-1.5, 1.5), vy: this._rand(0.2, 0.8),
        hit: new Set(), expiresAt: this.t + cfg.jellyTtl,
      });
      this._emit({ type: 'jelly' });
    }

    if (this.t >= this.nextCrabAt) {
      this.nextCrabAt = this.t + this._rand(cfg.crabMinGap, cfg.crabMaxGap);
      const fromLeft = this.rng() < 0.5;
      this.hazards.push({
        id: `h${this.seq++}`, kind: 'crab',
        x: fromLeft ? -4 : 104,
        y: this._rand(Math.min(86, waterline + 6), 88),
        vx: (fromLeft ? 1 : -1) * cfg.crabSpeed, vy: 0,
        hit: new Set(), expiresAt: Infinity,
      });
      this._emit({ type: 'crab' });
    }

    // A gull picks a mark among the dropped items; grab it first or lose it.
    // Each bird flies its own line: a random entry point and its own pace,
    // so some raids are beatable sprints and others slow glides.
    if (this.t >= this.nextGullAt) {
      this.nextGullAt = this.t + this._rand(cfg.gullMinGap, cfg.gullMaxGap);
      if (!this.gullRaid && this.powerups.length) {
        const pu = this.powerups[Math.floor(this.rng() * this.powerups.length)];
        this.gullRaid = {
          powerupId: pu.id, x: pu.x, y: pu.y,
          fromX: this._rand(5, 95),
          start: this.t,
          at: this.t + this._rand(cfg.gullSnatchMin, cfg.gullSnatchMax),
        };
        this._emit({ type: 'gull-swoop', powerupId: pu.id, x: pu.x, y: pu.y });
      }
    }
    if (this.gullRaid) {
      const pu = this.powerups.find(u => u.id === this.gullRaid.powerupId);
      if (!pu) {
        this.gullRaid = null;   // someone beat the bird to it
      } else if (this.t >= this.gullRaid.at) {
        this.powerups = this.powerups.filter(u => u.id !== pu.id);
        this._emit({ type: 'gull-steal', powerupId: pu.id, powerupType: pu.type, x: pu.x, y: pu.y });
        this.gullRaid = null;
      }
    }

    // Salps drift like jellyfish tentacles with no cap in sight — and one
    // in five IS a jellyfish, cap hidden below the surface. Only players
    // carrying a pail interact with them: scoop one for Pleasant Points, or
    // discover the disguise the hard way.
    if (this.t >= this.nextSalpAt) {
      this.nextSalpAt = this.t + this._rand(cfg.salpMinGap, cfg.salpMaxGap);
      this.salps.push({
        id: `s${this.seq++}`,
        x: this._rand(12, 88),
        y: this._rand(cfg.deepY + 2, waterline - 8),
        vx: this._rand(-1.2, 1.2), vy: this._rand(0.15, 0.5),
        sting: this.rng() < cfg.salpJellyChance,
        expiresAt: this.t + cfg.salpTtl,
      });
    }
    for (const s of [...this.salps]) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < 6 || s.x > 94) s.vx = -s.vx;
      s.y = Math.min(s.y, waterline - 4);
      for (const p of this._alivePlayers()) {
        if (!p.pail || p.state === 'washed' || p.y >= waterline) continue;
        if (this._dist(p, s) > cfg.pickupRadius) continue;
        this.salps = this.salps.filter(u => u.id !== s.id);
        if (s.sting) {
          this._emit({ type: 'salp-sting', playerId: p.id });
          this._applyDamage(p, cfg.jellyDamage, 'jelly');
        } else {
          p.score += cfg.salpPoints;
          this._emit({ type: 'salp-collected', playerId: p.id, points: cfg.salpPoints });
        }
        break;
      }
    }
    this.salps = this.salps.filter(s => this.t < s.expiresAt);

    for (const h of this.hazards) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.kind === 'jelly') {
        if (h.x < 6 || h.x > 94) h.vx = -h.vx;
        h.y = Math.min(h.y, waterline - 4);    // jellyfish stay in the water
      } else if (h.kind === 'crab') {
        h.y = Math.max(h.y, waterline + 3);    // crabs retreat from the tide
      }

      for (const p of this._alivePlayers()) {
        if (p.state === 'washed') continue;
        const inWater = p.y < waterline;
        const d = this._dist(p, h);

        if (h.kind === 'shark' && inWater && d <= cfg.hazardRadius + 1 && !h.hit.has(p.id)) {
          h.hit.add(p.id);
          p.streak = 0;
          this._washAshore(p);
          this._emit({ type: 'shark-attack', playerId: p.id });
          this._applyDamage(p, cfg.sharkDamage, 'shark');
        } else if (h.kind === 'jelly' && inWater && d <= cfg.hazardRadius - 1) {
          h.expiresAt = 0;                     // spent on the sting
          this._emit({ type: 'jelly-sting', playerId: p.id });
          this._applyDamage(p, cfg.jellyDamage, 'jelly');
          break;
        } else if (h.kind === 'crab' && !inWater && d <= cfg.hazardRadius - 1 && !h.hit.has(p.id)
                   && !this._actionActive(p, 'dig')) {
          h.hit.add(p.id);
          if (p.state === 'resting') p.state = 'idle';   // pinched awake
          this._emit({ type: 'crab-pinch', playerId: p.id });
          this._applyDamage(p, cfg.crabDamage, 'crab');
        }
      }
    }

    this.hazards = this.hazards.filter(h => this.t < h.expiresAt && h.x > -8 && h.x < 108);
  }

  _collect(p, pu) {
    this.powerups = this.powerups.filter(u => u.id !== pu.id);
    if (pu.type === 'sunscreen') {
      p.hp = Math.min(this.cfg.maxHp, p.hp + this.cfg.sunscreenHeal);
    } else if (pu.type === 'pail') {
      p.pail = true;   // equipment: kept for the rest of the day
    } else {
      p.buffs[pu.type] = this.t + this.cfg.buffDurations[pu.type];
    }
    p.powerupsCollected += 1;
    this._emit({ type: 'powerup-collected', playerId: p.id, powerupType: pu.type });
  }

  _expireBuffsAndPowerups() {
    this.powerups = this.powerups.filter(u => u.expiresAt > this.t);
  }

  // ─── Damage & game over ───────────────────────────────────────────────────

  _applyDamage(p, amount, cause) {
    p.hp = Math.max(0, p.hp - amount);
    p.damageTaken += amount;
    this._emit({ type: 'damage', playerId: p.id, amount, cause, hp: p.hp });
    if (p.hp <= 0 && p.state !== 'out') {
      p.state = 'out';
      p.eliminatedAtHour = this.clockHour();
      p.y = Math.max(p.y, Math.min(90, this.waterline() + 8));   // eliminated players watch from the sand
      p.target = null;
      p.action = null;
      this._emit({ type: 'eliminated', playerId: p.id, cause });
    }
  }

  _endGame(reason) {
    this.phase = 'over';
    this._emit({ type: 'game-over', reason, tally: this.tally() });
  }

  tally() {
    const rows = Object.values(this.players).map(p => ({
      id: p.id,
      name: p.name,
      npc: !!p.npc,
      avatar: p.avatar,
      score: Math.round(p.score),
      wavesRidden: p.wavesRidden,
      bestStreak: p.bestStreak,
      powerupsCollected: p.powerupsCollected,
      damageTaken: Math.round(p.damageTaken),
      hp: Math.round(p.hp),
      survived: p.state !== 'out',
      eliminatedAtHour: p.eliminatedAtHour,
    }));
    // Survivors always place above the eliminated; then by score.
    rows.sort((a, b) => (b.survived - a.survived) || (b.score - a.score));
    const superlative = (key) =>
      rows.reduce((best, r) => (r[key] > (best?.[key] ?? 0) ? r : best), null);
    return {
      rows,
      best: rows[0] || null,
      waveMaster: superlative('wavesRidden'),
      streakKing: superlative('bestStreak'),
      beachcomber: superlative('powerupsCollected'),
    };
  }

  // ─── Broadcast snapshot ───────────────────────────────────────────────────

  snapshot() {
    return {
      t: Math.round(this.t * 100) / 100,
      clockHour: Math.round(this.clockHour() * 1000) / 1000,
      forecast: this.forecast(),
      phase: this.phase,
      tide: { level: Math.round(this.tide() * 100) / 100, rising: this.tideRising() },
      flags: {
        minX: this.cfg.flagMinX,
        maxX: this.cfg.flagMaxX,
        deepY: this.cfg.deepY,
        beachY: Math.round(this.waterline() * 10) / 10,   // the live sand line
      },
      players: Object.values(this.players).map(p => ({
        id: p.id,
        name: p.name,
        npc: !!p.npc,
        avatar: p.avatar,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        hp: Math.round(p.hp),
        score: Math.round(p.score),
        streak: p.streak,
        state: p.state,
        facing: p.facing,
        moving: !!p.moving,
        running: !!p.running,
        runReadyIn: Math.max(0, Math.round((p.runReadyAt - this.t) * 10) / 10),
        action: p.action && this.t <= p.action.until ? p.action.type : null,
        buffs: {
          bodysuit: Math.max(0, Math.round((p.buffs.bodysuit - this.t) * 10) / 10),
          bodyboard: Math.max(0, Math.round((p.buffs.bodyboard - this.t) * 10) / 10),
          blanket: Math.max(0, Math.round((p.buffs.blanket - this.t) * 10) / 10),
        },
        pail: !!p.pail,
      })),
      waves: this.waves.map(w => ({ id: w.id, size: w.size, y: Math.round(w.y * 10) / 10, slope: w.slope || 0, wobble: w.wobble })),
      powerups: this.powerups.map(u => ({ id: u.id, type: u.type, x: u.x, y: u.y, ttl: Math.round((u.expiresAt - this.t) * 10) / 10 })),
      // Deliberately no `sting` here: the client can never tell a salp from
      // a disguised jellyfish — that IS the gamble.
      salps: this.salps.map(s => ({
        id: s.id,
        x: Math.round(s.x * 10) / 10,
        y: Math.round(s.y * 10) / 10,
      })),
      hazards: this.hazards.map(h => ({
        id: h.id, kind: h.kind,
        x: Math.round(h.x * 10) / 10,
        y: Math.round(h.y * 10) / 10,
        vx: h.vx,
      })),
      gull: this.gullRaid ? {
        x: this.gullRaid.x,
        y: this.gullRaid.y,
        fromX: this.gullRaid.fromX,
        progress: Math.min(1, (this.t - this.gullRaid.start) / (this.gullRaid.at - this.gullRaid.start)),
      } : null,
    };
  }
}

module.exports = { WaveRunnerGame, DEFAULTS, WAVE_TYPES, DAY_START_HOUR, DAY_END_HOUR, WEATHER, NPC_ROSTER };
