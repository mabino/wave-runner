const { WaveRunnerGame, DAY_END_HOUR } = require('../src/game');

// Constant-rng game: weather is all sunny (0.5 rolls), no surprises.
function makeGame(config = {}, rng = () => 0.5) {
  const game = new WaveRunnerGame(config, rng);
  // Quiet the environment by default so each test forces exactly the
  // scenario it cares about. Every scheduled spawner follows the
  // `next<Thing>At` convention, so future ones are silenced automatically.
  for (const key of Object.keys(game)) {
    if (/^next\w+At$/.test(key) && typeof game[key] === 'number') game[key] = Infinity;
  }
  return game;
}

// All-storm skies on top of the quiet default.
function stormGame() {
  const game = makeGame();
  game.hours = Array(game.hours.length).fill('storm');
  return game;
}

function addHazard(game, kind, x, y, vx = 0) {
  const h = { id: `test-${kind}-${x}`, kind, x, y, vx, vy: 0, hit: new Set(), expiresAt: Infinity };
  game.hazards.push(h);
  return h;
}

function addSwimmer(game, id = 'p1', y = 40, x = 50) {
  game.addPlayer(id, id, { archetype: 0, skin: 0, outfit: 0 });
  const p = game.players[id];
  p.x = x;
  p.y = y;
  return p;
}

function sendWave(game, size, y) {
  game.waves.push({ id: `test-${size}-${y}`, size, y, wobble: 0, resolved: new Set() });
}

// Step the sim in small increments and collect events.
function run(game, seconds, step = 0.1) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += step) {
    events.push(...game.tick(step));
  }
  return events;
}

describe('wave resolution', () => {
  test('standing survives a small wave and scores', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    sendWave(game, 1, p.y - 4);
    const events = run(game, 0.3);
    const result = events.find(e => e.type === 'wave-result');
    expect(result.outcome).toBe('ride');
    expect(p.wavesRidden).toBe(1);
    expect(p.streak).toBe(1);
    expect(p.score).toBeGreaterThan(0);
    expect(p.hp).toBe(100);
  });

  test('standing in a medium wave wipes out, damages, and washes ashore', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    sendWave(game, 2, p.y - 4);
    const events = run(game, 0.3);
    const result = events.find(e => e.type === 'wave-result');
    expect(result.outcome).toBe('wiped');
    expect(p.hp).toBe(100 - 24);
    expect(p.streak).toBe(0);
    expect(p.y).toBeGreaterThanOrEqual(game.cfg.beachY);   // washed onto the sand
    expect(p.state).toBe('washed');
  });

  test('a timed jump rides a medium wave', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    sendWave(game, 2, p.y - 4);
    game.handleAction('p1', 'jump');
    const events = run(game, 0.3);
    expect(events.find(e => e.type === 'wave-result').outcome).toBe('ride');
    expect(p.hp).toBe(100);
  });

  test('a timed dive rides a medium wave', () => {
    const game = makeGame();
    addSwimmer(game);
    sendWave(game, 2, 36);
    game.handleAction('p1', 'dive');
    const events = run(game, 0.3);
    expect(events.find(e => e.type === 'wave-result').outcome).toBe('ride');
  });

  test('jumping a large wave is not enough — dive only', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    sendWave(game, 3, p.y - 4);
    game.handleAction('p1', 'jump');
    const events = run(game, 0.3);
    expect(events.find(e => e.type === 'wave-result').outcome).toBe('wiped');
    expect(p.hp).toBe(100 - 36);
  });

  test('a dive rides a large wave', () => {
    const game = makeGame();
    addSwimmer(game);
    sendWave(game, 3, 36);
    game.handleAction('p1', 'dive');
    const events = run(game, 0.3);
    expect(events.find(e => e.type === 'wave-result').outcome).toBe('ride');
  });

  test('an expired action no longer protects', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    game.handleAction('p1', 'jump');
    run(game, 1.2);                      // jump lasts 0.9s — let it lapse
    sendWave(game, 2, p.y - 4);
    const events = run(game, 0.3);
    expect(events.find(e => e.type === 'wave-result').outcome).toBe('wiped');
  });

  test('early (well-timed) action earns the perfect bonus', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    sendWave(game, 2, p.y - 4.5);        // arrives almost immediately
    game.handleAction('p1', 'dive');
    const events = run(game, 0.3);
    const result = events.find(e => e.type === 'wave-result');
    expect(result.perfect).toBe(true);
    // base + perfect + dive premium, no streak bonus yet
    expect(p.score).toBe(25 + 5 + game.cfg.diveRideBonus);
  });

  test('standing bails out of an action into a short recovery', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    game.handleAction('p1', 'jump');       // cooldown would run to ~1.4s
    run(game, 0.2);
    game.handleAction('p1', 'stand');
    expect(p.action).toBeNull();
    run(game, 0.3);                        // past the shortened recovery
    game.handleAction('p1', 'dive');
    expect(p.action?.type).toBe('dive');   // correction allowed well before 1.4s
    expect(game.t).toBeLessThan(1.0);
  });

  test('diving costs a little HP; jumping is free', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    game.handleAction('p1', 'dive');
    expect(p.hp).toBe(100 - game.cfg.diveHpCost);
    run(game, game.cfg.diveDuration + game.cfg.actionCooldown + 0.2);
    game.handleAction('p1', 'jump');
    expect(p.hp).toBe(100 - game.cfg.diveHpCost);   // unchanged by the jump
  });

  test('dive exertion never knocks a player out', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    p.hp = 1;
    game.handleAction('p1', 'dive');
    expect(p.hp).toBe(1);
    expect(p.state).toBe('idle');
  });

  test('a dive-ride outscores a jump-ride on the same wave', () => {
    const scoreWith = (action) => {
      const game = makeGame();
      const p = addSwimmer(game);
      sendWave(game, 2, p.y - 4.5);
      game.handleAction('p1', action);
      run(game, 0.3);
      return p.score;
    };
    expect(scoreWith('dive')).toBe(scoreWith('jump') + 5);
  });

  test('streak grows scoring and resets on a wipe', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    sendWave(game, 1, p.y - 4);
    run(game, 0.3);
    expect(p.streak).toBe(1);
    sendWave(game, 1, p.y - 4);
    run(game, 0.3);
    expect(p.streak).toBe(2);
    expect(p.bestStreak).toBe(2);
    sendWave(game, 3, p.y - 4);
    run(game, 0.3);
    expect(p.streak).toBe(0);
    expect(p.bestStreak).toBe(2);
  });

  test('a bodyboard rides out any wave with no action', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    p.buffs.bodyboard = 1000;
    sendWave(game, 3, p.y - 4);
    const events = run(game, 0.3);
    expect(events.find(e => e.type === 'wave-result').outcome).toBe('ride');
    expect(p.hp).toBe(100);
  });

  test('players on the sand are never hit by waves', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80);   // on the beach
    sendWave(game, 3, 60);
    const events = run(game, 1);
    expect(events.find(e => e.type === 'wave-result')).toBeUndefined();
    expect(p.hp).toBe(100);
  });

  test('waves break and disappear at the sand line', () => {
    const game = makeGame();
    sendWave(game, 2, 60);
    run(game, 1.0);
    expect(game.waves.length).toBe(0);
  });

  test('losing all HP to a wave eliminates the player', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    p.hp = 10;
    sendWave(game, 3, p.y - 4);
    const events = run(game, 0.3);
    expect(events.find(e => e.type === 'eliminated')).toMatchObject({ playerId: 'p1', cause: 'wave' });
    expect(p.state).toBe('out');
    expect(p.hp).toBe(0);
  });

  test('a solo wipeout ends the game', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    p.hp = 5;
    sendWave(game, 3, p.y - 4);
    const events = run(game, 0.3);
    const over = events.find(e => e.type === 'game-over');
    expect(over.reason).toBe('wiped-out');
    expect(game.phase).toBe('over');
  });
});

describe('umbrella rest', () => {
  test('resting on the beach slowly regains HP, capped at max', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80);
    p.hp = 50;
    game.handleRest('p1');
    expect(p.state).toBe('resting');
    run(game, 10);
    expect(p.hp).toBeCloseTo(75, 0);
    p.hp = 99;
    run(game, 10);
    expect(p.hp).toBe(100);
  });

  test('tapping the umbrella from the water swims in, then settles', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 55);
    game.handleRest('p1');
    expect(p.state).toBe('idle');
    expect(p.pendingRest).toBe(true);
    run(game, 5);
    expect(p.y).toBeGreaterThanOrEqual(game.cfg.beachY);
    expect(p.state).toBe('resting');
  });

  test('moving stands the player back up', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80);
    game.handleRest('p1');
    game.handleMove('p1', 50, 50);
    expect(p.state).toBe('idle');
    run(game, 5);
    expect(p.y).toBeLessThan(game.cfg.beachY);
  });
});

