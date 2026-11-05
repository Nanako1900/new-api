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

import {
  checkinStreak,
  lastSevenDays,
  monthGrid,
  toDateKey,
  toMonthKey,
} from '../lib/meow-checkin'

const TODAY = new Date(2026, 10, 3) // 2026-11-03

test('date and month keys are zero-padded like the check-in API', () => {
  expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  expect(toMonthKey(new Date(2026, 0, 5))).toBe('2026-01')
})

test('last seven days run oldest first, end today and cross month starts', () => {
  const keys = lastSevenDays(TODAY).map(toDateKey)
  expect(keys).toHaveLength(7)
  expect(keys[0]).toBe('2026-10-28')
  expect(keys[6]).toBe('2026-11-03')
})

test('streak counts back from today when today is checked in', () => {
  const checked = new Set(['2026-11-03', '2026-11-02', '2026-10-31'])
  expect(checkinStreak(TODAY, checked)).toBe(2)
})

test('streak counts back from yesterday when today is not checked in yet', () => {
  const checked = new Set(['2026-11-02', '2026-11-01', '2026-10-31'])
  expect(checkinStreak(TODAY, checked)).toBe(3)
})

test('streak is zero with no recent check-ins', () => {
  expect(checkinStreak(TODAY, new Set(['2026-10-20']))).toBe(0)
})

test('month grid starts on Sunday and pads to whole weeks', () => {
  // November 2026 starts on a Sunday and has 30 days.
  const cells = monthGrid(new Date(2026, 10, 15))
  expect(cells).toHaveLength(35)
  expect(toDateKey(cells[0].date)).toBe('2026-11-01')
  expect(cells.filter((cell) => cell.inMonth)).toHaveLength(30)
  expect(cells.at(-1)?.inMonth).toBe(false)
})

test('month grid adds leading days from the previous month', () => {
  // October 2026 starts on a Thursday.
  const cells = monthGrid(new Date(2026, 9, 1))
  expect(toDateKey(cells[0].date)).toBe('2026-09-27')
  expect(cells[0].inMonth).toBe(false)
  expect(toDateKey(cells[4].date)).toBe('2026-10-01')
})
