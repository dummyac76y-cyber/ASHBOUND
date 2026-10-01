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
 * Single source of truth for the world backdrops.
 *
 * Android loads them from res/drawable (see GameWorld.loadArenaBackground) and the
 * web build loads the synced copies, so both platforms render identical pixels from
 * the same file. Each section is one finite environment, so each is a single file
 * rather than a tileable texture.
 */
const BACKGROUNDS = [
  {
    label: 'arena',
    from: join(androidRes, 'res', 'drawable', 'img_arena_bg_hd.png'),
    to: join(webPublic, 'bg', 'arena_bg.png'),
  },
  {
    label: 'cavern',
    from: join(androidRes, 'res', 'drawable', 'img_underground_cavern_hd.png'),
    to: join(webPublic, 'bg', 'cavern_bg.png'),
  },
]

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
      // `.ttf` and `.woff2` are here because the UI font is a supplied asset like any other:
      // it lives in app/src/main/assets/fonts/ so that one copy serves both engines, and the
      // web build can only reference it if it is copied into public/ first. Without this the
      // @font-face URL 404s and the browser silently falls back to a system font, which is
      // exactly the drift this script exists to prevent for images.
    } else if (/\.(png|jpe?g|gif|webp|mp3|ogg|wav|ttf|woff2)$/i.test(entry.name)) {
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

  // 2. World backdrops live in res/drawable on Android.
  //
  // They are pushed into copiedPaths so they get fingerprinted below like every
  // other public asset. Previously they were copied without a fingerprint, so
  // replacing the bytes behind a backdrop left its URL unchanged and any cached
  // copy would keep serving the old section.
  for (const bg of BACKGROUNDS) {
    if (await exists(bg.from)) {
      await mkdir(dirname(bg.to), { recursive: true })
      await cp(bg.from, bg.to)
      copiedPaths.push(relative(webPublic, bg.to).split('\\').join('/'))
      console.log(`[sync-assets] ${relative(repoRoot, bg.to)}`)
    } else {
      console.warn(`[sync-assets] ${bg.label} background not found, that section falls back to flat fill`)
    }
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
