/* ─────────────────────────────────────────────────────────────────────────
 * audio.js — all sound is synthesized with WebAudio: ambient surf and
 * seagulls, event SFX (whistle, thunder, propeller plane, splashes) and a
 * jaunty summer chiptune. No audio assets, iOS-safe (unlocks on first tap).
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let musicGain = null;
  let ambienceStarted = false;
  let musicTimer = null;
  let gullTimer = null;
  let enabled = true;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' });
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function setEnabled(on) {
    enabled = on;
    if (master) master.gain.value = on ? 0.85 : 0;
  }

  // ── Small synth helpers ────────────────────────────────────────────────
  function env(gain, t, attack, peak, decay) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function blip(type, freq, dur, peak, when = 0, glideTo = null) {
    if (!enabled) return;
    const c = ensureCtx();
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    env(g, t, 0.01, peak, dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noiseBuffer(c, seconds) {
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // Brown-ish noise reads as water better than white noise.
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }

  function noiseBurst(dur, peak, filterFreq, when = 0, type = 'lowpass') {
    if (!enabled) return;
    const c = ensureCtx();
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur + 0.1);
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    env(g, t, 0.01, peak, dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  // ── Ambience: rolling surf + occasional gulls ──────────────────────────
  function startAmbience() {
    if (ambienceStarted || !enabled) return;
    const c = ensureCtx();
    ambienceStarted = true;

    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 4);
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const g = c.createGain();
    g.gain.value = 0.12;
    // Slow swell so the surf breathes.
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.055;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(filter).connect(g).connect(master);
    src.start();
    lfo.start();

    scheduleGull();
  }

  function scheduleGull() {
    gullTimer = setTimeout(() => {
      seagull();
      scheduleGull();
    }, 6000 + Math.random() * 12000);
  }

  function seagull() {
    const cries = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < cries; i++) {
      blip('triangle', 1250 + Math.random() * 250, 0.28, 0.05, i * 0.35, 750);
    }
  }

  // ── Event SFX ──────────────────────────────────────────────────────────
  const sfx = {
    whistle() {
      blip('square', 2100, 0.22, 0.12, 0);
      blip('square', 2100, 0.32, 0.12, 0.3);
    },
    thunder() {
      noiseBurst(1.6, 0.5, 160);
      blip('sine', 55, 1.4, 0.3, 0.05, 35);
    },
    plane() {
      // Propeller drone panning by amplitude flutter, ~3.5s flyover.
      if (!enabled) return;
      const c = ensureCtx();
      const t = c.currentTime;
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(82, t);
      osc.frequency.linearRampToValueAtTime(96, t + 1.7);
      osc.frequency.linearRampToValueAtTime(78, t + 3.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 1.2);
      g.gain.linearRampToValueAtTime(0.0001, t + 3.5);
      const flutter = c.createOscillator();
      flutter.frequency.value = 13;
      const flutterGain = c.createGain();
      flutterGain.gain.value = 0.04;
      flutter.connect(flutterGain).connect(g.gain);
      osc.connect(g).connect(master);
      osc.start(t); flutter.start(t);
      osc.stop(t + 3.6); flutter.stop(t + 3.6);
    },
    splash()   { noiseBurst(0.25, 0.22, 2400, 0, 'highpass'); },
    bigSplash(){ noiseBurst(0.55, 0.4, 1200); },
    ride() {
      blip('square', 523, 0.09, 0.1);
      blip('square', 659, 0.09, 0.1, 0.09);
      blip('square', 784, 0.16, 0.1, 0.18);
    },
    wipeout() {
      blip('sawtooth', 300, 0.5, 0.16, 0, 70);
      noiseBurst(0.5, 0.3, 1000, 0.05);
    },
    jump()  { blip('square', 330, 0.16, 0.1, 0, 660); },
    combo(n) {
      // Encore jumps ring higher with each link in the chain.
      const base = 440 + Math.min(4, n) * 110;
      blip('square', base, 0.1, 0.11, 0, base * 1.5);
      blip('square', base * 1.25, 0.12, 0.1, 0.1);
    },
    shell() {
      [659, 831, 988, 1319].forEach((f, i) => blip('triangle', f, 0.16, 0.13, i * 0.09));
      blip('square', 1568, 0.35, 0.1, 0.4);
    },
    dive()  { blip('sine', 500, 0.3, 0.12, 0, 160); noiseBurst(0.2, 0.12, 1800, 0.08, 'highpass'); },
    pickup(){ blip('square', 880, 0.08, 0.12); blip('square', 1320, 0.14, 0.12, 0.08); },
    zap()   { noiseBurst(0.15, 0.35, 5000, 0, 'highpass'); blip('sawtooth', 1600, 0.3, 0.2, 0.02, 90); },
    sharkAlert() {
      blip('sawtooth', 98, 0.35, 0.16);
      blip('sawtooth', 92, 0.5, 0.18, 0.4);
    },
    squawk() {
      blip('triangle', 1350, 0.22, 0.09, 0, 760);
      blip('triangle', 1450, 0.18, 0.08, 0.2, 820);
    },
    sting() { blip('square', 1200, 0.12, 0.12, 0, 500); },
    dig() { noiseBurst(0.12, 0.2, 900); noiseBurst(0.12, 0.18, 800, 0.14); },
    pinch() { blip('square', 240, 0.05, 0.14); blip('square', 210, 0.05, 0.14, 0.07); },
    eliminated() {
      blip('triangle', 392, 0.25, 0.14);
      blip('triangle', 330, 0.25, 0.14, 0.25);
      blip('triangle', 262, 0.5, 0.14, 0.5);
    },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => blip('square', f, 0.18, 0.13, i * 0.14));
      blip('square', 1319, 0.5, 0.13, 0.6);
    },
  };

  // ── Jaunty summer chiptune ─────────────────────────────────────────────
  // A bouncy 2-bar surf-pop vamp in C: lead + walking bass + offbeat "hat".
  const LEAD = [
    523, 0, 659, 784, 659, 0, 523, 659,
    587, 0, 698, 880, 784, 698, 659, 587,
    523, 0, 659, 784, 880, 0, 1047, 880,
    784, 659, 587, 659, 523, 0, 392, 0,
  ];
  const BASS = [
    131, 131, 196, 131, 175, 175, 262, 175,
    147, 147, 220, 147, 196, 196, 147, 131,
    131, 131, 196, 131, 175, 175, 262, 175,
    196, 196, 147, 147, 131, 131, 98, 98,
  ];
  const STEP = 60 / 132 / 2;   // 132 BPM, 8th notes
  let step = 0;

  function musicStep() {
    if (!enabled) return;
    const c = ensureCtx();
    const t = c.currentTime;
    const i = step % LEAD.length;

    const lead = LEAD[i];
    if (lead) {
      const osc = c.createOscillator();
      osc.type = 'square';
      osc.frequency.value = lead;
      const g = c.createGain();
      env(g, t, 0.012, 0.5, STEP * 0.9);
      osc.connect(g).connect(musicGain);
      osc.start(t); osc.stop(t + STEP);
    }

    const bass = BASS[i];
    if (bass) {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = bass;
      const g = c.createGain();
      env(g, t, 0.01, 0.8, STEP * 0.95);
      osc.connect(g).connect(musicGain);
      osc.start(t); osc.stop(t + STEP);
    }

    if (i % 2 === 1) {   // offbeat shaker
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c, 0.06);
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      const g = c.createGain();
      env(g, t, 0.005, 0.25, 0.05);
      src.connect(f).connect(g).connect(musicGain);
      src.start(t);
    }

    step++;
  }

  function startMusic() {
    if (musicTimer || !enabled) return;
    ensureCtx();
    step = 0;
    musicTimer = setInterval(musicStep, STEP * 1000);
  }

  function stopMusic() {
    clearInterval(musicTimer);
    musicTimer = null;
  }

  window.Beach = {
    unlock: ensureCtx,
    startAmbience,
    startMusic,
    stopMusic,
    setEnabled,
    isEnabled: () => enabled,
    sfx,
  };
})();
