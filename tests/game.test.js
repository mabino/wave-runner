const { WaveRunnerGame, DAY_END_HOUR } = require('../src/game');

// Constant-rng game: weather is all sunny (0.5 rolls), no surprises.
function makeGame(config = {}, rng = () => 0.5) {
  const game = new WaveRunnerGame(config, rng);
  // Quiet the environment by default so each test forces exactly the
  // scenario it cares about.
  game.nextWaveAt = Infinity;
  game.nextPlaneAt = Infinity;
  game.nextSharkAt = Infinity;
  game.nextJellyAt = Infinity;
  game.nextCrabAt = Infinity;
  game.nextGullAt = Infinity;
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

  test('swimming too far out also triggers the lifeguard', () => {
    const game = makeGame();
    addSwimmer(game, 'p1', 15, 50);   // above deepY=22
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
  function stormGame() {
    const game = makeGame();
    game.hours = Array(game.hours.length).fill('storm');
    return game;
  }

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
