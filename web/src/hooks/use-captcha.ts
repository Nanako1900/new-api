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
import i18next from 'i18next'
import { useState } from 'react'
import { toast } from 'sonner'

import { useStatus } from '@/hooks/use-status'

/**
 * GeeTest human verification state for a form: whether the site requires it,
 * the public captcha ID, and the result token of the current attempt.
 */
export function useCaptcha() {
  const { status } = useStatus()
  const [captchaToken, setCaptchaToken] = useState('')

  const captchaId = status?.geetest_captcha_id || ''
  const isCaptchaEnabled = Boolean(status?.geetest_check && captchaId)

  /** Whether the form may submit: verification is off or already passed. */
  const validateCaptcha = (): boolean => {
    if (isCaptchaEnabled && !captchaToken) {
      toast.info(i18next.t('Please complete the human verification first'))
      return false
    }
    return true
  }

  return {
    isCaptchaEnabled,
    captchaId,
    captchaToken,
    setCaptchaToken,
    validateCaptcha,
  }
}
