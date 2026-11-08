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

/** Extra time to reach a target that moved during the flight. */
const SETTLE_MS = 160

/** Logo to cat: the cat fades in over the logo, then both rest a moment. */
const MORPH_MS = 300
const MORPH_REST_MS = 150

/**
 * Places a cat avatar so its head covers the logo's head. Both are drawn in
 * 120 units: renderMeowAvatar (lib/meow-avatar) puts the head at
 * translate(60 67) scale(0.92) translate(-60 -60), index.html the logo at
 * translate(-4.6 -3.9) scale(1.08). Keep in sync with both.
 */
const CAT_OVER_LOGO = 'translate(0.17%, -6.1%) scale(1.174)'

const PREVIEW_PARAM = 'meow-splash'
const PREVIEW_DEFAULT_MS = 3000
/** Stays under the 10s failsafe in index.html. */
const PREVIEW_MAX_MS = 8000

/**
 * Local preview: `?meow-splash` (or `?meow-splash=3000`) holds the app back
 * that many ms so the splash can be seen on a fast localhost; index.html
 * also treats it as a first visit. Returns 0 without the parameter.
 */
export function readMeowSplashPreviewDelay(search: string): number {
  const params = new URLSearchParams(search)
  if (!params.has(PREVIEW_PARAM)) return 0
  const ms = Number(params.get(PREVIEW_PARAM))
  if (!Number.isFinite(ms) || ms <= 0) return PREVIEW_DEFAULT_MS
  return Math.min(ms, PREVIEW_MAX_MS)
}

function isOnScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight
}

/** The site logo in the public header, if it is loaded and on screen. */
function findHeaderLogo(): HTMLImageElement | null {
  const logo = document.querySelector<HTMLImageElement>(
    'header img[alt="logo"]'
  )
  if (!logo || !logo.complete || logo.naturalWidth === 0) return null
  return isOnScreen(logo) ? logo : null
}

/**
 * The signed-in user's cat avatar in the header, if it is on screen. Cats
 * are SVG data URLs (lib/meow-avatar); an uploaded photo is not, and keeps
 * the logo flight. The avatar image only renders once it has loaded.
 */
function findHeaderCatAvatar(): HTMLImageElement | null {
  const avatars = document.querySelectorAll<HTMLImageElement>(
    'header [data-slot="avatar-image"]'
  )
  for (const avatar of avatars) {
    if (
      avatar.complete &&
      avatar.src.startsWith('data:image/svg+xml') &&
      isOnScreen(avatar)
    ) {
      return avatar
    }
  }
  return null
}

/** Plain fade-out, for when there is nothing on screen to fly into. */
function fadeOut(splash: HTMLElement): void {
  document.documentElement.classList.remove(SPLASH_ACTIVE_CLASS)
  splash.classList.add('is-leaving')
  window.setTimeout(() => splash.remove(), MEOW_SPLASH_FADE_MS)
}

/**
 * Lands exactly on the target even if it moved during the flight, say when
 * the page grew a scrollbar and a centred header shifted.
 */
function settleOnTarget(
  tile: HTMLElement,
  target: HTMLElement,
  flown: { dx: number; dy: number; scale: number }
): Promise<unknown> {
  const now = tile.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (now.width === 0) return Promise.resolve()
  const offX = to.left + to.width / 2 - (now.left + now.width / 2)
  const offY = to.top + to.height / 2 - (now.top + now.height / 2)
  const ratio = to.width / now.width
  if (
    Math.abs(offX) < 0.5 &&
    Math.abs(offY) < 0.5 &&
    Math.abs(ratio - 1) < 0.01
  ) {
    return Promise.resolve()
  }
  return tile.animate(
    [
      {
        transform: `translate(${flown.dx}px, ${flown.dy}px) scale(${flown.scale})`,
      },
      {
        transform: `translate(${flown.dx + offX}px, ${flown.dy + offY}px) scale(${flown.scale * ratio})`,
      },
    ],
    { duration: SETTLE_MS, easing: 'ease-out', fill: 'forwards' }
  ).finished
}

/**
 * The splash tile shrinks into the header logo or avatar while the cover
 * fades away and the home hero rises. Only transform and opacity animate, so
 * the GPU keeps the flight smooth while the app renders. A cat on the tile
 * goes from covering the logo's head back to the avatar's own framing.
 */
