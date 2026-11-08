/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { MeowOption } from './types'

const SALT = 'meow-avatar:v1'

/** cyrb53: a fast 53-bit string hash with good spread. */
function hash53(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** A stable number in (0, 1) for one seed and one key. */
export function unitHash(seed: string, key: string): number {
  return (hash53(`${SALT}:${seed}:${key}`) + 0.5) / 2 ** 53
}

export function chance(
  seed: string,
  key: string,
  probability: number
): boolean {
  return unitHash(seed, key) < probability
}

function isAvailable(option: MeowOption, userId: number | null): boolean {
  if (option.availableFrom == null) return true
  return userId != null && userId >= option.availableFrom
}

/**
 * Weighted rendezvous hashing: every option draws its own score from the seed
 * and the lowest score wins, with odds proportional to `weight`. Each score
 * only depends on that option, so adding or removing an option never changes
 * who wins among the others.
 */
export function pickOption<T extends MeowOption>(
  seed: string,
  part: string,
  options: readonly T[],
  userId: number | null
): T | undefined {
  let winner: T | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (const option of options) {
    if (option.weight <= 0 || !isAvailable(option, userId)) continue
    const score =
      -Math.log(unitHash(seed, `${part}:${option.id}`)) / option.weight
    if (score < bestScore) {
      bestScore = score
      winner = option
    }
  }
  return winner
}
