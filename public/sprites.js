/* ─────────────────────────────────────────────────────────────────────────
 * sprites.js — 16-bit style beachgoer caricatures, drawn from pixel maps.
 *
 * Each archetype is a 12×16 template. Legend:
 *   .  transparent      S  skin (player-picked)   O  outfit (player-picked)
 *   H  hair             A  accessory accent        W  white
 *   K  dark detail/outline
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const SKIN_TONES = ['#f8d0a8', '#e8b184', '#b97a50', '#7a4b2a'];
  const OUTFITS = ['#e0403c', '#1e6ee0', '#18a558', '#f28c1b', '#8a4fd8', '#0aa5a0'];

  const ARCHETYPES = [
    {
      name: 'Surfer Dude',
      hair: '#e8c26a',
      accent: '#7a4b2a',   // puka shells
      headEnd: 5,
      rows: [
        '....HHHH....',
        '...HHHHHH...',
        '...HSSSSH...',
        '...HSKSKH...',
        '...HSSSSH...',
        '...H.SS.H...',
        '....AAAA....',
        '..SSSSSSSS..',
        '.S..SSSS..S.',
        '.S..SSSS..S.',
        '....SSSS....',
        '...OOOOOO...',
        '...OOOOOO...',
        '....S..S....',
        '....S..S....',
        '....K..K....',
      ],
    },
    {
      name: 'Boogie Kid',
      hair: '#3b2a1a',
      accent: '#ffd97b',   // backwards cap
      headEnd: 6,
      rows: [
        '............',
        '....AAAA....',
        '...AAAAAA...',
        '...ASSSSA...',
        '....SKSK....',
        '....SSSS....',
        '.....SS.....',
        '...OOOOOO...',
        '..S.OOOO.S..',
        '..S.OOOO.S..',
        '....OOOO....',
        '....OOOO....',
        '....S..S....',
        '....S..S....',
        '....K..K....',
        '............',
      ],
    },
    {
      name: 'Beach Granny',
      hair: '#e6e6e6',
      accent: '#ffffff',   // flower print
      headEnd: 5,
      rows: [
        '....HHHH....',
        '...HHHHHH...',
        '...HSSSSH...',
        '...HSKSKH...',
        '....SSSS....',
        '.....SS.....',
        '...OOOOOO...',
        '..S.OAOO.S..',
        '..S.OOAO.S..',
        '...OOOOOO...',
        '...OOAOOO...',
        '...OOOOOO...',
        '....S..S....',
        '....S..S....',
        '....K..K....',
        '............',
      ],
    },
    {
      name: 'Muscle Mike',
      hair: '#1c1c1c',
      accent: '#ffffff',   // tank stripe
      headEnd: 4,
      rows: [
        '....HHHH....',
        '...HSSSSH...',
        '...HSKSKH...',
        '....SSSS....',
        '.....SS.....',
        '..SSOOOOSS..',
        '.SSSOAAOSSS.',
        '.SS.OOOO.SS.',
        '.SS.OOOO.SS.',
        '....OOOO....',
        '...OOOOOO...',
        '...OOOOOO...',
        '...SS..SS...',
        '...SS..SS...',
        '...KK..KK...',
        '............',
      ],
    },
    {
      name: 'Tourist Tim',
      hair: '#6b4a2a',
      accent: '#fff3c4',   // bucket hat + shirt flowers
      headEnd: 5,
      rows: [
        '....AAAA....',
        '...AAAAAA...',
        '..AAAAAAAA..',
        '...SSSSSS...',
        '...SKSSKS...',
        '....SSSS....',
        '...OOOOOO...',
        '..SOAOOAOS..',
        '..S.OOOO.S..',
        '..KKOOAOKK..',
        '...OOOOOO...',
        '....WWWW....',
        '....W..W....',
        '....S..S....',
        '....K..K....',
        '............',
      ],
    },
    {
      name: 'Sun Seeker',
      hair: '#c2452d',
      accent: '#1c1c1c',   // big shades
      headEnd: 5,
      rows: [
        '....HHHH....',
        '...HHHHHH...',
        '..HHSSSSHH..',
        '..HAAKAAKH..',
        '..H.SSSS.H..',
        '..H..SS..H..',
        '..H.OOOO.H..',
        '..HS.SS.SH..',
        '..HS.SS.SH..',
        '..H.SSSS.H..',
        '....OOOO....',
        '....OOOO....',
        '....S..S....',
        '....S..S....',
        '....K..K....',
        '............',
      ],
    },
    {
      name: 'Sandcastle Sam',
      hair: '#f2d16b',
      accent: '#e0403c',   // pail
      headEnd: 6,
      rows: [
        '............',
        '....HHHH....',
        '...HHHHHH...',
        '...HSSSSH...',
        '....SKSK....',
        '....SSSS....',
        '.....SS.....',
        '...OWOWOW...',
        '..S.WOWOW.S.',
        '..S.OWOWO.AA',
        '....WOWOW.AA',
        '....OWOWO...',
        '....S..S....',
        '....S..S....',
        '....K..K....',
        '............',
      ],
    },
    {
      name: 'Salty Skipper',
      hair: '#ffffff',
      accent: '#123a63',   // captain's cap
      headEnd: 7,
      rows: [
        '....AAAA....',
        '...AAAAAA...',
        '...AWWWWA...',
        '...SSSSSS...',
        '...SKSSKS...',
        '...HSSSSH...',
        '...HHSSHH...',
        '....HHHH....',
        '...OOOOOO...',
        '..S.OOOO.S..',
        '..S.OWWO.S..',
        '...OOOOOO...',
        '...OOOOOO...',
        '....S..S....',
        '....S..S....',
        '....K..K....',
      ],
    },
  ];

  // Base pixel maps are 12×16; rendered sprites gain a 1px dark outline on
  // every side (14×18) so beachgoers stay readable against the sand, whose
  // hue can sit close to the lighter skin tones.
  const BASE_W = 12;
  const BASE_H = 16;
  const SPRITE_W = BASE_W + 2;
  const SPRITE_H = BASE_H + 2;

  function paletteFor(archetype, skinIdx, outfitIdx) {
    const arch = ARCHETYPES[archetype] || ARCHETYPES[0];
    return {
      S: SKIN_TONES[skinIdx] || SKIN_TONES[0],
      O: OUTFITS[outfitIdx] || OUTFITS[0],
      H: arch.hair,
      A: arch.accent,
      W: '#ffffff',
      K: '#20242c',
    };
  }

  // ── Facing & walk-frame variants ───────────────────────────────────────
  // Every orientation is derived from the one front-facing map, so each new
  // archetype stays a single-map job. headEnd marks the last head row.

  // K pixels in the head zone are facial detail (eyes, shade lenses). Erase
  // them into their surroundings for the back view.
  function eraseFace(row) {
    const chars = row.split('');
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] !== 'K') continue;
      chars[i] = (chars[i - 1] && chars[i - 1] !== '.' && chars[i - 1] !== 'K')
        ? chars[i - 1]
        : (chars[i + 1] && chars[i + 1] !== '.' ? chars[i + 1] : 'H');
    }
    return chars.join('');
  }

  // Seen from behind: no face, and the head is hair (hats keep their color).
  function backRows(arch) {
    return arch.rows.map((row, y) =>
      y > arch.headEnd ? row : eraseFace(row).replace(/S/g, 'H'));
  }

  // Left/right profile: the whole face — both eyes — rides with the head,
  // nudged one pixel toward the direction of travel.
  function sideRows(arch) {
    return arch.rows.map((row, y) =>
      y > arch.headEnd ? row : '.' + row.slice(0, -1));
  }

  const mirrorRows = (rows) => rows.map(r => r.split('').reverse().join(''));

  function facingRows(arch, facing) {
    if (facing === 'up') return backRows(arch);
    if (facing === 'right') return sideRows(arch);
    if (facing === 'left') return mirrorRows(sideRows(arch));
    return arch.rows;
  }

  // Two-step walk cycle: lift alternating feet by blanking one of the two
  // pixel runs in the bottom-most drawn row.
  function walkFrameRows(rows, frame) {
    if (!frame) return rows;
    let bottom = rows.length - 1;
    while (bottom >= 0 && !/[^.]/.test(rows[bottom])) bottom--;
    if (bottom < 0) return rows;
    const row = rows[bottom];
    const runs = [];
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '.') continue;
      if (i === 0 || row[i - 1] === '.') runs.push([i, i]);
      else runs[runs.length - 1][1] = i;
    }
    if (runs.length < 2) return rows;
    const lift = frame === 1 ? runs[0] : runs[runs.length - 1];
    const chars = row.split('');
    for (let i = lift[0]; i <= lift[1]; i++) chars[i] = '.';
    const out = rows.slice();
    out[bottom] = chars.join('');
    return out;
  }

  // Cache rendered sprites: one offscreen canvas per
  // (archetype, skin, outfit, facing, frame).
  const cache = new Map();

  function spriteCanvas(archetype, skinIdx, outfitIdx, facing = 'down', frame = 0) {
    const key = `${archetype}-${skinIdx}-${outfitIdx}-${facing}-${frame}`;
    if (cache.has(key)) return cache.get(key);
    // Defensive cap: the full variant space is ~2300 canvases; a real room
    // uses a couple dozen. Reset rather than grow without bound.
    if (cache.size > 600) cache.clear();

    const arch = ARCHETYPES[archetype] || ARCHETYPES[0];
    const pal = paletteFor(archetype, skinIdx, outfitIdx);
    const rows = walkFrameRows(facingRows(arch, facing), frame);

    const base = document.createElement('canvas');
    base.width = BASE_W;
    base.height = BASE_H;
    const bctx = base.getContext('2d');
    rows.forEach((row, y) => {
      for (let x = 0; x < BASE_W; x++) {
        const c = pal[row[x]];
        if (!c) continue;
        bctx.fillStyle = c;
        bctx.fillRect(x, y, 1, 1);
      }
    });

    // Outline: stamp a dark silhouette in the 4 cardinal offsets, then draw
    // the sprite on top.
    const sil = document.createElement('canvas');
    sil.width = BASE_W;
    sil.height = BASE_H;
    const sctx = sil.getContext('2d');
    sctx.drawImage(base, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = '#20242c';
    sctx.fillRect(0, 0, BASE_W, BASE_H);

    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_W;
    canvas.height = SPRITE_H;
    const ctx = canvas.getContext('2d');
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) ctx.drawImage(sil, dx, dy);
    ctx.drawImage(base, 1, 1);

    cache.set(key, canvas);
    return canvas;
  }

  // Draw an avatar scaled into a destination canvas (for pickers/lists).
  function drawInto(dest, avatar) {
    const ctx = dest.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, dest.width, dest.height);
    const scale = Math.min(dest.width / SPRITE_W, dest.height / SPRITE_H);
    const w = SPRITE_W * scale;
    const h = SPRITE_H * scale;
    ctx.drawImage(
      spriteCanvas(avatar.archetype, avatar.skin, avatar.outfit),
      (dest.width - w) / 2, (dest.height - h) / 2, w, h
    );
  }

  window.Sprites = {
    ARCHETYPES,
    SKIN_TONES,
    OUTFITS,
    SPRITE_W,
    SPRITE_H,
    spriteCanvas,
    drawInto,
  };
})();
