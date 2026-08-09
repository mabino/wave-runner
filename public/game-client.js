/* ─────────────────────────────────────────────────────────────────────────
 * game-client.js — canvas renderer for the beach scene.
 *
 * The server owns the simulation; this file only draws the latest snapshot
 * (with light interpolation) and translates taps back into world space.
 * World: 100×100 units; y<beachY is ocean, the lower third is sand.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  let canvas, ctx;
  let W = 0, H = 0, dpr = 1;
  let running = false;

  let snap = null;        // latest server snapshot
  let prevSnap = null;
  let snapTime = 0;       // performance.now() at latest snapshot
  let prevTime = 0;
  let myId = null;

  let flashUntil = 0;     // lightning flash
  let boltPoints = null;
  const floaters = [];    // {x, y, text, color, bornAt}

  // Golden sand, deliberately shifted away from every avatar skin tone so
  // players stay visible on the beach.
  const SAND = '#f0cd74';
  const SAND_DARK = '#d9b45b';
  const SAND_WET = '#c9a254';

  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const sx = (x) => (x / 100) * W;
  const sy = (y) => (y / 100) * H;

  function screenToWorld(px, py) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((px - rect.left) / rect.width) * 100,
      y: ((py - rect.top) / rect.height) * 100,
    };
  }

  function setSnapshot(s, me) {
    prevSnap = snap;
    prevTime = snapTime;
    snap = s;
    snapTime = performance.now();
    myId = me;
  }

  // Interpolate an entity list keyed by id between the last two snapshots.
  function lerp(a, b, f) { return a + (b - a) * f; }

  function lerpFactor() {
    if (!prevSnap) return 1;
    const span = Math.max(40, snapTime - prevTime);
    return Math.min(1, (performance.now() - snapTime) / span);
  }

  function lerpedPlayers() {
    const f = lerpFactor();
    if (!prevSnap) return snap.players;
    const prev = new Map(prevSnap.players.map(p => [p.id, p]));
    return snap.players.map(p => {
      const q = prev.get(p.id);
      return q ? { ...p, x: lerp(q.x, p.x, f), y: lerp(q.y, p.y, f) } : p;
    });
  }

  function lerpedWaves() {
    const f = lerpFactor();
    if (!prevSnap) return snap.waves;
    const prev = new Map(prevSnap.waves.map(w => [w.id, w]));
    return snap.waves.map(w => {
      const q = prev.get(w.id);
      return q ? { ...w, y: lerp(q.y, w.y, f) } : w;
    });
  }

  // ── Scene painting ─────────────────────────────────────────────────────

  function skyPalette() {
    const hour = snap ? snap.clockHour : 12;
    const storm = snap && snap.forecast.now === 'storm';
    const cloudy = snap && snap.forecast.now === 'cloudy';
    // Ocean/sky tint drifts through the day: fresh morning → bright noon →
    // golden evening.
    let top, bottom;
    if (hour < 11)      { top = '#2e7fb0'; bottom = '#5db3cf'; }
    else if (hour < 15) { top = '#1f6fa8'; bottom = '#4fb0d4'; }
    else if (hour < 17.5) { top = '#2a6f9e'; bottom = '#63aec4'; }
    else                { top = '#3c5f8e'; bottom = '#d99a6c'; }
    if (storm)  { top = '#31414f'; bottom = '#4a6272'; }
    else if (cloudy) { top = '#4e7d99'; bottom = '#7fa8b8'; }
    return { top, bottom };
  }

  function drawOcean(beachTop) {
    const pal = skyPalette();
    const grad = ctx.createLinearGradient(0, 0, 0, beachTop);
    grad.addColorStop(0, pal.top);
    grad.addColorStop(1, pal.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, beachTop);

    // Sparkle rows for texture.
    const t = performance.now() / 1000;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let i = 0; i < 7; i++) {
      const y = ((i / 7) * beachTop + t * 6) % beachTop;
      for (let x = (i * 37) % 60; x < W; x += 60) {
        ctx.fillRect(x + Math.sin(t + i) * 8, y, 14, 2);
      }
    }
  }

  function drawWave(w, beachTop) {
    // Subtle differentiation by size: taller foam, deeper shadow, wider
    // crest as waves get bigger — read the water, time the move.
    const t = performance.now() / 1000;
    const y = sy(w.y);
    const foamH = 2 + w.size * 2.4;
    const amp = 1.5 + w.size * 1.3;
    const shadowH = w.size * 7;

    // Shadow the face of the wave (approaching mass).
    const grad = ctx.createLinearGradient(0, y - shadowH, 0, y);
    grad.addColorStop(0, 'rgba(8, 44, 66, 0)');
    grad.addColorStop(1, `rgba(8, 44, 66, ${0.12 + w.size * 0.09})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - shadowH, W, shadowH);

    // Foam crest with a wobble.
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 12) {
      ctx.lineTo(x, y + Math.sin(x / 34 + w.wobble + t * (1.6 + w.size * 0.5)) * amp);
    }
    ctx.lineTo(W, y + foamH + 4);
    ctx.lineTo(0, y + foamH + 4);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${0.55 + w.size * 0.12})`;
    ctx.fill();

    // Whitecap flecks on big sets.
    if (w.size >= 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let x = ((w.wobble * 97) % 40); x < W; x += 40) {
        ctx.fillRect(x + Math.sin(t * 3 + x) * 4, y - 2 - w.size, 5, 2);
      }
    }
  }

  function drawBeach(beachTop) {
    ctx.fillStyle = SAND;
    ctx.fillRect(0, beachTop, W, H - beachTop);
    // Wet sand lip at the waterline.
    ctx.fillStyle = SAND_WET;
    ctx.fillRect(0, beachTop, W, 6);
    // Sand speckle.
    ctx.fillStyle = SAND_DARK;
    for (let i = 0; i < 60; i++) {
      const x = (i * 197) % W;
      const y = beachTop + 10 + ((i * 89) % Math.max(1, H - beachTop - 14));
      ctx.fillRect(x, y, 2, 2);
    }
  }

  function drawFlag(x, beachTop) {
    const fx = sx(x);
    ctx.strokeStyle = '#8a5a2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, beachTop + 4);
    ctx.lineTo(fx, beachTop - 26);
    ctx.stroke();
    const wave = Math.sin(performance.now() / 300 + x) * 3;
    ctx.fillStyle = '#e0403c';
    ctx.beginPath();
    ctx.moveTo(fx, beachTop - 26);
    ctx.lineTo(fx + 18, beachTop - 21 + wave);
    ctx.lineTo(fx, beachTop - 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd97b';
    ctx.beginPath();
    ctx.moveTo(fx, beachTop - 23);
    ctx.lineTo(fx + 11, beachTop - 20 + wave * 0.7);
    ctx.lineTo(fx, beachTop - 17);
    ctx.closePath();
    ctx.fill();
  }

  function drawBuoys(deepY) {
    const y = sy(deepY);
    ctx.fillStyle = '#e0403c';
    const bob = Math.sin(performance.now() / 500) * 2;
    for (let x = 30; x < W; x += 90) {
      ctx.beginPath();
      ctx.arc(x, y + bob, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawUmbrella(x, y, color) {
    ctx.strokeStyle = '#7a5230';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 26);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - 24, 18, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.arc(x, y - 24, 18, Math.PI + 0.35, Math.PI + 1.1);
    ctx.lineTo(x, y - 24);
    ctx.closePath();
    ctx.fill();
  }

  function drawLifeguardTower(beachTop) {
    const x = W - 46;
    const y = beachTop + Math.min(46, (H - beachTop) * 0.45);
    ctx.fillStyle = '#c94040';
    ctx.fillRect(x - 14, y - 34, 28, 20);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 14, y - 38, 28, 5);
    ctx.strokeStyle = '#8a5a2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 14); ctx.lineTo(x - 12, y + 8);
    ctx.moveTo(x + 10, y - 14); ctx.lineTo(x + 12, y + 8);
    ctx.stroke();
    // The lifeguard on watch.
    ctx.fillStyle = '#e8b184';
    ctx.fillRect(x - 3, y - 46, 7, 6);
    ctx.fillStyle = '#e0403c';
    ctx.fillRect(x - 4, y - 41, 9, 6);
  }

  function drawPowerup(u) {
    const x = sx(u.x), y = sy(u.y);
    const bob = Math.sin(performance.now() / 260 + u.x) * 2.5;
    const fading = u.ttl < 3 && Math.floor(performance.now() / 180) % 2 === 0;
    if (fading) return;
    // Touch bubble.
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath();
    ctx.arc(x, y + bob, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = '17px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = u.type === 'sunscreen' ? '🧴' : u.type === 'bodysuit' ? '🦺' : '🛹';
    ctx.fillText(icon, x, y + bob + 1);
  }

  function drawPlayer(p, beachTop) {
    const sprite = window.Sprites.spriteCanvas(p.avatar.archetype, p.avatar.skin, p.avatar.outfit);
    const scale = Math.max(2.4, Math.min(3.4, W / 150));
    const w = window.Sprites.SPRITE_W * scale;
    const h = window.Sprites.SPRITE_H * scale;
    const x = sx(p.x), y = sy(p.y);
    const inWater = p.y < (snap ? snap.flags.beachY : 66);

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    if (p.state === 'out') ctx.globalAlpha = 0.35;

    if (p.action === 'jump') {
      // Airborne: shadow stays, sprite lifts.
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + h * 0.32, w * 0.4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(sprite, x - w / 2, y - h * 0.95, w, h);
    } else if (p.action === 'dive') {
      // Under the surface: just a hint of the body + ripples.
      ctx.globalAlpha *= 0.45;
      ctx.drawImage(sprite, 0, 0, sprite.width, 8, x - w / 2, y - h * 0.18, w, h * 0.44);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 1.5;
      const rip = (performance.now() / 200) % 3;
      ctx.beginPath();
      ctx.ellipse(x, y, w * (0.35 + rip * 0.12), 4 + rip * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.state === 'washed') {
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-x, -y);
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('💫', x, y - h * 0.6);
    } else if (inWater) {
      // Wading: lower half in the water.
      ctx.drawImage(sprite, 0, 0, sprite.width, 12, x - w / 2, y - h * 0.62, w, h * 0.69);
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.fillRect(x - w / 2, y + h * 0.05, w, 2);
    } else {
      // Grounding shadow keeps the sprite readable against the sand.
      ctx.fillStyle = 'rgba(90, 60, 20, .3)';
      ctx.beginPath();
      ctx.ellipse(x, y + h * 0.27, w * 0.42, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(sprite, x - w / 2, y - h * 0.75, w, h);
      if (p.state === 'resting') drawUmbrella(x + w * 0.55, y + 6, '#0aa5a0');
    }

    ctx.restore();

    // Name tag + status.
    ctx.font = `700 ${p.id === myId ? 12 : 10}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = p.id === myId ? '#ffd97b' : 'rgba(255,255,255,.92)';
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 2.5;
    const label = (p.id === myId ? '▾ ' : '') + p.name + (p.state === 'out' ? ' ✕' : '');
    ctx.strokeText(label, x, y - h * 1.02);
    ctx.fillText(label, x, y - h * 1.02);

    // Buff pips.
    let pip = '';
    if (p.buffs.bodysuit > 0) pip += '🦺';
    if (p.buffs.bodyboard > 0) pip += '🛹';
    if (pip) {
      ctx.font = '10px system-ui';
      ctx.fillText(pip, x, y - h * 1.02 + 12);
    }
  }

  function drawRain() {
    ctx.strokeStyle = 'rgba(200,225,240,.35)';
    ctx.lineWidth = 1;
    const t = performance.now() / 2;
    ctx.beginPath();
    for (let i = 0; i < 60; i++) {
      const x = ((i * 61) + t * 0.9) % (W + 30) - 15;
      const y = ((i * 113) + t) % H;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 11);
    }
    ctx.stroke();
  }

  function drawBolt() {
    if (!boltPoints) return;
    ctx.strokeStyle = '#fdf6c8';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    boltPoints.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawFloaters() {
    const now = performance.now();
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      const age = (now - f.bornAt) / 1000;
      if (age > 1.2) { floaters.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - age / 1.2;
      ctx.font = '700 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = f.color;
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, sx(f.x), sy(f.y) - age * 26);
      ctx.fillText(f.text, sx(f.x), sy(f.y) - age * 26);
      ctx.globalAlpha = 1;
    }
  }

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!snap) return;

    const beachTop = sy(snap.flags.beachY);
    drawOcean(beachTop);
    drawBuoys(snap.flags.deepY);
    for (const w of lerpedWaves()) drawWave(w, beachTop);
    drawBeach(beachTop);
    drawFlag(snap.flags.minX, beachTop);
    drawFlag(snap.flags.maxX, beachTop);

    // Decorative umbrellas along the back of the beach.
    const backY = Math.min(H - 12, beachTop + (H - beachTop) * 0.72);
    drawUmbrella(W * 0.16, backY, '#e0403c');
    drawUmbrella(W * 0.5, backY, '#ffd97b');
    drawUmbrella(W * 0.84, backY, '#1e6ee0');
    drawLifeguardTower(beachTop);

    for (const u of snap.powerups) drawPowerup(u);

    const players = lerpedPlayers().slice().sort((a, b) => a.y - b.y);
    for (const p of players) drawPlayer(p, beachTop);

    if (snap.forecast.now === 'storm') drawRain();
    if (performance.now() < flashUntil) {
      drawBolt();
      ctx.fillStyle = `rgba(255,255,240,${0.35 * (flashUntil - performance.now()) / 350})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawFloaters();
  }

  function start() {
    // The canvas lives on a display:none screen until the game begins, so
    // its client size is 0×0 at init time. Re-measure now that the screen
    // is visible — and once more a frame later for iOS Safari, whose
    // layout can settle after the class flip.
    resize();
    requestAnimationFrame(resize);
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  function stop() { running = false; }

  function flash(targetWorldX) {
    flashUntil = performance.now() + 350;
    const x = targetWorldX !== null && targetWorldX !== undefined ? sx(targetWorldX) : Math.random() * W;
    boltPoints = [];
    let bx = x, by = 0;
    while (by < H * 0.5) {
      boltPoints.push([bx, by]);
      bx += (Math.random() - 0.5) * 30;
      by += 20 + Math.random() * 25;
    }
    boltPoints.push([x, H * 0.55]);
  }

  function addFloater(x, y, text, color = '#fff') {
    floaters.push({ x, y, text, color, bornAt: performance.now() });
  }

  // Hit-test a tap against power-up touch bubbles (generous for thumbs).
  function hitPowerup(px, py) {
    if (!snap) return null;
    const rect = canvas.getBoundingClientRect();
    for (const u of snap.powerups) {
      const ux = rect.left + (sx(u.x) / W) * rect.width;
      const uy = rect.top + (sy(u.y) / H) * rect.height;
      if (Math.hypot(px - ux, py - uy) < 30) return u.id;
    }
    return null;
  }

  window.GameRenderer = { init, setSnapshot, start, stop, flash, addFloater, screenToWorld, hitPowerup };
})();
