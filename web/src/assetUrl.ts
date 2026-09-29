/**
 * Resolves a public asset to a URL that works from any deploy path.
 *
 * BASE_URL is either './' (relative build) or '/' (domain root) and always ends
 * in a slash, so append to it directly — stripping the slash would turn
 * './ui/btn_attack.png' into a root-absolute '/ui/btn_attack.png' and break
 * sub-path hosting.
 */
const BASE = import.meta.env.BASE_URL

export function assetUrl(path: string): string {
  return `${BASE}${path.replace(/^\//, '')}`
}