function flyInto(
  splash: HTMLElement,
  tile: HTMLElement,
  target: HTMLElement,
  cat?: HTMLElement
): void {
  // The cover keeps its width: a page scrollbar appearing mid-flight would
  // otherwise narrow it and shift the tile.
  splash.style.width = `${splash.getBoundingClientRect().width}px`
  splash.style.right = 'auto'

  const from = tile.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  const flown = {
    dx: to.left + to.width / 2 - (from.left + from.width / 2),
    dy: to.top + to.height / 2 - (from.top + from.height / 2),
    scale: to.width / from.width,
  }

  document.documentElement.classList.remove(SPLASH_ACTIVE_CLASS)
  splash.classList.remove('is-shown')
  target.style.visibility = 'hidden'
  const timing = {
    duration: FLIGHT_MS,
    easing: FLIGHT_EASING,
    fill: 'forwards',
  } as const
  const flight = tile.animate(
    [
      { transform: 'none' },
      {
        transform: `translate(${flown.dx}px, ${flown.dy}px) scale(${flown.scale})`,
      },
    ],
    timing
  )
  cat?.animate([{ transform: CAT_OVER_LOGO }, { transform: 'none' }], timing)
  splash
    .querySelector('.meow-splash-bg')
    ?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 300,
      easing: 'ease-in-out',
      fill: 'forwards',
    })
  splash
    .querySelector('.meow-splash-word')
    ?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 150,
      easing: 'ease-in',
      fill: 'forwards',
    })

  const land = () => {
    target.style.visibility = ''
    splash.remove()
  }
  flight.finished
    .then(() => settleOnTarget(tile, target, flown))
    .then(land)
    .catch(land)
}

/** Flies the logo into the header logo, or fades out when it is not there. */
function flyLogoOrFade(splash: HTMLElement, tile: HTMLElement): void {
  const logo = findHeaderLogo()
  if (logo) {
    flyInto(splash, tile, logo)
    return
  }
  fadeOut(splash)
}

/**
 * A signed-in user with a cat avatar sees the logo turn into their cat: the
 * tile rounds into a circle as the cat fades in head on head and the logo
 * fades out, rests a moment, then flies into the header avatar. Keeps the
 * logo if the cat cannot be drawn.
 */
async function turnIntoCatThenFly(
  splash: HTMLElement,
  tile: HTMLElement,
  avatar: HTMLImageElement
): Promise<void> {
  const cat = document.createElement('img')
  cat.alt = ''
  cat.src = avatar.src
  cat.style.transform = CAT_OVER_LOGO
  if (typeof cat.decode === 'function') {
    try {
      await cat.decode()
    } catch {
      flyLogoOrFade(splash, tile)
      return
    }
  }

  const face = document.createElement('div')
  face.className = 'meow-splash-cat'
  face.append(cat)
  tile.append(face)
  // The tile itself rounds into the avatar's circle while the logo turns
  // into the cat, so both share one shape. clip-path rather than
  // border-radius: Safari keeps it clipping the cat that moves inside.
  const corner = getComputedStyle(tile).borderTopLeftRadius
  tile.animate(
    [
      { clipPath: `inset(0 round ${corner})` },
      { clipPath: `inset(0 round ${tile.offsetWidth / 2}px)` },
    ],
    { duration: MORPH_MS, easing: 'ease-in-out', fill: 'forwards' }
  )
  face.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: MORPH_MS,
    easing: 'ease-out',
    fill: 'forwards',
  })
  tile.querySelector('svg')?.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: MORPH_MS,
    easing: 'ease-in',
    fill: 'forwards',
  })
  await new Promise((resolve) => {
    window.setTimeout(resolve, MORPH_MS + MORPH_REST_MS)
  })

  if (!avatar.isConnected || !isOnScreen(avatar)) {
    fadeOut(splash)
    return
  }
  flyInto(splash, tile, avatar, cat)
}

/**
 * Retires the splash once the app is ready. A splash that has not appeared
 * yet is dropped at once; one on screen first finishes its intro, then turns
 * into the user's cat and flies into the header avatar, or flies its logo
 * into the header logo, or fades out when neither is on screen.
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
      const tile = splash.querySelector<HTMLElement>('.meow-splash-tile')
      const reduceMotion =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      if (!tile || reduceMotion || typeof tile.animate !== 'function') {
        fadeOut(splash)
        return
      }
      const avatar = findHeaderCatAvatar()
      if (!avatar) {
        flyLogoOrFade(splash, tile)
        return
      }
      turnIntoCatThenFly(splash, tile, avatar).catch(() => fadeOut(splash))
    })
  }, wait)
}
