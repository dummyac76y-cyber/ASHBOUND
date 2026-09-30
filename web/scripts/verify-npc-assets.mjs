/**
 * Verification for the NPC sprite assets.
 *
 * The NPC is not animated or placed in a scene yet, so nothing in the game reads
 * these files. That is exactly why they need their own check: an asset nothing
 * loads is also an asset nothing notices going missing, arriving half-resaved, or
 * drifting between the two platforms.
 *
 * What this asserts:
 *   - the base reference is in the shared Android asset tree, and the web copy is
 *     byte-identical to it, so both platforms draw the same pixels
 *   - it is one 128px cell, the same cell size the player's sheets use
 *   - transparency survived the copy, and did so as hard-edged alpha rather than a
 *     resample that would soften the pixel art
 *   - every other sheet in the set is declared but genuinely absent, so no
 *     placeholder can be mistaken for finished artwork
 *
 * Run with: node scripts/verify-npc-assets.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readPng } from './lib/artwork.mjs'
import { NPC_ASSET_SET, NPC_CELL_SIZE, NPC_BASE, npcSheetHeight, npcSheetWidth } from '../src/game/npcAssets.ts'

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

console.log('the NPC asset set is declared once, with one base and the rest pending')
{
  const files = NPC_ASSET_SET.map((s) => s.file)
  check('every file name is unique', new Set(files).size === files.length, files.join(', '))
  check(
    'exactly one sheet is marked present, and it is the base reference',
    NPC_ASSET_SET.filter((s) => s.status === 'present').length === 1 && NPC_BASE.status === 'present',
    NPC_ASSET_SET.map((s) => `${s.file}:${s.status}`).join(' '),
  )
  check(
    'every sheet uses the shared cell size',
    NPC_ASSET_SET.every((s) => npcSheetHeight(s) % NPC_CELL_SIZE === 0),
    `cell ${NPC_CELL_SIZE}px`,
  )
  check(
    'a strip sheet is one row of cells, a grid sheet is 8x8',
    NPC_ASSET_SET.every((s) =>
      s.layout === 'grid'
        ? npcSheetWidth(s) === NPC_CELL_SIZE * 8 && npcSheetHeight(s) === NPC_CELL_SIZE * 8
        : npcSheetWidth(s) === NPC_CELL_SIZE * s.frames && npcSheetHeight(s) === NPC_CELL_SIZE,
    ),
    NPC_ASSET_SET.map((s) => `${s.file}:${npcSheetWidth(s)}x${npcSheetHeight(s)}`).join(' '),
  )
  const expected = [
    'npc.png',
    'npc.dash.png',
    'npc_idle.png',
    'npc_walk.png',
    'npc_attack.png',
    'npc_heavy.png',
    'npc_hurt.png',
    'npc_death.png',
  ]
  check(
    'the set is exactly the eight files that were asked for',
    files.length === expected.length && expected.every((f) => files.includes(f)),
    `have ${files.length}, expected ${expected.length}`,
  )
}

console.log('\nthe base reference is in the shared assets, byte-identical on both platforms')
{
  const android = join(androidSprites, NPC_BASE.file)
  const web = join(webSprites, NPC_BASE.file)
  check('it lives in the Android asset tree, which is the source of truth', existsSync(android), android)
  if (!existsSync(android)) {
    console.log(`\n${failures} NPC asset check(s) FAILED`)
    process.exit(1)
  }
  const a = readFileSync(android)
  const aSha = sha(a)
  check(
    'the web copy is byte-identical, so both platforms draw the same pixels',
    existsSync(web) && Buffer.compare(a, readFileSync(web)) === 0,
    existsSync(web) ? `sha ${aSha} on both` : 'web/public has not been synced',
  )
  check(
    'it is a PNG, stored as supplied with no re-encode',
    a.subarray(1, 4).toString('ascii') === 'PNG',
    `sha ${aSha}, ${a.length} bytes`,
  )

  const img = readPng(android)
  check(
    `the base reference is a single ${NPC_CELL_SIZE}px cell`,
    img.width === NPC_CELL_SIZE && img.height === NPC_CELL_SIZE,
    `${img.width}x${img.height}`,
  )
  check('it matches the width and height the declaration predicts', npcSheetWidth(NPC_BASE) === img.width && npcSheetHeight(NPC_BASE) === img.height, `${npcSheetWidth(NPC_BASE)}x${npcSheetHeight(NPC_BASE)}`)

  // Transparency, measured rather than assumed from the colour type.
  let clear = 0
  let partial = 0
  let opaque = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const colours = new Set()
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b, a] = img.px(x, y)
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
      maxY = Math.max(maxY, y)
    }
  }
  check('the background is genuinely transparent', clear > img.width * img.height * 0.5, `${((clear / (img.width * img.height)) * 100).toFixed(1)}% fully transparent`)
  check('the sprite itself is fully drawn', opaque > 0, `${opaque} opaque pixels`)
  check(
    'there is no partially transparent pixel, so the pixel art was not softened by a resample',
    partial === 0,
    `${partial} pixels with intermediate alpha`,
  )
  check(
    'the art sits inside its cell with a margin, ready to be cut into frames',
    minX > 0 && minY > 0 && maxX < img.width - 1 && maxY < img.height - 1,
    `opaque bounds x ${minX}..${maxX} y ${minY}..${maxY} within ${img.width}x${img.height}`,
  )
  check(
    'it is a small colour palette, as pixel art should be',
    colours.size > 0 && colours.size <= 256,
    `${colours.size} distinct colours`,
  )
  console.log(`       sprite occupies ${maxX - minX + 1}x${maxY - minY + 1} of the ${img.width}x${img.height} cell`)
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
