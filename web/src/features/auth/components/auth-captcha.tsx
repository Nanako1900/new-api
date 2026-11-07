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
import { useTranslation } from 'react-i18next'

import { GeetestCaptcha } from '@/components/geetest-captcha'
import { cn } from '@/lib/utils'

import type { AuthCaptchaState } from '../hooks/use-auth-captcha'

type AuthCaptchaProps = {
  captcha: AuthCaptchaState
  className?: string
}

/**
 * The GeeTest check of an auth form, placed right before the action it
 * gates, with a short hint while the action is still locked.
 */
export function AuthCaptcha(props: AuthCaptchaProps) {
  const { t } = useTranslation()
  if (!props.captcha.isEnabled) return null

  return (
    <div className={cn('grid gap-1.5', props.className)}>
      <GeetestCaptcha
        key={props.captcha.widgetKey}
        captchaId={props.captcha.captchaId}
        onVerify={props.captcha.setToken}
        onError={() => props.captcha.setToken('')}
      />
      {!props.captcha.ready && (
        <p id={props.captcha.hintId} className='text-muted-foreground text-xs'>
          {t('Please complete the human verification first')}
        </p>
      )}
    </div>
  )
}
