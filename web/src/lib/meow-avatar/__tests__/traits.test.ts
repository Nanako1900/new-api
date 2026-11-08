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

import { MEOW_CATALOG } from '../catalog'
import { MIN_CONTRAST, colorDistance } from '../color'
import { renderMeowAvatar } from '../render'
import { generateMeowTraits, getBackgroundAvoidColors } from '../traits'
import type { CoatOption, MeowCatalog } from '../types'

const USER_IDS = Array.from({ length: 400 }, (_, index) => String(index + 1))

function drawCat(seed: string, catalog: MeowCatalog = MEOW_CATALOG): string {
  return renderMeowAvatar(generateMeowTraits(seed, catalog))
}

describe('generateMeowTraits stability', () => {
  test('the same user id always draws the same cat', () => {
    expect(drawCat('42')).toBe(drawCat('42'))
  })

  test('adding an accessory only changes the users who now wear it', () => {
    const withScarf: MeowCatalog = {
      ...MEOW_CATALOG,
      accessories: [
        ...MEOW_CATALOG.accessories,
        { id: 'test-scarf', weight: 6 },
      ],
    }

    let wearers = 0
    for (const seed of USER_IDS) {
      const after = generateMeowTraits(seed, withScarf)
      if (after.accessory.id === 'test-scarf') {
        wearers++
        continue
      }
      expect(drawCat(seed, withScarf)).toBe(drawCat(seed))
    }
    expect(wearers).toBeGreaterThan(0)
  })

  test('a coat with availableFrom leaves every older user unchanged', () => {
    const newCoat: CoatOption = {
      id: 'test-coat',
      weight: 1e9,
      availableFrom: 1000,
      base: '#7B61FF',
      nose: '#FFFFFF',
      mouth: '#FFFFFF',
      under: ['#7B61FF', '#7B61FF'],
      edge: ['#7B61FF'],
    }
    const withCoat: MeowCatalog = {
      ...MEOW_CATALOG,
      coats: [...MEOW_CATALOG.coats, newCoat],
    }

    for (const seed of USER_IDS) {
      expect(drawCat(seed, withCoat)).toBe(drawCat(seed))
    }
    expect(generateMeowTraits('1000', withCoat).coat.id).toBe('test-coat')
  })
})

describe('generateMeowTraits colours', () => {
  test('the background stays clear of the fur and accessory colours', () => {
    for (const seed of USER_IDS) {
      const traits = generateMeowTraits(seed)
      for (const color of getBackgroundAvoidColors(traits)) {
        expect(colorDistance(color, traits.background)).toBeGreaterThanOrEqual(
          MIN_CONTRAST
        )
      }
    }
  })

  test('solid eyes stay visible on the fur below them', () => {
    for (const seed of USER_IDS) {
      const traits = generateMeowTraits(seed)
      expect(
        colorDistance(traits.eyeColors[0], traits.under[0])
      ).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(
        colorDistance(traits.eyeColors[1], traits.under[1])
      ).toBeGreaterThanOrEqual(MIN_CONTRAST)
    }
  })

  test('the alien cat never gets an accessory that covers its antennae', () => {
    const alienOnly: MeowCatalog = {
      ...MEOW_CATALOG,
      coats: MEOW_CATALOG.coats.filter((coat) => coat.id === 'alien'),
    }
    for (const seed of USER_IDS) {
      expect(generateMeowTraits(seed, alienOnly).accessory.onTop).not.toBe(true)
    }
  })
})