describe('lifeguard', () => {
  test('straying beyond the flags draws a whistle, then a penalty', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 10);   // outside flagMinX=20
    const early = run(game, 2.5);
    expect(early.find(e => e.type === 'whistle')).toMatchObject({ playerId: 'p1' });
    expect(early.find(e => e.type === 'lifeguard-penalty')).toBeUndefined();
    const later = run(game, 4);
    expect(later.find(e => e.type === 'lifeguard-penalty')).toMatchObject({ playerId: 'p1' });
    expect(p.hp).toBe(100 - 20);
    expect(p.y).toBeGreaterThanOrEqual(game.cfg.beachY);   // hauled ashore
  });

  test('the open water beyond the buoys is fair game now', () => {
    const game = makeGame();
    addSwimmer(game, 'p1', 15, 50);   // past the buoy line — allowed these days
    const events = run(game, 3);
    expect(events.find(e => e.type === 'whistle')).toBeUndefined();
  });

  test('swimming past the outer limit still triggers the lifeguard', () => {
    const game = makeGame();
    addSwimmer(game, 'p1', game.cfg.outerY - 5, 50);
    const events = run(game, 2.5);
    expect(events.find(e => e.type === 'whistle')).toBeDefined();
  });

  test('swimming between the flags draws no attention', () => {
    const game = makeGame();
    addSwimmer(game, 'p1', 40, 50);
    const events = run(game, 7);
    expect(events.find(e => e.type === 'whistle')).toBeUndefined();
    expect(events.find(e => e.type === 'lifeguard-penalty')).toBeUndefined();
  });

  test('returning inside the flags resets the countdown', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 10);
    run(game, 2.5);           // whistled
    p.x = 50;                 // back inside
    run(game, 0.2);
    p.x = 10;                 // out again — fresh grace period
    const events = run(game, 1);
    expect(events.find(e => e.type === 'lifeguard-penalty')).toBeUndefined();
  });
});

describe('weather and lightning', () => {
  test('forecast exposes the current and next two hours', () => {
    const game = makeGame();
    game.hours = ['sunny', 'cloudy', 'storm', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny'];
    expect(game.forecast()).toEqual({ now: 'sunny', next1: 'cloudy', next2: 'storm' });
  });

  test('the first two hours are never stormy', () => {
    for (const roll of [0, 0.1, 0.2]) {
      const game = new WaveRunnerGame({}, () => roll);
      expect(game.hours[0]).not.toBe('storm');
      expect(game.hours[1]).not.toBe('storm');
    }
  });

  test('lightning strikes a swimmer during a storm', () => {
    const game = stormGame();
    const p = addSwimmer(game);
    const events = run(game, 10);
    const strike = events.find(e => e.type === 'lightning');
    expect(strike.playerId).toBe('p1');
    expect(p.hp).toBeLessThan(100);
  });

  test('a bodysuit blocks the strike', () => {
    const game = stormGame();
    const p = addSwimmer(game);
    p.buffs.bodysuit = 10000;
    const events = run(game, 10);
    const strike = events.find(e => e.type === 'lightning');
    expect(strike.blocked).toBe(true);
    expect(p.hp).toBe(100);
  });

  test('waiting out the storm on the beach is safe', () => {
    const game = stormGame();
    const p = addSwimmer(game, 'p1', 80);   // on the sand
    const events = run(game, 10);
    const strike = events.find(e => e.type === 'lightning');
    expect(strike.playerId).toBeNull();
    expect(p.hp).toBe(100);
  });

  test('no lightning under a sunny sky', () => {
    const game = makeGame();   // all-sunny weather
    addSwimmer(game);
    const events = run(game, 15);
    expect(events.find(e => e.type === 'lightning')).toBeUndefined();
  });
});

describe('banner plane power-ups', () => {
  test('plane pass drops a tappable item shortly after the sound cue', () => {
    const game = makeGame();
    addSwimmer(game);
    game.nextPlaneAt = 0.5;
    const events = run(game, 3);
    expect(events.find(e => e.type === 'plane')).toBeDefined();
    const drop = events.find(e => e.type === 'powerup-drop');
    expect(drop).toBeDefined();
    expect(game.powerups.length).toBe(1);
  });

  test('items wash away after their TTL', () => {
    const game = makeGame();
    addSwimmer(game);
    game.nextPlaneAt = 0.5;
    run(game, 3);
    expect(game.powerups.length).toBe(1);
    run(game, game.cfg.powerupTtl + 1);
    expect(game.powerups.length).toBe(0);
  });

  test('tapping an intersecting sunscreen bottle heals', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    p.hp = 40;
    game.powerups.push({ id: 'pu1', type: 'sunscreen', x: p.x + 2, y: p.y, expiresAt: 1000 });
    game.handleTapPowerup('p1', 'pu1');
    expect(p.hp).toBe(75);
    expect(p.powerupsCollected).toBe(1);
    expect(game.powerups.length).toBe(0);
  });

  test('tapping a distant item walks over and collects on intersection', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 30);
    game.powerups.push({ id: 'pu1', type: 'bodyboard', x: 70, y: 80, expiresAt: 1000 });
    game.handleTapPowerup('p1', 'pu1');
    expect(game.powerups.length).toBe(1);   // no grabbing at range
    run(game, 4);
    expect(game.powerups.length).toBe(0);
    expect(p.buffs.bodyboard).toBeGreaterThan(game.t);
  });

  test('a tap alone never collects an item the player has not reached', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 20);
    p.hp = 40;
    game.powerups.push({ id: 'pu1', type: 'sunscreen', x: 80, y: 80, expiresAt: 1000 });
    game.handleTapPowerup('p1', 'pu1');
    run(game, 0.3);                          // barely a step toward it
    expect(game.powerups.length).toBe(1);
    expect(p.hp).toBe(40);
    expect(p.powerupsCollected).toBe(0);
  });

  test('bodysuit, bodyboard, and blanket grant timed buffs', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    game.powerups.push({ id: 'a', type: 'bodysuit', x: p.x, y: p.y, expiresAt: 1000 });
    game.powerups.push({ id: 'b', type: 'bodyboard', x: p.x, y: p.y, expiresAt: 1000 });
    game.powerups.push({ id: 'c', type: 'blanket', x: p.x, y: p.y, expiresAt: 1000 });
    game.handleTapPowerup('p1', 'a');
    game.handleTapPowerup('p1', 'b');
    game.handleTapPowerup('p1', 'c');
    expect(p.buffs.bodysuit).toBeCloseTo(game.t + game.cfg.buffDurations.bodysuit);
    expect(p.buffs.bodyboard).toBeCloseTo(game.t + game.cfg.buffDurations.bodyboard);
    expect(p.buffs.blanket).toBeCloseTo(game.t + game.cfg.buffDurations.blanket);
  });
});

