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

/*
 * The MeowAPI splash lives in index.html so it can show before the app
 * loads. This retires it once the app is ready. Keep the ids, classes and
 * timings in sync with the #meow-splash block there.
 */

const SPLASH_SELECTOR = '#meow-splash'

/** Set once the app has loaded; index.html then reveals the splash later. */
export const MEOW_SPLASH_SEEN_KEY = 'meow:splash:v1:seen'

/** Set on <html> while the splash is on screen; the home hero waits for it. */
const SPLASH_ACTIVE_CLASS = 'meow-splash-active'

/**
 * Once shown, the logo pops and the name settles (0.5s), then both rest for
 * a moment (0.15s) so the splash never cuts off mid-motion.
 */
export const MEOW_SPLASH_HOLD_MS = 650

/** Plain fade-out, the `.is-leaving` animation in index.html. */
export const MEOW_SPLASH_FADE_MS = 250

const FLIGHT_MS = 450
const FLIGHT_EASING = 'cubic-bezier(0.5, 0, 0.15, 1)'

/** The site logo in the public header, if it is loaded and on screen. */
function findHeaderLogo(): HTMLImageElement | null {
  const logo = document.querySelector<HTMLImageElement>(
    'header img[alt="logo"]'
  )
  if (!logo || !logo.complete || logo.naturalWidth === 0) return null
  const rect = logo.getBoundingClientRect()
  if (rect.width === 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) {
    return null
  }
  return logo
}

/** The splash logo shrinks into the header logo while the cover fades away. */
function flyIntoHeaderLogo(
  splash: HTMLElement,
  tile: HTMLElement,
  logo: HTMLImageElement
): void {
  const from = tile.getBoundingClientRect()
  const to = logo.getBoundingClientRect()
  const scale = to.width / from.width
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  const logoRadius = Number.parseFloat(
    getComputedStyle(logo).borderTopLeftRadius
  )
  const endRadius = (Number.isFinite(logoRadius) ? logoRadius : 0) / scale

  splash.classList.remove('is-shown')
  logo.style.visibility = 'hidden'
  const flight = tile.animate(
    [
      { transform: 'none', borderRadius: getComputedStyle(tile).borderRadius },
      {
        transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
        borderRadius: `${endRadius}px`,
      },
    ],
    { duration: FLIGHT_MS, easing: FLIGHT_EASING, fill: 'forwards' }
  )
  splash.animate(
    [
      { backgroundColor: getComputedStyle(splash).backgroundColor },
      { backgroundColor: 'transparent' },
    ],
    { duration: 300, easing: 'ease-in-out', fill: 'forwards' }
  )
  splash
    .querySelector('.meow-splash-word')
    ?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 150,
      easing: 'ease-in',
      fill: 'forwards',
    })

  const land = () => {
    logo.style.visibility = ''
    splash.remove()
  }
  flight.finished.then(land).catch(land)
}

/**
 * Retires the splash once the app is ready. A splash that has not appeared
 * yet is dropped at once; one on screen first finishes its intro, then flies
 * its logo into the header, or fades out when that logo is not on screen.
 */
export function dismissMeowSplash(): void {
  const splash = document.querySelector<HTMLElement>(SPLASH_SELECTOR)
  if (!splash || splash.dataset.leaving) return
  splash.dataset.leaving = 'true'

  try {
    localStorage.setItem(MEOW_SPLASH_SEEN_KEY, '1')
  } catch {
    // Storage can be blocked; the splash then keeps the early reveal.
  }

  const shownAt = splash.dataset.shownAt
  if (shownAt === undefined) {
    splash.remove()
    return
  }

  const wait = Math.max(
    0,
    Number(shownAt) + MEOW_SPLASH_HOLD_MS - performance.now()
  )
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      document.documentElement.classList.remove(SPLASH_ACTIVE_CLASS)
      const tile = splash.querySelector<HTMLElement>('.meow-splash-tile')
      const logo = findHeaderLogo()
      const reduceMotion =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      if (tile && logo && !reduceMotion && typeof tile.animate === 'function') {
        flyIntoHeaderLogo(splash, tile, logo)
        return
      }
      splash.classList.add('is-leaving')
      window.setTimeout(() => splash.remove(), MEOW_SPLASH_FADE_MS)
    })
  }, wait)
}
