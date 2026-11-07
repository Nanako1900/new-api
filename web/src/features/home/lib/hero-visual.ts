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
 * The visual beside the built-in home page headline, chosen by admins in
 * System Settings → Site (option `HomeHeroVisual`, exposed by /api/status
 * as `home_hero_visual`).
 */
export const HOME_HERO_VISUALS = [
  'key-card',
  'gateway',
  'base-url',
  'code-card',
] as const

export type HomeHeroVisual = (typeof HOME_HERO_VISUALS)[number]

export const DEFAULT_HOME_HERO_VISUAL: HomeHeroVisual = 'key-card'

/** Read the saved option; empty, unknown or non-string values use the default. */
export function parseHomeHeroVisual(raw: unknown): HomeHeroVisual {
  if (typeof raw !== 'string') return DEFAULT_HOME_HERO_VISUAL
  const value = raw.trim()
  return (
    HOME_HERO_VISUALS.find((visual) => visual === value) ??
    DEFAULT_HOME_HERO_VISUAL
  )
}
