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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeInterfaceLanguage } from '@/i18n/languages'
import { cn } from '@/lib/utils'

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

type GeetestCaptchaInstance = {
  appendTo: (target: HTMLElement) => GeetestCaptchaInstance
  getValidate: () => GeetestValidateResult | false
  onSuccess: (callback: () => void) => GeetestCaptchaInstance
  onError: (callback: (error: unknown) => void) => GeetestCaptchaInstance
  destroy: () => void
}

type GeetestConfig = {
  captchaId: string
  product: 'float' | 'popup' | 'bind'
  language: string
  protocol?: 'https://'
  nativeButton?: { width: string; height: string }
  /** Replaces GeeTest's offline mode, whose local pass the server rejects. */
  offlineCb?: () => void
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

/** Load gt4.js once per page; a failed load can be retried by a remount. */
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

interface GeetestCaptchaProps {
  captchaId: string
  /** Receives the result token the server's captcha check expects. */
  onVerify: (token: string) => void
  /** The widget failed; any earlier token should be discarded. */
  onError?: () => void
  className?: string
}

/**
 * GeeTest v4 verification button. Remount it (change its `key`) to start a
 * new attempt after a token has been spent.
 */
export function GeetestCaptcha(props: GeetestCaptchaProps) {
  const { t, i18n } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onVerifyRef = useRef(props.onVerify)
  const onErrorRef = useRef(props.onError)
  const [failed, setFailed] = useState(false)
  const language =
    GEETEST_LANGUAGES[
      normalizeInterfaceLanguage(i18n.resolvedLanguage || i18n.language)
    ] ?? 'eng'

  useEffect(() => {
    onVerifyRef.current = props.onVerify
    onErrorRef.current = props.onError
  })

  useEffect(() => {
    let cancelled = false
    let reported = false
    let captcha: GeetestCaptchaInstance | null = null

    const fail = () => {
      if (cancelled || reported) return
      reported = true
      setFailed(true)
      onErrorRef.current?.()
    }

    loadGeetestScript()
      .then(() => {
        const initGeetest4 = window.initGeetest4
        if (cancelled) return
        if (!initGeetest4) {
          fail()
          return
        }
        initGeetest4(
          {
            captchaId: props.captchaId,
            product: 'popup',
            language,
            // Consoles served over http (such as the desktop app) would
            // otherwise talk to GeeTest in plain text.
            protocol: 'https://',
            nativeButton: { width: '100%', height: '44px' },
            offlineCb: fail,
          },
          (instance) => {
            if (cancelled || !containerRef.current) {
              instance.destroy()
              return
            }
            captcha = instance
            instance
              .appendTo(containerRef.current)
              .onSuccess(() => {
                const result = instance.getValidate()
                if (!result) return
                onVerifyRef.current(
                  JSON.stringify({
                    lot_number: result.lot_number,
                    captcha_output: result.captcha_output,
                    pass_token: result.pass_token,
                    gen_time: result.gen_time,
                  })
                )
              })
              .onError(fail)
          }
        )
      })
      .catch(fail)

    return () => {
      cancelled = true
      captcha?.destroy()
    }
  }, [props.captchaId, language])

  return (
    <div className={cn('w-full', props.className)}>
      <div ref={containerRef} className='min-h-11 w-full' hidden={failed} />
      {failed && (
        <p role='alert' className='text-destructive mt-2 text-sm'>
          {t(
            'Human verification failed to load. Refresh the page and try again.'
          )}
        </p>
      )}
    </div>
  )
}
