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
 * One choice inside a part (a coat, an ear shape, an accessory...).
 *
 * `id` feeds the hash that decides who gets this option, so it must never be
 * renamed once released. Adding an option only moves the users who now win
 * it; set `availableFrom` to the next user id to keep every existing cat
 * exactly as it is.
 */
export type MeowOption = {
  id: string
  weight: number
  availableFrom?: number
}

export type ColorOption = MeowOption & { color: string }

export type EarOption = MeowOption & { path: string }

/** Fur colour under the left and right eye. */
export type EyeUnderColors = readonly [string, string]

export type CoatPattern = MeowOption & {
  layer: string
  under: EyeUnderColors
  top?: string
}

export type CoatOption = MeowOption & {
  base: string
  nose: string
  mouth: string
  /** Every colour that can touch the background around the head. */
  edge: readonly string[]
  layer?: string
  front?: string
  under?: EyeUnderColors
  top?: string
  /** Eye look this coat always gets when generated: an eye colour id or 'plain'. */
  forceEyeLook?: string
  noTopAccessory?: boolean
  patterns?: readonly CoatPattern[]
}

export type AccessoryOption = MeowOption & {
  fixedColors?: readonly string[]
  onFace?: boolean
  onTop?: boolean
  furColored?: boolean
}

export type MeowCatalog = {
  coats: readonly CoatOption[]
  ears: readonly EarOption[]
  eyes: readonly MeowOption[]
  eyeColors: readonly ColorOption[]
  mouths: readonly MeowOption[]
  accessories: readonly AccessoryOption[]
  accessoryColors: readonly ColorOption[]
  backgrounds: readonly ColorOption[]
}

/**
 * One cat as part ids. This is what a user's built cat is saved as, so the
 * field names are part of the saved format and must not be renamed.
 * `eyeLeft` / `eyeRight` hold an eye colour id or 'plain'.
 */
export type MeowChoice = {
  coat: string
  pattern: string | null
  ear: string
  eye: string
  eyeLeft: string
  eyeRight: string
  mouth: string
  cheeks: boolean
  accessory: string
  accessoryColor: string
  background: string
}

export type MeowTraits = {
  coat: CoatOption
  pattern: CoatPattern | null
  under: EyeUnderColors
  ear: EarOption
  eye: MeowOption
  eyeColors: readonly [string, string]
  mouth: MeowOption
  cheeks: boolean
  accessory: AccessoryOption
  accessoryColor: string
  background: string
}
