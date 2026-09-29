# Exiled Knight

2D retro action platformer. The same game builds as an **Android APK** and as a **web app** from this one repository.

| Target | Directory | Stack |
| --- | --- | --- |
| Android | `app/` | Kotlin + Jetpack Compose (Android Gradle Plugin) |
| Web | `web/` | TypeScript + Canvas 2D (Vite) |

## Quick start

### Web

```bash
npm run web:install     # once
npm run web:dev         # http://localhost:5173
```

Production build into `web/dist/`:

```bash
npm run web:build
npm run web:preview     # serve the production build locally
```

`web/dist/` is a static bundle — drop it on any static host (GitHub Pages, Netlify,
Cloudflare Pages, an S3 bucket). Asset URLs are relative, so it also works from a
sub-path without reconfiguration.

### Deploying to Vercel

The web app lives in a sub-directory of a repo whose root is an Android project, so
Vercel needs to be told what to build. A root `vercel.json` already does this:

| Setting | Value |
| --- | --- |
| Framework Preset | **Other** |
| Root Directory | **leave empty** (the repository root — *not* `web`) |
| Install Command | `npm --prefix web ci` |
| Build Command | `npm --prefix web run build` |
| Output Directory | `web/dist` |

Import the Git repository and accept those defaults, or run `vercel` from the repo
root. All of the values above are committed in `vercel.json`, so a fresh import
works with no dashboard configuration.

> **Root Directory must not be set to `web`.** The build syncs artwork out of
> `app/src/main/assets`, which lives outside `web/`. If the project root is
> `web`, that directory is not in the build context and `npm run sync-assets`
> fails the build with an explicit error rather than deploying a broken site.

Other static hosts need the equivalent mapping: install and build inside `web/`,
then publish `web/dist`.

### Android

```bash
./gradlew :app:assembleDebug     # debug APK
./gradlew :app:assembleRelease   # release APK (needs KEYSTORE_PATH / STORE_PASSWORD / KEY_PASSWORD)
```

Requires a JDK 17+ and the Android SDK. The release build is wired to the keystore
described in `.env.example` / `gradle.properties`.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Move | Left thumbstick | `A` / `D` or `←` / `→` |
| Jump | `JUMP` button | `Space` or `W` |
| Attack | `ATK` button | `J` |
| Heavy attack | `HEAVY` button | `K` |
| Block (hold) | `BLOCK` button | `L` |
| Dash | `DASH` button | `Shift` |

Keyboard bindings are web-only; the Android build is touch-driven. `CONFIG` in the
HUD opens the animation inspector (live FPS tuning, frame-count stepping, per-action
preview) on both platforms.

## Ground plane

The arena floor is **derived from the backdrop artwork**, not guessed from the screen size.

The backdrop (`img_arena_bg_hd.png`, 1536×864) is drawn with a **single uniform scale** of
`360 / 864 = 5/12`, which maps the art exactly onto the 640×360 logical viewport — no
distortion, no letterboxing, no screen-relative coordinates. Because the same factor drives
both the drawing and the floor constant, the two cannot drift apart.

Row 533 is where the wall ends and the stone floor begins. Measuring mean luma and lit-pixel
fraction across the image width, the transition is unambiguous:

| row | mean luma | lit pixels |
|-----|-----------|-----------|
| 532 | 22.1 | 20% |
| 533 | 32.0 | 50% |
| 534 | 35.5 | 65% |

```
FLOOR_Y = 533 × (360 / 864) = 222.083 logical px
```

The edge is horizontal, so one world-space plane is exact across the arena. `FLOOR_Y` is
the single collision plane: the player's feet rest on it while idle and walking, the jump
impulse launches from it, and gravity returns to it.

> Row 620 is a bright flagstone joint *inside* the floor, not its top edge. It produces a
> larger single-row brightness jump than the real horizon does, which is how an earlier
> version of this file came to place the knight standing in front of the wall. The floor
> edge has to be found with a windowed comparison, not a one-row difference.

The backdrop is drawn in **screen space, before the camera translate**, so panning cannot
slide the floor relative to the feet. Nothing opaque is painted over it: the engine's
original stone slab and flagstone grid were removed, since covering the floor is exactly
what hid the surface the player has to stand on. Pillars and a soft contact shadow remain.

### Per-frame foot rows

The 128px sprite cells are not filled to the bottom edge, and the walk cycle's contact row
moves, so the padding is **measured per frame** rather than assumed constant:

| sheet | bottom-most opaque row per frame |
|-------|----------------------------------|
| `idle.png` | 111 on all 12 frames |
| `walk.png` | 111, 111, 110, 110, 110, 111, 110, 111, 112, 112, 112, 112 |

