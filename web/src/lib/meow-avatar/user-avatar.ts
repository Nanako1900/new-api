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
import { renderMeowAvatar } from './render'
import { buildMeowTraits, chooseMeowParts } from './traits'
import type { MeowChoice } from './types'

/** The avatar a user picked, as stored in `setting.avatar` on the server. */
export type UserAvatar =
  | { kind: 'cat'; cat: Record<string, string> }
  | { kind: 'upload'; image: string }

// Only raster data URLs are ever shown; anything else falls back to the cat.
const UPLOAD_IMAGE_PATTERN =
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

const CHOICE_TEXT_PARTS = [
  'coat',
  'ear',
  'eye',
  'eyeLeft',
  'eyeRight',
  'mouth',
  'accessory',
  'accessoryColor',
  'background',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the picked avatar from a user's `setting` (JSON text or object). */
export function readUserAvatar(setting: unknown): UserAvatar | null {
  let parsed: unknown = setting
  if (typeof setting === 'string') {
    try {
      parsed = JSON.parse(setting)
    } catch {
      return null
    }
  }
  if (!isRecord(parsed) || !isRecord(parsed.avatar)) return null
  const avatar = parsed.avatar
  if (avatar.kind === 'upload' && typeof avatar.image === 'string') {
    return UPLOAD_IMAGE_PATTERN.test(avatar.image)
      ? { kind: 'upload', image: avatar.image }
      : null
  }
  if (avatar.kind === 'cat' && isRecord(avatar.cat)) {
    const cat: Record<string, string> = {}
    for (const [part, id] of Object.entries(avatar.cat)) {
      if (typeof id === 'string') cat[part] = id
    }
    return { kind: 'cat', cat }
  }
  return null
}

/** The saved form of a built cat. */
export function meowChoiceToConfig(choice: MeowChoice): Record<string, string> {
  const config: Record<string, string> = {}
  for (const part of CHOICE_TEXT_PARTS) config[part] = choice[part]
  if (choice.pattern) config.pattern = choice.pattern
  config.cheeks = choice.cheeks ? 'on' : 'off'
  return config
}

/** Reads a saved cat; parts it does not mention keep the fallback's value. */
export function meowChoiceFromConfig(
  config: Record<string, string>,
  fallback: MeowChoice
): MeowChoice {
  const choice: MeowChoice = { ...fallback }
  for (const part of CHOICE_TEXT_PARTS) {
    if (config[part]) choice[part] = config[part]
  }
  if (config.pattern) choice.pattern = config.pattern
  if (config.cheeks) choice.cheeks = config.cheeks === 'on'
  return choice
}

export function meowChoiceToUrl(choice: MeowChoice): string {
  const svg = renderMeowAvatar(buildMeowTraits(choice))
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** The default cat of a user id, as part ids (for editing). */
export function defaultMeowChoice(userId: number): MeowChoice {
  return chooseMeowParts(String(userId))
}

/** A random cat that does not depend on any user. */
export function randomMeowChoice(): MeowChoice {
  const bytes = new Uint32Array(2)
  crypto.getRandomValues(bytes)
  return chooseMeowParts(`random:${bytes[0]}:${bytes[1]}`)
}