describe('shoving', () => {
  function pair(game, dist = 5) {
    const a = addSwimmer(game, 'attacker', 40, 50);
    const b = addSwimmer(game, 'victim', 40, 50 + dist);
    return [a, b];
  }

  test('a shove knocks a nearby swimmer out of the water and onto the beach', () => {
    const game = makeGame();
    const [a, b] = pair(game);
    b.streak = 4;
    game.handleShove('attacker');
    const events = run(game, 0.2);
    const shove = events.find(e => e.type === 'shove');
    expect(shove).toMatchObject({ shoverId: 'attacker', playerId: 'victim', blocked: false });
    expect(b.state).toBe('washed');
    expect(b.y).toBeGreaterThanOrEqual(game.cfg.beachY);
    expect(b.streak).toBe(0);
    expect(b.hp).toBe(100 - game.cfg.shoveDamage);
    expect(a.hp).toBe(100);
    expect(a.state).toBe('idle');
  });

  test('a beach blanket blocks the shove', () => {
    const game = makeGame();
    const [, b] = pair(game);
    b.buffs.blanket = 1000;
    game.handleShove('attacker');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'shove').blocked).toBe(true);
    expect(b.state).toBe('idle');
    expect(b.y).toBeLessThan(game.cfg.beachY);   // still in the water
    expect(b.hp).toBe(100);
  });

  test('shoving is rate-limited by a cooldown', () => {
    const game = makeGame();
    pair(game);
    game.handleShove('attacker');
    run(game, 0.2);
    // Victim recovers and wades back out.
    game.players.victim.state = 'idle';
    game.players.victim.y = 40;
    game.players.victim.x = 52;
    game.handleShove('attacker');            // still cooling down
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'shove')).toBeUndefined();
    run(game, game.cfg.shoveCooldown);
    game.handleShove('attacker');
    expect(run(game, 0.2).find(e => e.type === 'shove')).toBeDefined();
  });

  test('players on the sand cannot be shoved', () => {
    const game = makeGame();
    addSwimmer(game, 'attacker', 75, 50);
    addSwimmer(game, 'victim', 78, 52);      // both on the beach
    game.handleShove('attacker');
    expect(run(game, 0.2).find(e => e.type === 'shove')).toBeUndefined();
  });

  test('a shove needs the target within reach, and a whiff reports back', () => {
    const game = makeGame();
    pair(game, game.cfg.shoveRadius + 5);
    game.handleShove('attacker');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'shove')).toBeUndefined();
    expect(events.find(e => e.type === 'shove-miss')).toMatchObject({ playerId: 'attacker' });
  });

  test('a whiffed shove does not start the cooldown', () => {
    const game = makeGame();
    const [, b] = pair(game, game.cfg.shoveRadius + 5);
    game.handleShove('attacker');            // whiff
    run(game, 0.2);
    b.x = 52; b.y = 40;                      // now in reach
    game.handleShove('attacker');            // should fire immediately
    expect(run(game, 0.2).find(e => e.type === 'shove')).toBeDefined();
  });

  test('the shover lunges to contact from across the acquisition range', () => {
    const game = makeGame();
    const [a, b] = pair(game, game.cfg.shoveRadius - 2);   // near the edge of range
    const targetX = b.x;
    game.handleShove('attacker');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'shove')).toMatchObject({ blocked: false });
    expect(Math.abs(a.x - targetX)).toBeLessThanOrEqual(3.5);   // closed the gap
  });

  test('a diver under the surface cannot be shoved', () => {
    const game = makeGame();
    const [, b] = pair(game);
    game.handleAction('victim', 'dive');
    game.handleShove('attacker');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'shove')).toBeUndefined();
    expect(events.find(e => e.type === 'shove-miss')).toBeDefined();
    expect(b.state).toBe('idle');
    expect(b.hp).toBe(100 - game.cfg.diveHpCost);   // only the dive cost
  });

  test('you cannot shove while diving or buried', () => {
    const game = makeGame();
    pair(game);
    game.handleAction('attacker', 'dive');
    game.handleShove('attacker');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'shove' || e.type === 'shove-miss')).toBeUndefined();
  });

  test('a shove can eliminate a swimmer on their last legs', () => {
    const game = makeGame();
    const [, b] = pair(game);
    b.hp = game.cfg.shoveDamage;
    game.handleShove('attacker');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'eliminated')).toMatchObject({ playerId: 'victim', cause: 'shove' });
    expect(b.state).toBe('out');
  });
});

describe('last one standing', () => {
  test('a multiplayer day ends when only one beachgoer remains active', () => {
    const game = makeGame();
    addSwimmer(game, 'alice', 80);
    addSwimmer(game, 'bob', 80);
    addSwimmer(game, 'carol', 80);
    run(game, 0.2);   // first tick locks in multiplayer mode
    game._applyDamage(game.players.bob, 1000, 'wave');
    game._applyDamage(game.players.carol, 1000, 'wave');
    const events = run(game, 0.2);
    const over = events.find(e => e.type === 'game-over');
    expect(over.reason).toBe('last-one-standing');
    expect(over.tally.best.id).toBe('alice');
    expect(over.tally.best.survived).toBe(true);
  });

  test('players leaving a multiplayer game also crowns the last one left', () => {
    const game = makeGame();
    addSwimmer(game, 'alice', 80);
    addSwimmer(game, 'bob', 80);
    run(game, 0.2);
    game.removePlayer('bob');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'game-over').reason).toBe('last-one-standing');
  });

  test('a solo game keeps running for its lone player', () => {
    const game = makeGame();
    addSwimmer(game, 'solo', 80);
    run(game, 2);
    expect(game.phase).toBe('running');
  });

  test('a simultaneous full wipeout still reads as the ocean winning', () => {
    const game = makeGame();
    addSwimmer(game, 'alice', 80);
    addSwimmer(game, 'bob', 80);
    run(game, 0.2);
    game._applyDamage(game.players.alice, 1000, 'wave');
    game._applyDamage(game.players.bob, 1000, 'wave');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'game-over').reason).toBe('wiped-out');
  });
});

describe('wildlife hazards', () => {
  test('a shark bite mauls a swimmer and washes them ashore', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 50);
    p.streak = 3;
    addHazard(game, 'shark', 44, 40, 22);   // closing fast from the left
    const events = run(game, 0.5);
    expect(events.find(e => e.type === 'shark-attack')).toMatchObject({ playerId: 'p1' });
    expect(p.hp).toBe(100 - game.cfg.sharkDamage);
    expect(p.state).toBe('washed');
    expect(p.y).toBeGreaterThanOrEqual(game.cfg.beachY);
    expect(p.streak).toBe(0);
  });

  test('sharks cannot reach players on the sand', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 75, 50);   // on the beach
    addHazard(game, 'shark', 44, 60, 22);
    const events = run(game, 2);
    expect(events.find(e => e.type === 'shark-attack')).toBeUndefined();
    expect(p.hp).toBe(100);
  });

  test('a jellyfish stings once and is spent', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 50);
    addHazard(game, 'jelly', 50, 40);
    const events = run(game, 0.3);
    expect(events.filter(e => e.type === 'jelly-sting')).toHaveLength(1);
    expect(p.hp).toBe(100 - game.cfg.jellyDamage);
    expect(game.hazards.find(h => h.kind === 'jelly')).toBeUndefined();
  });

  test('a crab pinches a resting player awake', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);
    game.handleRest('p1');
    expect(p.state).toBe('resting');
    addHazard(game, 'crab', 44, 80, 7);
    const events = run(game, 1.5);
    expect(events.filter(e => e.type === 'crab-pinch')).toHaveLength(1);   // once per crab
    expect(p.hp).toBe(100 - game.cfg.crabDamage);
    expect(p.state).toBe('idle');
  });

  test('crabs stay out of the water', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 50);   // swimming
    addHazard(game, 'crab', 48, 40, 7);         // hypothetically adjacent
    const events = run(game, 1);
    expect(events.find(e => e.type === 'crab-pinch')).toBeUndefined();
    expect(p.hp).toBe(100);
  });

  test('a gull swoops in and steals an unclaimed item', () => {
    const game = makeGame();
    addSwimmer(game, 'p1', 80, 20);
    game.powerups.push({ id: 'pu1', type: 'sunscreen', x: 70, y: 50, expiresAt: 1000 });
    game.nextGullAt = 0;
    const early = run(game, 0.3);
    expect(early.find(e => e.type === 'gull-swoop')).toMatchObject({ powerupId: 'pu1' });
    expect(game.powerups).toHaveLength(1);      // telegraph window
    // Each raid flies its own line at its own pace.
    expect(game.gullRaid.fromX).toBeGreaterThanOrEqual(5);
    expect(game.gullRaid.fromX).toBeLessThanOrEqual(95);
    const flight = game.gullRaid.at - game.gullRaid.start;
    expect(flight).toBeGreaterThanOrEqual(game.cfg.gullSnatchMin);
    expect(flight).toBeLessThanOrEqual(game.cfg.gullSnatchMax);
    const later = run(game, game.cfg.gullSnatchMax + 0.3);
    expect(later.find(e => e.type === 'gull-steal')).toMatchObject({ powerupId: 'pu1' });
    expect(game.powerups).toHaveLength(0);
  });

  test('grabbing the item during the swoop foils the gull', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 50, 70);
    game.powerups.push({ id: 'pu1', type: 'sunscreen', x: 70, y: 50, expiresAt: 1000 });
    game.nextGullAt = 0;
    run(game, 0.2);                             // swoop begins
    game.handleTapPowerup('p1', 'pu1');         // player is intersecting
    const events = run(game, game.cfg.gullSnatchMax + 0.5);
    expect(events.find(e => e.type === 'gull-steal')).toBeUndefined();
    expect(p.powerupsCollected).toBe(1);
    expect(game.gullRaid).toBeNull();
  });
});

