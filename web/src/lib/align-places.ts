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

/** A formatted number's characters before and from its last '.'. */
function splitAtPoint(text: string): [string[], string[]] {
  const point = text.lastIndexOf('.')
  if (point === -1) return [[...text], []]
  const whole = text.slice(0, point)
  const decimals = text.slice(point)
  return [[...whole], [...decimals]]
}

/**
 * Pairs the characters of two formatted numbers place by place: whole
 * parts lined up from the right, decimals from the point. Amounts may drop
 * trailing zeros ($127.4 vs $127.13), so lining up whole strings from the
 * right would shift every place. Returns [next, previous] pairs, '' where
 * one side has no character. Used by `RollingNumber`.
 */
export function alignPlaces(
  next: string,
  previous: string
): Array<[string, string]> {
  const [nextWhole, nextDecimals] = splitAtPoint(next)
  const [previousWhole, previousDecimals] = splitAtPoint(previous)
  const pairs: Array<[string, string]> = []
  const wholeWidth = Math.max(nextWhole.length, previousWhole.length)
  for (let i = 0; i < wholeWidth; i++) {
    pairs.push([
      nextWhole[nextWhole.length - wholeWidth + i] ?? '',
      previousWhole[previousWhole.length - wholeWidth + i] ?? '',
    ])
  }
  const decimalWidth = Math.max(nextDecimals.length, previousDecimals.length)
  for (let i = 0; i < decimalWidth; i++) {
    pairs.push([nextDecimals[i] ?? '', previousDecimals[i] ?? ''])
  }
  return pairs
}
