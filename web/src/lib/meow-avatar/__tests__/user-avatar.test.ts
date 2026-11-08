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

import {
  defaultMeowChoice,
  getMeowAvatarUrl,
  getUserAvatarUrl,
  meowChoiceFromConfig,
  meowChoiceToConfig,
  readUserAvatar,
} from '..'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('readUserAvatar', () => {
  test('a saved upload in setting JSON text is read back', () => {
    const setting = JSON.stringify({
      language: 'en',
      avatar: { kind: 'upload', image: PNG },
    })

    expect(readUserAvatar(setting)).toEqual({ kind: 'upload', image: PNG })
  })

  test.each([
    ['an SVG data URL', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['a remote URL', 'https://example.com/cat.png'],
  ])('an upload pointing at %s is ignored', (_, image) => {
    expect(readUserAvatar({ avatar: { kind: 'upload', image } })).toBeNull()
  })

  test('broken setting text gives no avatar', () => {
    expect(readUserAvatar('{not json')).toBeNull()
  })
})

describe('built cat config', () => {
  test('a cat survives being saved and read back', () => {
    const choice = {
      ...defaultMeowChoice(42),
      cheeks: true,
      accessory: 'pixel',
    }

    expect(
      meowChoiceFromConfig(meowChoiceToConfig(choice), defaultMeowChoice(1))
    ).toEqual(choice)
  })

  test('parts the saved config leaves out keep the default', () => {
    const fallback = defaultMeowChoice(5)

    expect(meowChoiceFromConfig({ ear: 'tilt' }, fallback)).toEqual({
      ...fallback,
      ear: 'tilt',
    })
  })
})

describe('getUserAvatarUrl', () => {
  test('a user without a picked avatar gets the default cat', () => {
    expect(getUserAvatarUrl(9, '{}')).toBe(getMeowAvatarUrl(9))
  })

  test('an uploaded picture is shown as is', () => {
    expect(
      getUserAvatarUrl(9, { avatar: { kind: 'upload', image: PNG } })
    ).toBe(PNG)
  })

  test('a built cat differs from the default cat', () => {
    const setting = {
      avatar: { kind: 'cat', cat: { coat: 'alien', accessory: 'banana' } },
    }

    expect(getUserAvatarUrl(9, setting)).not.toBe(getMeowAvatarUrl(9))
  })
})
