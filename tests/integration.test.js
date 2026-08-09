/**
 * Integration test: real Socket.IO clients against the real server —
 * the same lobby flow a browser walks through, plus a fast-forwarded
 * game day to the end screen.
 */
const { io: ioc } = require('socket.io-client');
const { httpServer, io, roomManager } = require('../server');

let port;
const clients = [];

function connect() {
  const socket = ioc(`http://localhost:${port}`, { transports: ['websocket'] });
  clients.push(socket);
  return new Promise((resolve) => socket.on('connect', () => resolve(socket)));
}

function emitAck(socket, event, payload) {
  const args = payload === undefined ? [] : [payload];
  return new Promise((resolve) => socket.emit(event, ...args, resolve));
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

beforeAll((done) => {
  httpServer.listen(0, () => {
    port = httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  for (const c of clients) c.disconnect();
  // io.close() also closes the underlying HTTP server.
  io.close(() => done());
});

test('two players lobby up, play, and reach the end-of-day tally', async () => {
  const host = await connect();
  const guest = await connect();

  // Host creates a room with an avatar.
  const created = await emitAck(host, 'room:create', {
    playerName: 'Alice',
    avatar: { archetype: 1, skin: 2, outfit: 3 },
  });
  expect(created.success).toBe(true);
  const code = created.room.code;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // Guest joins by code; both see the updated roster.
  const joined = await emitAck(guest, 'room:join', { code, playerName: 'Bob' });
  expect(joined.success).toBe(true);
  expect(joined.room.players).toHaveLength(2);

  // Guest re-customizes in the lobby.
  const customized = await emitAck(guest, 'player:customize', { avatar: { archetype: 4, skin: 1, outfit: 0 } });
  expect(customized.success).toBe(true);

  // Only the host may start.
  const denied = await emitAck(guest, 'game:start', undefined);
  expect(denied.success).toBe(false);

  const started = await emitAck(host, 'game:start', undefined);
  expect(started.success).toBe(true);

  // Both receive streaming state with the full scene.
  const snap = await waitFor(guest, 'game:state');
  expect(snap.players).toHaveLength(2);
  expect(snap.forecast.now).toBeDefined();
  expect(snap.clockHour).toBeGreaterThanOrEqual(9);

  // Inputs flow: the guest wades toward the surf and the sim moves them.
  const before = snap.players.find(p => p.name === 'Bob');
  guest.emit('game:move', { x: 50, y: 40 });
  await new Promise(r => setTimeout(r, 700));
  const later = await waitFor(guest, 'game:state');
  const after = later.players.find(p => p.name === 'Bob');
  expect(after.y).toBeLessThan(before.y);

  // Actions are accepted (jump shows up in the broadcast state).
  guest.emit('game:action', { type: 'jump' });
  const acting = await waitFor(guest, 'game:state');
  expect(['jump', null]).toContain(acting.players.find(p => p.name === 'Bob').action);

  // Fast-forward: shrink the day so the next tick passes 7 PM.
  const room = roomManager.rooms.get(code);
  room.game.cfg.dayLengthSec = 0.001;
  const over = await waitFor(host, 'game:over');
  expect(over.reason).toBe('end-of-day');
  expect(over.tally.rows).toHaveLength(2);
  expect(over.tally.best).toBeDefined();

  // Rematch needs everyone; then the day restarts.
  await emitAck(host, 'game:rematch', undefined);
  const again = waitFor(guest, 'game:started');
  await emitAck(guest, 'game:rematch', undefined);
  await again;
  const rematchSnap = await waitFor(host, 'game:state');
  expect(rematchSnap.players).toHaveLength(2);

  // Leaving tears the room down for the remaining player.
  const leftNotice = waitFor(host, 'room:player-left');
  guest.emit('room:leave');
  expect((await leftNotice).playerName).toBe('Bob');
}, 20000);

test('bad joins are rejected with reasons', async () => {
  const socket = await connect();
  expect(await emitAck(socket, 'room:join', { code: 'ZZZZZZ', playerName: 'Nia' }))
    .toEqual({ success: false, error: 'Room not found' });
  expect((await emitAck(socket, 'room:create', { playerName: '' })).success).toBe(false);
  expect((await emitAck(socket, 'room:join', { playerName: 'Nia' })).success).toBe(false);
});

test('the health endpoint answers', async () => {
  const res = await fetch(`http://localhost:${port}/api/health`);
  expect(res.status).toBe(200);
  expect((await res.json()).status).toBe('ok');
});
