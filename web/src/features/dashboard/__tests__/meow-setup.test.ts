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

import { greetingFor, healthBadge, splitAroundName } from '../lib/meow-setup'

test.each([
  [4, 'evening'],
  [5, 'morning'],
  [11, 'morning'],
  [12, 'afternoon'],
  [17, 'afternoon'],
  [18, 'evening'],
] as const)('hour %i greets with %s', (hour, expected) => {
  expect(greetingFor(hour)).toBe(expected)
})

test('splitAroundName returns the text before and after the name', () => {
  const parts = splitAroundName((name) => `下午好，${name}！`)
  expect(parts).toEqual({ before: '下午好，', after: '！' })
})

test('splitAroundName keeps the whole text when a locale drops the name', () => {
  expect(splitAroundName(() => 'Hello')).toEqual({ before: 'Hello', after: '' })
})

test.each([
  ['excellent', 'healthy'],
  ['good', 'healthy'],
  ['warning', 'degraded'],
  ['critical', 'unstable'],
  ['unknown', 'unknown'],
] as const)('healthBadge maps %s to %s', (level, badge) => {
  expect(healthBadge(level)).toBe(badge)
})
