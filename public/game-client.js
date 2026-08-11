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

  let snap = null;        // latest server snapshot (HUD/non-positional state)
  const buffer = [];      // recent snapshots for time-aligned interpolation
  let clockOffset = null; // estimated (server sim time − client clock)
  // Render this far behind the freshest server state (~1.5 ticks at 8 Hz):
  // uneven snapshot arrivals then land inside the delay window instead of
  // freezing and jumping the avatars — most visible at run speed.
  const RENDER_DELAY = 0.18;
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
    myId = me;
    // A rematch restarts sim time; drop the stale timeline.
    if (snap && s.t < snap.t) { buffer.length = 0; clockOffset = null; }
    snap = s;
    buffer.push(s);
    if (buffer.length > 24) buffer.shift();
    // Map server sim time onto the client clock. Track the fastest arrivals
    // (a late packet only means the network hiccuped) and drift down slowly.
    const off = s.t - performance.now() / 1000;
    clockOffset = clockOffset === null || off > clockOffset
      ? off
      : clockOffset * 0.98 + off * 0.02;
  }

  function lerp(a, b, f) { return a + (b - a) * f; }

  // The pair of buffered snapshots straddling "now minus the render delay",
  // and the blend factor between them.
  function bracket() {
    if (!buffer.length) return null;
    const rt = performance.now() / 1000 + clockOffset - RENDER_DELAY;
    if (rt <= buffer[0].t) return { a: buffer[0], b: buffer[0], f: 0 };
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i].t <= rt) {
        const a = buffer[i];
        const b = buffer[i + 1] || a;
        const span = b.t - a.t;
        return { a, b, f: span > 0 ? Math.min(1, (rt - a.t) / span) : 1 };
      }
    }
    const last = buffer[buffer.length - 1];
    return { a: last, b: last, f: 1 };
  }

  function lerpedPlayers(br) {
    if (!br || br.a === br.b) return (br ? br.b : snap).players;
    const prev = new Map(br.a.players.map(p => [p.id, p]));
    return br.b.players.map(p => {
      const q = prev.get(p.id);
      return q ? { ...p, x: lerp(q.x, p.x, br.f), y: lerp(q.y, p.y, br.f) } : p;
    });
  }

  function lerpedWaves(br) {
    if (!br || br.a === br.b) return (br ? br.b : snap).waves;
    const prev = new Map(br.a.waves.map(w => [w.id, w]));
    return br.b.waves.map(w => {
      const q = prev.get(w.id);
      return q ? { ...w, y: lerp(q.y, w.y, br.f) } : w;
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
    // crest as waves get bigger — read the water, time the move. Fronts can
    // arrive at an angle (w.slope tilts the crest across the screen).
    const t = performance.now() / 1000;
    const foamH = 2 + w.size * 2.4;
    const amp = 1.5 + w.size * 1.3;
    const shadowH = w.size * 7;
    const yAt = (px) => sy(w.y + (w.slope || 0) * ((px / W) * 100 - 50));

    // Shadow the face of the wave (approaching mass), following the tilt.
    ctx.fillStyle = `rgba(8, 44, 66, ${0.10 + w.size * 0.07})`;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0) - shadowH);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, yAt(x) - shadowH);
    for (let x = W; x >= 0; x -= 16) ctx.lineTo(x, yAt(x));
    ctx.closePath();
    ctx.fill();

    // Foam crest with a wobble.
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 0; x <= W; x += 12) {
      ctx.lineTo(x, yAt(x) + Math.sin(x / 34 + w.wobble + t * (1.6 + w.size * 0.5)) * amp);
    }
    for (let x = W; x >= 0; x -= 12) ctx.lineTo(x, yAt(x) + foamH + 4);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${0.55 + w.size * 0.12})`;
    ctx.fill();

    // Whitecap flecks on big sets.
    if (w.size >= 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let x = ((w.wobble * 97) % 40); x < W; x += 40) {
        ctx.fillRect(x + Math.sin(t * 3 + x) * 4, yAt(x) - 2 - w.size, 5, 2);
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

  function lerpedHazards(br) {
    if (!br || br.a === br.b) return ((br ? br.b : snap).hazards) || [];
    const prev = new Map((br.a.hazards || []).map(h => [h.id, h]));
    return (br.b.hazards || []).map(h => {
      const q = prev.get(h.id);
      return q ? { ...h, x: lerp(q.x, h.x, br.f), y: lerp(q.y, h.y, br.f) } : h;
    });
  }

  function drawHazard(h) {
    const x = sx(h.x), y = sy(h.y);
    const t = performance.now() / 1000;
    if (h.kind === 'shark') {
      // Just a fin slicing the surface — the menace is in what you can't see.
      const dir = h.vx >= 0 ? 1 : -1;
      // Wake trail behind the fin.
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - dir * 12, y + 2);
      ctx.lineTo(x - dir * 34, y + 2 + Math.sin(t * 6) * 2);
      ctx.stroke();
      // Curved triangular dorsal fin, leaning into the direction of travel.
      ctx.fillStyle = '#4a5a66';
      ctx.beginPath();
      ctx.moveTo(x - dir * 8, y + 3);
      ctx.quadraticCurveTo(x - dir * 4, y - 6, x + dir * 2, y - 13);
      ctx.quadraticCurveTo(x + dir * 5, y - 6, x + dir * 8, y + 3);
      ctx.closePath();
      ctx.fill();
      // Waterline slice where the fin cuts the surface.
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillRect(x - 11, y + 2, 22, 2);
    } else if (h.kind === 'jelly') {
      // Hand-drawn so older devices don't render a tofu box.
      const bob = Math.sin(t * 2.2 + h.x) * 2.5;
      ctx.fillStyle = 'rgba(255, 150, 190, .75)';
      ctx.beginPath();
      ctx.arc(x, y + bob, 8, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 150, 190, .65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(x + i * 4, y + bob + 1);
        ctx.quadraticCurveTo(x + i * 4 + Math.sin(t * 3 + i) * 3, y + bob + 7, x + i * 4, y + bob + 12);
      }
      ctx.stroke();
    } else if (h.kind === 'crab') {
      const scuttle = Math.sin(t * 9) * 2;
      ctx.font = '20px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🦀', x, y + scuttle * 0.4);
    }
  }

  function drawGull(g) {
    // Swoop from a per-raid entry point across the sky to the marked item,
    // accelerating into the dive.
    const p = g.progress;
    const gx = lerp(sx(g.fromX !== undefined ? g.fromX : g.x), sx(g.x), p);
    const gy = -20 + (sy(g.y) + 20) * p * p;
    const flap = Math.sin(performance.now() / 90) * 4;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(gx - 10, gy - flap);
    ctx.quadraticCurveTo(gx - 4, gy + 3, gx, gy);
    ctx.quadraticCurveTo(gx + 4, gy + 3, gx + 10, gy - flap);
    ctx.stroke();
    ctx.fillStyle = '#f2a33c';
    ctx.fillRect(gx - 1, gy + 1, 3, 2);   // beak
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
    const icon = { sunscreen: '🧴', bodysuit: '🦺', bodyboard: '🛹', blanket: '🧺' }[u.type] || '🎁';
    ctx.fillText(icon, x, y + bob + 1);
  }

  // Deterministic per-player phase so a crowd doesn't march in lockstep.
  function walkPhase(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % 97;
    return h;
  }

  function drawPlayer(p, beachTop) {
    const inWater = p.y < (snap ? snap.flags.beachY : 66);
    const facing = p.facing || 'down';
    // Feet animate on land; in the water the legs are submerged anyway.
    // One smooth phase drives both the frame flip and a sinusoidal bob
    // (one bounce per footfall), so nothing pops between frames.
    const cycleMs = p.running ? 320 : 500;    // full two-step cycle
    const phase = (performance.now() / cycleMs + walkPhase(p.id) * 0.137) % 1;
    const walking = p.moving && !inWater;
    const stepFrame = walking ? (phase < 0.5 ? 1 : 2) : 0;
    const sprite = window.Sprites.spriteCanvas(
      p.avatar.archetype, p.avatar.skin, p.avatar.outfit, facing, stepFrame);
    const scale = Math.max(2.4, Math.min(3.4, W / 150));
    const w = window.Sprites.SPRITE_W * scale;
    const h = window.Sprites.SPRITE_H * scale;
    const x = sx(p.x), y = sy(p.y);
    const bob = walking ? -Math.abs(Math.sin(phase * Math.PI * 2)) * scale * 0.5 : 0;

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
    } else if (p.action === 'dig') {
      // Buried in the sand: a mound with just the head poking out.
      ctx.fillStyle = SAND_DARK;
      ctx.beginPath();
      ctx.ellipse(x, y + 2, w * 0.62, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(sprite, 0, 0, sprite.width, 6, x - w / 2, y - 10, w, (6 / sprite.height) * h);
      ctx.fillStyle = SAND;
      ctx.fillRect(x - w * 0.45, y - 2, w * 0.9, 4);
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
      // Sprinters kick up little puffs of sand behind them.
      if (p.running) {
        const back = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }[facing];
        const t = performance.now() / 1000;
        ctx.fillStyle = SAND_WET;
        for (let i = 0; i < 2; i++) {
          const ph = (t * 3 + i * 0.5) % 1;
          ctx.globalAlpha = (1 - ph) * 0.55;
          ctx.beginPath();
          ctx.arc(x + back[0] * (w * 0.35 + ph * 12),
                  y + h * 0.22 + back[1] * (4 + ph * 10),
                  2 + ph * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = p.state === 'out' ? 0.35 : 1;
      }
      ctx.drawImage(sprite, x - w / 2, y - h * 0.75 + bob, w, h);
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
    const label = (p.id === myId ? '▾ ' : '') + (p.npc ? '🤖 ' : '') + p.name + (p.state === 'out' ? ' ✕' : '');
    ctx.strokeText(label, x, y - h * 1.02);
    ctx.fillText(label, x, y - h * 1.02);

    // Buff pips.
    let pip = '';
    if (p.buffs.bodysuit > 0) pip += '🦺';
    if (p.buffs.bodyboard > 0) pip += '🛹';
    if (p.buffs.blanket > 0) pip += '🧺';
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
    // Self-heal: if layout settled after start() (or anything resized the
    // canvas without firing our handlers), re-measure. A 0×0 canvas here is
    // exactly the "solid dark background" bug.
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
    if (!snap || W === 0 || H === 0) return;

    const beachTop = sy(snap.flags.beachY);
    const br = bracket();
    drawOcean(beachTop);
    drawBuoys(snap.flags.deepY);
    for (const w of lerpedWaves(br)) drawWave(w, beachTop);
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
    for (const h of lerpedHazards(br)) drawHazard(h);
    if (snap.gull) drawGull(snap.gull);

    const players = lerpedPlayers(br).slice().sort((a, b) => a.y - b.y);
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
