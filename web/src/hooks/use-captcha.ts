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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useStatus } from '@/hooks/use-status'
import { CAPTCHA_REQUIRED_CODE } from '@/lib/captcha'
import {
  createGeetestBind,
  toGeetestLanguage,
  type GeetestBind,
} from '@/lib/geetest'
import { handleServerError } from '@/lib/handle-server-error'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

/**
 * When the server wants a GeeTest result: on every guarded request
 * (`always`), or only when its risk signals fire (`risk`).
 */
type CaptchaMode = 'always' | 'risk'

type UseCaptchaOptions = {
  /**
   * Whether the guarded action can be used now (default `true`). GeeTest
   * starts only while it is, so a page whose action is unavailable (such as
   * a check-in already done today) loads nothing from GeeTest. Keep it `true`
   * while `run` is in progress.
   */
  active?: boolean
}

/**
 * GeeTest human verification for a form or action guarded by the server's
 * captcha check. GeeTest starts in bind mode when the component mounts (or
 * the action becomes active), and `run` decides whether a request needs a
 * challenge first.
 */
export function useCaptcha(options: UseCaptchaOptions = {}) {
  const { t, i18n } = useTranslation()
  const { status } = useStatus()
  const queryClient = useQueryClient()
  const geetest = useRef<GeetestBind | null>(null)

  const captchaId = status?.geetest_captcha_id || ''
  const isEnabled = Boolean(status?.geetest_check && captchaId)
  const mode: CaptchaMode =
    status?.geetest_check_mode === 'risk' ? 'risk' : 'always'
  const language = toGeetestLanguage(i18n.resolvedLanguage || i18n.language)
  const active = options.active ?? true

  useEffect(() => {
    if (!isEnabled || !active) return
    const bind = createGeetestBind(captchaId, language)
    geetest.current = bind
    return () => {
      bind.destroy()
      if (geetest.current === bind) geetest.current = null
    }
  }, [isEnabled, active, captchaId, language])

  /** Shows the challenge: the token of a pass, or `null` (the user was told why). */
  async function challenge(): Promise<string | null> {
    const outcome = geetest.current
      ? await geetest.current.challenge()
      : { kind: 'failed' as const }
    if (outcome.kind === 'passed') return outcome.token
    if (outcome.kind === 'closed') {
      toast.info(t('Please complete the human verification first'))
    } else if (outcome.kind === 'failed') {
      toast.error(
        t('Human verification failed to load. Refresh the page and try again.')
      )
    }
    return null
  }

  /**
   * Sends a guarded request through the human check and answers its final
   * reply, or `null` when it was not (re)sent because no check was passed.
   * `send` puts the token, when there is one, in the captcha header; each
   * token goes to exactly one request.
   */
  async function run<T extends { code?: string }>(
    send: (token?: string) => Promise<T>
  ): Promise<T | null> {
    if (isEnabled && mode === 'always') {
      const token = await challenge()
      return token === null ? null : send(token)
    }

    const reply = await send()
    if (reply.code !== CAPTCHA_REQUIRED_CODE) return reply
    if (!isEnabled) {
      // Verification was turned on after this page read the site settings.
      handleServerError(
        reply,
        t('Please complete the human verification first')
      )
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
      return null
    }
    const token = await challenge()
    return token === null ? null : send(token)
  }

  return { isEnabled, mode, run }
}
