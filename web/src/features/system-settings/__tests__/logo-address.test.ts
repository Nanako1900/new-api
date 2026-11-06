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
import { describe, expect, test } from 'vitest'

import { isValidLogoAddress } from '../general/logo-address'

describe('logo address', () => {
  test('a path on this site is accepted, so a bundled image needs no separate host', () => {
    for (const value of [
      '/meow-logo.svg',
      '/logo.png',
      '/brand/logo.svg?v=2',
    ]) {
      expect(isValidLogoAddress(value), value).toBe(true)
    }
  })

  test('an empty value or an absolute URL keeps working as before', () => {
    for (const value of [
      '',
      'https://cdn.example.com/logo.png',
      'http://localhost:3000/logo.png',
    ]) {
      expect(isValidLogoAddress(value), value).toBe(true)
    }
  })

  test('a path that resolves to another host or is not a URL is rejected', () => {
    for (const value of [
      'meow-logo.svg',
      '//evil.example.com/logo.png',
      '/\\evil.example.com/logo.png',
      ' /meow-logo.svg',
      '/meow-logo.svg ',
      'https://',
    ]) {
      expect(isValidLogoAddress(value), value).toBe(false)
    }
  })
})