describe('keyboard steering', () => {
  test('a held direction moves the player continuously; release stops', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);
    game.handleSteer('p1', 0, -1);
    run(game, 1);
    expect(p.y).toBeLessThan(69);        // marched steadily up-screen
    game.handleSteer('p1', 0, 0);        // key released
    const y = p.y;
    run(game, 1);
    expect(p.y).toBeCloseTo(y, 5);
  });

  test('steering stands a resting player up and clears tap targets', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);
    game.handleRest('p1');
    game.handleSteer('p1', 1, 0);
    expect(p.state).toBe('idle');
    expect(p.target).toBeNull();
    expect(p.steer).toEqual({ x: 1, y: 0, run: false });
  });

  test('washed players cannot steer', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 50);
    game._washAshore(p);
    game.handleSteer('p1', 0, -1);
    expect(p.steer).toBeNull();
  });

  test('walking over an item collects it without a tap', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 20);
    p.hp = 50;
    game.powerups.push({ id: 'pu1', type: 'sunscreen', x: 40, y: 80, expiresAt: 1000 });
    game.handleSteer('p1', 1, 0);        // stroll right along the beach
    run(game, 3);
    expect(p.powerupsCollected).toBe(1);
    expect(p.hp).toBeGreaterThan(50);
  });
});

describe('tide', () => {
  test('the waterline breathes across the day', () => {
    const game = makeGame({ dayLengthSec: 400, tideCycles: 2, tideAmp: 8 });
    expect(game.waterline()).toBeCloseTo(66, 5);
    game.t = 50;    // quarter of the first cycle — peak high tide
    expect(game.waterline()).toBeCloseTo(74, 5);
    game.t = 150;   // three quarters — dead low tide
    expect(game.waterline()).toBeCloseTo(58, 5);
  });

  test('the rising tide floods a low napping spot and wakes the napper', () => {
    const game = makeGame({ dayLengthSec: 400 });
    const p = addSwimmer(game, 'p1', 68, 50);   // dry sand at mean tide
    game.handleRest('p1');
    expect(p.state).toBe('resting');
    game.t = 50;                                 // high tide: waterline 74
    run(game, 0.2);
    expect(p.state).toBe('idle');
  });

  test('waves run faster at high tide than at low', () => {
    const advance = (tAt) => {
      const game = makeGame({ dayLengthSec: 400 });
      game.t = tAt;
      sendWave(game, 2, 10);
      game.tick(1);
      return game.waves[0].y;
    };
    expect(advance(50)).toBeGreaterThan(advance(150));
  });
});

describe('angled waves', () => {
  test('a tilted front reaches same-depth players at different moments', () => {
    const game = makeGame();
    const right = addSwimmer(game, 'right', 40, 80);
    const left = addSwimmer(game, 'left', 40, 20);
    game.waves.push({ id: 'tilt', size: 1, y: 35, slope: 0.1, wobble: 0, resolved: new Set() });
    run(game, 0.05);
    expect(right.wavesRidden).toBe(1);   // the front is lower on the right
    expect(left.wavesRidden).toBe(0);
  });

  test('the approach angle drifts wave to wave but stays bounded', () => {
    const game = new WaveRunnerGame({}, () => 0.99);   // drift always positive
    game.nextPlaneAt = Infinity;
    game.nextSharkAt = Infinity;
    game.nextJellyAt = Infinity;
    game.nextCrabAt = Infinity;
    game.nextGullAt = Infinity;
    for (let i = 0; i < 200 && game.phase === 'running'; i++) game.tick(0.5);
    expect(game.waveSlope).toBeGreaterThan(0.02);
    expect(Math.abs(game.waveSlope)).toBeLessThanOrEqual(0.03 + game.cfg.waveSlopeCap + 1e-9);
    expect(game.waves.every(w => typeof w.slope === 'number')).toBe(true);
  });
});

describe('digging in on the sand', () => {
  test('diving on the sand digs in instead — free, immobile, timed', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);
    game.handleAction('p1', 'dive');
    expect(p.action.type).toBe('dig');
    expect(p.hp).toBe(100);                  // digging costs nothing
    game.handleSteer('p1', 1, 0);            // try to walk while buried
    run(game, 1);
    expect(p.x).toBe(50);                    // not going anywhere
    run(game, game.cfg.digDuration);
    expect(p.action).toBeNull();             // surfaced
    run(game, 1);
    expect(p.x).toBeGreaterThan(50);         // held steer resumes after surfacing
  });

  test('a buried player shrugs off crab pinches', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);
    game.handleAction('p1', 'dive');         // dig in
    const crab = { id: 'c1', kind: 'crab', x: 50, y: 80, vx: 0, vy: 0, hit: new Set(), expiresAt: Infinity };
    game.hazards.push(crab);
    const events = run(game, 1.5);           // crab sits on the mound all the while
    expect(events.find(e => e.type === 'crab-pinch')).toBeUndefined();
    expect(p.hp).toBe(100);
  });

  test('lightning cannot find a buried player', () => {
    const game = makeGame();
    game.hours = Array(game.hours.length).fill('storm');
    const p = addSwimmer(game, 'p1', 60, 50);   // in the water at mean tide
    p.action = { type: 'dig', startedAt: 0, until: 10000 };   // freak tide burial
    const events = run(game, 10);
    const strike = events.find(e => e.type === 'lightning');
    expect(strike.playerId).toBeNull();
    expect(p.hp).toBe(100);
  });

  test('standing unburies early', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);
    game.handleAction('p1', 'dive');
    expect(p.action.type).toBe('dig');
    game.handleAction('p1', 'stand');
    expect(p.action).toBeNull();
  });
});

describe('NPC beachgoers', () => {
  test('addNpcs seeds roster players flagged as NPCs with rising aggression', () => {
    const game = makeGame();
    game.addNpcs(3);
    const npcs = Object.values(game.players).filter(p => p.npc);
    expect(npcs).toHaveLength(3);
    expect(npcs.map(p => p.npc.aggression)).toEqual([0.25, 0.55, 0.9]);
    expect(game.snapshot().players.every(p => p.npc === true)).toBe(true);
  });

  test('a skilled NPC reads and dives a thumper', () => {
    const game = makeGame();
    game.addNpcs(1);
    const npc = game.players['npc-mel'];
    npc.x = 50; npc.y = 40;
    npc.npc.skill = 1;
    sendWave(game, 3, npc.y - 8);
    const events = run(game, 1);
    const result = events.find(e => e.type === 'wave-result' && e.playerId === 'npc-mel');
    expect(result.outcome).toBe('ride');
  });

  test('the most aggressive NPC shoves a nearby swimmer', () => {
    const game = makeGame({}, () => 0.2);
    game.hours = Array(game.hours.length).fill('sunny');
    game.addNpcs(3);
    game.players['npc-mel'].x = 5;  game.players['npc-mel'].y = 90;
    game.players['npc-pete'].x = 95; game.players['npc-pete'].y = 90;
    const bruiser = game.players['npc-bruiser'];
    bruiser.x = 50; bruiser.y = 40;
    addSwimmer(game, 'victim', 40, 55);
    const events = run(game, 3);
    const shove = events.find(e => e.type === 'shove' && e.shoverId === 'npc-bruiser');
    expect(shove).toBeDefined();
    expect(shove.playerId).toBe('victim');
  });

  test('a battered NPC retreats under the umbrella', () => {
    const game = makeGame();
    game.addNpcs(1);
    const npc = game.players['npc-mel'];
    npc.x = 50; npc.y = 40; npc.hp = 20;
    run(game, 8);
    expect(npc.state).toBe('resting');
    expect(npc.hp).toBeGreaterThan(20);
  });

  test('Pete is the fastest NPC and Bruiser the slowest', () => {
    const game = makeGame();
    game.addNpcs(3);
    const paces = Object.values(game.players).filter(p => p.npc).map(p => p.npc.pace);
    const [mel, pete, bruiser] = paces;
    expect(pete).toBeGreaterThan(mel);
    expect(pete).toBeGreaterThan(1);        // faster than a human
    expect(bruiser).toBeLessThan(mel);
    expect(bruiser).toBeLessThan(1);        // slower than a human
    // And it shows in the water: same command, different ground covered.
    const swim = (id) => {
      const p = game.players[id];
      p.x = 10; p.y = 40; p.target = null; p.npc.nextDecisionAt = Infinity;
      game.handleMove(id, 90, 40);
      run(game, 2);
      return p.x - 10;
    };
    expect(swim('npc-pete')).toBeGreaterThan(swim('npc-bruiser'));
  });

  test('NPCs must be much closer than humans to land a shove', () => {
    const game = makeGame({}, () => 0.2);
    game.hours = Array(game.hours.length).fill('sunny');
    game.addNpcs(3);
    game.players['npc-mel'].x = 5;  game.players['npc-mel'].y = 90;
    game.players['npc-pete'].x = 95; game.players['npc-pete'].y = 90;
    const bruiser = game.players['npc-bruiser'];
    bruiser.x = 50; bruiser.y = 40;
    // Within the human lunge range (25) but beyond the NPC reach (12):
    // the bully must swim closer before a shove can land.
    const victim = addSwimmer(game, 'victim', 40, 50 + game.cfg.npcShoveRadius + 6);
    victim.hp = 100;
    game.handleShove('npc-bruiser');           // direct attempt from 18 away
    const early = run(game, 0.1);
    expect(early.find(e => e.type === 'shove')).toBeUndefined();
    // A human at the same distance connects immediately.
    const human = addSwimmer(game, 'human', 40, victim.x - game.cfg.shoveRadius + 2);
    game.handleShove('human');
    const events = run(game, 0.1);
    expect(events.find(e => e.type === 'shove' && e.shoverId === 'human')).toBeDefined();
  });

  test('the day ends when every human is out, even with NPCs still up', () => {
    const game = makeGame();
    addSwimmer(game, 'human', 80);
    game.addNpcs(2);
    run(game, 0.2);
    game._applyDamage(game.players.human, 1000, 'wave');
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'game-over').reason).toBe('wiped-out');
  });

  test('outlasting the bullies crowns the human last-one-standing', () => {
    const game = makeGame();
    addSwimmer(game, 'human', 80);
    game.addNpcs(2);
    run(game, 0.2);
    game._applyDamage(game.players['npc-mel'], 1000, 'wave');
    game._applyDamage(game.players['npc-pete'], 1000, 'wave');
    const events = run(game, 0.2);
    const over = events.find(e => e.type === 'game-over');
    expect(over.reason).toBe('last-one-standing');
    expect(over.tally.best.id).toBe('human');
  });
});

