/**
 * Room / lobby management — the same join mechanics as Bino Bee:
 * six-character room codes, host-created rooms, host migration on leave,
 * and a lobby -> playing -> over phase cycle with rematch.
 */

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const DAY_LENGTHS = { quick: 240, classic: 420, marathon: 600 };
const MAX_PLAYERS = 8;

class Room {
  constructor(hostId, hostName, avatar) {
    this.code = generateCode();
    this.hostId = hostId;
    this.players = {
      [hostId]: this._makePlayer(hostId, hostName, avatar),
    };
    this.config = {
      dayLength: 'classic',   // 'quick' | 'classic' | 'marathon'
      npcs: 0,                // 0-3 computer beachgoers of rising menace
    };
    this.phase = 'lobby';     // 'lobby' | 'playing' | 'over'
    this.game = null;         // WaveRunnerGame instance while playing
  }

  _makePlayer(id, name, avatar) {
    return {
      id,
      name,
      avatar: this._cleanAvatar(avatar),
      rematch: false,
    };
  }

  _cleanAvatar(avatar) {
    const a = avatar || {};
    return {
      archetype: Math.min(7, Math.max(0, Number(a.archetype) || 0)),
      skin: Math.min(3, Math.max(0, Number(a.skin) || 0)),
      outfit: Math.min(5, Math.max(0, Number(a.outfit) || 0)),
    };
  }

  setConfig(cfg) {
    if (!cfg) return;
    if (DAY_LENGTHS[cfg.dayLength]) this.config.dayLength = cfg.dayLength;
    if (Number.isInteger(cfg.npcs) && cfg.npcs >= 0 && cfg.npcs <= 3) this.config.npcs = cfg.npcs;
  }

  dayLengthSec() { return DAY_LENGTHS[this.config.dayLength]; }

  setAvatar(id, avatar) {
    if (this.players[id]) this.players[id].avatar = this._cleanAvatar(avatar);
  }

  addPlayer(id, name, avatar) {
    if (Object.keys(this.players).length >= MAX_PLAYERS) {
      return { success: false, error: 'The beach is full' };
    }
    this.players[id] = this._makePlayer(id, name, avatar);
    return { success: true };
  }

  removePlayer(id) {
    delete this.players[id];
    if (this.game) this.game.removePlayer(id);
    if (this.hostId === id) {
      const ids = Object.keys(this.players);
      if (ids.length) this.hostId = ids[0];
    }
  }

  isEmpty() { return Object.keys(this.players).length === 0; }

  startGame(GameClass, rng) {
    this.phase = 'playing';
    this.game = new GameClass({ dayLengthSec: this.dayLengthSec() }, rng);
    for (const p of Object.values(this.players)) {
      p.rematch = false;
      this.game.addPlayer(p.id, p.name, p.avatar);
    }
    if (this.config.npcs) this.game.addNpcs(this.config.npcs);
    return this.game;
  }

  endGame() {
    this.phase = 'over';
    this.game = null;
  }

  requestRematch(playerId) {
    if (this.players[playerId]) this.players[playerId].rematch = true;
  }

  allWantRematch() {
    const ps = Object.values(this.players);
    return ps.length > 0 && ps.every(p => p.rematch);
  }

  toPublic() {
    return {
      code: this.code,
      hostId: this.hostId,
      players: Object.values(this.players).map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        rematch: p.rematch,
      })),
      config: this.config,
      phase: this.phase,
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();       // code -> Room
    this.playerRooms = new Map(); // socketId -> code
  }

  createRoom(hostId, hostName, avatar) {
    const room = new Room(hostId, hostName, avatar);
    while (this.rooms.has(room.code)) room.code = generateCode();
    this.rooms.set(room.code, room);
    this.playerRooms.set(hostId, room.code);
    return room;
  }

  joinRoom(code, playerId, playerName, avatar) {
    const room = this.rooms.get(String(code).toUpperCase().trim());
    if (!room) return { success: false, error: 'Room not found' };
    if (room.phase === 'playing') return { success: false, error: 'Game already in progress' };
    const result = room.addPlayer(playerId, playerName, avatar);
    if (!result.success) return result;
    this.playerRooms.set(playerId, room.code);
    return { success: true, room };
  }

  getRoomByPlayer(playerId) {
    const code = this.playerRooms.get(playerId);
    return code ? (this.rooms.get(code) || null) : null;
  }

  removePlayer(playerId) {
    const room = this.getRoomByPlayer(playerId);
    if (room) room.removePlayer(playerId);
    this.playerRooms.delete(playerId);
  }

  deleteRoom(code) {
    const room = this.rooms.get(code);
    if (room) {
      for (const id of Object.keys(room.players)) this.playerRooms.delete(id);
    }
    this.rooms.delete(code);
  }
}

module.exports = { RoomManager, Room, DAY_LENGTHS, MAX_PLAYERS };
