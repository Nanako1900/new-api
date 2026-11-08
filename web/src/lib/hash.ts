/**
 * Fast non-cryptographic 32-bit string hash, base36 encoded. Fingerprints
 * user-visible content in client-side read and dismiss state.
 */
export function hashString(input: string): string {
  let hash = 0
  if (!input) return '0'

  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}
