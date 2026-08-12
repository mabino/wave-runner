const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const { RoomManager } = require('./src/rooms');
const { WaveRunnerGame } = require('./src/game');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const roomManager = new RoomManager();

// Per-room simulation loop handles
const roomLoops = new Map();   // code -> interval

const TICK_MS = 125;           // 8 Hz simulation + broadcast

app.use(express.json());

// Serve the socket.io client bundle explicitly so it is always available,
// even in environments where the prepare script did not run (e.g. bare npm ci).
app.get('/socket.io/socket.io.js', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(require.resolve('socket.io/client-dist/socket.io.js'));
});

// The CDN edge caches js/css by extension for hours and ignores origin
// no-cache — a fresh index.html referencing last week's app.js is how
// buttons die. Every asset URL therefore carries a version stamped at
// boot: each deploy recreates the container, mints a new stamp, and the
// new URLs sail past every stale edge copy.
const ASSET_VERSION = Date.now().toString(36);
const INDEX_HTML = fs
  .readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace(/\?v=\w+/g, `?v=${ASSET_VERSION}`);

app.get(['/', '/index.html'], (_req, res) => {
  res.set('Cache-Control', 'no-cache').type('html').send(INDEX_HTML);
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
}));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', rooms: roomManager.rooms.size });
});

// ─── Game loop ────────────────────────────────────────────────────────────────

function stopLoop(code) {
  const loop = roomLoops.get(code);
  if (loop) {
    clearInterval(loop);
    roomLoops.delete(code);
  }
}

function startLoop(room) {
  stopLoop(room.code);
  let last = Date.now();
  const interval = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.5, (now - last) / 1000);   // clamp catch-up after stalls
    last = now;

    const game = room.game;
    if (!game) { stopLoop(room.code); return; }

    const events = game.tick(dt);
    // One batched packet per tick instead of one per event — busy moments
    // (storms, shove brawls) otherwise fan out into a packet flurry.
    const batch = [];
    for (const ev of events) {
      if (ev.type === 'game-over') {
        io.to(room.code).emit('game:over', { reason: ev.reason, tally: ev.tally });
        room.endGame();
        stopLoop(room.code);
        io.to(room.code).emit('room:updated', room.toPublic());
      } else {
        batch.push(ev);
      }
    }
    if (batch.length) io.to(room.code).emit('game:events', batch);
    if (room.game) io.to(room.code).emit('game:state', room.game.snapshot());
  }, TICK_MS);
  roomLoops.set(room.code, interval);
}

