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

import { getMeowAvatarUrl } from '..'

test('a valid user id gives an inline SVG image url', () => {
  const url = getMeowAvatarUrl(7)

  expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  expect(decodeURIComponent(url ?? '')).toContain(
    '<svg xmlns="http://www.w3.org/2000/svg"'
  )
})

test('different user ids give different cats', () => {
  expect(getMeowAvatarUrl(1)).not.toBe(getMeowAvatarUrl(2))
})

test.each([undefined, null, 0, -3, 1.5, Number.NaN])(
  'an invalid user id (%s) gives no url so the initials fallback shows',
  (userId) => {
    expect(getMeowAvatarUrl(userId)).toBeUndefined()
  }
)
