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
    expect(p.score).toBe(25 + 5);        // base + perfect, no streak bonus yet
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
    const later = run(game, game.cfg.gullSnatchDelay + 0.3);
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
    const events = run(game, game.cfg.gullSnatchDelay + 0.5);
    expect(events.find(e => e.type === 'gull-steal')).toBeUndefined();
    expect(p.powerupsCollected).toBe(1);
    expect(game.gullRaid).toBeNull();
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
