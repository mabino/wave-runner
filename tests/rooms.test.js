const { RoomManager, DAY_LENGTHS, MAX_PLAYERS } = require('../src/rooms');
const { WaveRunnerGame } = require('../src/game');

describe('RoomManager', () => {
  let manager;
  beforeEach(() => { manager = new RoomManager(); });

  test('creates a room with a 6-character code and the host inside', () => {
    const room = manager.createRoom('host1', 'Alice', { archetype: 2, skin: 1, outfit: 3 });
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(room.hostId).toBe('host1');
    expect(room.players.host1.avatar).toEqual({ archetype: 2, skin: 1, outfit: 3 });
    expect(room.phase).toBe('lobby');
  });

  test('players join by code, case-insensitively', () => {
    const room = manager.createRoom('host1', 'Alice');
    const result = manager.joinRoom(room.code.toLowerCase(), 'p2', 'Bob');
    expect(result.success).toBe(true);
    expect(Object.keys(room.players)).toHaveLength(2);
  });

  test('joining an unknown room fails', () => {
    expect(manager.joinRoom('NOPE99', 'p2', 'Bob')).toEqual({ success: false, error: 'Room not found' });
  });

  test('a running game cannot be joined', () => {
    const room = manager.createRoom('host1', 'Alice');
    room.startGame(WaveRunnerGame);
    expect(manager.joinRoom(room.code, 'p2', 'Bob').success).toBe(false);
  });

  test(`the beach holds ${MAX_PLAYERS} players`, () => {
    const room = manager.createRoom('host1', 'Alice');
    for (let i = 2; i <= MAX_PLAYERS; i++) {
      expect(manager.joinRoom(room.code, `p${i}`, `P${i}`).success).toBe(true);
    }
    expect(manager.joinRoom(room.code, 'extra', 'Extra').success).toBe(false);
  });

  test('the host role migrates when the host leaves', () => {
    const room = manager.createRoom('host1', 'Alice');
    manager.joinRoom(room.code, 'p2', 'Bob');
    manager.removePlayer('host1');
    expect(room.hostId).toBe('p2');
  });

  test('empty rooms can be deleted and forget their players', () => {
    const room = manager.createRoom('host1', 'Alice');
    manager.removePlayer('host1');
    expect(room.isEmpty()).toBe(true);
    manager.deleteRoom(room.code);
    expect(manager.rooms.has(room.code)).toBe(false);
    expect(manager.getRoomByPlayer('host1')).toBeNull();
  });

  test('avatars are clamped to the catalogue', () => {
    const room = manager.createRoom('host1', 'Alice', { archetype: 42, skin: -3, outfit: 99 });
    expect(room.players.host1.avatar).toEqual({ archetype: 7, skin: 0, outfit: 5 });
    room.setAvatar('host1', { archetype: 5, skin: 2, outfit: 1 });
    expect(room.players.host1.avatar).toEqual({ archetype: 5, skin: 2, outfit: 1 });
  });

  test('only known day lengths are accepted', () => {
    const room = manager.createRoom('host1', 'Alice');
    room.setConfig({ dayLength: 'marathon' });
    expect(room.config.dayLength).toBe('marathon');
    expect(room.dayLengthSec()).toBe(DAY_LENGTHS.marathon);
    room.setConfig({ dayLength: 'forever' });
    expect(room.config.dayLength).toBe('marathon');
  });

  test('the NPC option is clamped and staffs the game', () => {
    const room = manager.createRoom('host1', 'Alice');
    room.setConfig({ npcs: 2 });
    expect(room.config.npcs).toBe(2);
    room.setConfig({ npcs: 9 });
    expect(room.config.npcs).toBe(2);
    room.setConfig({ npcs: -1 });
    expect(room.config.npcs).toBe(2);
    const game = room.startGame(WaveRunnerGame);
    const npcs = Object.values(game.players).filter(p => p.npc);
    expect(npcs.map(p => p.name)).toEqual(['Mellow Mel', 'Pushy Pete']);
    expect(Object.keys(game.players)).toHaveLength(3);   // host + 2 bullies
  });

  test('starting a game seeds it with every lobby player', () => {
    const room = manager.createRoom('host1', 'Alice');
    manager.joinRoom(room.code, 'p2', 'Bob');
    const game = room.startGame(WaveRunnerGame);
    expect(room.phase).toBe('playing');
    expect(Object.keys(game.players).sort()).toEqual(['host1', 'p2']);
    expect(game.cfg.dayLengthSec).toBe(DAY_LENGTHS.classic);
  });

  test('leaving mid-game removes the player from the simulation too', () => {
    const room = manager.createRoom('host1', 'Alice');
    manager.joinRoom(room.code, 'p2', 'Bob');
    room.startGame(WaveRunnerGame);
    manager.removePlayer('p2');
    expect(room.game.players.p2).toBeUndefined();
  });

  test('rematch fires only when every player is in', () => {
    const room = manager.createRoom('host1', 'Alice');
    manager.joinRoom(room.code, 'p2', 'Bob');
    room.phase = 'over';
    room.requestRematch('host1');
    expect(room.allWantRematch()).toBe(false);
    room.requestRematch('p2');
    expect(room.allWantRematch()).toBe(true);
    room.startGame(WaveRunnerGame);
    expect(Object.values(room.players).every(p => p.rematch === false)).toBe(true);
  });

  test('toPublic exposes no game internals', () => {
    const room = manager.createRoom('host1', 'Alice');
    room.startGame(WaveRunnerGame);
    const pub = room.toPublic();
    expect(pub.game).toBeUndefined();
    expect(pub).toMatchObject({ code: room.code, hostId: 'host1', phase: 'playing' });
  });
});
