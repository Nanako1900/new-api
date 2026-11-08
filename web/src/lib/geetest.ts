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
import { normalizeInterfaceLanguage } from '@/i18n/languages'

const GEETEST_SCRIPT_URL = 'https://static.geetest.com/v4/gt4.js'

/** Interface languages GeeTest has a translation for; others use English. */
const GEETEST_LANGUAGES: Record<string, string> = {
  zhCN: 'zho',
  zhTW: 'zho-tw',
  en: 'eng',
  fr: 'fra',
  ru: 'rus',
  ja: 'jpn',
}

type GeetestValidateResult = {
  lot_number: string
  captcha_output: string
  pass_token: string
  gen_time: string
}

/** The gt4.js instance methods used in bind mode. */
type GeetestCaptchaInstance = {
  getValidate: () => GeetestValidateResult | false
  /** Does nothing before `onReady`. */
  showCaptcha: () => void
  onReady: (callback: () => void) => GeetestCaptchaInstance
  onSuccess: (callback: () => void) => GeetestCaptchaInstance
  onClose: (callback: () => void) => GeetestCaptchaInstance
  onError: (callback: (error: unknown) => void) => GeetestCaptchaInstance
  destroy: () => void
}

type GeetestConfig = {
  captchaId: string
  product: 'bind'
  /** Bind mode only: skip GeeTest's own success popup. */
  hideSuccess: boolean
  language: string
  protocol: 'https://'
  /** Replaces GeeTest's offline mode, whose local pass the server rejects. */
  offlineCb: () => void
  /** Errors raised before the instance exists. */
  onError: (error: unknown) => void
}

declare global {
  interface Window {
    initGeetest4?: (
      config: GeetestConfig,
      callback: (captcha: GeetestCaptchaInstance) => void
    ) => void
  }
}

let geetestScript: Promise<void> | null = null

/** Load gt4.js once per page; a failed load can be retried by a new instance. */
function loadGeetestScript(): Promise<void> {
  if (window.initGeetest4) return Promise.resolve()
  if (geetestScript) return geetestScript
  geetestScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GEETEST_SCRIPT_URL
    script.async = true
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener(
      'error',
      () => {
        geetestScript = null
        script.remove()
        reject(new Error('GeeTest script failed to load'))
      },
      { once: true }
    )
    document.head.appendChild(script)
  })
  return geetestScript
}

/** The GeeTest language code for an interface language. */
export function toGeetestLanguage(interfaceLanguage: string): string {
  return (
    GEETEST_LANGUAGES[normalizeInterfaceLanguage(interfaceLanguage)] ?? 'eng'
  )
}

/**
 * How one challenge ended. `passed` carries the result token the server's
 * captcha check expects; `cancelled` means the challenge never showed (the
 * instance was destroyed, or another challenge is still open).
 */
type GeetestOutcome =
  | { kind: 'passed'; token: string }
  | { kind: 'closed' }
  | { kind: 'failed' }
  | { kind: 'cancelled' }

export type GeetestBind = {
  /** Waits until GeeTest is ready, shows the challenge and reports how it ended. */
  challenge: () => Promise<GeetestOutcome>
  destroy: () => void
}

/**
 * GeeTest v4 in bind mode: nothing is drawn on the page, and the challenge
 * opens only when `challenge()` asks for it. Create it when the form mounts so
 * GeeTest can collect the behavior data it judges the challenge by.
 */
export function createGeetestBind(
  captchaId: string,
  language: string
): GeetestBind {
  let state: 'loading' | 'ready' | 'failed' | 'destroyed' = 'loading'
  let captcha: GeetestCaptchaInstance | null = null
  let finishChallenge: ((outcome: GeetestOutcome) => void) | null = null
  let leaveLoading = () => {}
  const loaded = new Promise<void>((resolve) => {
    leaveLoading = resolve
  })

  function finish(outcome: GeetestOutcome) {
    const resolve = finishChallenge
    finishChallenge = null
    resolve?.(outcome)
  }

  function fail() {
    if (state === 'destroyed') return
    state = 'failed'
    leaveLoading()
    finish({ kind: 'failed' })
  }

  loadGeetestScript()
    .then(() => {
      const initGeetest4 = window.initGeetest4
      if (state !== 'loading') return
      if (!initGeetest4) {
        fail()
        return
      }
      initGeetest4(
        {
          captchaId,
          product: 'bind',
          hideSuccess: true,
          language,
          // Consoles served over http (such as the desktop app) would
          // otherwise talk to GeeTest in plain text.
          protocol: 'https://',
          offlineCb: fail,
          onError: fail,
        },
        (instance) => {
          if (state === 'destroyed') {
            instance.destroy()
            return
          }
          captcha = instance
          instance
            .onReady(() => {
              if (state !== 'loading') return
              state = 'ready'
              leaveLoading()
            })
            .onSuccess(() => {
              const result = instance.getValidate()
              if (!result) {
                finish({ kind: 'failed' })
                return
              }
              // Only the four fields the server's check reads.
              finish({
                kind: 'passed',
                token: JSON.stringify({
                  lot_number: result.lot_number,
                  captcha_output: result.captcha_output,
                  pass_token: result.pass_token,
                  gen_time: result.gen_time,
                }),
              })
            })
            .onClose(() => finish({ kind: 'closed' }))
            .onError(fail)
        }
      )
    })
    .catch(fail)

  return {
    async challenge() {
      await loaded
      if (state === 'failed') return { kind: 'failed' }
      const ready = state === 'ready' ? captcha : null
      if (!ready || finishChallenge) return { kind: 'cancelled' }
      return new Promise<GeetestOutcome>((resolve) => {
        finishChallenge = resolve
        // Bind mode starts a fresh challenge each time, so a result is never
        // handed out twice.
        ready.showCaptcha()
      })
    },
    destroy() {
      state = 'destroyed'
      leaveLoading()
      finish({ kind: 'cancelled' })
      captcha?.destroy()
      captcha = null
    },
  }
}
