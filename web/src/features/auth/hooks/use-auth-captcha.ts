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
import { useId, useState } from 'react'

import { useCaptcha } from '@/hooks/use-captcha'

/**
 * GeeTest state for an auth form, with the rule every auth form follows:
 * the submit action stays disabled until the check passes, and a result is
 * single-use, so taking it for a request starts a fresh challenge.
 */
export function useAuthCaptcha() {
  const captcha = useCaptcha()
  const [widgetKey, setWidgetKey] = useState(0)
  const hintId = useId()
  const ready = !captcha.isCaptchaEnabled || Boolean(captcha.captchaToken)

  /**
   * Returns the token for one request and remounts the widget, or `null`
   * when the check has not passed yet (the user is told to complete it).
   */
  function takeToken(): string | null {
    if (!captcha.validateCaptcha()) return null
    const token = captcha.captchaToken
    if (captcha.isCaptchaEnabled) {
      captcha.setCaptchaToken('')
      setWidgetKey((current) => current + 1)
    }
    return token
  }

  return {
    isEnabled: captcha.isCaptchaEnabled,
    captchaId: captcha.captchaId,
    setToken: captcha.setCaptchaToken,
    ready,
    widgetKey,
    hintId,
    takeToken,
    /** Props for the action the check gates: disabled and described by the hint. */
    gateProps: {
      'aria-describedby': ready ? undefined : hintId,
    },
  }
}

export type AuthCaptchaState = ReturnType<typeof useAuthCaptcha>
