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
import type { TFunction } from 'i18next'

export type PartLabels = Record<string, string>

/** Names of every cat part option, read by screen readers and shown as tooltips. */
export function getPartLabels(t: TFunction): Record<string, PartLabels> {
  return {
    coat: {
      calico: t('Calico'),
      orange: t('Orange tabby'),
      'orange-white': t('Orange and white'),
      black: t('Black'),
      white: t('White'),
      tuxedo: t('Tuxedo'),
      tabby: t('Brown tabby'),
      blue: t('Blue'),
      siamese: t('Siamese'),
      tortoiseshell: t('Tortoiseshell'),
      cream: t('Cream'),
      alien: t('Alien'),
    },
    pattern: {
      logo: t('Logo patches'),
      mirror: t('Mirrored patches'),
      ears: t('Patched ears'),
      side: t('Side patch'),
      forehead: t('Forehead patch'),
    },
    ear: {
      soft: t('Soft pointed'),
      round: t('Round'),
      big: t('Big round'),
      tall: t('Tall'),
      out: t('Outward'),
      tuft: t('Tufted'),
      tilt: t('Tilted'),
    },
    eye: {
      oval: t('Oval'),
      big: t('Big'),
      round: t('Round'),
      small: t('Small'),
      happy: t('Smiling'),
      sleepy: t('Sleepy'),
      wink: t('Wink'),
      tear: t('Teary'),
      heart: t('Hearts'),
      star: t('Stars'),
    },
    eyeColor: {
      plain: t('Plain'),
      amber: t('Amber'),
      green: t('Green'),
      blue: t('Blue'),
    },
    mouth: {
      none: t('No mouth'),
      w: t('Cat mouth'),
      smile: t('Smile'),
      blep: t('Tongue out'),
      open: t('Open mouth'),
    },
    accessory: {
      none: t('None'),
      bow: t('Bow'),
      flower: t('Flower'),
      glasses: t('Round glasses'),
      leaf: t('Leaf'),
      star: t('Star clip'),
      party: t('Party hat'),
      crown: t('Crown'),
      phones: t('Headphones'),
      code: t('Code clip'),
      tie: t('Bow tie'),
      shades: t('Sunglasses'),
      beanie: t('Beanie'),
      collar: t('Bell collar'),
      aid: t('Bandage'),
      ahoge: t('Hair curl'),
      heart: t('Heart clip'),
      halo: t('Halo'),
      horns: t('Little horns'),
      fish: t('Fish snack'),
      pixel: t('Pixel shades'),
      banana: t('Banana hood'),
      duck: t('Rubber duck'),
      think: t('Thought bubble'),
      huh: t('Question mark'),
      sweat: t('Sweat drop'),
      'glasses-3d': t('3D glasses'),
    },
    accessoryColor: {
      red: t('Red'),
      orange: t('Orange'),
      blue: t('Blue'),
      green: t('Green'),
      pink: t('Pink'),
      yellow: t('Yellow'),
      purple: t('Purple'),
      ink: t('Black'),
    },
    background: {
      apricot: t('Apricot'),
      matcha: t('Matcha'),
      mint: t('Mint'),
      mist: t('Mist blue'),
      lavender: t('Lavender'),
      rose: t('Rose'),
      mustard: t('Mustard'),
      cream: t('Cream'),
      celadon: t('Celadon'),
      oat: t('Oat'),
      calico: t('Calico orange'),
    },
  }
}
