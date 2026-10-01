import manifest from './generated/asset-manifest.json'

/**
 * Resolves a public asset to a cache-safe URL that works from any deploy path.
 *
 * BASE_URL is either './' (relative build) or '/' (domain root) and always ends
 * in a slash, so append to it directly — stripping the slash would turn
 * './ui/btn_attack.png' into a root-absolute '/ui/btn_attack.png' and break
 * sub-path hosting.
 *
 * Public asset filenames are stable, so editing the bytes behind one leaves the
 * URL unchanged and caches keep serving the old file. Each path therefore gets a
 * `?v=` fingerprint generated from its content by scripts/sync-assets.mjs, which
 * makes the URL change exactly when the image does. Paths missing from the
 * manifest (none in normal builds) are passed through unchanged.
 */
const BASE = import.meta.env.BASE_URL

type AssetManifest = Record<string, string>

const FINGERPRINTS = manifest as AssetManifest

export function assetUrl(path: string): string {
  const rel = path.replace(/^\//, '')
  const key = `./${rel}`
  const version = FINGERPRINTS[key]
  const url = `${BASE}${rel}`
  return version ? `${url}?v=${version}` : url
}

/**
 * Whether a public asset was actually installed, decided from the fingerprint manifest
 * rather than by asking the server.
 *
 * The manifest is written by scripts/sync-assets.mjs from the files that exist, so a path
 * absent from it is a path that would 404. That matters for anything optional: the audio
 * bank is catalogued in full while most of its files are not present yet, and fetching each
 * one to discover that turns twelve absent sounds into twelve 404s on every page load --
 * noise in the console, and a hole in the verify-main-menu harness that asserts a clean
 * request log.
 *
 * Only trustworthy for files that sync-assets.mjs copies, which is every asset in this
 * project. Anything else should fall back to requesting it and handling the failure.
 */
export function hasAsset(path: string): boolean {
  return Object.hasOwn(FINGERPRINTS, `./${path.replace(/^\//, '')}`)
}

/**
 * The path the UI font lives at, as one string for both engines to agree on.
 *
 * Declared here rather than in the stylesheet because the stylesheet cannot reach the
 * fingerprint manifest: a plain `url(/fonts/Pixelta.ttf)` is a fixed URL, so swapping the
 * bytes behind the font leaves the request identical and every cache keeps serving the old
 * file. Everything else in the game resolves through `assetUrl` for the same reason.
 */
export const UI_FONT_FILE = 'fonts/Pixelta.ttf'

/** The font's family name as declared inside the file, which is what a browser matches on. */
export const UI_FONT_FAMILY = 'Pixelta'
