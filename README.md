# 🌊 Wave Runner

A 2D top-down multiplayer browser game: beachgoers survive as many waves as
they can before the end of the day. Ocean at the top of the screen, sand on
the lower third, lifeguards on patrol, weather rolling in.

Playable on iPhone/iPad Safari in portrait or landscape. Served at
`binolabs.com/waves/`.

## How it plays

- **Lobby**: Bino Bee-style room codes — create a beach, share the 6-letter
  code, up to 8 players. Pick a 16-bit beachgoer caricature (8 archetypes ×
  4 skin tones × 6 suit colors).
- **Waves** roll in from the top with subtle visual tells (foam height, face
  shadow): ripples are safe standing, rollers need a timed **jump** or
  **dive**, thumpers demand a **dive**. Mistime it and you're washed up on
  the sand with less HP. Diving costs a sliver of HP (never lethal) but
  pays a scoring premium when it lands.
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
