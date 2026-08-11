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

  // Vertical camera: the classic view is world y 0..100, but the ocean now
  // extends a full extra screen upward (to flags.outerY). The camera pans up
  // as "me" swims out, leaving the beach behind.
  let camY = 0;

  const sx = (x) => (x / 100) * W;
  const sy = (y) => ((y - camY) / 100) * H;

  function screenToWorld(px, py) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((px - rect.left) / rect.width) * 100,
      y: camY + ((py - rect.top) / rect.height) * 100,
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
    // Fading waves thin out visibly as they run down to their endpoint.
    const fadeA = w.fade !== undefined ? 0.25 + 0.75 * w.fade : 1;
    const yAt = (px) => sy(w.y + (w.slope || 0) * ((px / W) * 100 - 50));

    // Shadow the face of the wave (approaching mass), following the tilt.
    ctx.fillStyle = `rgba(8, 44, 66, ${(0.10 + w.size * 0.07) * fadeA})`;
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
    ctx.fillStyle = `rgba(255,255,255,${(0.55 + w.size * 0.12) * fadeA})`;
    ctx.fill();

    // Whitecap flecks on big sets.
    if (w.size >= 2) {
      ctx.fillStyle = `rgba(255,255,255,${0.8 * fadeA})`;
      for (let x = ((w.wobble * 97) % 40); x < W; x += 40) {
        ctx.fillRect(x + Math.sin(t * 3 + x) * 4, yAt(x) - 2 - w.size, 5, 2);
      }
    }
  }

  function drawBeach(beachTop) {
    const bwTop = sy(snap.flags.boardwalkY ?? 100);
    const sandBottom = Math.min(H, bwTop);
    if (sandBottom > beachTop) {
      ctx.fillStyle = SAND;
      ctx.fillRect(0, beachTop, W, sandBottom - beachTop);
      // Wet sand lip at the waterline.
      ctx.fillStyle = SAND_WET;
      ctx.fillRect(0, beachTop, W, 6);
      // Sand speckle.
      ctx.fillStyle = SAND_DARK;
      for (let i = 0; i < 60; i++) {
        const x = (i * 197) % W;
        const y = beachTop + 10 + ((i * 89) % Math.max(1, sandBottom - beachTop - 14));
        if (y < sandBottom) ctx.fillRect(x, y, 2, 2);
      }
    }
    if (bwTop < H) drawBoardwalk(bwTop);
  }

  // The Bait & Tackle shop: a proper storefront on the boardwalk, with a
  // doorway tall enough for a beachgoer to walk through.
  function drawShop(s) {
    const x = sx(s.x), y = sy(s.y);
    if (y < -110 || y > H + 110) return;
    const scale = Math.max(2.4, Math.min(3.4, W / 150));
    const doorH = window.Sprites.SPRITE_H * scale * 0.95;   // ~avatar height
    const doorW = window.Sprites.SPRITE_W * scale * 0.85;
    const bw = doorW * 4.6;                                 // building width
    const bh = doorH * 1.5;
    // Walls with clapboard lines.
    ctx.fillStyle = '#6d4f2e';
    ctx.fillRect(x - bw / 2, y - bh, bw, bh + 4);
    ctx.strokeStyle = 'rgba(0,0,0,.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let ly = y - bh + 8; ly < y; ly += 8) {
      ctx.moveTo(x - bw / 2, ly);
      ctx.lineTo(x + bw / 2, ly);
    }
    ctx.stroke();
    // The doorway — dark, avatar-sized, dead center. Walk right in.
    ctx.fillStyle = '#241708';
    ctx.fillRect(x - doorW / 2, y - doorH, doorW, doorH + 4);
    ctx.fillStyle = 'rgba(255, 217, 123, .25)';             // lamplight inside
    ctx.fillRect(x - doorW / 2 + 2, y - doorH + 2, doorW - 4, 6);
    // Windows with tackle on display.
    ctx.fillStyle = '#bfe3ef';
    ctx.fillRect(x - bw / 2 + 8, y - doorH * 0.8, doorW * 0.9, doorH * 0.42);
    ctx.fillRect(x + bw / 2 - 8 - doorW * 0.9, y - doorH * 0.8, doorW * 0.9, doorH * 0.42);
    ctx.font = `${Math.round(doorH * 0.22)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🪱', x - bw / 2 + 8 + doorW * 0.45, y - doorH * 0.58);
    ctx.fillText('🛟', x + bw / 2 - 8 - doorW * 0.45, y - doorH * 0.58);
    // Striped awning across the front.
    const stripes = 8;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#e0403c';
      ctx.fillRect(x - bw / 2 - 4 + i * ((bw + 8) / stripes), y - bh - 2, (bw + 8) / stripes, 12);
    }
    // Sign above.
    ctx.font = `700 ${Math.round(doorH * 0.24)}px system-ui`;
    ctx.fillStyle = '#ffd97b';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 3;
    ctx.textBaseline = 'alphabetic';
    ctx.strokeText('🎣 BAIT & TACKLE', x, y - bh - 8);
    ctx.fillText('🎣 BAIT & TACKLE', x, y - bh - 8);
  }

  // Inside the shop: aisles, browsing regulars, and the Skipper at the
  // counter. The beach day keeps running — this is just your view of it.
  function drawShopInterior(me) {
    const scale = Math.max(2.6, Math.min(3.8, W / 140));
    const sw = window.Sprites.SPRITE_W * scale;
    const sh = window.Sprites.SPRITE_H * scale;
    const t = performance.now() / 1000;

    // Floor planks.
    ctx.fillStyle = '#8a683f';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(40, 26, 10, .25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0; y < H; y += 14) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // Back wall + sign.
    ctx.fillStyle = '#5c4326';
    ctx.fillRect(0, 0, W, H * 0.16);
    ctx.font = `700 ${Math.round(H * 0.035)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd97b';
    ctx.fillText('🎣 BAIT & TACKLE', W / 2, H * 0.1);

    // Counter with the Skipper behind it.
    const counterY = H * 0.26;
    const keeper = window.Sprites.spriteCanvas(7, 1, 5, 'down', 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(keeper, W / 2 - sw / 2, counterY - sh * 0.9, sw, sh);
    ctx.fillStyle = '#6d4f2e';
    ctx.fillRect(W * 0.28, counterY, W * 0.44, 16);
    ctx.fillStyle = '#553d1e';
    ctx.fillRect(W * 0.28, counterY + 16, W * 0.44, 7);
    ctx.font = '13px system-ui';
    ctx.fillText('🪱', W * 0.34, counterY + 10);
    ctx.fillText('🐟', W * 0.66, counterY + 10);

    // Two aisles of beach sundries.
    const aisle = (ay, items) => {
      ctx.fillStyle = '#75552e';
      ctx.fillRect(W * 0.12, ay, W * 0.76, 13);
      ctx.fillStyle = '#5c4020';
      ctx.fillRect(W * 0.12, ay + 13, W * 0.76, 5);
      ctx.font = '12px system-ui';
      items.forEach((it, i) => ctx.fillText(it, W * (0.2 + i * 0.15), ay + 7));
    };
    aisle(H * 0.48, ['🧴', '🛟', '🪱', '🛹', '🧺']);
    aisle(H * 0.66, ['🐟', '🥤', '🍦', '🧢', '🩴']);

    // Regulars browsing the aisles (window dressing, not interactive).
    const bob1 = Math.sin(t * 1.3) * 2;
    const bob2 = Math.sin(t * 1.1 + 2) * 2;
    ctx.drawImage(window.Sprites.spriteCanvas(2, 1, 4, 'up', 0), W * 0.22 - sw / 2, H * 0.48 + 8 + bob1, sw, sh);
    ctx.drawImage(window.Sprites.spriteCanvas(4, 3, 1, 'up', 0), W * 0.72 - sw / 2, H * 0.66 + 8 + bob2, sw, sh);

    // You, at the counter's queue.
    const mine = window.Sprites.spriteCanvas(me.avatar.archetype, me.avatar.skin, me.avatar.outfit, 'up', 0);
    ctx.drawImage(mine, W / 2 - sw / 2, H * 0.82, sw, sh);
    // Door mat back out to the boardwalk.
    ctx.fillStyle = 'rgba(36, 23, 8, .8)';
    ctx.fillRect(W / 2 - sw, H - 10, sw * 2, 10);
  }

  // The boardwalk behind the beach — just weathered planks for now.
  function drawBoardwalk(top) {
    ctx.fillStyle = '#9b7648';
    ctx.fillRect(0, Math.max(0, top), W, H - Math.max(0, top));
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(0, top, W, 3);   // front edge
    ctx.strokeStyle = 'rgba(60, 40, 20, .35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = top + 12; y < H; y += 12) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    // Staggered plank joints.
    ctx.fillStyle = 'rgba(60, 40, 20, .3)';
    for (let row = 0; row * 12 + top + 12 < H + 12; row++) {
      const y = top + 3 + row * 12;
      for (let x = ((row % 2) * 45 + 20); x < W; x += 90) {
        ctx.fillRect(x, y, 1.5, 12);
      }
    }
  }

  // Lifeguard flags read the surf: 1 yellow (easy), 2 yellow (lively),
  // 1 red (rough), 2 red (double-red — respect the ocean).
  function drawFlag(x, beachTop, danger) {
    const fx = sx(x);
    const level = danger || 0;
    const color = level >= 2 ? '#e0403c' : '#ffd23c';
    const count = (level % 2) + 1;
    ctx.strokeStyle = '#8a5a2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, beachTop + 4);
    ctx.lineTo(fx, beachTop - (count === 2 ? 38 : 26));
    ctx.stroke();
    const wave = Math.sin(performance.now() / 300 + x) * 3;
    for (let i = 0; i < count; i++) {
      const top = beachTop - (count === 2 ? 38 : 26) + i * 13;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(fx, top);
      ctx.lineTo(fx + 18, top + 5 + wave);
      ctx.lineTo(fx, top + 11);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawBuoys(worldY, color) {
    const y = sy(worldY);
    if (y < -8 || y > H + 8) return;
    ctx.fillStyle = color;
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

  function drawLifeguardTower(y) {
    const x = W - 46;
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

  // A rescue swimmer powering through the surf: red cap, white wake, and
  // the classic red torpedo float in tow.
  function drawRescueSwimmer(g) {
    const x = sx(g.x), y = sy(g.y);
    if (y < -20 || y > H + 20) return;
    const t = performance.now() / 1000;
    // Kicked-up wake.
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 4 + Math.sin(t * 8) * 1.5);
    ctx.lineTo(x - 16, y + 5);
    ctx.stroke();
    // Torpedo float.
    ctx.fillStyle = '#e0403c';
    ctx.beginPath();
    ctx.ellipse(x + 7, y + 3, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Arms mid-stroke.
    ctx.strokeStyle = '#e8b184';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 1);
    ctx.lineTo(x - 3 + Math.sin(t * 9) * 5, y - 3);
    ctx.stroke();
    // Head with the red cap.
    ctx.fillStyle = '#e8b184';
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e0403c';
    ctx.beginPath();
    ctx.arc(x, y - 0.8, 3.2, Math.PI, 0);
    ctx.fill();
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

  // A salp: the wiggly tentacles of a jellyfish with no cap in sight —
  // drawn with the exact strokes of the jellyfish tentacles, because
  // whether a cap lurks under the surface is the whole gamble.
  function drawSalp(s) {
    const x = sx(s.x), y = sy(s.y);
    const t = performance.now() / 1000;
    const bob = Math.sin(t * 2.2 + s.x) * 2.5;
    ctx.strokeStyle = 'rgba(255, 150, 190, .65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      ctx.moveTo(x + i * 4, y + bob + 1);
      ctx.quadraticCurveTo(x + i * 4 + Math.sin(t * 3 + i) * 3, y + bob + 7, x + i * 4, y + bob + 12);
    }
    ctx.stroke();
  }

  function lerpedSalps(br) {
    if (!br || br.a === br.b) return ((br ? br.b : snap).salps) || [];
    const prev = new Map((br.a.salps || []).map(s => [s.id, s]));
    return (br.b.salps || []).map(s => {
      const q = prev.get(s.id);
      return q ? { ...s, x: lerp(q.x, s.x, br.f), y: lerp(q.y, s.y, br.f) } : s;
    });
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
    const icon = { sunscreen: '🧴', bodysuit: '🦺', bodyboard: '🛹', blanket: '🧺', pail: '🪣' }[u.type] || '🎁';
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

    // Shoppers are indoors — nothing of them to draw on the map.
    if (p.inShop) return;

    // Deep search: the player is off the playfield entirely. Only their
    // own screen shows a faint ripple so they don't lose themselves.
    if (p.action === 'vanish') {
      if (p.id === myId) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 1.5;
        const rip2 = (performance.now() / 300) % 2;
        ctx.beginPath();
        ctx.ellipse(x, y, 6 + rip2 * 5, 2.5 + rip2 * 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    if (p.state === 'out') ctx.globalAlpha = 0.35;

    if (p.action === 'jump') {
      // Airborne: shadow stays, sprite lifts. Encore jumps show off —
      // higher air, and a rotating pose cycle (lift, corkscrew, starfish).
      const combo = Math.max(1, p.jumpCombo || 1);
      const pose = (combo - 1) % 3;
      const lift = 0.95 + 0.12 * Math.min(3, combo - 1);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + h * 0.32, w * 0.4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(x, y - h * lift + h / 2);
      if (pose === 1) ctx.rotate((performance.now() / 90) % (Math.PI * 2));
      else if (pose === 2) ctx.rotate(Math.sin(performance.now() / 110) * 0.4);
      const pw = pose === 2 ? w * 1.25 : w;
      ctx.drawImage(sprite, -pw / 2, -h / 2, pw, h);
      ctx.restore();
      if (combo >= 2) {
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('✨', x + w * 0.6, y - h * lift);
      }
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
    } else if (p.state === 'resting') {
      // Stretched out in the shade beneath the umbrella, canopy in front.
      ctx.fillStyle = 'rgba(90, 60, 20, .3)';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.15, y + 8, h * 0.4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x + w * 0.15, y + 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-(x + w * 0.15), -(y + 2));
      drawUmbrella(x - w * 0.45, y + 10, '#0aa5a0');
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
    }

    // The pail rides near the hand of whoever carries it.
    if (p.pail && p.state !== 'washed' && p.state !== 'resting'
        && p.action !== 'dive' && p.action !== 'dig') {
      const side = facing === 'left' ? -1 : 1;
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🪣', x + side * w * 0.62, y - (inWater ? h * 0.1 : h * 0.05) + bob);
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
    if (p.bait > 0) pip += '🪱';
    if (p.fish > 0) pip += '🐟'.repeat(Math.min(3, p.fish));
    if (pip) {
      ctx.font = '10px system-ui';
      ctx.fillText(pip, x, y - h * 1.02 + 12);
    }
  }

  // The doomed patch of water glows before a lightning strike — swim clear.
  function drawStrikeWarning(s) {
    const x = sx(s.x), y = sy(s.y);
    const flicker = 0.85 + Math.sin(performance.now() / 45) * 0.15;
    const r = (14 + s.progress * 14) * flicker;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(253, 246, 200, ${0.28 + s.progress * 0.35})`);
    grad.addColorStop(0.6, `rgba(253, 246, 200, ${0.10 + s.progress * 0.15})`);
    grad.addColorStop(1, 'rgba(253, 246, 200, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // A rip current: a subtly darker channel with foam streaking out to sea.
  // It builds and dies with the server's strength envelope.
  function drawRip(r, beachTop) {
    const s = r.strength !== undefined ? r.strength : 1;
    if (s <= 0.02) return;
    const x0 = sx(r.x - r.halfW);
    const x1 = sx(r.x + r.halfW);
    const top = sy(snap.flags.deepY);
    const h = beachTop - top;
    if (h <= 0) return;
    ctx.fillStyle = `rgba(8, 30, 48, ${0.15 * s})`;
    ctx.fillRect(x0, top, x1 - x0, h);
    // Outbound foam streaks, drifting toward the horizon.
    const t = performance.now() / 1000;
    ctx.fillStyle = `rgba(255,255,255,${0.16 * s})`;
    const lanes = 4;
    for (let i = 0; i < lanes; i++) {
      const lx = x0 + ((i + 0.5) / lanes) * (x1 - x0) + Math.sin(t + i * 2) * 3;
      const ph = ((t * 26 + i * 41) % h);
      ctx.fillRect(lx - 1, beachTop - ph - 8, 2, 8);
      ctx.fillRect(lx - 1, beachTop - ((ph + h * 0.5) % h) - 6, 2, 6);
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

    const meNow = snap.players.find(p => p.id === myId);

    // Inside the Bait & Tackle: your screen shows the interior while the
    // beach day keeps playing out for everyone else.
    if (meNow && meNow.inShop) {
      drawShopInterior(meNow);
      drawFloaters();
      return;
    }

    // Camera follows me out to sea — or back to the boardwalk — and eases
    // home to the classic view in between.
    let camTarget = 0;
    if (meNow) {
      const maxCam = (snap.flags.boardwalkBottom ?? 100) - 100;
      if (meNow.y < 32) camTarget = Math.max((snap.flags.outerY ?? 0) - 4, meNow.y - 32);
      else if (meNow.y > 88) camTarget = Math.min(maxCam, meNow.y - 88);
    }
    camY += (camTarget - camY) * 0.08;
    if (Math.abs(camY - camTarget) < 0.05) camY = camTarget;

    const beachTop = sy(snap.flags.beachY);
    const br = bracket();
    drawOcean(beachTop);
    if (snap.rip) drawRip(snap.rip, beachTop);
    drawBuoys(snap.flags.deepY, '#e0403c');
    if (snap.flags.outerY !== undefined) drawBuoys(snap.flags.outerY, '#ffffff');
    for (const w of lerpedWaves(br)) drawWave(w, beachTop);
    if (snap.strike) drawStrikeWarning(snap.strike);
    drawBeach(beachTop);
    drawFlag(snap.flags.minX, beachTop, snap.flags.danger);
    drawFlag(snap.flags.maxX, beachTop, snap.flags.danger);

    // Decorative umbrellas and the tower are anchored to the sand itself —
    // they scroll away with the beach instead of tagging along with the view.
    const bwY = snap.flags.boardwalkY ?? 100;
    const backY = sy(snap.flags.beachY + (bwY - snap.flags.beachY) * 0.72);
    if (backY > -40 && backY < H + 40) {
      drawUmbrella(W * 0.16, backY, '#e0403c');
      drawUmbrella(W * 0.5, backY, '#ffd97b');
      drawUmbrella(W * 0.84, backY, '#1e6ee0');
    }
    const towerY = sy(snap.flags.beachY + (bwY - snap.flags.beachY) * 0.45);
    if (towerY > -60 && towerY < H + 60) drawLifeguardTower(towerY);
    if (snap.shop) drawShop(snap.shop);
    for (const g of (snap.lifeguards || [])) drawRescueSwimmer(g);

    for (const u of snap.powerups) drawPowerup(u);
    for (const s of lerpedSalps(br)) drawSalp(s);
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
    camY = 0;
    resize();
    requestAnimationFrame(resize);
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  function stop() { running = false; }

  // The bolt zigzags from the sky down to its true endpoint — the same
  // spot the telegraph glow marked, where the damage actually lands.
  function flash(targetWorldX, targetWorldY) {
    flashUntil = performance.now() + 350;
    const hasSpot = targetWorldX !== null && targetWorldX !== undefined;
    const x = hasSpot ? sx(targetWorldX) : Math.random() * W;
    const endY = targetWorldY !== null && targetWorldY !== undefined
      ? sy(targetWorldY)
      : H * 0.55;
    boltPoints = [];
    let bx = x, by = 0;
    while (by < endY - 15) {
      boltPoints.push([bx, by]);
      bx += (Math.random() - 0.5) * 30;
      by += 20 + Math.random() * 25;
    }
    boltPoints.push([x, endY]);
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
