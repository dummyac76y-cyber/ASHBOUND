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