function handlePlayerLeave(socketId) {
  const room = roomManager.getRoomByPlayer(socketId);
  if (!room) return;

  const playerName = room.players[socketId]?.name || 'A beachgoer';
  roomManager.removePlayer(socketId);

  if (room.isEmpty()) {
    stopLoop(room.code);
    roomManager.deleteRoom(room.code);
    return;
  }

  io.to(room.code).emit('room:player-left', { playerName, playerId: socketId });

  // If a running game just lost its last active player, end the day early.
  if (room.phase === 'playing' && room.game && Object.keys(room.game.players).length === 0) {
    stopLoop(room.code);
    room.endGame();
  }

  io.to(room.code).emit('room:updated', room.toPublic());
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // Most in-game messages want the same thing: this socket's running game.
  const gameOf = () => roomManager.getRoomByPlayer(socket.id)?.game;

  // Starting a day and starting a rematch are the same launch sequence.
  const launchGame = (room) => {
    room.startGame(WaveRunnerGame);
    io.to(room.code).emit('game:started', { config: room.config });
    startLoop(room);
  };

  socket.on('room:create', ({ playerName, avatar } = {}, cb) => {
    if (typeof cb !== 'function') return;
    if (!playerName?.trim()) return cb({ success: false, error: 'Name required' });
    const room = roomManager.createRoom(socket.id, playerName.trim().slice(0, 20), avatar);
    socket.join(room.code);
    cb({ success: true, room: room.toPublic() });
  });

  socket.on('room:join', ({ code, playerName, avatar } = {}, cb) => {
    if (typeof cb !== 'function') return;
    if (!playerName?.trim()) return cb({ success: false, error: 'Name required' });
    if (!code?.trim()) return cb({ success: false, error: 'Room code required' });
    const result = roomManager.joinRoom(code, socket.id, playerName.trim().slice(0, 20), avatar);
    if (!result.success) return cb(result);
    socket.join(result.room.code);
    io.to(result.room.code).emit('room:updated', result.room.toPublic());
    cb({ success: true, room: result.room.toPublic() });
  });

  socket.on('player:customize', ({ avatar } = {}, cb) => {
    const room = roomManager.getRoomByPlayer(socket.id);
    if (!room) return cb?.({ success: false, error: 'Not in a room' });
    if (room.phase === 'playing') return cb?.({ success: false, error: 'Game in progress' });
    room.setAvatar(socket.id, avatar);
    io.to(room.code).emit('room:updated', room.toPublic());
    cb?.({ success: true });
  });

  socket.on('game:configure', ({ config } = {}, cb) => {
    const room = roomManager.getRoomByPlayer(socket.id);
    if (!room) return cb?.({ success: false, error: 'Not in a room' });
    if (room.hostId !== socket.id) return cb?.({ success: false, error: 'Host only' });
    room.setConfig(config);
    io.to(room.code).emit('game:configured', { config: room.config });
    cb?.({ success: true });
  });

  // Ack may arrive as the first or second arg depending on whether the
  // client sent a payload before the callback.
  const ackOf = (...args) => args.find(a => typeof a === 'function');

  socket.on('game:start', (...args) => {
    const cb = ackOf(...args);
    const room = roomManager.getRoomByPlayer(socket.id);
    if (!room) return cb?.({ success: false, error: 'Not in a room' });
    if (room.hostId !== socket.id) return cb?.({ success: false, error: 'Host only' });
    if (room.phase === 'playing') return cb?.({ success: false, error: 'Game already started' });

    launchGame(room);
    cb?.({ success: true });
  });

  socket.on('game:move', ({ x, y, run } = {}) => gameOf()?.handleMove(socket.id, x, y, run));
  socket.on('game:steer', ({ dx, dy, run } = {}) => gameOf()?.handleSteer(socket.id, dx, dy, run));
  socket.on('game:action', ({ type } = {}) => gameOf()?.handleAction(socket.id, type));
  socket.on('game:shove', () => gameOf()?.handleShove(socket.id));
  socket.on('game:rest', () => gameOf()?.handleRest(socket.id));
  socket.on('game:tap-powerup', ({ id } = {}) => gameOf()?.handleTapPowerup(socket.id, id));

  socket.on('game:shop', ({ action } = {}, cb) => {
    const result = gameOf()?.handleShopAction(socket.id, action);
    cb?.(result || { success: false, error: 'No game running' });
  });

  socket.on('game:rematch', (...args) => {
    const cb = ackOf(...args);
    const room = roomManager.getRoomByPlayer(socket.id);
    if (!room) return cb?.({ success: false, error: 'Not in a room' });
    if (room.phase === 'playing') return cb?.({ success: false, error: 'Game in progress' });
    room.requestRematch(socket.id);
    if (room.allWantRematch()) {
      launchGame(room);
    } else {
      io.to(room.code).emit('game:rematch-requested', {
        playerId: socket.id,
        playerName: room.players[socket.id]?.name,
      });
    }
    cb?.({ success: true });
  });

  socket.on('room:leave', () => handlePlayerLeave(socket.id));

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    handlePlayerLeave(socket.id);
  });
});

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`🌊 Wave Runner on http://localhost:${PORT}`);
  });
}

module.exports = { app, httpServer, io, roomManager };
