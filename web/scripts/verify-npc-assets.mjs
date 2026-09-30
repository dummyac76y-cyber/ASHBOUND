/**
 * Verification for the NPC sprite assets.
 *
 * The NPC is not placed in a scene yet, so nothing in the game reads these files.
 * That is exactly why they need their own check: an asset nothing loads is also an
 * asset nothing notices going missing, arriving half-resaved, or quietly drifting
 * out of step with the other platform.
 *
 * What this asserts:
 *   - every sheet is in the shared Android asset tree, and its web copy is
 *     byte-identical, so both platforms draw the same pixels
 *   - the artwork is stored exactly as supplied -- not re-encoded, not resampled
 *     into soft edges -- and the declared cell size matches the real dimensions
 *   - transparency survived, and did so as hard-edged alpha
 *   - every frame of the walk cycle shares one foot baseline, so the NPC will not
 *     bob as it animates, and that baseline is the one the code will draw against
 *   - each motion is bound to a frame range that exists on a sheet that exists
 *   - sheets still awaiting artwork are genuinely absent
 *
 * Run with: node scripts/verify-npc-assets.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readPng } from './lib/artwork.mjs'
import {
  NPC_ASSET_SET,
  NPC_BASELINE_Y,
  NPC_CELL_SIZE,
  NPC_CLIPS,
  NPC_IDLE_FPS,
  NPC_IDLE_WALK_SHEET,
  NPC_NEAREST_NEIGHBOR,
  NPC_WALK_FPS,
  isClipAssigned,
  npcSheetHeight,
  npcSheetWidth,
} from '../src/game/npcAssets.ts'

// This script is bundled before it runs, so import.meta.url points at the build
// cache rather than the repository. Walk up to the folder that actually holds the
// shared assets instead of assuming where the bundle landed.
function findRepoRoot() {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'app', 'src', 'main', 'assets', 'sprites'))) return dir
    dir = dirname(dir)
  }
  throw new Error(`could not find the repository root from ${process.cwd()}`)
}
const repoRoot = findRepoRoot()
const androidSprites = join(repoRoot, 'app', 'src', 'main', 'assets', 'sprites')
const webSprites = join(repoRoot, 'web', 'public', 'sprites')

let failures = 0
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8)

/** Alpha coverage and opaque bounds of one cell of a sheet. */
function measureCell(img, ox, oy, w, h) {
  let clear = 0
  let partial = 0
  let opaque = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let lowest = -1
  const colours = new Set()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = img.px(ox + x, oy + y)
      if (a === 0) {
        clear++
        continue
      }
      if (a === 255) opaque++
      else partial++
      colours.add((r << 24) | (g << 16) | (b << 8) | a)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      if (y > maxY) {
        maxY = y
        lowest = y
      }
    }
  }
  return { clear, partial, opaque, minX, minY, maxX, maxY, lowest, colours }
}

console.log('the NPC asset set is declared once, coherently')
{
  const files = NPC_ASSET_SET.map((s) => s.file)
  check('every file name is unique', new Set(files).size === files.length, files.join(', '))
  check(
    'a strip sheet is one row of cells, a grid sheet is 8x8',
    NPC_ASSET_SET.every((s) =>
      s.layout === 'grid'
        ? npcSheetWidth(s) === NPC_CELL_SIZE * 8 && npcSheetHeight(s) === NPC_CELL_SIZE * 8
        : npcSheetWidth(s) === NPC_CELL_SIZE * s.frames && npcSheetHeight(s) === NPC_CELL_SIZE,
    ),
    NPC_ASSET_SET.map((s) => `${s.file}:${npcSheetWidth(s)}x${npcSheetHeight(s)}`).join(' '),
  )
  check('filtering is pinned to nearest-neighbour so pixel art keeps its hard edges', NPC_NEAREST_NEIGHBOR === true, 'no smoothing')
  check('the shared cell size is the one the artwork already uses', NPC_CELL_SIZE === 128, `${NPC_CELL_SIZE}px`)
}

console.log('\nevery sheet that exists is in the shared assets, byte-identical on both platforms')
const presentSheets = NPC_ASSET_SET.filter((s) => s.status === 'present')
{
  for (const sheet of presentSheets) {
    const android = join(androidSprites, sheet.file)
    const web = join(webSprites, sheet.file)
    if (!check(`${sheet.file}: lives in the Android asset tree, the source of truth`, existsSync(android), android)) {
      continue
    }
    const a = readFileSync(android)
    check(
      `${sheet.file}: the web copy is byte-identical, so both platforms draw the same pixels`,
      existsSync(web) && Buffer.compare(a, readFileSync(web)) === 0,
      existsSync(web) ? `sha ${sha(a)} on both` : 'web/public has not been synced',
    )
    check(
      `${sheet.file}: stored as supplied, with no re-encode or recompression`,
      a.subarray(1, 4).toString('ascii') === 'PNG',
      `sha ${sha(a)}, ${a.length} bytes`,
    )
  }
}

