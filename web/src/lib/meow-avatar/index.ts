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
import {
  defaultMeowChoice,
  meowChoiceFromConfig,
  meowChoiceToUrl,
  readUserAvatar,
} from './user-avatar'

export { MEOW_CATALOG } from './catalog'
export {
  buildMeowTraits,
  chooseMeowParts,
  generateMeowTraits,
  PLAIN_EYE,
} from './traits'
export { renderMeowAvatar } from './render'
export {
  defaultMeowChoice,
  meowChoiceFromConfig,
  meowChoiceToConfig,
  meowChoiceToUrl,
  randomMeowChoice,
  readUserAvatar,
  type UserAvatar,
} from './user-avatar'
export type { MeowChoice, MeowTraits } from './types'

/**
 * Pass to `AvatarFallback delay` next to the cat image: the data URL loads in
 * a moment, and the delay keeps the initials from flashing before it does.
 */
export const MEOW_AVATAR_FALLBACK_DELAY = 600

const MAX_CACHED = 300
const urlCache = new Map<string, string>()

function isValidUserId(userId: number | null | undefined): userId is number {
  return userId != null && Number.isInteger(userId) && userId > 0
}

function cachedUrl(key: string, draw: () => string): string {
  const cached = urlCache.get(key)
  if (cached) return cached
  const url = draw()
  if (urlCache.size >= MAX_CACHED) urlCache.clear()
  urlCache.set(key, url)
  return url
}

/**
 * The default cat avatar of a user as an image URL. It is computed from the
 * user id alone, so it needs no storage and looks the same on every device.
 * Returns undefined when there is no valid id, so callers show their fallback.
 */
export function getMeowAvatarUrl(
  userId: number | null | undefined
): string | undefined {
  if (!isValidUserId(userId)) return undefined
  return cachedUrl(String(userId), () =>
    meowChoiceToUrl(defaultMeowChoice(userId))
  )
}

/**
 * A user's avatar: the picture they uploaded, the cat they built, or their
 * default cat. `setting` is the user's setting JSON (text or object).
 */
export function getUserAvatarUrl(
  userId: number | null | undefined,
  setting: unknown
): string | undefined {
  if (!isValidUserId(userId)) return undefined
  const avatar = readUserAvatar(setting)
  if (avatar?.kind === 'upload') return avatar.image
  if (avatar?.kind === 'cat') {
    return cachedUrl(`${userId}:${JSON.stringify(avatar.cat)}`, () =>
      meowChoiceToUrl(
        meowChoiceFromConfig(avatar.cat, defaultMeowChoice(userId))
      )
    )
  }
  return getMeowAvatarUrl(userId)
}
