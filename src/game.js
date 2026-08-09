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

  beachY: 66,               // y >= beachY is sand
  deepY: 22,                // y < deepY is too far out (lifeguard territory)
  flagMinX: 20,             // swim between the flags
  flagMaxX: 80,

  waveIntervalMin: 3.5,     // seconds between wave spawns
  waveIntervalMax: 7,
  hitRange: 3,              // wave front proximity that triggers resolution

  jumpDuration: 0.9,        // airtime seconds
  diveDuration: 1.4,        // underwater seconds
  actionCooldown: 0.5,

  walkSpeed: 16,            // units/sec on sand
  swimSpeed: 10,            // units/sec in water
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

  // Shove reach in world units. World x spans the full screen width, so a
  // small value is only a few finger-widths on a phone — 15 units ≈ one
  // sprite-and-a-half, i.e. "visibly next to each other".
  shoveRadius: 15,
  shoveCooldown: 3,
  shoveDamage: 5,
};

// Per-size wave characteristics. Bigger waves run faster, hit harder and pay
// better. The client renders the size difference subtly (foam height/shadow).
const WAVE_TYPES = {
  1: { speed: 9,  damage: 12, points: 10 },   // ripple  — survivable standing
  2: { speed: 11, damage: 24, points: 25 },   // roller  — jump or dive
  3: { speed: 13, damage: 36, points: 45 },   // thumper — dive only
};

const WEATHER = ['sunny', 'cloudy', 'storm'];