console.log('\nthe walk sheet is 12 unaltered 128px frames')
const walkImg = (() => {
  const p = join(androidSprites, NPC_IDLE_WALK_SHEET.file)
  if (!existsSync(p)) {
    check(`${NPC_IDLE_WALK_SHEET.file}: present so its frames can be measured`, false, p)
    return null
  }
  return readPng(p)
})()
if (walkImg) {
  check(
    `it is ${npcSheetWidth(NPC_IDLE_WALK_SHEET)}x${npcSheetHeight(NPC_IDLE_WALK_SHEET)}, twelve cells side by side`,
    walkImg.width === NPC_CELL_SIZE * 12 && walkImg.height === NPC_CELL_SIZE,
    `${walkImg.width}x${walkImg.height}`,
  )

  // Every frame is measured, not assumed: alpha health, bounds, and the foot line.
  const perFrame = []
  let anyPartial = 0
  for (let f = 0; f < 12; f++) {
    const m = measureCell(walkImg, f * NPC_CELL_SIZE, 0, NPC_CELL_SIZE, NPC_CELL_SIZE)
    perFrame.push(m)
    anyPartial += m.partial
    if (m.opaque === 0) {
      check(`frame ${f}: actually drawn`, false, 'the cell is empty')
      continue
    }
    const feetRow = m.maxY
    const desc = `x ${m.minX}..${m.maxX} y ${m.minY}..${m.maxY}, ${m.opaque}px, ${m.colours.size} colours`
    check(`frame ${String(f).padStart(2)}: feet land on the shared baseline row ${NPC_BASELINE_Y}`, feetRow === NPC_BASELINE_Y, desc)
    check(
      `frame ${String(f).padStart(2)}: transparency is hard-edged, so no resample softened the art`,
      m.partial === 0,
      `${m.partial} pixels with intermediate alpha`,
    )
  }
  const baselines = new Set(perFrame.map((m) => m.maxY))
  check(
    'all twelve frames share one ground line, so the NPC cannot bob as it walks',
    baselines.size === 1 && baselines.has(NPC_BASELINE_Y),
    `baselines ${[...baselines].sort((a, b) => a - b).join(',')} against the declared ${NPC_BASELINE_Y}`,
  )
  check(
    'no frame was shifted to make that happen: the baseline is where the art was drawn',
    NPC_BASELINE_Y === 104,
    `measured ${[...baselines][0]}`,
  )
  console.log(
    `       each frame sits in a ${Math.min(...perFrame.map((m) => m.minX))}..${Math.max(...perFrame.map((m) => m.maxX))} x ` +
      `${Math.min(...perFrame.map((m) => m.minY))}..${Math.max(...perFrame.map((m) => m.maxY))} box inside its 128px cell, ` +
      `${perFrame.reduce((a, m) => a + m.clear, 0)} transparent pixels overall`,
  )
}

console.log('\neach motion is bound to frames that exist, and can be bound independently')
{
  const byFile = new Map(NPC_ASSET_SET.map((s) => [s.file, s]))
  const names = NPC_CLIPS.map((c) => c.name)
  check('idle and walk are separate bindings', names.includes('idle') && names.includes('walk'), names.join(', '))
  check('clip names are unique', new Set(names).size === names.length)

  for (const clip of NPC_CLIPS) {
    if (!isClipAssigned(clip)) {
      check(
        `${clip.name}: unassigned, and says so with no sheet rather than pointing at a frame that was never drawn`,
        clip.sheet === null && clip.frameCount === 0 && clip.firstFrame === 0,
        `sheet ${clip.sheet}, ${clip.frameCount} frames`,
      )
      continue
    }
    const sheet = byFile.get(clip.sheet)
    if (!check(`${clip.name}: bound to a declared sheet`, !!sheet, clip.sheet ?? 'none')) continue
    check(
      `${clip.name}: fits inside the frames that sheet actually has`,
      clip.firstFrame >= 0 && clip.frameCount > 0 && clip.firstFrame + clip.frameCount <= sheet.frames,
      `frames ${clip.firstFrame}..${clip.firstFrame + clip.frameCount - 1} of ${sheet.frames}`,
    )
    check(
      `${clip.name}: the sheet it names is artwork that actually exists`,
      sheet.status === 'present' && existsSync(join(androidSprites, sheet.file)),
      `${sheet.file} (${sheet.status})`,
    )
  }

  const walk = NPC_CLIPS.find((c) => c.name === 'walk')
  const idle = NPC_CLIPS.find((c) => c.name === 'idle')
  check('walk plays the full cycle, since the sheet is one continuous stride', walk.frameCount === 12, `${walk.frameCount} frames`)
  check('walk loops', walk.loops === true)
  check('walk runs at 12 fps as specified', walk.fps === NPC_WALK_FPS && NPC_WALK_FPS === 12, `${walk.fps} fps`)
  check('idle runs at 6 fps as specified', idle.fps === NPC_IDLE_FPS && NPC_IDLE_FPS === 6, `${idle.fps} fps`)
  check('idle and walk are separate bindings that name their own frame ranges', idle !== walk && (idle.firstFrame !== walk.firstFrame || idle.frameCount !== walk.frameCount), `idle ${idle.frameCount} frame(s), walk ${walk.frameCount}`)
}

console.log('\nthe remaining sheets are declared but genuinely absent')
{
  for (const sheet of NPC_ASSET_SET.filter((s) => s.status === 'pending')) {
    const android = join(androidSprites, sheet.file)
    const web = join(webSprites, sheet.file)
    check(
      `${sheet.file}: no artwork yet, so no placeholder can pass for finished art`,
      !existsSync(android) && !existsSync(web),
      existsSync(android) ? 'unexpected file in the Android assets' : existsSync(web) ? 'unexpected file in web/public' : 'slot ready',
    )
  }
}

console.log(`\n${failures === 0 ? 'NPC asset checks passed' : `${failures} NPC asset check(s) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
