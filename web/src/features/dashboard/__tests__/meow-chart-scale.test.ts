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
import { expect, test } from 'vitest'

import { niceTicks } from '../lib/meow-chart-scale'

test('ticks start at zero and reach at least the maximum', () => {
  const ticks = niceTicks(7.62)
  expect(ticks[0]).toBe(0)
  expect(ticks.at(-1)).toBeGreaterThanOrEqual(7.62)
})

test('ticks use round steps', () => {
  expect(niceTicks(7.62)).toEqual([0, 2, 4, 6, 8])
  expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100])
})

test('small amounts get small round steps without float noise', () => {
  expect(niceTicks(0.013)).toEqual([0, 0.005, 0.01, 0.015])
})

test('no data gives a single zero tick', () => {
  expect(niceTicks(0)).toEqual([0])
  expect(niceTicks(Number.NaN)).toEqual([0])
})
