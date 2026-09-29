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

The backdrop (`img_arena_bg_hd.png`, 1536×864) is drawn scaled into 960×360 logical pixels,
so artwork row *r* maps to logical Y via `r × 360 / 864`. The stone floor is a hard
horizontal edge running the full width of the image — a dark ledge seam at row **618**
(168/192 sampled columns agree) with the lit flagstone surface starting at row **620**
(111/158 columns; the rest are pillars occluding the edge). There is no perspective slope.

```
GROUND_Y = 620 × (360 / 864) = 258.33 logical px
```

`GameWorld.FLOOR_Y` is that value. It is the single world-space collision plane: the
player's feet rest exactly on it while idle and walking, the jump impulse launches from
it, and gravity returns to it. The engine's stone slab is drawn from `FLOOR_Y` downward,
so its top edge coincides with the backdrop's own floor line and the background stays
visible above it as the reference.

The sprite cell also carries transparent padding below the feet — opaque content ends at
row 111 of the 128px cell in every frame of both sheets, leaving 16 empty rows, which is
12.5 logical px at the 100px display size. `GameWorld.SPRITE_FOOT_OFFSET` offsets the
draw-rect by that amount so the *visible* feet, not the padding, land on `FLOOR_Y`. The
PNG itself is neither modified nor stretched.

The walk cycle's last four frames let the cloak hang one to two source pixels lower than
the idle rest pose, so worst-case penetration is 0.78 logical px (sub-pixel at typical
display scale). The idle sheet is exact to the pixel on all 12 frames.

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
