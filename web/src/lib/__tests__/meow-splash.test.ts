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

import {
  dismissMeowSplash,
  MEOW_SPLASH_FADE_MS,
  MEOW_SPLASH_HOLD_MS,
  MEOW_SPLASH_SEEN_KEY,
} from '../meow-splash'

/** The #meow-splash block of index.html; `shownAt` as its script records it. */
function mountSplash(shownAt?: number): HTMLElement {
  const splash = document.createElement('div')
  splash.id = 'meow-splash'
  splash.innerHTML =
    '<div class="meow-splash-tile"></div><svg class="meow-splash-word"></svg>'
  if (shownAt !== undefined) {
    splash.dataset.shownAt = String(shownAt)
    splash.classList.add('is-shown')
    document.documentElement.classList.add('meow-splash-active')
  }
  document.body.append(splash)
  return splash
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  document.querySelector('#meow-splash')?.remove()
  document.documentElement.classList.remove('meow-splash-active')
  localStorage.clear()
})

test('a splash that has not appeared yet is removed as soon as the app is ready', () => {
  mountSplash()

  dismissMeowSplash()

  expect(document.querySelector('#meow-splash')).toBeNull()
})

test('dismissing records the visit so the next splash reveals later', () => {
  mountSplash()

  dismissMeowSplash()

  expect(localStorage.getItem(MEOW_SPLASH_SEEN_KEY)).toBe('1')
})

test('a splash on screen keeps its logo and name until the intro and pause are over', () => {
  const splash = mountSplash(performance.now())
  vi.advanceTimersByTime(200)

  dismissMeowSplash()
  vi.advanceTimersByTime(MEOW_SPLASH_HOLD_MS - 200 - 1)

  expect(splash).toBeInTheDocument()
  expect(splash).not.toHaveClass('is-leaving')
})

test('a splash on screen leaves after its pause and lets the home hero play', () => {
  const splash = mountSplash(performance.now())
  vi.advanceTimersByTime(200)

  dismissMeowSplash()
  vi.advanceTimersByTime(MEOW_SPLASH_HOLD_MS - 200 + 1)

  expect(splash).toHaveClass('is-leaving')
  expect(document.documentElement).not.toHaveClass('meow-splash-active')
})

test('an app ready long after the intro starts the exit on the next frame', () => {
  const splash = mountSplash(performance.now())
  vi.advanceTimersByTime(3000)

  dismissMeowSplash()
  vi.advanceTimersByTime(1)

  expect(splash).toHaveClass('is-leaving')
})

test('without a header logo to fly into, the splash fades out and is removed', () => {
  mountSplash(performance.now())
  vi.advanceTimersByTime(3000)

  dismissMeowSplash()
  vi.advanceTimersByTime(1 + MEOW_SPLASH_FADE_MS)

  expect(document.querySelector('#meow-splash')).toBeNull()
})
