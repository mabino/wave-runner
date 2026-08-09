/* ─────────────────────────────────────────────────────────────────────────
 * app.js — screens, lobby flow (Bino Bee style room codes), socket wiring,
 * HUD and touch controls.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Works at "/" in dev and under "/waves/" behind the gateway.
  const BASE = location.pathname.endsWith('/')
    ? location.pathname
    : location.pathname.replace(/[^/]*$/, '');
  const socket = io({ path: BASE + 'socket.io' });

  const state = {
    myId: null,
    myName: localStorage.getItem('wr-name') || '',
    avatar: JSON.parse(localStorage.getItem('wr-avatar') || '{"archetype":0,"skin":0,"outfit":0}'),
    room: null,
    playing: false,
    lastHp: 100,
  };

  const $ = (id) => document.getElementById(id);

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(`screen-${name}`).classList.add('active');
  }

  function showError(id, msg) {
    const el = $(id);
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // ── Audio unlock: iOS requires a user gesture ──────────────────────────
  let audioReady = false;
  function unlockAudio() {
    if (audioReady) return;
    audioReady = true;
    Beach.unlock();
    Beach.startAmbience();
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('touchend', unlockAudio, { once: true });

  // ── Avatar picker ──────────────────────────────────────────────────────
  function buildPicker() {
    const grid = $('archetype-grid');
    grid.innerHTML = '';
    Sprites.ARCHETYPES.forEach((arch, i) => {
      const c = document.createElement('canvas');
      c.width = 36; c.height = 48;
      c.title = arch.name;
      c.addEventListener('click', () => { state.avatar.archetype = i; refreshPicker(); });
      grid.appendChild(c);
    });

    const skins = $('skin-swatches');
    skins.innerHTML = '';
    Sprites.SKIN_TONES.forEach((tone, i) => {
      const b = document.createElement('button');
      b.style.background = tone;
      b.addEventListener('click', () => { state.avatar.skin = i; refreshPicker(); });
      skins.appendChild(b);
    });

    const outfits = $('outfit-swatches');
    outfits.innerHTML = '';
    Sprites.OUTFITS.forEach((color, i) => {
      const b = document.createElement('button');
      b.style.background = color;
      b.addEventListener('click', () => { state.avatar.outfit = i; refreshPicker(); });
      outfits.appendChild(b);
    });

    refreshPicker();
  }

  function refreshPicker() {
    localStorage.setItem('wr-avatar', JSON.stringify(state.avatar));
    $('archetype-name').textContent = Sprites.ARCHETYPES[state.avatar.archetype].name;
    [...$('archetype-grid').children].forEach((c, i) => {
      c.classList.toggle('on', i === state.avatar.archetype);
      Sprites.drawInto(c, { ...state.avatar, archetype: i });
    });
    [...$('skin-swatches').children].forEach((b, i) => b.classList.toggle('on', i === state.avatar.skin));
    [...$('outfit-swatches').children].forEach((b, i) => b.classList.toggle('on', i === state.avatar.outfit));
    Sprites.drawInto($('avatar-preview'), state.avatar);
    if (state.room) socket.emit('player:customize', { avatar: state.avatar });
  }

  // ── Home screen ────────────────────────────────────────────────────────
  $('player-name').value = state.myName;

  function myName() {
    const name = $('player-name').value.trim();
    if (name) localStorage.setItem('wr-name', name);
    return name;
  }

  $('btn-create').addEventListener('click', () => {
    const playerName = myName();
    if (!playerName) return showError('home-error', 'Pick a beach name first');
    socket.emit('room:create', { playerName, avatar: state.avatar }, (res) => {
      if (!res.success) return showError('home-error', res.error);
      state.room = res.room;
      enterLobby();
    });
  });

  $('btn-join').addEventListener('click', () => {
    const playerName = myName();
    if (!playerName) return showError('home-error', 'Pick a beach name first');
    const code = $('join-code').value.trim().toUpperCase();
    if (!code) return showError('home-error', 'Enter a room code');
    socket.emit('room:join', { code, playerName, avatar: state.avatar }, (res) => {
      if (!res.success) return showError('home-error', res.error);
      state.room = res.room;
      enterLobby();
    });
  });

  // ── Lobby ──────────────────────────────────────────────────────────────
  function enterLobby() {
    showScreen('lobby');
    renderLobby();
  }

  function renderLobby() {
    const room = state.room;
    if (!room) return;
    $('lobby-code').textContent = room.code;

    const wrap = $('lobby-players');
    wrap.innerHTML = '';
    for (const p of room.players) {
      const div = document.createElement('div');
      div.className = 'lobby-player';
      const c = document.createElement('canvas');
      c.width = 24; c.height = 32;
      div.appendChild(c);
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = p.name + (p.id === state.myId ? ' (you)' : '');
      div.appendChild(who);
      if (p.id === room.hostId) {
        const tag = document.createElement('div');
        tag.className = 'host-tag';
        tag.textContent = '★ host';
        div.appendChild(tag);
      }
      wrap.appendChild(div);
      Sprites.drawInto(c, p.avatar);
    }

    const amHost = room.hostId === state.myId;
    $('host-controls').classList.toggle('hidden', !amHost);
    $('guest-waiting').classList.toggle('hidden', amHost);
    [...$('daylen-options').children].forEach(b =>
      b.classList.toggle('on', b.dataset.len === room.config.dayLength));
  }

  $('daylen-options').addEventListener('click', (e) => {
    const len = e.target.dataset?.len;
    if (!len) return;
    socket.emit('game:configure', { config: { dayLength: len } });
  });

  $('btn-start').addEventListener('click', () => {
    socket.emit('game:start', (res) => {
      if (!res.success) showError('lobby-error', res.error);
    });
  });

  $('btn-leave-lobby').addEventListener('click', () => {
    socket.emit('room:leave');
    state.room = null;
    showScreen('home');
  });

  // ── Game screen ────────────────────────────────────────────────────────
  GameRenderer.init($('game-canvas'));

  function enterGame() {
    state.playing = true;
    state.lastHp = 100;
    showScreen('game');
    GameRenderer.start();
    Beach.startMusic();
    $('btn-rest').classList.remove('on');
  }

  function leaveGameScreen() {
    state.playing = false;
    GameRenderer.stop();
    Beach.stopMusic();
  }

  const WEATHER_ICON = { sunny: '☀️', cloudy: '⛅', storm: '⛈️' };

  function fmtClock(hour) {
    let h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = ((h + 11) % 12) + 1;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function renderHud(snap) {
    const me = snap.players.find(p => p.id === state.myId);
    $('hud-clock').textContent = `${WEATHER_ICON[snap.forecast.now]} ${fmtClock(snap.clockHour)}`;
    const f1 = snap.forecast.next1 ? WEATHER_ICON[snap.forecast.next1] : '🌙';
    const f2 = snap.forecast.next2 ? WEATHER_ICON[snap.forecast.next2] : '🌙';
    $('hud-forecast').textContent = `next: ${f1} ${f2}`;

    if (!me) return;
    const pct = Math.max(0, Math.min(100, me.hp));
    $('hp-bar').style.width = pct + '%';
    $('hp-bar').classList.toggle('low', pct <= 30);
    $('hp-label').textContent = me.hp;
    $('hud-score').textContent = `${me.score} pts` + (me.streak > 1 ? ` · ${me.streak}🔥` : '');

    const buffs = [];
    if (me.buffs.bodysuit > 0) buffs.push(`🦺 ${Math.ceil(me.buffs.bodysuit)}s`);
    if (me.buffs.bodyboard > 0) buffs.push(`🛹 ${Math.ceil(me.buffs.bodyboard)}s`);
    if (me.buffs.blanket > 0) buffs.push(`🧺 ${Math.ceil(me.buffs.blanket)}s`);
    $('hud-buffs').innerHTML = buffs.map(b => `<span class="buff-chip">${b}</span>`).join('');

    $('btn-rest').classList.toggle('on', me.state === 'resting');

    if (me.hp < state.lastHp && navigator.vibrate) navigator.vibrate(60);
    state.lastHp = me.hp;
  }

  // Touch / click on the scene: grab a power-up or wade to the spot.
  $('game-canvas').addEventListener('pointerdown', (e) => {
    if (!state.playing) return;
    e.preventDefault();
    const hit = GameRenderer.hitPowerup(e.clientX, e.clientY);
    if (hit) {
      socket.emit('game:tap-powerup', { id: hit });
      return;
    }
    const { x, y } = GameRenderer.screenToWorld(e.clientX, e.clientY);
    socket.emit('game:move', { x, y });
  });

  function bindAction(btnId, type, sfx) {
    $(btnId).addEventListener('pointerdown', (e) => {
      e.preventDefault();
      socket.emit('game:action', { type });
      if (sfx) sfx();
    });
  }
  bindAction('btn-jump', 'jump', () => Beach.sfx.jump());
  bindAction('btn-dive', 'dive', () => Beach.sfx.dive());
  bindAction('btn-stand', 'stand', null);
  $('btn-shove').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    socket.emit('game:shove');
  });

  // The cooldown only starts when a shove actually connects (or is
  // blanket-blocked) — a whiff costs nothing, so the button stays live.
  function shoveCooldownUi() {
    const btn = $('btn-shove');
    btn.disabled = true;
    btn.style.opacity = '.45';
    setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, 3000);
  }
  $('btn-rest').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    socket.emit('game:rest');
  });

  $('btn-sound').addEventListener('click', () => {
    const on = !Beach.isEnabled();
    Beach.setEnabled(on);
    $('btn-sound').textContent = on ? '🔊' : '🔇';
    if (on && state.playing) Beach.startMusic();
    if (!on) Beach.stopMusic();
  });

  // ── End screen ─────────────────────────────────────────────────────────
  function renderGameOver({ reason, tally }) {
    leaveGameScreen();
    showScreen('over');
    Beach.sfx.fanfare();

    $('over-title').textContent = {
      'end-of-day': '🌅 End of the Day',
      'wiped-out': '🌊 The Ocean Wins',
      'last-one-standing': '🏆 Last One Standing',
    }[reason] || '🌅 End of the Day';

    const best = tally.best;
    $('over-best').innerHTML = best
      ? `🏆 Best on the Beach: ${esc(best.name)} — ${best.score} pts`
      : 'Nobody survived the surf…';

    const table = $('over-table');
    table.innerHTML = '';
    tally.rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'tally-row' + (r.id === state.myId ? ' me' : '');
      const status = r.survived
        ? `made it · ${r.hp} HP`
        : `out at ${fmtClock(r.eliminatedAtHour || 9)}`;
      row.innerHTML = `
        <span class="tally-rank">${i + 1}</span>
        <canvas width="24" height="32"></canvas>
        <span class="tally-name">${esc(r.name)}</span>
        <span class="tally-stats">🌊${r.wavesRidden} · 🔥${r.bestStreak} · 🎁${r.powerupsCollected} · ${status}</span>
        <span class="tally-score">${r.score}</span>`;
      table.appendChild(row);
      Sprites.drawInto(row.querySelector('canvas'), r.avatar);
    });

    const sup = [];
    if (tally.waveMaster) sup.push(`🌊 Wave Master: ${esc(tally.waveMaster.name)} (${tally.waveMaster.wavesRidden})`);
    if (tally.streakKing) sup.push(`🔥 Hot Streak: ${esc(tally.streakKing.name)} (${tally.streakKing.bestStreak})`);
    if (tally.beachcomber) sup.push(`🎁 Beachcomber: ${esc(tally.beachcomber.name)} (${tally.beachcomber.powerupsCollected})`);
    $('over-superlatives').innerHTML = sup.map(s => `<span class="superlative">${s}</span>`).join('');
    $('rematch-status').textContent = '';
  }

  $('btn-rematch').addEventListener('click', () => {
    socket.emit('game:rematch', (res) => {
      if (res?.success) $('rematch-status').textContent = 'Waiting for the others…';
    });
  });

  $('btn-back-home').addEventListener('click', () => {
    socket.emit('room:leave');
    state.room = null;
    showScreen('home');
  });

  // ── Socket events ──────────────────────────────────────────────────────
  socket.on('connect', () => { state.myId = socket.id; });

  socket.on('room:updated', (room) => {
    state.room = room;
    if (room.phase === 'lobby' && !state.playing && $('screen-lobby').classList.contains('active')) {
      renderLobby();
    } else if (!state.playing && $('screen-over').classList.contains('active')) {
      // stay on the tally; roster is used on rematch
    } else if (!state.playing) {
      renderLobby();
    }
  });

  socket.on('room:player-left', ({ playerName }) => {
    if (state.playing) toast(`${playerName} left the beach`);
    if (state.room) renderLobby();
  });

  socket.on('game:configured', ({ config }) => {
    if (state.room) { state.room.config = config; renderLobby(); }
  });

  socket.on('game:started', () => enterGame());

  socket.on('game:state', (snap) => {
    if (!state.playing) return;
    GameRenderer.setSnapshot(snap, state.myId);
    renderHud(snap);
  });

  socket.on('game:event', (ev) => {
    if (!state.playing) return;
    const mine = ev.playerId === state.myId;
    const snapName = (id) => {
      const p = state.room?.players.find(pl => pl.id === id);
      return p ? p.name : 'Someone';
    };

    switch (ev.type) {
      case 'wave-result': {
        if (ev.outcome === 'ride') {
          if (mine) Beach.sfx.ride(); else Beach.sfx.splash();
          if (mine) GameRenderer.addFloater(50, 50, ev.perfect ? 'Perfect! 🌊' : 'Ride! 🌊', '#7be3a0');
        } else {
          if (mine) { Beach.sfx.wipeout(); toast('Wiped out! 🌀', 'danger'); }
          else Beach.sfx.bigSplash();
        }
        break;
      }
      case 'whistle':
        Beach.sfx.whistle();
        if (mine) toast('📣 Lifeguard: back between the flags!', 'warn');
        break;
      case 'lifeguard-penalty':
        Beach.sfx.whistle();
        toast(mine ? '🛟 The lifeguard hauled you in! -20 HP' : `🛟 ${snapName(ev.playerId)} got hauled in`, 'danger');
        break;
      case 'lightning': {
        Beach.sfx.thunder();
        if (ev.playerId !== null) Beach.sfx.zap();
        GameRenderer.flash(null);
        if (mine) toast(ev.blocked ? '🦺 The body suit took the bolt!' : '⚡ Struck by lightning!', ev.blocked ? 'warn' : 'danger');
        break;
      }
      case 'plane':
        Beach.sfx.plane();
        toast('✈️ You hear a propeller plane…');
        break;
      case 'powerup-drop':
        Beach.sfx.splash();
        break;
      case 'powerup-collected': {
        if (mine) {
          Beach.sfx.pickup();
          const label = {
            sunscreen: '🧴 Sunscreen! +HP',
            bodysuit: '🦺 Body suit! Lightning-proof',
            bodyboard: '🛹 Body board! Ride anything',
            blanket: '🧺 Beach blanket! Shove-proof',
          }[ev.powerupType];
          toast(label, 'warn');
        }
        break;
      }
      case 'shove': {
        if (ev.shoverId === state.myId) shoveCooldownUi();
        if (ev.blocked) {
          if (ev.shoverId === state.myId) toast('🧺 Their beach blanket held firm!', 'warn');
          if (mine) toast('🧺 Your blanket blocked a shove!', 'warn');
        } else {
          Beach.sfx.bigSplash();
          if (mine) toast(`🫸 ${snapName(ev.shoverId)} shoved you back to the beach!`, 'danger');
          else if (ev.shoverId === state.myId) toast(`🫸 You shoved ${snapName(ev.playerId)} ashore!`);
        }
        break;
      }
      case 'shove-miss':
        if (mine) toast('🫸 No swimmer near you — wade closer first');
        break;
      case 'shark':
        Beach.sfx.sharkAlert();
        toast('🦈 Fin spotted — clear the water!', 'warn');
        break;
      case 'shark-attack':
        Beach.sfx.bigSplash();
        toast(mine ? '🦈 Shark attack! Washed ashore!' : `🦈 ${snapName(ev.playerId)} got bitten!`, 'danger');
        break;
      case 'jelly-sting':
        if (mine) { Beach.sfx.sting(); toast('🪼 Jellyfish sting!', 'danger'); }
        break;
      case 'crab-pinch':
        if (mine) { Beach.sfx.pinch(); toast('🦀 Crab pinch! Ow!', 'danger'); }
        break;
      case 'gull-swoop':
        Beach.sfx.squawk();
        toast('🐦 A gull dives for a prize — grab it first!', 'warn');
        break;
      case 'gull-steal':
        Beach.sfx.squawk();
        toast('🐦 The seagull made off with it!');
        break;
      case 'eliminated':
        Beach.sfx.eliminated();
        toast(mine ? '💀 Your beach day is over — spectating' : `💀 ${snapName(ev.playerId)} is out for the day`, 'danger');
        break;
    }
  });

  socket.on('game:over', (payload) => renderGameOver(payload));

  socket.on('game:rematch-requested', ({ playerName }) => {
    $('rematch-status').textContent = `${playerName} wants one more day…`;
  });

  socket.on('disconnect', () => {
    if (state.playing) {
      leaveGameScreen();
      state.room = null;
      showScreen('home');
      showError('home-error', 'Connection lost — the tide took you out');
    }
  });

  // ── Boot ───────────────────────────────────────────────────────────────
  buildPicker();
})();
