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
  readMeowSplashPreviewDelay,
} from '../meow-splash'

/** The #meow-splash block of index.html; `shownAt` as its script records it. */
function mountSplash(shownAt?: number): HTMLElement {
  const splash = document.createElement('div')
  splash.id = 'meow-splash'
  splash.innerHTML =
    '<div class="meow-splash-bg"></div><div class="meow-splash-tile"></div><svg class="meow-splash-word"></svg>'
  if (shownAt !== undefined) {
    splash.dataset.shownAt = String(shownAt)
    splash.classList.add('is-shown')
    document.documentElement.classList.add('meow-splash-active')
  }
  document.body.append(splash)
  return splash
}

const CAT_AVATAR = 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E'
const PHOTO_AVATAR = 'data:image/webp;base64,UklGRg=='

/** A signed-in user's header avatar, loaded and on screen. */
function mountHeaderAvatar(src: string): HTMLImageElement {
  const header = document.createElement('header')
  const avatar = document.createElement('img')
  avatar.dataset.slot = 'avatar-image'
  avatar.src = src
  Object.defineProperty(avatar, 'complete', { value: true })
  avatar.getBoundingClientRect = () =>
    ({
      x: 960,
      y: 22,
      left: 960,
      top: 22,
      right: 994,
      bottom: 56,
      width: 34,
      height: 34,
    }) as DOMRect
  header.append(avatar)
  document.body.append(header)
  return avatar
}

/** Motion allowed, with Web Animations (missing in jsdom) that end at once. */
function allowMotion(): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: false,
  } as MediaQueryList)
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: () => ({ finished: Promise.resolve() }),
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(Element.prototype, 'animate')
  document.querySelector('#meow-splash')?.remove()
  document.querySelector('header')?.remove()
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

test('a signed-in user with a cat avatar sees the splash logo turn into their cat', async () => {
  allowMotion()
  mountHeaderAvatar(CAT_AVATAR)
  const splash = mountSplash(performance.now())
  await vi.advanceTimersByTimeAsync(200)

  dismissMeowSplash()
  await vi.advanceTimersByTimeAsync(MEOW_SPLASH_HOLD_MS)

  expect(splash.querySelector('.meow-splash-tile img')).toHaveAttribute(
    'src',
    CAT_AVATAR
  )
})

test('a signed-in user with an uploaded photo keeps the splash logo', async () => {
  allowMotion()
  mountHeaderAvatar(PHOTO_AVATAR)
  const splash = mountSplash(performance.now())
  await vi.advanceTimersByTimeAsync(200)

  dismissMeowSplash()
  await vi.advanceTimersByTimeAsync(MEOW_SPLASH_HOLD_MS)

  expect(splash.querySelector('.meow-splash-tile img')).toBeNull()
})

test('once the cat has flown in, the header avatar shows again and the splash is gone', async () => {
  allowMotion()
  const avatar = mountHeaderAvatar(CAT_AVATAR)
  mountSplash(performance.now())
  await vi.advanceTimersByTimeAsync(200)

  dismissMeowSplash()
  await vi.advanceTimersByTimeAsync(3000)

  expect(document.querySelector('#meow-splash')).toBeNull()
  expect(avatar).toBeVisible()
})

test('the local preview holds the app only when ?meow-splash is in the URL', () => {
  expect(readMeowSplashPreviewDelay('?meow-preview=1')).toBe(0)
})

test('the local preview holds the app for the given time, 3s by default', () => {
  expect(readMeowSplashPreviewDelay('?meow-splash=5000')).toBe(5000)
  expect(readMeowSplashPreviewDelay('?meow-splash')).toBe(3000)
  expect(readMeowSplashPreviewDelay('?meow-splash=soon')).toBe(3000)
})

test('the local preview hold stays under the 10s failsafe', () => {
  expect(readMeowSplashPreviewDelay('?meow-splash=60000')).toBe(8000)
})
