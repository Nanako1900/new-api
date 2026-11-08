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
import { MEOW_CATALOG } from './catalog'
import {
  INK,
  MIN_CONTRAST,
  WHITE,
  colorDistance,
  isDark,
  legibleOn,
} from './color'
import { chance, pickOption } from './pick'
import type {
  AccessoryOption,
  CoatOption,
  EyeUnderColors,
  MeowCatalog,
  MeowChoice,
  MeowOption,
  MeowTraits,
} from './types'

/** Eye look that keeps the default dark (or white) eyes. */
export const PLAIN_EYE = 'plain'

function contrastsWithAll(
  color: string,
  others: readonly string[],
  min: number
): boolean {
  return others.every((other) => colorDistance(color, other) >= min)
}

/** Returns the option with this id, or the first option for an unknown id. */
function findOption<T extends MeowOption>(
  options: readonly T[],
  id: string | null | undefined
): T {
  return options.find((option) => option.id === id) ?? options[0]
}

function coatUnder(coat: CoatOption, patternId: string | null): EyeUnderColors {
  if (coat.patterns) return findOption(coat.patterns, patternId).under
  return coat.under ?? [coat.base, coat.base]
}

function fitsCoat(accessory: AccessoryOption, coat: CoatOption): boolean {
  if (coat.noTopAccessory && accessory.onTop) return false
  if (!accessory.fixedColors) return true
  return accessory.fixedColors.every((color) =>
    contrastsWithAll(color, coat.edge, 70)
  )
}

/**
 * Colours the background has to stay clear of: the fur around the head and
 * any accessory colour that sits on the background.
 */
export function getBackgroundAvoidColors(
  traits: Pick<MeowTraits, 'coat' | 'accessory' | 'accessoryColor'>
): readonly string[] {
  const accessory = traits.accessory
  if (accessory.id === 'none' || accessory.onFace || accessory.furColored) {
    return traits.coat.edge
  }
  return [
    ...traits.coat.edge,
    ...(accessory.fixedColors ?? [traits.accessoryColor]),
  ]
}

function pickBackgroundId(
  seed: string,
  catalog: MeowCatalog,
  avoid: readonly string[],
  userId: number | null
): string {
  const clear = catalog.backgrounds.filter((bg) =>
    contrastsWithAll(bg.color, avoid, MIN_CONTRAST)
  )
  const picked = pickOption(seed, 'background', clear, userId)
  if (picked) return picked.id
  let best = catalog.backgrounds[0]
  let bestGap = -1
  for (const bg of catalog.backgrounds) {
    const gap = Math.min(
      ...avoid.map((color) => colorDistance(color, bg.color))
    )
    if (gap > bestGap) {
      bestGap = gap
      best = bg
    }
  }
  return best.id
}

function pickEyeLooks(
  seed: string,
  coat: CoatOption,
  catalog: MeowCatalog,
  userId: number | null
): [string, string] {
  // Plain eyes, each solid colour and odd eyes are equally likely.
  const looks: readonly MeowOption[] = [
    { id: PLAIN_EYE, weight: 1 },
    ...catalog.eyeColors,
    { id: 'odd', weight: 1 },
  ]
  const look = pickOption(seed, 'eye-look', looks, userId)?.id ?? PLAIN_EYE
  if (look !== 'odd') {
    const both = coat.forceEyeLook ?? look
    return [both, both]
  }
  const left =
    coat.forceEyeLook ??
    pickOption(seed, 'eye-odd', catalog.eyeColors, userId)?.id ??
    PLAIN_EYE
  const others = catalog.eyeColors.filter((option) => option.id !== left)
  const right = pickOption(seed, 'eye-odd-other', others, userId)?.id ?? left
  return [left, right]
}

/**
 * Picks every part of one user's cat as ids. Each part hashes the seed with
 * its own key, so changing the options of one part leaves the others alone.
 */
export function chooseMeowParts(
  seed: string,
  catalog: MeowCatalog = MEOW_CATALOG
): MeowChoice {
  const numericId = Number(seed)
  const userId = Number.isInteger(numericId) ? numericId : null
  const coat =
    pickOption(seed, 'coat', catalog.coats, userId) ?? catalog.coats[0]
  const pattern = coat.patterns
    ? (pickOption(seed, `coat:${coat.id}`, coat.patterns, userId) ??
      coat.patterns[0])
    : null
  const accessory =
    pickOption(
      seed,
      'accessory',
      catalog.accessories.filter((option) => fitsCoat(option, coat)),
      userId
    ) ?? catalog.accessories[0]
  const accessoryColor =
    pickOption(
      seed,
      'accessory-color',
      catalog.accessoryColors.filter((option) =>
        contrastsWithAll(option.color, coat.edge, MIN_CONTRAST)
      ),
      userId
    ) ?? catalog.accessoryColors[0]
  const [eyeLeft, eyeRight] = pickEyeLooks(seed, coat, catalog, userId)
  const avoid = getBackgroundAvoidColors({
    coat,
    accessory,
    accessoryColor: accessoryColor.color,
  })

  return {
    coat: coat.id,
    pattern: pattern?.id ?? null,
    ear: (pickOption(seed, 'ear', catalog.ears, userId) ?? catalog.ears[0]).id,
    eye: (pickOption(seed, 'eye', catalog.eyes, userId) ?? catalog.eyes[0]).id,
    eyeLeft,
    eyeRight,
    mouth: (
      pickOption(seed, 'mouth', catalog.mouths, userId) ?? catalog.mouths[0]
    ).id,
    cheeks: chance(seed, 'cheeks', 0.5),
    accessory: accessory.id,
    accessoryColor: accessoryColor.id,
    background: pickBackgroundId(seed, catalog, avoid, userId),
  }
}

/** Resolves a choice of part ids into drawable parts; unknown ids fall back. */
export function buildMeowTraits(
  choice: MeowChoice,
  catalog: MeowCatalog = MEOW_CATALOG
): MeowTraits {
  const coat = findOption(catalog.coats, choice.coat)
  const pattern = coat.patterns
    ? findOption(coat.patterns, choice.pattern)
    : null
  const under = coatUnder(coat, pattern?.id ?? null)
  const eyeColor = (look: string, fur: string): string => {
    const option = catalog.eyeColors.find((color) => color.id === look)
    if (!option) return isDark(fur) ? WHITE : INK
    return legibleOn(option.color, fur)
  }

  return {
    coat,
    pattern,
    under,
    ear: findOption(catalog.ears, choice.ear),
    eye: findOption(catalog.eyes, choice.eye),
    eyeColors: [
      eyeColor(choice.eyeLeft, under[0]),
      eyeColor(choice.eyeRight, under[1]),
    ],
    mouth: findOption(catalog.mouths, choice.mouth),
    cheeks: choice.cheeks,
    accessory: findOption(catalog.accessories, choice.accessory),
    accessoryColor: findOption(catalog.accessoryColors, choice.accessoryColor)
      .color,
    background: findOption(catalog.backgrounds, choice.background).color,
  }
}

export function generateMeowTraits(
  seed: string,
  catalog: MeowCatalog = MEOW_CATALOG
): MeowTraits {
  return buildMeowTraits(chooseMeowParts(seed, catalog), catalog)
}
