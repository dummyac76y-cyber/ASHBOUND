/**
 * Artwork-derived verification of the cavern's combat floor.
 *
 * The scene declares a `floorRow`, which decides where the player's feet land and
 * therefore what counts as solid ground. This script re-derives that row from
 * cavern_bg.png itself and checks the declared value against it, so the floor can
 * never quietly become a copy of another scene's value, a screen-space guess, or a
 * row that happens to sit on top of a rock.
 *
 * Run with: node scripts/verify-floor-art.mjs
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readPng, deriveFloorRow, floorRowInWindow, surfaceRows } from './lib/artwork.mjs'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const bgDir = join(webRoot, '..', 'web', 'public', 'bg')

/**
 * Kept in step with web/src/game/GameScene.ts by hand and cross-checked here; the
 * point of the check is that these numbers describe the paintings, so they are
 * stated literally rather than imported from the app under test.
 *
 * Only the cavern is re-derived. The rule below keys on a standable surface
 * catching light along its top face, which is how cavern_bg.png is painted; the
 * prison's floor is the near edge of a large uniformly lit ground plane whose
 * strongest full-width edge lies well below the row its walkable surface starts
 * at, so the same rule would not reproduce its value. Re-deriving the prison here
 * would therefore be measuring the heuristic rather than the picture, and the
 * prison's floor is not what this change is about.
 */
const SCENES = [
  { id: 'forgotten_prison', file: 'arena_bg.png', floorRow: 533, derive: false },
  { id: 'underground_cavern', file: 'cavern_bg.png', floorRow: 391, derive: true },
]

let failures = 0
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

for (const scene of SCENES) {
  if (!scene.derive) continue
  const path = join(bgDir, scene.file)
  if (!existsSync(path)) {
    console.error(`missing ${path}; run \`npm run sync-assets\``)
    process.exit(1)
  }
  const img = readPng(path)

  console.log(`\n${scene.id}: the visible stone floor in ${scene.file} (${img.width}x${img.height})`)

  // --- The floor is re-derived from the artwork, not taken on trust -------------
  const derived = deriveFloorRow(img)
  check(
    'the declared floor row is the row the artwork itself puts the ground at',
    derived.floorRow === scene.floorRow,
    `declared ${scene.floorRow}, artwork says ${derived.floorRow} (${(derived.score * 100).toFixed(0)}% of the width carries that surface)`,
  )

  // A single obvious winner means the floor is unambiguous. Without this the
  // derivation could be picking one of several equally plausible ledges. The
  // floor's own thickness is excluded, not just the row: the top of the ground is
  // a textured stone face some rows deep, and those rows are the floor, not rivals.
  const FLOOR_BAND = 15
  const ranked = surfaceRows(img).sort((a, b) => b.score - a.score)
  const runnerUp = ranked.find((r) => Math.abs(r.y - derived.floorRow) > FLOOR_BAND)
  check(
    'the ground is the widest surface in the picture, so it is not a rock or a ledge',
    ranked[0].y === derived.floorRow && derived.score > (runnerUp?.score ?? 0) * 1.25,
    `floor ${(derived.score * 100).toFixed(0)}% vs next widest at y ${runnerUp?.y} ${((runnerUp?.score ?? 0) * 100).toFixed(0)}%`,
  )

  // --- The floor is flat along the whole walkable width -----------------------
  // The painting has stone grain and gentle undulation, so the surface is not
  // pixel-identical everywhere; what matters is that no part of the walkable span
  // sits on a step high enough to read as a separate platform.
  const TOLERANCE = 20
  const windows = []
  for (let x0 = 0; x0 + 64 <= img.width; x0 += 64) {
    windows.push({ x0, ...floorRowInWindow(img, x0, x0 + 64, { around: derived.floorRow }) })
  }
  const outliers = windows.filter((w) => Math.abs(w.row - derived.floorRow) > TOLERANCE)
  check(
    'the ground stays at the same height across the whole scene, with no raised section',
    outliers.length === 0,
    outliers.length
      ? `${outliers.length} of ${windows.length} windows differ: ${outliers.map((w) => `x${w.x0}->y${w.row}`).join(', ')}`
      : `all ${windows.length} windows within ${TOLERANCE}px of y ${derived.floorRow}`,
  )
  const spread = windows.map((w) => w.row)
  console.log(
    `       surface across the scene spans y ${Math.min(...spread)}..${Math.max(...spread)} (median ${spread.sort((a, b) => a - b)[spread.length >> 1]})`,
  )
}

// --- The two scenes do not share a floor ------------------------------------
console.log('\nscene independence')
{
  const [prison, cavern] = SCENES
  const pimg0 = readPng(join(bgDir, prison.file))
  const cimg0 = readPng(join(bgDir, cavern.file))
  check(
    "the cavern does not reuse the prison's floor row",
    cavern.floorRow !== prison.floorRow,
    `prison ${prison.floorRow}, cavern ${cavern.floorRow}`,
  )
  // A shared world Y would only be legitimate if the two paintings placed their
  // ground at the same relative height; they do not, so the rows must differ.
  const pRel = prison.floorRow / pimg0.height
  const cRel = cavern.floorRow / cimg0.height
  check(
    'the two floors differ in the paintings as well as in the declarations',
    Math.abs(pRel - cRel) > 0.05,
    `prison row is ${(pRel * 100).toFixed(1)}% down its image, cavern ${(cRel * 100).toFixed(1)}%`,
  )
}

console.log(`\n${failures === 0 ? 'artwork floor checks passed' : `${failures} artwork floor check(s) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
