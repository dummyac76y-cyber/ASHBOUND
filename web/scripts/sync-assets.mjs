import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const androidRes = join(repoRoot, 'app', 'src', 'main')
const webPublic = join(repoRoot, 'web', 'public')

/**
 * Single source of truth for the arena backdrop.
 *
 * Android loads it from res/drawable (see GameWorld.loadArenaBackground) and the
 * web build loads the synced copy, so both platforms render identical pixels.
 */
const BACKGROUND = {
  from: join(androidRes, 'res', 'drawable', 'img_arena_bg_hd.png'),
  to: join(webPublic, 'bg', 'arena_bg.png'),
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function syncDir(from, to) {
  if (!(await exists(from))) {
    console.warn(`[sync-assets] missing source directory, skipped: ${relative(repoRoot, from)}`)
    return 0
  }
  await mkdir(to, { recursive: true })
  const entries = await readdir(from, { withFileTypes: true })
  let copied = 0
  for (const entry of entries) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) {
      copied += await syncDir(src, dst)
    } else if (/\.(png|jpe?g|gif|webp|mp3|ogg|wav)$/i.test(entry.name)) {
      await mkdir(dirname(dst), { recursive: true })
      await cp(src, dst)
      copied++
    }
  }
  return copied
}

async function main() {
  // 1. app/src/main/assets/** -> web/public/  (sprites/, etc.)
  const assetCount = await syncDir(join(androidRes, 'assets'), webPublic)

  // 2. Arena backdrop lives in res/drawable on Android.
  if (await exists(BACKGROUND.from)) {
    await mkdir(dirname(BACKGROUND.to), { recursive: true })
    await cp(BACKGROUND.from, BACKGROUND.to)
    console.log(`[sync-assets] ${relative(repoRoot, BACKGROUND.to)}`)
  } else {
    console.warn(`[sync-assets] arena background not found, web will render the gradient fallback`)
  }

  console.log(`[sync-assets] ${assetCount} asset file(s) synced from ${relative(repoRoot, androidRes)}/assets`)
}

main().catch((err) => {
  console.error('[sync-assets] failed:', err)
  process.exit(1)
})