describe('the beach day', () => {
  test('the clock runs from 9 AM and ends the game at 7 PM', () => {
    const game = makeGame({ dayLengthSec: 10 });
    addSwimmer(game, 'p1', 80);
    expect(game.clockHour()).toBe(9);
    const events = run(game, 11);
    const over = events.find(e => e.type === 'game-over');
    expect(over.reason).toBe('end-of-day');
    expect(over.tally.rows[0].survived).toBe(true);
    expect(game.phase).toBe('over');
    expect(game.clockHour()).toBeGreaterThanOrEqual(DAY_END_HOUR);
  });

  test('ticking a finished game is a no-op', () => {
    const game = makeGame({ dayLengthSec: 1 });
    addSwimmer(game, 'p1', 80);
    run(game, 2);
    expect(game.phase).toBe('over');
    expect(game.tick(1)).toEqual([]);
  });

  test('the tally ranks survivors above the eliminated and crowns the best', () => {
    const game = makeGame();
    const a = addSwimmer(game, 'alice', 80);
    const b = addSwimmer(game, 'bob', 80);
    const c = addSwimmer(game, 'carol', 80);
    a.score = 50; a.wavesRidden = 3;
    b.score = 900; b.state = 'out'; b.wavesRidden = 20; b.bestStreak = 9;
    c.score = 120; c.powerupsCollected = 4;
    const tally = game.tally();
    expect(tally.rows.map(r => r.id)).toEqual(['carol', 'alice', 'bob']);
    expect(tally.best.id).toBe('carol');
    expect(tally.waveMaster.id).toBe('bob');
    expect(tally.streakKing.id).toBe('bob');
    expect(tally.beachcomber.id).toBe('carol');
  });

  test('snapshots carry everything the client renders', () => {
    const game = makeGame();
    addSwimmer(game);
    sendWave(game, 2, 20);
    game.powerups.push({ id: 'pu1', type: 'sunscreen', x: 50, y: 50, expiresAt: 1000 });
    const snap = game.snapshot();
    expect(snap.players).toHaveLength(1);
    expect(snap.waves).toHaveLength(1);
    expect(snap.powerups).toHaveLength(1);
    expect(snap.forecast.now).toBeDefined();
    expect(snap.flags).toMatchObject({ minX: 20, maxX: 80 });
    expect(snap.clockHour).toBeGreaterThanOrEqual(9);
  });
});

describe('facing, walking and running', () => {
  test('players face the way they move, and facing persists at rest', () => {
    const game = makeGame();
    game.addPlayer('p1', 'Strider');
    let me = game.snapshot().players[0];
    expect(me.facing).toBe('down');
    expect(me.moving).toBe(false);
    expect(me.running).toBe(false);

    game.handleSteer('p1', -1, 0);
    run(game, 0.3);
    expect(game.snapshot().players[0].facing).toBe('left');
    expect(game.snapshot().players[0].moving).toBe(true);

    game.handleSteer('p1', 0, -1);
    run(game, 0.3);
    expect(game.snapshot().players[0].facing).toBe('up');

    game.handleSteer('p1', 0, 0);   // keys released
    run(game, 0.2);
    me = game.snapshot().players[0];
    expect(me.moving).toBe(false);
    expect(me.facing).toBe('up');   // still looking where they last went
  });

  test('a held tap runs to the target faster than a walk', () => {
    const game = makeGame();
    const w = addSwimmer(game, 'walker', 80, 10);
    const r = addSwimmer(game, 'runner', 80, 10);
    game.handleMove('walker', 90, 80);
    game.handleMove('runner', 90, 80, true);
    run(game, 1);
    expect(w.x).toBeCloseTo(10 + game.cfg.walkSpeed, 0);
    expect(r.x).toBeCloseTo(10 + game.cfg.walkSpeed * game.cfg.runSpeedFactor, 0);
    const snap = game.snapshot();
    expect(snap.players.find(p => p.id === 'runner').running).toBe(true);
    expect(snap.players.find(p => p.id === 'walker').running).toBe(false);
  });

  test('running drains a little HP; walking is free', () => {
    const game = makeGame();
    const w = addSwimmer(game, 'walker', 80, 10);
    const r = addSwimmer(game, 'runner', 80, 10);
    game.handleMove('walker', 90, 80);
    game.handleMove('runner', 90, 80, true);
    run(game, 2);
    expect(w.hp).toBe(100);
    expect(r.hp).toBeCloseTo(100 - game.cfg.runHpPerSec * 2, 0);
  });

  test('running can never knock a player out', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 10);
    p.hp = 2;
    game.handleMove('p1', 90, 80, true);
    run(game, 4);
    expect(p.hp).toBe(1);
    expect(p.state).not.toBe('out');
  });

  test('sprinting with held keys honors the steer run flag', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 30);
    game.handleSteer('p1', 1, 0, true);
    run(game, 1);
    expect(p.x).toBeCloseTo(30 + game.cfg.walkSpeed * game.cfg.runSpeedFactor, 0);
    expect(game.snapshot().players[0].running).toBe(true);
    expect(p.hp).toBeLessThan(100);
  });

  test('arriving at a run target ends the sprint and the drain', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);
    game.handleMove('p1', 60, 80, true);
    run(game, 1);   // 10 units at run speed — long since arrived
    const me = game.snapshot().players[0];
    expect(me.running).toBe(false);
    expect(me.moving).toBe(false);
    const hpAfter = p.hp;
    run(game, 1);
    expect(p.hp).toBe(hpAfter);
  });

  test('NPCs never run', () => {
    const game = makeGame({}, () => 0.2);
    game.hours = game.hours.map(() => 'sunny');
    addSwimmer(game, 'human', 40, 50);
    game.addNpcs(3);
    run(game, 5);
    for (const p of game.snapshot().players) {
      if (p.npc) expect(p.running).toBe(false);
    }
  });
});

describe('running cooldown', () => {
  test('a sprint winds the runner after runMaxSec and downgrades to a walk', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 5);
    game.handleSteer('p1', 1, 0, true);
    run(game, 2);
    expect(game.snapshot().players[0].running).toBe(true);

    const events = run(game, 1);   // stamina runs out at 2.5s
    expect(events.find(e => e.type === 'winded')).toBeTruthy();
    const me = game.snapshot().players[0];
    expect(me.running).toBe(false);
    expect(me.moving).toBe(true);       // still going — just walking
    expect(me.runReadyIn).toBeGreaterThan(0);
  });

  test('a sprint held through the breather surges again when stamina returns', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 5);
    game.handleSteer('p1', 1, 0, true);
    run(game, 3);                        // sprint (2.5s) then winded
    expect(game.snapshot().players[0].running).toBe(false);

    game.handleSteer('p1', -1, 0, true); // turn around, still holding run
    run(game, 2);                        // inside the ~3s breather
    expect(game.snapshot().players[0].running).toBe(false);

    run(game, 1.2);                      // breather over — off they go
    expect(game.snapshot().players[0].running).toBe(true);
  });

  test('stopping a sprint voluntarily also starts the breather', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 10);
    game.handleSteer('p1', 1, 0, true);
    run(game, 1);
    game.handleSteer('p1', 0, 0);        // let go mid-sprint
    run(game, 0.3);
    expect(game.snapshot().players[0].runReadyIn).toBeGreaterThan(0);

    game.handleSteer('p1', -1, 0, true); // try again right away
    const before = p.x;
    run(game, 1);
    expect(game.snapshot().players[0].running).toBe(false);
    expect(before - p.x).toBeCloseTo(game.cfg.walkSpeed, 0);   // walk pace only

    game.handleSteer('p1', 1, 0, true);  // clear of the world edge, still held
    run(game, 3);                        // breather expires while held
    expect(game.snapshot().players[0].running).toBe(true);
  });
});

