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

  // ── How-to-play overlay ────────────────────────────────────────────────
  $('btn-help').addEventListener('click', () => $('help-overlay').classList.remove('hidden'));
  $('btn-help-close').addEventListener('click', () => $('help-overlay').classList.add('hidden'));
  $('help-overlay').addEventListener('click', (e) => {
    if (e.target === $('help-overlay')) $('help-overlay').classList.add('hidden');
  });

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
    [...$('npc-options').children].forEach(b =>
      b.classList.toggle('on', Number(b.dataset.npc) === (room.config.npcs || 0)));
  }

  $('daylen-options').addEventListener('click', (e) => {
    const len = e.target.dataset?.len;
    if (!len) return;
    socket.emit('game:configure', { config: { dayLength: len } });
  });

  $('npc-options').addEventListener('click', (e) => {
    const n = e.target.dataset?.npc;
    if (n === undefined) return;
    socket.emit('game:configure', { config: { npcs: Number(n) } });
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
    $('screen-game').classList.remove('shopping');
    $('shop-menu').classList.add('hidden');
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
    const tide = snap.tide ? (snap.tide.rising ? '🌊↑' : '🌊↓') : '';
    $('hud-forecast').textContent = `next: ${f1} ${f2} ${tide}`;

    if (!me) return;
    const pct = Math.max(0, Math.min(100, me.hp));
    $('hp-bar').style.width = pct + '%';
    $('hp-bar').classList.toggle('low', pct <= 30);
    $('hp-label').textContent = me.hp;
    $('hud-score').textContent = `${me.score} ppts` + (me.streak > 1 ? ` · ${me.streak}🔥` : '');

    const buffs = [];
    if (me.buffs.bodysuit > 0) buffs.push(`🦺 ${Math.ceil(me.buffs.bodysuit)}s`);
    if (me.buffs.bodyboard > 0) buffs.push(`🛹 ${Math.ceil(me.buffs.bodyboard)}s`);
    if (me.buffs.blanket > 0) buffs.push(`🧺 ${Math.ceil(me.buffs.blanket)}s`);
    if (me.pail) buffs.push('🪣');
    if (me.bait > 0) buffs.push('🪱');
    if (me.fish > 0) buffs.push(`🐟×${me.fish}`);
    if (me.runReadyIn > 0) buffs.push(`💨 ${Math.ceil(me.runReadyIn)}s`);
    // Only touch the DOM when the chips actually changed — this runs at
    // snapshot rate and innerHTML churn forces re-layout.
    const buffsHtml = buffs.map(b => `<span class="buff-chip">${b}</span>`).join('');
    if (buffsHtml !== state.lastBuffsHtml) {
      state.lastBuffsHtml = buffsHtml;
      $('hud-buffs').innerHTML = buffsHtml;
    }

    $('btn-rest').classList.toggle('on', me.state === 'resting');

    // On the sand, Dive becomes Dig (burrow in, shrug off trouble).
    const onSand = me.y >= snap.flags.beachY;
    if (state.diveMode !== onSand) {
      state.diveMode = onSand;
      setDiveButton(onSand);
    }

    // Inside the Bait & Tackle: swap the surf controls for the counter menu.
    const shopping = !!me.inShop;
    $('screen-game').classList.toggle('shopping', shopping);
    const menu = $('shop-menu');
    menu.classList.toggle('hidden', !shopping);
    if (shopping) {
      // Prices come from the server's snapshot — the menu can never drift
      // from what the counter actually charges.
      const baitCost = snap.shop?.baitCost ?? 10;
      const fishPts = snap.shop?.fishSellPoints ?? 25;
      $('shop-ppts').textContent = `${me.score} ppts`;
      const buy = $('shop-buy');
      buy.disabled = me.bait > 0 || me.score < baitCost;
      buy.textContent = me.bait > 0 ? '🪱 Bait pouch is full' : `🪱 Buy bait — ${baitCost} ppts`;
      const sell = $('shop-sell');
      sell.disabled = me.fish === 0;
      sell.textContent = me.fish > 0
        ? `💰 Sell ${me.fish} fish — +${me.fish * fishPts} ppts`
        : '💰 No fish to sell';
    }

    if (me.hp < state.lastHp && navigator.vibrate) navigator.vibrate(60);
    state.lastHp = me.hp;
  }

  // Touch / click on the scene: grab a power-up, tap to walk to the spot —
  // or keep holding to break into a run (faster, but it burns a little HP).
  // While held, dragging retargets the run.
  const HOLD_RUN_MS = 300;
  let hold = null;   // { id, x, y, timer, running, lastSent }

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
    hold = {
      id: e.pointerId, x, y, sentX: x, sentY: y, running: false, lastSent: 0,
      timer: setTimeout(() => {
        if (!hold) return;
        hold.running = true;
        hold.sentX = hold.x;
        hold.sentY = hold.y;
        socket.emit('game:move', { x: hold.x, y: hold.y, run: true });
      }, HOLD_RUN_MS),
    };
  });

  $('game-canvas').addEventListener('pointermove', (e) => {
    if (!hold || e.pointerId !== hold.id || !state.playing) return;
    const { x, y } = GameRenderer.screenToWorld(e.clientX, e.clientY);
    hold.x = x;
    hold.y = y;
    // Dead zone: a stationary held finger jitters by a pixel or two, and
    // re-sending the same target makes the runner stutter around it. Only
    // retarget when the finger genuinely travels.
    if (hold.running && performance.now() - hold.lastSent > 100
        && Math.hypot(x - hold.sentX, y - hold.sentY) > 2.5) {
      hold.lastSent = performance.now();
      hold.sentX = x;
      hold.sentY = y;
      socket.emit('game:move', { x, y, run: true });
    }
  });

  const endHold = (e) => {
    if (!hold || e.pointerId !== hold.id) return;
    clearTimeout(hold.timer);
    hold = null;
  };
  $('game-canvas').addEventListener('pointerup', endHold);
  $('game-canvas').addEventListener('pointercancel', endHold);

  // Best-effort desktop detection: a fine pointer that can hover almost
  // always means a keyboard is present too.
  const IS_DESKTOP = !!(window.matchMedia
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

  const keyHint = (k) => IS_DESKTOP ? `<span class="key-hint">(${k})</span>` : '';

  // The Dive button relabels to Dig on the sand, so its content (hint
  // included) is rebuilt in one place.
  function setDiveButton(onSand) {
    $('btn-dive').innerHTML =
      (onSand ? '🕳️<span>Dig</span>' : '🤿<span>Dive</span>') + keyHint('U');
  }

  if (IS_DESKTOP) {
    $('btn-jump').insertAdjacentHTML('beforeend', keyHint('J'));
    setDiveButton(false);
    $('btn-stand').insertAdjacentHTML('beforeend', keyHint('N'));
    $('btn-shove').insertAdjacentHTML('beforeend', keyHint('K'));
    $('btn-rest').insertAdjacentHTML('beforeend', keyHint('R'));
  }

  // Flash the matching button so a keystroke gives the same feedback as a tap.
  function pressBtn(id) {
    const b = $(id);
    b.classList.add('active');
    setTimeout(() => b.classList.remove('active'), 130);
  }

  function bindAction(btnId, type, sfx) {
    $(btnId).addEventListener('pointerdown', (e) => {
      e.preventDefault();
      socket.emit('game:action', { type });
      if (sfx) sfx();
    });
  }
  bindAction('btn-jump', 'jump', () => Beach.sfx.jump());
  bindAction('btn-dive', 'dive', () => (state.diveMode ? Beach.sfx.dig() : Beach.sfx.dive()));
  bindAction('btn-stand', 'stand', null);
  $('btn-shove').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    socket.emit('game:shove');
  });

  // The cooldown only starts when a shove actually connects (or is
  // blanket-blocked) — a whiff costs nothing, so the button stays live.
  function shoveCooldownUi(seconds) {
    const btn = $('btn-shove');
    btn.disabled = true;
    btn.style.opacity = '.45';
    // The engine tells us its cooldown; never hard-code a second copy.
    setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, (seconds || 3) * 1000);
  }
  $('btn-rest').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    socket.emit('game:rest');
  });

  // ── Bait & Tackle counter ──────────────────────────────────────────────
  const shopAct = (action) => socket.emit('game:shop', { action }, (res) => {
    if (res && !res.success && res.error) toast(res.error, 'warn');
  });
  $('shop-buy').addEventListener('click', () => shopAct('buy-bait'));
  $('shop-sell').addEventListener('click', () => shopAct('sell-fish'));
  $('shop-leave').addEventListener('click', () => shopAct('leave'));

  // ── Desktop keyboard: WASD / arrow keys steer continuously ─────────────
  const KEYMAP = {
    KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  };
  const heldKeys = new Set();
  let shiftHeld = false;   // Shift + WASD/arrows = sprint

  // Action hotkeys mirror the on-screen buttons (desktop only).
  const HOTKEYS = {
    KeyJ: () => { socket.emit('game:action', { type: 'jump' }); Beach.sfx.jump(); pressBtn('btn-jump'); },
    KeyU: () => {
      socket.emit('game:action', { type: 'dive' });
      if (state.diveMode) Beach.sfx.dig(); else Beach.sfx.dive();
      pressBtn('btn-dive');
    },
    KeyN: () => { socket.emit('game:action', { type: 'stand' }); pressBtn('btn-stand'); },
    KeyK: () => {
      if ($('btn-shove').disabled) return;   // honor the shove cooldown
      socket.emit('game:shove');
      pressBtn('btn-shove');
    },
    KeyR: () => { socket.emit('game:rest'); pressBtn('btn-rest'); },
  };

  function sendSteer() {
    let dx = 0, dy = 0;
    for (const k of heldKeys) { dx += KEYMAP[k][0]; dy += KEYMAP[k][1]; }
    socket.emit('game:steer', { dx, dy, run: shiftHeld });
  }

  window.addEventListener('keydown', (e) => {
    if (!state.playing) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Shift' && !shiftHeld) {
      shiftHeld = true;
      if (heldKeys.size) sendSteer();
      return;
    }
    if (IS_DESKTOP && HOTKEYS[e.code] && !e.repeat) {
      e.preventDefault();
      HOTKEYS[e.code]();
      return;
    }
    if (!KEYMAP[e.code] || e.repeat) return;
    e.preventDefault();
    heldKeys.add(e.code);
    sendSteer();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      shiftHeld = false;
      if (heldKeys.size && state.playing) sendSteer();
      return;
    }
    if (!KEYMAP[e.code]) return;
    if (heldKeys.delete(e.code) && state.playing) { e.preventDefault(); sendSteer(); }
  });
  window.addEventListener('blur', () => {
    shiftHeld = false;
    if (heldKeys.size) {
      heldKeys.clear();
      if (state.playing) socket.emit('game:steer', { dx: 0, dy: 0 });
    }
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
      ? `🏆 Best on the Beach: ${esc(best.name)} — ${best.score} ppts`
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
        <span class="tally-name">${r.npc ? '🤖 ' : ''}${esc(r.name)}</span>
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
    // Keep an id -> name map so event toasts can name NPCs too.
    state.names = {};
    for (const p of snap.players) state.names[p.id] = (p.npc ? '🤖 ' : '') + p.name;
    GameRenderer.setSnapshot(snap, state.myId);
    renderHud(snap);
  });

  socket.on('game:events', (events) => {
    if (!Array.isArray(events)) return;
    for (const ev of events) handleGameEvent(ev);
  });

  function handleGameEvent(ev) {
    if (!state.playing) return;
    const mine = ev.playerId === state.myId;
    const snapName = (id) =>
      state.names?.[id] || state.room?.players.find(pl => pl.id === id)?.name || 'Someone';

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
        GameRenderer.flash(ev.x ?? null, ev.y ?? null);   // bolt lands on the telegraphed spot
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
            pail: '🪣 A pail! Scoop up salps for Pleasant Points',
          }[ev.powerupType];
          toast(label, 'warn');
        }
        break;
      }
      case 'shove': {
        if (ev.shoverId === state.myId) shoveCooldownUi(ev.cooldown);
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
      case 'winded':
        if (mine) toast('💨 Winded — catch your breath');
        break;
      case 'swell-duck':
        if (mine) { Beach.sfx.splash(); GameRenderer.addFloater(50, 40, '🌊 Ducked under!', '#9fd8ef'); }
        break;
      case 'swell-swept':
        if (mine) { Beach.sfx.wipeout(); toast('🌊 Swept back by a swell — dive under them!', 'warn'); }
        break;
      case 'jump-combo':
        if (mine) {
          Beach.sfx.combo(ev.combo);
          GameRenderer.addFloater(50, 45, `✨ x${ev.combo}! +${ev.heal} HP`, '#ffd97b');
        }
        break;
      case 'vanished':
        if (mine) { Beach.sfx.dive(); toast('🫧 You slip beneath, out of sight…'); }
        break;
      case 'shell-found':
        if (mine) {
          Beach.sfx.shell();
          toast(`🐚 A rare shell! +${ev.points} ppts`, 'warn');
          GameRenderer.addFloater(50, 50, `🐚 +${ev.points} ppts`, '#ffd97b');
        } else {
          toast(`🐚 ${snapName(ev.playerId)} surfaced with a rare shell!`);
        }
        break;
      case 'surfaced':
        if (mine) toast('🫧 Nothing down there this time');
        break;
      case 'salp-collected':
        if (mine) {
          Beach.sfx.pickup();
          toast(`🎐 Salp scooped! +${ev.points} ppts`);
          GameRenderer.addFloater(50, 50, `+${ev.points} ppts 🎐`, '#7be3a0');
        }
        break;
      case 'salp-sting':
        if (mine) { Beach.sfx.sting(); toast('🪼 That was no salp — stung!', 'danger'); }
        break;
      case 'rip-caught':
        if (mine) { Beach.sfx.bigSplash(); toast('🌀 Rip current! Swim sideways to escape!', 'danger'); }
        break;
      case 'rip-rescue':
        Beach.sfx.whistle();
        toast(mine
          ? '🛟 The lifeguard hauled you out of the rip — catch your breath'
          : `🛟 ${snapName(ev.playerId)} got rescued from a rip`, 'warn');
        break;
      case 'lifeguard-launch':
        Beach.sfx.whistle();
        if (mine) toast('🛟 The lifeguard is swimming out for you — hold on!', 'warn');
        break;
      case 'swept-away':
        Beach.sfx.bigSplash();
        toast(mine
          ? '🌊 Swept out to sea… your beach day is over'
          : `🌊 ${snapName(ev.playerId)} was swept out to sea!`, 'danger');
        break;
      case 'shop-enter':
        if (mine) Beach.sfx.pickup();   // the door chime
        break;
      case 'bait-bought':
        if (mine) { Beach.sfx.pickup(); toast(`🪱 Bait bought (−${ev.cost} ppts) — soak it in the surf`); }
        break;
      case 'fish-caught':
        if (mine) { Beach.sfx.pickup(); toast('🐟 Something bit — you caught a fish!'); }
        break;
      case 'fish-sold':
        if (mine) {
          Beach.sfx.shell();
          toast(`💰 Sold ${ev.count} fish for +${ev.points} ppts`, 'warn');
          GameRenderer.addFloater(50, 50, `+${ev.points} ppts 💰`, '#7be3a0');
        }
        break;
      case 'fish-taken':
        Beach.sfx.sharkAlert();
        toast(mine
          ? '🦈 The shark took your fish — and left you alone!'
          : `🦈 A shark took ${snapName(ev.playerId)}'s fish`, 'warn');
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
      case 'crab-shoved':
        if (mine) { Beach.sfx.splash(); toast('🦀 Punted! The crab scurries off'); }
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
  }

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
