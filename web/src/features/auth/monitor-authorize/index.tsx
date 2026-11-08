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
import { Link } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'

import { AuthLayout } from '../auth-layout'
import {
  monitorAuthorizeErrorCode,
  requestMonitorAuthorizationCode,
} from './api'
import {
  isRetryableMonitorAuthorizeError,
  MONITOR_INVALID_LINK_MESSAGE,
  monitorAuthorizeErrorMessage,
  monitorCallbackUrl,
  parseMonitorAuthorizeRequest,
  type MonitorAuthorizeSearch,
} from './lib'

type MonitorAuthorizeProps = {
  search: MonitorAuthorizeSearch
  // Sends the browser to the monitor console callback. The callback is on
  // another origin, so the router cannot navigate there.
  onAuthorized?: (callbackUrl: string) => void
}

type AuthorizeFailure = { message: string; retryable: boolean }

function replaceLocation(callbackUrl: string) {
  window.location.replace(callbackUrl)
}

export function MonitorAuthorize(props: MonitorAuthorizeProps) {
  const { t } = useTranslation()
  const request = useMemo(
    () => parseMonitorAuthorizeRequest(props.search),
    [props.search]
  )
  const [attempt, setAttempt] = useState(0)
  const [failure, setFailure] = useState<AuthorizeFailure | null>(null)
  const startedAttempt = useRef(-1)
  const onAuthorized = props.onAuthorized ?? replaceLocation

  useEffect(() => {
    if (request == null || startedAttempt.current === attempt) return
    startedAttempt.current = attempt
    requestMonitorAuthorizationCode({
      redirect_uri: request.redirectUri,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
    })
      .then((code) =>
        onAuthorized(
          monitorCallbackUrl(request.redirectUri, code, request.state)
        )
      )
      .catch((error: unknown) => {
        const code = monitorAuthorizeErrorCode(error)
        setFailure({
          message: monitorAuthorizeErrorMessage(code),
          retryable: isRetryableMonitorAuthorizeError(code),
        })
      })
  }, [request, attempt, onAuthorized])

  const visibleFailure =
    request == null
      ? { message: MONITOR_INVALID_LINK_MESSAGE, retryable: false }
      : failure

  return (
    <AuthLayout>
      <div className='w-full space-y-6 text-center'>
        <div className='flex flex-col items-center space-y-4'>
          <div className='bg-muted flex h-16 w-16 items-center justify-center rounded-2xl'>
            <Activity className='h-8 w-8' aria-hidden='true' />
          </div>
          <h2 className='text-2xl font-semibold tracking-tight'>
            {t('Signing you in to the monitor console')}
          </h2>
          <p className='text-muted-foreground text-sm sm:text-base'>
            {t(
              'Your current session signs you in. No password or API key is shared with the monitor console.'
            )}
          </p>
        </div>
        {visibleFailure == null ? (
          <LoadingState message={t('Redirecting to the monitor console...')} />
        ) : (
          <ErrorState
            title={t('Could not sign in to the monitor console')}
            description={t(visibleFailure.message)}
            onRetry={
              visibleFailure.retryable
                ? () => {
                    setFailure(null)
                    setAttempt((value) => value + 1)
                  }
                : undefined
            }
            action={
              <Button variant='ghost' size='sm' render={<Link to='/' />}>
                {t('Back to Home')}
              </Button>
            }
          />
        )}
      </div>
    </AuthLayout>
  )
}