describe('pails and salps', () => {
  test('planes sometimes drop pails, and picking one up equips it for the day', () => {
    const game = makeGame({}, () => 0.9);   // 0.9 drop roll → pail (and cloudy skies)
    const p = addSwimmer(game, 'p1', 80, 50);
    game.pendingDropAt = 0.05;
    run(game, 0.2);
    const pu = game.powerups[0];
    expect(pu.type).toBe('pail');
    p.x = pu.x;
    p.y = pu.y;
    run(game, 0.2);
    expect(game.powerups).toHaveLength(0);
    const me = game.snapshot().players[0];
    expect(me.pail).toBe(true);
    expect(me.buffs.bodysuit).toBe(0);   // equipment, not a timed buff
  });

  test('a pail-carrying swimmer scoops a salp for Pleasant Points', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 50);
    p.pail = true;
    game.salps.push({ id: 'sa', x: 50, y: 40, vx: 0, vy: 0, sting: false, expiresAt: 1000 });
    const events = run(game, 0.2);
    const ev = events.find(e => e.type === 'salp-collected');
    expect(ev).toBeTruthy();
    expect(ev.points).toBe(game.cfg.salpPoints);
    expect(p.score).toBe(game.cfg.salpPoints);
    expect(game.salps).toHaveLength(0);
  });

  test('without a pail, salps drift by untouched', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 50);
    game.salps.push({ id: 'sa', x: 50, y: 40, vx: 0, vy: 0, sting: false, expiresAt: 1000 });
    run(game, 0.3);
    expect(game.salps).toHaveLength(1);
    expect(p.score).toBe(0);
  });

  test('a disguised jellyfish stings the scooper instead of paying out', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 50);
    p.pail = true;
    game.salps.push({ id: 'sa', x: 50, y: 40, vx: 0, vy: 0, sting: true, expiresAt: 1000 });
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'salp-sting')).toBeTruthy();
    expect(p.hp).toBe(100 - game.cfg.jellyDamage);
    expect(p.score).toBe(0);
    expect(game.salps).toHaveLength(0);
  });

  test('snapshots never reveal which salps are jellyfish in disguise', () => {
    const game = makeGame();
    game.salps.push({ id: 'sa', x: 50, y: 40, vx: 0, vy: 0, sting: true, expiresAt: 1000 });
    const snap = game.snapshot();
    expect(snap.salps).toHaveLength(1);
    expect('sting' in snap.salps[0]).toBe(false);
  });

  test('salps wash away after their time', () => {
    const game = makeGame();
    game.salps.push({ id: 'sa', x: 50, y: 40, vx: 0, vy: 0, sting: false, expiresAt: 1 });
    run(game, 1.3);
    expect(game.salps).toHaveLength(0);
  });
});

describe('surf danger flags', () => {
  test('a calm morning flies a single yellow flag', () => {
    const game = makeGame();
    expect(game.surfDanger()).toBe(0);
    expect(game.snapshot().flags.danger).toBe(0);
  });

  test('danger climbs with the day, the tide, and the weather', () => {
    const game = makeGame();
    game.t = game.cfg.dayLengthSec * 0.5;      // midday, slack tide
    expect(game.surfDanger()).toBe(1);
    game.t = game.cfg.dayLengthSec * 0.625;    // high tide running fast
    expect(game.surfDanger()).toBe(2);
    game.hours = game.hours.map(() => 'storm');
    expect(game.surfDanger()).toBe(3);         // storm on top: double red
  });
});

describe('telegraphed lightning', () => {
  test('the strike spot glows before the bolt lands', () => {
    const game = stormGame();
    const p = addSwimmer(game);
    game.nextLightningAt = 0.05;
    const warnEvents = run(game, 0.3);
    const warn = warnEvents.find(e => e.type === 'lightning-warn');
    expect(warn).toBeTruthy();
    const snap = game.snapshot();
    expect(snap.strike).toBeTruthy();
    expect(snap.strike.progress).toBeGreaterThanOrEqual(0);
    // No damage yet — the telegraph is still running.
    expect(p.hp).toBe(100);
    const strikeEvents = run(game, game.cfg.lightningTelegraphSec + 0.2);
    expect(strikeEvents.find(e => e.type === 'lightning')).toBeTruthy();
    expect(game.snapshot().strike).toBeNull();
  });

  test('standing on the glowing spot gets you struck', () => {
    const game = stormGame();
    const p = addSwimmer(game);          // stays put at 50,40
    game.nextLightningAt = 0.05;
    const events = run(game, game.cfg.lightningTelegraphSec + 0.5);
    const strike = events.find(e => e.type === 'lightning');
    expect(strike.playerId).toBe('p1');
    expect(p.hp).toBe(100 - game.cfg.lightningDamage);
  });

  test('swimming clear of the telegraph dodges the bolt', () => {
    const game = stormGame();
    const p = addSwimmer(game);
    game.nextLightningAt = 0.05;
    run(game, 0.2);                      // telegraph appears near the swimmer
    p.x = 90;                            // teleport well outside the radius
    p.y = 30;
    const events = run(game, game.cfg.lightningTelegraphSec + 0.5);
    const strike = events.find(e => e.type === 'lightning');
    expect(strike.playerId).toBeNull();
    expect(p.hp).toBe(100);
  });
});

describe('rip currents', () => {
  function ripGame() {
    const game = makeGame();
    game.nextRipAt = 0.05;
    return game;
  }

  test('a caught swimmer is dragged out to sea and bleeds HP', () => {
    const game = ripGame();
    const p = addSwimmer(game, 'p1', 50, 50);
    const events = run(game, 0.2);       // rip spawns at x=50 (constant rng)
    expect(game.rip).toBeTruthy();
    events.push(...run(game, 1));
    expect(events.find(e => e.type === 'rip-caught')).toBeTruthy();
    expect(p.y).toBeLessThan(50);        // pulled toward the horizon
    expect(p.hp).toBeLessThan(100);
  });

  test('swimming sideways escapes the channel', () => {
    const game = ripGame();
    const p = addSwimmer(game, 'p1', 50, 50);
    run(game, 0.3);
    game.handleSteer('p1', 1, 0);        // swim parallel to the beach
    run(game, 1.5);                      // 15 units — well past halfWidth 6
    const yAfterEscape = p.y;
    const hpAfterEscape = p.hp;
    run(game, 1);
    expect(p.y).toBeCloseTo(yAfterEscape, 1);   // no longer being dragged
    expect(p.hp).toBe(hpAfterEscape);           // no longer bleeding
  });

  test('a lifeguard swims out and rescues anyone dragged past the buoys', () => {
    const game = ripGame();
    const p = addSwimmer(game, 'p1', game.cfg.deepY + 3, 50);
    const events = run(game, 9);
    expect(events.find(e => e.type === 'lifeguard-launch')).toBeTruthy();
    expect(events.find(e => e.type === 'rip-rescue')).toBeTruthy();
    expect(events.find(e => e.type === 'swept-away')).toBeUndefined();
    expect(p.state).not.toBe('out');
    expect(p.y).toBeGreaterThanOrEqual(game.cfg.deepY);    // hauled back in
    run(game, 6);                                          // guard swims home
    expect(game.lifeguards).toHaveLength(0);
  });

  test('carried to the top of the ocean, the rip wins — swept out to sea', () => {
    const game = ripGame();
    const p = addSwimmer(game, 'p1', -70, 50);   // already far out when it hits
    const events = run(game, 4);
    expect(events.find(e => e.type === 'swept-away')).toBeTruthy();
    expect(events.find(e => e.type === 'eliminated' && e.playerId === 'p1')).toBeTruthy();
    expect(events.find(e => e.type === 'rip-rescue')).toBeUndefined();
    expect(p.state).toBe('out');
  });

  test('escaping the rip calls the rescue off', () => {
    const game = ripGame();
    const p = addSwimmer(game, 'p1', game.cfg.deepY - 4, 50);
    const early = run(game, 0.4);
    expect(early.find(e => e.type === 'lifeguard-launch')).toBeTruthy();
    game.handleSteer('p1', 1, 0);                // swim out the side
    const later = run(game, 2.5);
    expect(later.find(e => e.type === 'rip-rescue')).toBeUndefined();
    expect(p.state).toBe('idle');
    run(game, 6);
    expect(game.lifeguards).toHaveLength(0);     // swam home empty-handed
  });

  test('swimmers outside the channel are untouched', () => {
    const game = ripGame();
    const p = addSwimmer(game, 'p1', 40, 80);   // far from rip at x=50
    run(game, 2);
    expect(p.hp).toBe(100);
    expect(p.y).toBe(40);
  });

  test('rips expire and the water calms down', () => {
    const game = ripGame();
    run(game, 0.2);
    expect(game.rip).toBeTruthy();
    game.rip.until = game.t + 0.1;
    run(game, 0.3);
    expect(game.rip).toBeNull();
    expect(game.snapshot().rip).toBeNull();
  });
});

