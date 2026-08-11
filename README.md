# 🌊 Wave Runner

A 2D top-down multiplayer browser game: beachgoers survive as many waves as
they can before the end of the day. Ocean at the top of the screen, sand on
the lower third, lifeguards on patrol, weather rolling in.

Playable on iPhone/iPad Safari in portrait or landscape (tap to walk,
hold to run) and on desktop (tap, or WASD/arrow keys with Shift to
sprint, plus action hotkeys — J jump, U dive/dig, N stand, K shove,
R rest — shown as parenthetical hints on the buttons when a mouse-and-
keyboard setup is detected). Served at `binolabs.com/waves/`.

## How it plays

- **Lobby**: Bino Bee-style room codes — create a beach, share the 6-letter
  code, up to 8 players. Pick a 16-bit beachgoer caricature (8 archetypes ×
  4 skin tones × 6 suit colors). Avatars face the way they move (you see
  their back heading out to sea, a profile crossing the beach) and animate
  a two-step walk cycle.
- **Running**: tap-and-hold a spot (drag to retarget) or hold Shift with
  WASD/arrows to run — 1.6× speed, kicking up sand, at a slow HP burn
  that can tire you down to 1 HP but never eliminate you. NPCs never run.
- **Waves** roll in from the top with subtle visual tells (foam height, face
  shadow): ripples are safe standing, rollers need a timed **jump** or
  **dive**, thumpers demand a **dive**. Mistime it and you're washed up on
  the sand with less HP. Diving costs a sliver of HP (never lethal) but
  pays a scoring premium when it lands.
- **Tide**: the waterline breathes through the day — high tide eats the
  beach and speeds up the surf; low tide exposes sand and slows it. The
  HUD shows the tide direction, and waves arrive at gradually drifting
  angles that sharpen late in the day.
- **Status bar** shows the time of day plus the next two hours of weather.
  When a **thunderstorm** hour arrives, being in the water risks a lightning
  strike — wait it out on the sand, or wear the body suit.
- **Lifeguards** whistle anyone beyond the flags or too far out; linger and
  they haul you in with an HP penalty.
- **Umbrella** (⛱️ button): sit out on the beach and slowly regain HP —
  safe, but no points.
- **Banner planes** pass overhead (propeller sound); tappable power-ups
  splash down: 🧴 sunscreen (+HP), 🦺 body suit (lightning immunity),
  🛹 body board (ride any wave for a while), 🧺 beach blanket (shove-proof).
  Tapping an item walks your beachgoer over — you must actually reach it
  to pick it up.
- **Shove** (🫸 button): lunge at the nearest swimmer near you and knock
  them out of the water and back onto the beach — breaking their streak
  and chipping their HP — unless their beach blanket is spread out. Short
  cooldown between shoves; a whiff costs nothing.
- **Wildlife**: 🦈 sharks sweep the water (heavy bite, washed ashore),
  🪼 jellyfish drift and sting, 🦀 crabs scuttle the sand and pinch
  resting campers awake, and 🐦 seagulls swoop to steal dropped power-ups
  before you reach them.
- In a **multiplayer** game, the last beachgoer still standing wins the
  day by default; solo days run until the clock or the ocean says
  otherwise.
- **Stand** doubles as a bail-out: cancelling a mistimed jump/dive
  collapses most of the cooldown so a quick correction is possible.
- **Diving** also hides you: a diver under the surface cannot be shoved.
  On the sand the same button becomes **Dig** — burrow in for a couple of
  seconds, immune to shoves, crab pinches, and lightning, but rooted in
  place.
- **Beach bullies** (lobby option): up to three computer beachgoers —
  Mellow Mel, Pushy Pete (the quickest), and Big Bruiser (slow but mean) —
  with rising aggression. They read waves, chase power-ups, nap when
  battered, flee storms (the meaner, the later), and shove anyone in
  reach — though their reach is half a human's lunge.
- A player is out when their HP hits zero. The game ends when everyone is
  out or the clock hits 7 PM; the tally crowns the **Best on the Beach**.

All audio (surf, seagulls, whistle, thunder, plane, jaunty summer chiptune)
is synthesized with WebAudio — no assets.

## Architecture

- `server.js` — Express + Socket.IO; drives an 8 Hz authoritative
  simulation per room and broadcasts snapshots.
- `src/rooms.js` — lobby/room-code management (mirrors Bino Bee).
- `src/game.js` — pure deterministic game engine (injected rng, manual
  `tick(dt)`), which is what the unit tests exercise.
- `public/` — canvas renderer, pixel-sprite catalogue, WebAudio engine.

## Development

```sh
npm install
npm start          # http://localhost:8080
npm test           # jest: engine + rooms unit tests, socket integration tests
```

Or containerized, as CI runs them:

```sh
docker run --rm -v "$PWD:/src:ro" -w /work node:20-alpine \
  sh -c "cp -r /src/. /work && npm ci && npm test"
```
