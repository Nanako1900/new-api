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
/**
 * Evenly spaced axis ticks from 0 up to at least `max`, on round steps
 * (1, 2, 2.5 or 5 times a power of ten). Returns [0] when there is no data.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]
  const rough = max / count
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  let step = 10 * power
  for (const nice of [1, 2, 2.5, 5]) {
    if (fraction <= nice) {
      step = nice * power
      break
    }
  }
  const steps = Math.ceil(max / step - 1e-9)
  return Array.from({ length: steps + 1 }, (_, index) =>
    Number((index * step).toPrecision(12))
  )
}
