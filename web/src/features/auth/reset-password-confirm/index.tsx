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
import { Link, useNavigate } from '@tanstack/react-router'
import { CircleCheck, MailCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AuthOperationError } from '@/lib/secure-verification'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

import { verifyPasswordResetToken } from '../api'
import { AuthLayout } from '../auth-layout'
import { AuthHeader } from '../components/auth-header'
import { NewPasswordForm } from './components/new-password-form'
import {
  classifyPasswordResetFailure,
  PASSWORD_RESET_LINK_INVALID,
  PASSWORD_RESET_TOKEN_STORAGE_KEY,
  readStoredPasswordResetToken,
} from './lib/reset-link'

export type ResetPasswordSearchParams = {
  token?: string
}

type ResetLinkState =
  | { kind: 'checking' }
  | { kind: 'ready'; email: string }
  | { kind: 'failed'; failure: unknown }
  | { kind: 'invalid' }
  | { kind: 'done' }

/**
 * The page a password reset email links to. An inline script in index.html
 * moves the token from the address bar into session storage before any
 * analytics script runs; the page takes it from there (or from the URL when
 * storage is unavailable), clears both, and sends no referrer.
 */
export function ResetPasswordConfirm(props: ResetPasswordSearchParams) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [token] = useState(
    () => props.token?.trim() || readStoredPasswordResetToken().trim()
  )
  const [link, setLink] = useState<ResetLinkState>(() =>
    token ? { kind: 'checking' } : { kind: 'invalid' }
  )
  const [checkCount, setCheckCount] = useState(0)

  useEffect(() => {
    try {
      sessionStorage.removeItem(PASSWORD_RESET_TOKEN_STORAGE_KEY)
    } catch {
      // Storage unavailable: the token never went there.
    }
    void navigate({ to: '.', search: {}, replace: true })
  }, [navigate])

  useEffect(() => {
    if (!token) return
    let active = true
    function showFailure(failure: unknown) {
      if (!active) return
      if (classifyPasswordResetFailure(failure).kind === 'invalid-link') {
        setLink({ kind: 'invalid' })
      } else {
        setLink({ kind: 'failed', failure })
      }
    }
    async function checkLink() {
      try {
        const res = await verifyPasswordResetToken(token)
        if (!active) return
        if (res.success && res.data) {
          setLink({ kind: 'ready', email: res.data.email })
        } else {
          showFailure(createServerError(res))
        }
      } catch (error) {
        showFailure(AuthOperationError.from(error))
      }
    }
    void checkLink()
    return () => {
      active = false
    }
  }, [token, checkCount])

  // The invalid and done states say what happened in their own message.
  const description =
    link.kind === 'invalid' || link.kind === 'done'
      ? undefined
      : t('Choose a new password for your account.')

  return (
    <AuthLayout>
      {/* React hoists this into <head> while the page is mounted. */}
      <meta name='referrer' content='no-referrer' />
      <AuthHeader title={t('Reset password')} description={description} />

      {link.kind === 'checking' && (
        <LoadingState message={t('Checking your reset link...')} />
      )}

      {link.kind === 'failed' && (
        <ErrorState
          className='min-h-0'
          description={getServerErrorMessage(link.failure, t('Request failed'))}
          onRetry={() => {
            setLink({ kind: 'checking' })
            setCheckCount((count) => count + 1)
          }}
        />
      )}

      {link.kind === 'invalid' && (
        <>
          <Alert variant='destructive'>
            <TriangleAlert aria-hidden='true' />
            <AlertDescription>
              {t(PASSWORD_RESET_LINK_INVALID)}
            </AlertDescription>
          </Alert>
          <Button render={<Link to='/forgot-password' />} className='w-full'>
            {t('Request a new link')}
          </Button>
        </>
      )}

      {link.kind === 'ready' && (
        <>
          <div className='border-border/60 bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2'>
            <MailCheck
              className='text-meow-accent-text size-4 shrink-0'
              aria-hidden='true'
            />
            <div className='grid min-w-0 flex-1 text-sm'>
              <span className='text-muted-foreground text-xs'>
                {t('Email')}
              </span>
              <span className='truncate font-medium'>{link.email}</span>
            </div>
          </div>
          <NewPasswordForm
            token={token}
            onCompleted={() => setLink({ kind: 'done' })}
            onLinkInvalid={() => setLink({ kind: 'invalid' })}
          />
        </>
      )}

      {link.kind === 'done' && (
        <>
          <div
            role='status'
            className='border-border/60 bg-muted/40 flex items-start gap-3 rounded-lg border p-4 text-sm'
          >
            <CircleCheck
              className='text-meow-accent-text mt-0.5 size-5 shrink-0'
              aria-hidden='true'
            />
            <p>{t('Password updated. Sign in with your new password.')}</p>
          </div>
          <Button render={<Link to='/sign-in' replace />} className='w-full'>
            {t('Sign in')}
          </Button>
        </>
      )}

      {link.kind !== 'done' && (
        <p className='text-muted-foreground text-center text-sm'>
          <Link
            to='/sign-in'
            className='hover:text-primary font-medium underline underline-offset-4'
          >
            {t('Back to login')}
          </Link>
        </p>
      )}
    </AuthLayout>
  )
}
