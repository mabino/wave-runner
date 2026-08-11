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
  that can tire you down to 1 HP but never eliminate you. A sprint lasts
  about 2.5 s before you're winded (💨 in the HUD) and need a ~3 s
  breather; keep holding and you'll surge again the moment it passes.
  NPCs never run.
- **Waves** are born at the far horizon — above even the deepest swimmer,
  so nothing ever pops up beneath you — and roll in with subtle visual
  tells (foam height, face shadow): ripples are safe standing, rollers
  need a timed **jump** or **dive**, thumpers demand a **dive**. Mistime
  it and you're washed up on the sand with less HP. Diving costs a sliver
  of HP (never lethal) but pays a scoring premium when it lands.
- **Not every wave goes the distance**: some pick an endpoint short of the
  sand and visibly thin out as they run down to it, dropping a size class
  (or two) along the way — a distant thumper may arrive as a mere roller.
  The strong ones hold full power all the way to the beach.
- **Encore jumps**: chain jumps back-to-back and the avatar starts showing
  off — new poses (corkscrew, starfish), extra hangtime, and a sliver of
  HP from the crowd's approval per encore.
- **Deep search**: a third quick **Dive** (or **Dig**) in a row takes you
  clean off the playfield for a few seconds — invisible and untouchable —
  and sometimes you surface clutching a **rare shell** worth a big pile
  of Pleasant Points.
- **Tide**: the waterline breathes through the day — high tide eats the
  beach and speeds up the surf; low tide exposes sand and slows it. The
  HUD shows the tide direction, and waves arrive at gradually drifting
  angles that sharpen late in the day.
- **Status bar** shows the time of day plus the next two hours of weather.
  When a **thunderstorm** hour arrives, being in the water risks a lightning
  strike — but every bolt is telegraphed: the doomed patch of water glows
  for a moment first, so a sharp swimmer can clear out (or wear the body
  suit and ignore it). Only the glowing endpoint is dangerous — the bolt's
  zigzag path through the sky hurts no one it crosses.
- **Lifeguard flags** read the surf danger and update live: one yellow
  (easy), two yellow (lively), one red (rough), two red (double red —
  respect the ocean). Rougher late-day sets and a fast high tide raise
  the level; lightning weather is an automatic double red.
- **Open ocean**: the red buoys mark the surf zone, but you may swim a
  full screen past them — the camera follows you out until the beach
  drops out of sight, and a white buoy line marks the true outer limit.
  Out there, waves are unbroken swells: they can't wipe you out to the
  sand, but they're no free pass either — **duck-dive** under each one
  (or ride it on a body board) or it sweeps you back toward shore with
  a sting. Waves only break, wipe, and pay points inside the surf zone.
- **Lifeguards** whistle anyone beyond the side flags or past the outer
  buoy line; linger and they haul you in with an HP penalty.
- **Rip currents** build up, hold, and die back down: a subtly darker
  channel of outbound foam that drags anyone in it further and further
  out to sea while draining HP fast. Swim **parallel to the beach** to
  escape (or sprint hard shoreward). The channel runs clear to the top
  of the ocean: anyone dragged past the buoys gets a **rescue swimmer**
  launched after them — red cap, torpedo float — who races the current
  and hauls the caught back to the sand for an extended cooldown. If
  the rip carries you to the top before the lifeguard arrives, you're
  **swept out to sea** and your beach day is over.
- **The boardwalk**: scroll down past the back of the beach and walk up
  onto the planks (no digging through them). The **🎣 Bait & Tackle**
  shack trades on contact, once per visit: it buys your catch (25 ppts
  per fish) and sells a worm of bait (10 ppts). Soak the bait by
  standing in the water and something will bite within a dozen seconds;
  a carried fish also buys off a **shark attack** — the shark takes the
  fish and leaves you whole.
- Scores are **Pleasant Points (ppts)** — waves, streaks, perfect reads,
  dive premiums, and scooped salps all pay into the same tally.
- **Umbrella** (⛱️ button): stretch out in the shade beneath your umbrella
  and slowly regain HP — safe, but no Pleasant Points.
- **Banner planes** pass overhead (propeller sound); tappable power-ups
  splash down: 🧴 sunscreen (+HP), 🦺 body suit (lightning immunity),
  🛹 body board (ride any wave for a while), 🧺 beach blanket (shove-proof),
  🪣 pail (kept for the whole day, carried at your side). Tapping an item
  walks your beachgoer over — you must actually reach it to pick it up.
- **Salps** drift in the water: wiggly tentacle-clusters that look exactly
  like a jellyfish with no cap. With a pail equipped, swim into one to
  scoop it for bonus Pleasant Points — but about one in five is really a
  jellyfish whose cap sits just below the surface, and scooping that one
  stings. Without a pail they drift by harmlessly.
- **Shove** (🫸 button): lunge at the nearest swimmer near you and knock
  them out of the water and back onto the beach — breaking their streak
  and chipping their HP — unless their beach blanket is spread out. Short
  cooldown between shoves; a whiff costs nothing.
- **Wildlife**: 🦈 sharks sweep the water (heavy bite, washed ashore),
  🪼 jellyfish drift and sting, 🦀 crabs scuttle the sand and pinch
  resting campers awake, and 🐦 seagulls swoop to steal dropped power-ups
  before you reach them. On the sand, the Shove button also punts an
  incoming crab away before it can pinch — ocean wildlife can't be shoved.
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
- A **?** button on the setup screen opens a quick how-to-play card with
  the basics.

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