describe('open ocean, crab shoves and rip fade', () => {
  test('players can swim a full screen beyond the buoys', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 30, 50);
    game.handleSteer('p1', 0, -1);
    const events = run(game, 4);                 // 40 units out to sea
    expect(p.y).toBeCloseTo(-10, 0);             // well past the old deepY=22
    expect(events.find(e => e.type === 'whistle')).toBeUndefined();
    expect(game.snapshot().flags.outerY).toBe(game.cfg.outerY);
  });

  test('a beachgoer punts a crab on the sand', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);            // on the sand
    const crab = addHazard(game, 'crab', 55, 80, -7);    // scuttling toward them
    game.handleShove('p1');
    const events = game.tick(0.1);
    expect(events.find(e => e.type === 'crab-shoved')).toBeTruthy();
    expect(crab.vx).toBeGreaterThan(0);                  // sent packing, away
    expect(p.shoveReadyAt).toBeGreaterThan(game.t);      // cooldown consumed
  });

  test('wildlife in the ocean cannot be shoved', () => {
    const game = makeGame();
    addSwimmer(game, 'p1', 40, 50);                      // swimming
    const crab = addHazard(game, 'crab', 52, 80, -7);    // crab ashore, shover afloat
    const jelly = addHazard(game, 'jelly', 60, 40, 0);
    game.handleShove('p1');
    const events = game.tick(0.1);
    expect(events.find(e => e.type === 'crab-shoved')).toBeUndefined();
    expect(events.find(e => e.type === 'shove-miss')).toBeTruthy();
    expect(crab.vx).toBe(-7);                            // still inbound
    expect(jelly.vx).toBe(0);
  });

  test('rip currents fade in and back out', () => {
    const game = makeGame();
    game.nextRipAt = 0.05;
    run(game, 0.2);
    expect(game.snapshot().rip.strength).toBeLessThan(0.2);   // just building
    run(game, game.cfg.ripFadeSec + 0.2);
    expect(game.snapshot().rip.strength).toBe(1);             // full force
    game.rip.until = game.t + 1;
    run(game, 0.5);
    expect(game.snapshot().rip.strength).toBeLessThan(0.5);   // dying down
  });
});

describe('encore jumps and the deep search', () => {
  test('chained jumps grow hangtime and give back a little HP', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    p.hp = 80;
    game.handleAction('p1', 'jump');
    const firstDur = p.action.until - p.action.startedAt;
    expect(p.hp).toBe(80);                       // first jump: no encore yet
    run(game, firstDur + game.cfg.actionCooldown + 0.1);
    game.handleAction('p1', 'jump');             // well inside the combo window
    const events = game.tick(0.05);
    const secondDur = p.action.until - p.action.startedAt;
    expect(secondDur).toBeGreaterThan(firstDur);
    expect(p.hp).toBe(80 + game.cfg.jumpComboHeal);
    expect(events.find(e => e.type === 'jump-combo')).toMatchObject({ combo: 2 });
    expect(game.snapshot().players[0].jumpCombo).toBe(2);
  });

  test('the encore lapses if you dawdle between jumps', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    p.hp = 80;
    game.handleAction('p1', 'jump');
    run(game, 3.5);                              // combo window long gone
    game.handleAction('p1', 'jump');
    expect(p.jumpCombo).toBe(1);
    expect(p.hp).toBe(80);
  });

  test('a third quick burrow vanishes the player from the playfield', () => {
    const game = makeGame();
    const p = addSwimmer(game);
    game.handleAction('p1', 'dive');
    run(game, 2);
    game.handleAction('p1', 'dive');
    run(game, 2);
    game.handleAction('p1', 'dive');             // third in the chain
    const events = game.tick(0.05);
    expect(p.action.type).toBe('vanish');
    expect(events.find(e => e.type === 'vanished')).toBeTruthy();

    // Off the playfield: unshovable, untouched by waves, immobile.
    const q = addSwimmer(game, 'q1', p.y, p.x + 3);
    game.handleShove('q1');
    const shoveEvents = game.tick(0.05);
    expect(shoveEvents.find(e => e.type === 'shove-miss')).toBeTruthy();
    sendWave(game, 3, p.y - 4);
    game.handleSteer('p1', 1, 0);
    const xBefore = p.x;
    const waveEvents = run(game, 0.4);
    expect(waveEvents.find(e => e.type === 'wave-result' && e.playerId === 'p1')).toBeUndefined();
    expect(p.x).toBe(xBefore);
  });

  test('surfacing can produce a rare shell…', () => {
    const game = makeGame({}, () => 0.2);        // shell roll: 0.2 < shellChance
    game.hours = game.hours.map(() => 'sunny');
    const p = addSwimmer(game);
    p.action = { type: 'vanish', startedAt: 0, until: 0.5 };
    const events = run(game, 1);
    const shell = events.find(e => e.type === 'shell-found');
    expect(shell).toBeTruthy();
    expect(p.score).toBe(game.cfg.shellPoints);
  });

  test('…or come up empty-handed', () => {
    const game = makeGame();                     // 0.5 ≥ shellChance
    const p = addSwimmer(game);
    p.action = { type: 'vanish', startedAt: 0, until: 0.5 };
    const events = run(game, 1);
    expect(events.find(e => e.type === 'surfaced')).toBeTruthy();
    expect(p.score).toBe(0);
  });
});

describe('wave endpoints and intensity gradient', () => {
  test('waves spawn at the far horizon, above the deepest swimmer', () => {
    const game = makeGame();
    game.nextWaveAt = 0.05;
    run(game, 0.2);
    expect(game.waves.length).toBeGreaterThan(0);
    expect(game.waves[0].y).toBeLessThan(game.cfg.waveSpawnY + 5);
    expect(game.cfg.waveSpawnY).toBeLessThan(game.cfg.outerY - 14);
  });

  test('some waves die before they reach the beach', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 50, 50);
    game.waves.push({ id: 'fader', size: 2, y: 30, endY: 42, slope: 0, wobble: 0, resolved: new Set() });
    const events = run(game, 3);
    expect(events.find(e => e.type === 'wave-result')).toBeUndefined();
    expect(game.waves.find(w => w.id === 'fader')).toBeUndefined();
    expect(p.hp).toBe(100);
  });

  test('a fading thumper arrives as something smaller', () => {
    const game = makeGame();
    addSwimmer(game, 'p1', 48, 50);
    game.waves.push({ id: 'fading', size: 3, y: 44, endY: 60, slope: 0, wobble: 0, resolved: new Set() });
    game.handleAction('p1', 'jump');             // a jump only survives size <= 2
    const events = run(game, 0.3);
    const res = events.find(e => e.type === 'wave-result');
    expect(res.outcome).toBe('ride');
    expect(res.size).toBeLessThan(3);
  });

  test('snapshots report the faded size and a fade factor', () => {
    const game = makeGame();
    game.waves.push({ id: 'w1', size: 3, y: 55, endY: 60, slope: 0, wobble: 0, resolved: new Set() });
    const w = game.snapshot().waves[0];
    expect(w.size).toBe(2);
    expect(w.fade).toBeCloseTo(0.42, 1);
  });
});

