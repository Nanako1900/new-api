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
import { removeCookie } from '@/lib/cookies'
import { THEME_STORAGE_KEYS } from '@/lib/theme-storage'

/** Set once the cleanup below has run in this browser. */
export const APPEARANCE_CLEANUP_FLAG = 'meow:appearance-cleanup:v1'

/** Cookies of the layout and direction providers, see `src/context/`. */
const LOOK_COOKIES = ['layout_variant', 'dir']

/**
 * MeowAPI replaced the theme drawer with a light / dark switch. Settings
 * saved through the drawer earlier that change the MeowAPI look (colour
 * preset, font, corner radius, centred content, sidebar style, text
 * direction) would stay stuck with no way to change them, so they are
 * cleared once per browser, before the app renders. Text size and how the
 * sidebar collapses are personal and stay as they are.
 */
export function cleanUpDrawerAppearance(): void {
  try {
    if (localStorage.getItem(APPEARANCE_CLEANUP_FLAG)) return
    localStorage.removeItem(THEME_STORAGE_KEYS.preset)
    localStorage.removeItem(THEME_STORAGE_KEYS.font)
    localStorage.removeItem(THEME_STORAGE_KEYS.radius)
    localStorage.removeItem(THEME_STORAGE_KEYS.contentLayout)
    for (const name of LOOK_COOKIES) removeCookie(name)
    localStorage.setItem(APPEARANCE_CLEANUP_FLAG, '1')
  } catch {
    // Storage blocked: nothing was saved there to clean up either.
  }
}
