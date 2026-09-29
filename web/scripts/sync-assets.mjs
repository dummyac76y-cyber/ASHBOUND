import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const androidRes = join(repoRoot, 'app', 'src', 'main')
const webPublic = join(repoRoot, 'web', 'public')

/** Generated content-fingerprint map, consumed by src/assetUrl.ts. */
const ASSET_MANIFEST = join(repoRoot, 'web', 'src', 'generated', 'asset-manifest.json')

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

async function syncDir(from, to, copiedPaths = []) {
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
      copied += await syncDir(src, dst, copiedPaths)
    } else if (/\.(png|jpe?g|gif|webp|mp3|ogg|wav)$/i.test(entry.name)) {
      await mkdir(dirname(dst), { recursive: true })
      await cp(src, dst)
      // Record the public-relative path so it can be fingerprinted below.
      copiedPaths.push(relative(webPublic, dst).split('\\').join('/'))
      copied++
    }
  }
  return copied
}

async function main() {
  // 1. app/src/main/assets/** -> web/public/  (sprites/, etc.)
  //
  // These live outside web/, so this only works when the whole repository is the
  // build root. On Vercel that means Project Settings > Root Directory must be
  // left empty (or set to the repo root), NOT "web". Fail loudly rather than
  // shipping a build with no sprites.
  const assetsSource = join(androidRes, 'assets')
  if (!(await exists(assetsSource))) {
    console.error(
      '[sync-assets] FATAL: could not find app/src/main/assets relative to this script.\n' +
        '               The web build needs the Android art as its source of truth.\n' +
        '               On Vercel, set Project Settings > Root Directory to the repository root\n' +
        '               (leave it blank) — do not set it to "web".',
    )
    process.exit(1)
  }

  const copiedPaths = []
  const assetCount = await syncDir(assetsSource, webPublic, copiedPaths)
  if (assetCount === 0) {
    console.error('[sync-assets] FATAL: no asset files found under app/src/main/assets')
    process.exit(1)
  }

  // 2. Arena backdrop lives in res/drawable on Android.
  if (await exists(BACKGROUND.from)) {
    await mkdir(dirname(BACKGROUND.to), { recursive: true })
    await cp(BACKGROUND.from, BACKGROUND.to)
    console.log(`[sync-assets] ${relative(repoRoot, BACKGROUND.to)}`)
  } else {
    console.warn(`[sync-assets] arena background not found, web will render the gradient fallback`)
  }

  // 3. Content fingerprints for every synced public asset.
  //
  // The asset filenames are stable, so swapping the bytes behind one (for example
  // permuting the button icons) leaves the requested URL identical and any
  // cache - browser, CDN or Vercel edge - keeps serving the old image. Appending
  // a short content hash as a query string makes the URL change exactly when the
  // bytes change, so a new build can never be served stale artwork.
  const manifest = {}
  for (const rel of [...copiedPaths].sort()) {
    const buf = await readFile(join(webPublic, rel))
    manifest[`./${rel}`] = createHash('sha256').update(buf).digest('hex').slice(0, 8)
  }
  await mkdir(dirname(ASSET_MANIFEST), { recursive: true })
  await writeFile(ASSET_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(
    `[sync-assets] ${Object.keys(manifest).length} asset fingerprint(s) written to ${relative(repoRoot, ASSET_MANIFEST)}`,
  )

  console.log(`[sync-assets] ${assetCount} asset file(s) synced from ${relative(repoRoot, androidRes)}/assets`)
}

main().catch((err) => {
  console.error('[sync-assets] failed:', err)
  process.exit(1)
})