describe('swells beyond the break', () => {
  test('a missed duck-dive sweeps the swimmer shoreward with a sting', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 0, 50);    // beyond the buoy line
    sendWave(game, 3, -8);                      // swell bearing down on them
    const events = run(game, 1.5);
    expect(events.find(e => e.type === 'wave-result')).toBeUndefined();
    expect(events.find(e => e.type === 'swell-swept')).toBeTruthy();
    expect(p.y).toBeCloseTo(0 + game.cfg.swellSweep, 0);   // shoved back
    expect(p.hp).toBe(100 - game.cfg.swellDamage);
    expect(p.state).toBe('idle');               // stung, but never washed ashore
  });

  test('a timed duck-dive slides the swell by harmlessly', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 0, 50);
    sendWave(game, 3, -4);
    game.handleAction('p1', 'dive');
    const events = run(game, 0.5);
    expect(events.find(e => e.type === 'swell-duck')).toBeTruthy();
    expect(events.find(e => e.type === 'swell-swept')).toBeUndefined();
    expect(p.y).toBe(0);                        // held their ground
    expect(p.hp).toBe(100 - game.cfg.diveHpCost);   // only the dive's cost
  });

  test('a body board rides over swells without ducking', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 0, 50);
    p.buffs.bodyboard = 1000;
    sendWave(game, 3, -4);
    const events = run(game, 0.5);
    expect(events.find(e => e.type === 'swell-duck')).toBeTruthy();
    expect(p.hp).toBe(100);
  });

  test('the same wave still breaks on the surf zone crowd', () => {
    const game = makeGame();
    const deep = addSwimmer(game, 'deep', 10, 30);
    const surf = addSwimmer(game, 'surf', 40, 70);
    sendWave(game, 2, 4);                       // starts above both
    const events = run(game, 4);
    const results = events.filter(e => e.type === 'wave-result');
    expect(results.map(r => r.playerId)).toEqual(['surf']);
    expect(events.find(e => e.type === 'swell-swept' && e.playerId === 'deep')).toBeTruthy();
    expect(deep.hp).toBe(100 - game.cfg.swellDamage);
    expect(surf.state).toBe('washed');          // stood through a roller
  });
});

describe('the boardwalk', () => {
  test('players can walk down onto the boardwalk', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 80, 50);
    game.handleMove('p1', 50, 140);
    run(game, 5);
    expect(p.y).toBeCloseTo(140, 0);
    expect(game.snapshot().flags.boardwalkY).toBe(game.cfg.boardwalkY);
    expect(game.snapshot().flags.boardwalkBottom).toBe(game.cfg.boardwalkBottom);
  });

  test('no digging through the planks', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 120, 50);   // standing on the boardwalk
    game.handleAction('p1', 'dive');
    expect(p.action).toBeNull();
    expect(p.burrowCombo).toBe(0);               // the press never counted
  });
});

describe('storm flags and the Bait & Tackle shop', () => {
  test('storm weather is an automatic double red', () => {
    const game = makeGame();
    game.hours = game.hours.map(() => 'storm');
    expect(game.surfDanger()).toBe(3);           // even at 9 AM, slack tide
  });

  test('walking into the doorway brings you inside the shop', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', game.cfg.shopY, game.cfg.shopX);
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'shop-enter')).toBeTruthy();
    expect(p.inShop).toBe(true);
    expect(game.snapshot().players[0].inShop).toBe(true);
    // Beach inputs are ignored at the counter.
    game.handleMove('p1', 50, 40);
    game.handleAction('p1', 'jump');
    run(game, 0.3);
    expect(p.target).toBeNull();
    expect(p.action).toBeNull();
    expect(p.x).toBe(game.cfg.shopX);
  });

  test('the counter sells one worm at a time, with honest errors', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', game.cfg.shopY, game.cfg.shopX);
    run(game, 0.2);                              // step inside
    expect(game.handleShopAction('p1', 'buy-bait').success).toBe(false);   // broke
    p.score = 50;
    expect(game.handleShopAction('p1', 'buy-bait').success).toBe(true);
    expect(p.bait).toBe(1);
    expect(p.score).toBe(50 - game.cfg.baitCost);
    expect(game.handleShopAction('p1', 'buy-bait').success).toBe(false);   // pouch full
    expect(p.score).toBe(50 - game.cfg.baitCost);
  });

  test('leaving the shop puts you back on the boardwalk, free to move', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', game.cfg.shopY, game.cfg.shopX);
    run(game, 0.2);
    expect(p.inShop).toBe(true);
    expect(game.handleShopAction('p1', 'leave').success).toBe(true);
    expect(p.inShop).toBe(false);
    run(game, 0.3);                              // standing out front...
    expect(p.inShop).toBe(false);                // ...does not re-enter
    game.handleMove('p1', 60, 130);
    run(game, 3);
    expect(p.x).toBeCloseTo(60, 0);              // walking works again
  });

  test('the beach day keeps playing while someone is in the shop', () => {
    const game = makeGame();
    const shopper = addSwimmer(game, 'shopper', game.cfg.shopY, game.cfg.shopX);
    const surfer = addSwimmer(game, 'surfer', 40, 60);
    run(game, 0.2);
    expect(shopper.inShop).toBe(true);
    const before = game.t;
    sendWave(game, 1, surfer.y - 4);
    const events = run(game, 0.5);
    expect(events.find(e => e.type === 'wave-result' && e.playerId === 'surfer')).toBeTruthy();
    expect(game.t).toBeGreaterThan(before);      // the clock never stopped
    expect(shopper.inShop).toBe(true);
  });

  test('soaked bait lures a fish — but only in the water', () => {
    const game = makeGame();
    const wet = addSwimmer(game, 'wet', 40, 50);
    const dry = addSwimmer(game, 'dry', 80, 70);
    wet.bait = 1;
    dry.bait = 1;
    const events = run(game, 10);                // lure fires at ~9s
    expect(events.find(e => e.type === 'fish-caught' && e.playerId === 'wet')).toBeTruthy();
    expect(wet.fish).toBe(1);
    expect(wet.bait).toBe(0);
    expect(dry.fish).toBe(0);
    expect(dry.bait).toBe(1);
  });

  test('a carried fish buys off a shark attack', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 40, 50);
    p.fish = 1;
    addHazard(game, 'shark', 50, 40, 0);
    const events = run(game, 0.2);
    expect(events.find(e => e.type === 'fish-taken')).toBeTruthy();
    expect(events.find(e => e.type === 'shark-attack')).toBeUndefined();
    expect(p.fish).toBe(0);
    expect(p.hp).toBe(100);
    expect(p.state).toBe('idle');

    addHazard(game, 'shark', 50.5, 40, 0);       // no fish left this time
    const events2 = run(game, 0.2);
    expect(events2.find(e => e.type === 'shark-attack')).toBeTruthy();
    expect(p.hp).toBe(100 - game.cfg.sharkDamage);
  });

  test('the counter buys the whole catch on request', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', game.cfg.shopY, game.cfg.shopX);
    p.fish = 2;
    run(game, 0.2);                              // step inside
    expect(game.handleShopAction('p1', 'sell-fish').success).toBe(true);
    expect(p.fish).toBe(0);
    expect(p.score).toBe(2 * game.cfg.fishSellPoints);
    expect(game.handleShopAction('p1', 'sell-fish').success).toBe(false);   // sold out
    // The counter refuses customers who aren't inside.
    const outside = addSwimmer(game, 'p2', 40, 70);
    expect(game.handleShopAction('p2', 'buy-bait').success).toBe(false);
  });
});

describe('shop collision', () => {
  test('the shop walls stop a walker from the side', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 112, 5);          // level with the building
    game.handleMove('p1', game.cfg.shopX, 112);        // aim straight through it
    run(game, 4);
    expect(p.x).toBeCloseTo(game.cfg.shopX - game.cfg.shopHalfW, 0);   // pinned at the wall
    expect(p.inShop).toBe(false);
  });

  test('the back wall blocks the beach-side approach — no sneaking in', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 95, game.cfg.shopX);
    game.handleMove('p1', game.cfg.shopX, 114);        // walk down into the roof
    run(game, 3);
    expect(p.y).toBeCloseTo(game.cfg.shopY - game.cfg.shopH, 0);
    expect(p.inShop).toBe(false);
  });

  test('the doorway on the south face still lets you in', () => {
    const game = makeGame();
    const p = addSwimmer(game, 'p1', 130, game.cfg.shopX);   // out front
    game.handleMove('p1', game.cfg.shopX, game.cfg.shopY);   // walk up to the door
    const events = run(game, 2);
    expect(events.find(e => e.type === 'shop-enter')).toBeTruthy();
    expect(p.inShop).toBe(true);
  });
});
