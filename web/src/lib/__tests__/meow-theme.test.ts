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
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { getCookie, setCookie } from '../cookies'
import { APPEARANCE_CLEANUP_FLAG, cleanUpDrawerAppearance } from '../meow-theme'
import { THEME_STORAGE_KEYS } from '../theme-storage'

function clearAll() {
  localStorage.clear()
  for (const name of ['layout_variant', 'layout_collapsible', 'dir']) {
    document.cookie = `${name}=; path=/; max-age=0`
  }
}

function saveDrawerSettings() {
  localStorage.setItem(THEME_STORAGE_KEYS.preset, 'claude')
  localStorage.setItem(THEME_STORAGE_KEYS.font, 'serif')
  localStorage.setItem(THEME_STORAGE_KEYS.radius, 'none')
  localStorage.setItem(THEME_STORAGE_KEYS.contentLayout, 'centered')
  localStorage.setItem(THEME_STORAGE_KEYS.scale, 'lg')
  localStorage.setItem(THEME_STORAGE_KEYS.mode, 'dark')
  setCookie('layout_variant', 'floating')
  setCookie('layout_collapsible', 'offcanvas')
  setCookie('dir', 'rtl')
}

beforeEach(clearAll)
afterEach(() => {
  clearAll()
  vi.restoreAllMocks()
})

test('first run clears the drawer settings that change the MeowAPI look', () => {
  saveDrawerSettings()

  cleanUpDrawerAppearance()

  expect(localStorage.getItem(THEME_STORAGE_KEYS.preset)).toBeNull()
  expect(localStorage.getItem(THEME_STORAGE_KEYS.font)).toBeNull()
  expect(localStorage.getItem(THEME_STORAGE_KEYS.radius)).toBeNull()
  expect(localStorage.getItem(THEME_STORAGE_KEYS.contentLayout)).toBeNull()
  expect(getCookie('layout_variant')).toBeUndefined()
  expect(getCookie('dir')).toBeUndefined()
})

test('first run keeps text size, sidebar collapse mode and light / dark', () => {
  saveDrawerSettings()

  cleanUpDrawerAppearance()

  expect(localStorage.getItem(THEME_STORAGE_KEYS.scale)).toBe('lg')
  expect(localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('dark')
  expect(getCookie('layout_collapsible')).toBe('offcanvas')
})

test('later runs leave settings saved after the first run alone', () => {
  cleanUpDrawerAppearance()
  expect(localStorage.getItem(APPEARANCE_CLEANUP_FLAG)).toBe('1')
  localStorage.setItem(THEME_STORAGE_KEYS.preset, 'claude')

  cleanUpDrawerAppearance()

  expect(localStorage.getItem(THEME_STORAGE_KEYS.preset)).toBe('claude')
})

test('blocked storage is skipped without throwing', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })

  expect(() => cleanUpDrawerAppearance()).not.toThrow()
})