class WaveRunnerGame {
  constructor(config = {}, rng = Math.random) {
    this.cfg = { ...DEFAULTS, ...config };
    this.rng = rng;
    this.t = 0;
    this.phase = 'running';           // 'running' | 'over'
    this.players = {};
    this.waves = [];
    this.powerups = [];
    this.events = [];
    this.seq = 0;

    this.hours = this._generateWeather();
    this.nextWaveAt = this._rand(this.cfg.waveIntervalMin, this.cfg.waveIntervalMax);
    this.nextPlaneAt = this._rand(this.cfg.planeMinGap, this.cfg.planeMaxGap);
    this.pendingDropAt = null;
    this.nextLightningAt = null;
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
      action: null,                  // { type, startedAt, until }
      cooldownUntil: 0,
      target: null,
      pendingRest: false,
      pendingPickup: null,
      washedUntil: 0,
      buffs: { bodysuit: 0, bodyboard: 0, blanket: 0 },
      shoveReadyAt: 0,
      outSince: null,
      whistled: false,
      eliminatedAtHour: null,
    };
  }

  removePlayer(id) { delete this.players[id]; }

  // ─── Clock & weather ──────────────────────────────────────────────────────

  clockHour() {
    return DAY_START_HOUR + (this.t / this.cfg.dayLengthSec) * (DAY_END_HOUR - DAY_START_HOUR);
  }

  hourIndex() {
    return Math.min(this.hours.length - 1, Math.floor(this.clockHour()) - DAY_START_HOUR);
  }

  weatherNow() { return this.hours[this.hourIndex()]; }

  forecast() {
    const i = this.hourIndex();
    return {
      now: this.hours[i],
      next1: this.hours[i + 1] || null,
      next2: this.hours[i + 2] || null,
    };
  }

  // ─── Input handlers (called by the server on socket events) ───────────────

  handleMove(id, x, y) {
    const p = this.players[id];
    if (!p || p.state === 'out' || p.state === 'washed' || this.phase !== 'running') return;
    if (p.state === 'resting') p.state = 'idle';   // stand up and walk
    p.pendingRest = false;
    p.pendingPickup = null;
    p.target = {
      x: Math.max(2, Math.min(98, Number(x) || 0)),
      y: Math.max(8, Math.min(92, Number(y) || 0)),
    };
  }

  handleAction(id, type) {
    const p = this.players[id];
    if (!p || p.state === 'out' || p.state === 'washed' || p.state === 'resting') return;
    if (this.phase !== 'running') return;
    if (type === 'stand') { p.action = null; return; }
    if (type !== 'jump' && type !== 'dive') return;
    if (this.t < p.cooldownUntil) return;
    const dur = type === 'jump' ? this.cfg.jumpDuration : this.cfg.diveDuration;
    p.action = { type, startedAt: this.t, until: this.t + dur };
    p.cooldownUntil = p.action.until + this.cfg.actionCooldown;
  }

  handleRest(id) {
    const p = this.players[id];
    if (!p || p.state === 'out' || p.state === 'washed' || this.phase !== 'running') return;
    if (p.state === 'resting') { p.state = 'idle'; return; }
    if (p.y >= this.cfg.beachY) {
      p.state = 'resting';
      p.target = null;
      p.action = null;
    } else {
      // Tapping the umbrella from the water: swim in, then settle.
      p.pendingRest = true;
      p.pendingPickup = null;
      p.target = { x: Math.max(25, Math.min(75, p.x)), y: this.cfg.beachY + 10 };
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

    // Nearest other beachgoer within arm's reach who is in the water.
    let target = null;
    let best = this.cfg.shoveRadius;
    for (const q of this._alivePlayers()) {
      if (q.id === id || q.state === 'washed' || q.y >= this.cfg.beachY) continue;
      const d = this._dist(p, q);
      if (d <= best) { best = d; target = q; }
    }
    if (!target) {
      // A whiffed shove costs nothing but tells the player it registered.
      this._emit({ type: 'shove-miss', playerId: id });
      return;
    }

    p.shoveReadyAt = this.t + this.cfg.shoveCooldown;

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
    this.t += dt;

    if (this.clockHour() >= DAY_END_HOUR) {
      this._endGame('end-of-day');
      return this._drainEvents();
    }

    this._spawnWaves();
    this._advanceWaves(dt);
    this._movePlayers(dt);
    this._lifeguard(dt);
    this._weatherHazards();
    this._planeAndPowerups();
    this._expireBuffsAndPowerups();

    if (this._allOut()) this._endGame('wiped-out');
    return this._drainEvents();
  }

  _drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  _emit(ev) { this.events.push({ ...ev, t: this.t }); }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Dump a player onto the sand, briefly stunned — the shared fate of
  // wipeouts, lifeguard hauls, and shoves.
  _washAshore(p, clampX = null) {
    if (clampX) p.x = Math.max(clampX[0], Math.min(clampX[1], p.x));
    p.y = this.cfg.beachY + 8;
    p.state = 'washed';
    p.washedUntil = this.t + this.cfg.washStunSec;
    p.target = null;
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
      const dayFrac = this.t / this.cfg.dayLengthSec;
      const r = this.rng();
      const size = r < 0.45 - 0.15 * dayFrac ? 1 : r < 0.85 - 0.1 * dayFrac ? 2 : 3;
      this.waves.push({
        id: `w${this.seq++}`,
        size,
        y: 0,
        wobble: this.rng() * Math.PI * 2,   // client-side rendering phase
        resolved: new Set(),
      });
      this.nextWaveAt += this._rand(this.cfg.waveIntervalMin, this.cfg.waveIntervalMax);
    }
  }

  _advanceWaves(dt) {
    for (const w of this.waves) {
      w.y += WAVE_TYPES[w.size].speed * dt;
      for (const p of this._alivePlayers()) {
        if (p.y >= this.cfg.beachY) continue;          // on the sand — safe
        if (w.resolved.has(p.id)) continue;
        if (w.y >= p.y - this.cfg.hitRange) {
          w.resolved.add(p.id);
          this._resolveWave(w, p);
        }
      }
    }
    this.waves = this.waves.filter(w => w.y < this.cfg.beachY);
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
      p.streak += 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.wavesRidden += 1;
      p.score += spec.points + 2 * (p.streak - 1) + (perfect ? 5 : 0);
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
    for (const p of Object.values(this.players)) {
      if (p.state === 'out') continue;

      if (p.state === 'washed') {
        if (this.t >= p.washedUntil) p.state = 'idle';
        continue;
      }

      if (p.state === 'resting') {
        p.hp = Math.min(this.cfg.maxHp, p.hp + this.cfg.restRegenPerSec * dt);
        continue;
      }

      if (p.action && this.t > p.action.until) p.action = null;

      if (p.target) {
        const speed = p.y < this.cfg.beachY ? this.cfg.swimSpeed : this.cfg.walkSpeed;
        const d = this._dist(p, p.target);
        const step = speed * dt;
        if (d <= step) {
          p.x = p.target.x;
          p.y = p.target.y;
          p.target = null;
          if (p.pendingRest && p.y >= this.cfg.beachY) {
            p.pendingRest = false;
            p.state = 'resting';
          }
        } else {
          p.x += ((p.target.x - p.x) / d) * step;
          p.y += ((p.target.y - p.y) / d) * step;
        }
      }

      if (p.pendingPickup) {
        const pu = this.powerups.find(u => u.id === p.pendingPickup);
        if (!pu) {
          p.pendingPickup = null;
        } else if (this._dist(p, pu) <= this.cfg.pickupRadius) {
          this._collect(p, pu);
          p.pendingPickup = null;
        }
      }
    }
  }

  // ─── Lifeguard ────────────────────────────────────────────────────────────

  _lifeguard(dt) {
    for (const p of this._alivePlayers()) {
      const inWater = p.y < this.cfg.beachY;
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
      const swimmers = this._alivePlayers().filter(p => p.y < this.cfg.beachY);
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
      const type = r < 0.35 ? 'sunscreen' : r < 0.6 ? 'bodyboard' : r < 0.8 ? 'bodysuit' : 'blanket';
      const pu = {
        id: `p${this.seq++}`,
        type,
        x: this._rand(12, 88),
        y: this._rand(this.cfg.deepY + 8, this.cfg.beachY + 14),
        expiresAt: this.t + this.cfg.powerupTtl,
      };
      this.powerups.push(pu);
      this._emit({ type: 'powerup-drop', powerup: { id: pu.id, type: pu.type, x: pu.x, y: pu.y } });
    }
  }

  _collect(p, pu) {
    this.powerups = this.powerups.filter(u => u.id !== pu.id);
    if (pu.type === 'sunscreen') {
      p.hp = Math.min(this.cfg.maxHp, p.hp + this.cfg.sunscreenHeal);
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
      p.y = Math.max(p.y, this.cfg.beachY + 8);   // eliminated players watch from the sand
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
      flags: { minX: this.cfg.flagMinX, maxX: this.cfg.flagMaxX, deepY: this.cfg.deepY, beachY: this.cfg.beachY },
      players: Object.values(this.players).map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        hp: Math.round(p.hp),
        score: Math.round(p.score),
        streak: p.streak,
        state: p.state,
        action: p.action && this.t <= p.action.until ? p.action.type : null,
        buffs: {
          bodysuit: Math.max(0, Math.round((p.buffs.bodysuit - this.t) * 10) / 10),
          bodyboard: Math.max(0, Math.round((p.buffs.bodyboard - this.t) * 10) / 10),
          blanket: Math.max(0, Math.round((p.buffs.blanket - this.t) * 10) / 10),
        },
      })),
      waves: this.waves.map(w => ({ id: w.id, size: w.size, y: Math.round(w.y * 10) / 10, wobble: w.wobble })),
      powerups: this.powerups.map(u => ({ id: u.id, type: u.type, x: u.x, y: u.y, ttl: Math.round((u.expiresAt - this.t) * 10) / 10 })),
    };
  }
}

module.exports = { WaveRunnerGame, DEFAULTS, WAVE_TYPES, DAY_START_HOUR, DAY_END_HOUR, WEATHER };