Those rows live in the animation config (`footRows` in `AnimationConfig.kt` /
`AnimationConfig.ts`, measured by scanning each sheet's alpha channel) and are read through
`footRowForFrame(index)`. At the 100px display size they span 11.72–13.28 logical px, so a
single constant would leave the extreme walk frames up to 0.78 logical px off the floor.
The PNGs are neither modified nor stretched.

### Verifying it against the rendered output

`web/src/game/logic.test.ts` (`npm test`) proves the geometry is self-consistent, but it
cannot prove the pixels. `web/scripts/verify-floor.mjs` drives the real page in Chromium via
a `?debug=1` hook and measures the rendered canvas:

- the plate's wall/floor horizon, found by a windowed brightness comparison
- the character's lowest painted row, read from the alpha channel of the real draw path
  (`GameWorld.renderCharacter`, extracted from `render` for exactly this purpose)

```
cd web && npm run build && npm run verify:floor
```

Current result: horizon at source row 533, feet edge at logical y 221.75 against a floor of
222.083 — a 0.33px difference, which is one device pixel at 2× and the closest a pixel-grid
measurement can get. Verified across idle and all walk foot-row variants, and at four camera
offsets.

## Shared assets

The Android app is the **source of truth** for art. The web build never stores its
own copy:

```
app/src/main/assets/sprites/*.png   ──┐
                                       ├──▶  web/public/  (generated, git-ignored)
app/src/main/res/drawable/img_arena_bg_hd.png  ──┘
```

`npm run sync-assets` performs the copy and runs automatically before `web:dev` and
`web:build`. Edit or add a sprite under `app/src/main/assets/sprites/`, re-run the
web build, and both targets pick it up.

Sprite sheets are named after the action they drive, because `SpriteAnimationConfig.kt`
looks them up by filename:

| File | Frames | Used by |
| --- | --- | --- |
| `idle.png` | 12 | `IDLE` (and currently as the fallback art for the other actions) |
| `walk.png` | 12 | `WALK`, `JUMP` |
| `exiled_knight_portrait.png` | 1 | unused placeholder / reference still |

Only `idle.png` and `walk.png` exist so far. `ATTACK`, `HEAVY_ATTACK`, `BLOCK`,
`DASH`, `HURT` and `DEATH` are configured but have no sheet, so they temporarily
render the idle art. Add `attack.png` etc. and point the matching entry in
`DefaultAnimationConfigs` at them.

### UI icons

`app/src/main/assets/ui/` holds HUD artwork rather than sprite sheets, and the
sync script copies the whole tree, so nested folders work as-is.

| File | Used by |
| --- | --- |
| `ui/btn_attack.png` | Icon on the `ATK` / `SLASH` button, replacing its text labels |

Both builds render the icon at 68% of the button's diameter, centred, with the
button's own circular red background, shadow and press animation unchanged. If
the asset is missing, the Compose loader returns `null` and the button falls
back to its `ATK` / `SLASH` text rather than drawing an empty circle; the web
build behaves the same way because the `<img>` simply fails to load.

The arena backdrop lives in `res/drawable/` rather than `assets/` on Android, so the
sync script copies it explicitly to `web/public/bg/arena_bg.png`. `GameWorld` looks up
`img_arena_bg_hd` first and falls back to the legacy `img_arena_bg.jpg`.

## Verifying

```bash
npm run web:check     # TypeScript typecheck + headless game-logic tests
```

`web/src/game/logic.test.ts` runs the physics, animation state machine, hit detection
and damage rules in plain Node (60 assertions) — it needs no browser.

## Repository layout

```
app/                      Android application module
  src/main/java/.../game/
    animation/            SpriteAnimationSystem, SpriteSheet, PlayerAction, configs
    controller/           PlayerController (physics + state machine)
    engine/               GameWorld (world, camera, arena, particles)
    model/                TrainingDummy, DamageText, SparkParticle
    ui/                   Compose HUD, virtual controls, animation inspector
  src/main/assets/sprites/   sprite sheets (source of truth)
  src/main/res/drawable/     arena backgrounds

web/                      Web application (Vite + TypeScript)
  src/game/               TypeScript port of the modules above
  src/ui/                 DOM-based HUD, virtual controls, inspector
  scripts/sync-assets.mjs copies Android art into web/public
vercel.json               Vercel build config (root, not web/)
```

### Note on the two implementations

The game logic is implemented **twice** — once in Kotlin, once in TypeScript — because
Jetpack Compose's `Canvas`/`nativeCanvas` rendering in `GameScreen.kt` has no web
equivalent. Only the *artwork* is genuinely shared. Behavioural changes therefore have
to be made in both `app/src/main/java/com/example/game/` and `web/src/game/`; the logic
test is the fastest way to confirm the web side after a change.
