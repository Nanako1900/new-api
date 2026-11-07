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
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import { Loader2, LogIn, KeyRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { z } from 'zod'

import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { login } from '@/features/auth/api'
import { AuthCaptcha } from '@/features/auth/components/auth-captcha'
import { AuthDivider } from '@/features/auth/components/auth-divider'
import { LegalConsent } from '@/features/auth/components/legal-consent'
import { OAuthProviders } from '@/features/auth/components/oauth-providers'
import { WeChatLoginDialog } from '@/features/auth/components/wechat-login-dialog'
import { loginFormSchema } from '@/features/auth/constants'
import { useAuthCaptcha } from '@/features/auth/hooks/use-auth-captcha'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { useLegalConsent } from '@/features/auth/hooks/use-legal-consent'
import { beginPasskeyLogin, finishPasskeyLogin } from '@/features/auth/passkey'
import {
  requestPasskeyAssertion,
  rememberPasskeyRPID,
  type PasskeyDomains,
} from '@/features/auth/passkey/assertion'
import { PasskeyDomainSelector } from '@/features/auth/passkey/components/passkey-domain-selector'
import type { AuthFormProps } from '@/features/auth/types'
import { useStatus } from '@/hooks/use-status'
import { handleServerError } from '@/lib/handle-server-error'
import { isPasskeySupported as detectPasskeySupport } from '@/lib/passkey'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: AuthFormProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false)
  const [passkeyDomains, setPasskeyDomains] = useState<PasskeyDomains | null>(
    null
  )
  const [passkeyRPID, setPasskeyRPID] = useState<string>()
  const passkeyOperation = useRef<AbortController | null>(null)
  useEffect(() => () => passkeyOperation.current?.abort(), [])
  const [isWeChatDialogOpen, setIsWeChatDialogOpen] = useState(false)
  const loginFailedMessage = t('Login failed')

  const { status } = useStatus()
  const passkeyLoginEnabled = Boolean(
    status?.passkey_login ?? status?.data?.passkey_login
  )
  const passwordLoginEnabled =
    (status?.password_login_enabled ??
      status?.data?.password_login_enabled ??
      true) !== false
  const passwordLoginEncryptionEnabled =
    (status?.password_login_encryption_enabled ??
      status?.data?.password_login_encryption_enabled ??
      false) === true
  const captcha = useAuthCaptcha()
  const legalConsent = useLegalConsent(status)
  const { handleLoginResult } = useAuthRedirect()

  const passkeyButtonDisabled =
    isPasskeyLoading || !passkeySupported || !legalConsent.agreed
  const hasWeChatLogin = Boolean(status?.wechat_login)
  const hasOAuthLogin = Boolean(
    status?.github_oauth ||
    status?.discord_oauth ||
    status?.oidc_enabled ||
    status?.linuxdo_oauth ||
    status?.telegram_oauth ||
    (status?.custom_oauth_providers?.length ?? 0) > 0
  )
  const hasAlternativeLogin =
    passkeyLoginEnabled || hasWeChatLogin || hasOAuthLogin

  useEffect(() => {
    detectPasskeySupport()
      .then(setPasskeySupported)
      .catch(() => setPasskeySupported(false))
  }, [])

  const form = useForm<z.infer<typeof loginFormSchema>>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof loginFormSchema>) {
    if (!legalConsent.ensureAgreed()) return

    const captchaToken = captcha.takeToken()
    if (captchaToken === null) return

    setIsLoading(true)
    try {
      const res = await login({
        username: data.username,
        password: data.password,
        captcha: captchaToken,
        passwordEncryptionEnabled: passwordLoginEncryptionEnabled,
      })

      if (res.success) {
        form.setValue('password', '')
        if (await handleLoginResult(res.data, redirectTo)) {
          toast.success(t('Welcome back!'))
        }
      } else {
        handleServerError(createServerError(res, loginFailedMessage))
      }
    } catch (error: unknown) {
      handleServerError(AuthOperationError.from(error, loginFailedMessage))
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenWeChatDialog = () => {
    if (!legalConsent.ensureAgreed()) return
    setIsWeChatDialogOpen(true)
  }

  async function handlePasskeyLogin() {
    if (!legalConsent.ensureAgreed()) return

    if (!passkeySupported) {
      toast.error(t('Passkey is not supported on this device'))
      return
    }

    if (!navigator?.credentials) {
      toast.error(t('Passkey is not available in this browser'))
      return
    }

    if (passkeyOperation.current) return
    const controller = new AbortController()
    passkeyOperation.current = controller
    setIsPasskeyLoading(true)
    try {
      const passkey = await requestPasskeyAssertion(
        (rpID) => beginPasskeyLogin(rpID, controller.signal),
        controller.signal,
        { rpID: passkeyRPID, onDomains: setPasskeyDomains }
      )
      const finish = await finishPasskeyLogin(
        passkey.flowToken,
        passkey.assertion,
        controller.signal
      )
      controller.signal.throwIfAborted()
      if (!finish.success) {
        throw createServerError(finish, t('Failed to complete Passkey login'))
      }

      rememberPasskeyRPID(passkey.rpID)
      if (await handleLoginResult(finish.data, redirectTo)) {
        toast.success(t('Signed in with Passkey'))
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) return
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        toast.info(t('Passkey login was cancelled or timed out'))
      } else if (error instanceof Error) {
        handleServerError(AuthOperationError.from(error))
      } else {
        handleServerError(
          AuthOperationError.from(error, t('Passkey login failed'))
        )
      }
    } finally {
      if (passkeyOperation.current === controller) {
        passkeyOperation.current = null
      }
      setIsPasskeyLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-4', className)}
        {...props}
      >
        {passwordLoginEnabled && (
          <>
            <FormField
              control={form.control}
              name='username'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Username or Email')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('Enter your username or email')}
                      autoComplete='username'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <div className='flex items-center justify-between gap-2'>
                    <FormLabel>{t('Password')}</FormLabel>
                    <Link
                      to='/forgot-password'
                      className='text-muted-foreground hover:text-primary text-sm font-medium'
                    >
                      {t('Forgot password?')}
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput
                      placeholder={t('Enter password')}
                      autoComplete='current-password'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        <LegalConsent
          status={status}
          checked={legalConsent.checked}
          onCheckedChange={legalConsent.setChecked}
        />

        {passwordLoginEnabled && (
          <>
            <AuthCaptcha captcha={captcha} />
            <Button
              type='submit'
              className='w-full justify-center gap-2'
              disabled={isLoading || !captcha.ready || !legalConsent.agreed}
              {...captcha.gateProps}
            >
              {isLoading ? (
                <Loader2 className='animate-spin' aria-hidden='true' />
              ) : (
                <LogIn aria-hidden='true' />
              )}
              {t('Sign in')}
            </Button>
          </>
        )}

        {passwordLoginEnabled && hasAlternativeLogin && (
          <AuthDivider className='mt-2'>{t('Or continue with')}</AuthDivider>
        )}

        {passkeyLoginEnabled && (
          <div className='space-y-1'>
            <Button
              type='button'
              variant='outline'
              disabled={passkeyButtonDisabled}
              onClick={handlePasskeyLogin}
              className='h-11 w-full justify-center gap-2 rounded-lg'
            >
              {isPasskeyLoading ? (
                <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' />
              ) : (
                <KeyRound className='h-4 w-4' aria-hidden='true' />
              )}
              {t('Sign in with Passkey')}
            </Button>
            <PasskeyDomainSelector
              domains={passkeyDomains}
              value={passkeyRPID}
              onChange={setPasskeyRPID}
              disabled={passkeyButtonDisabled}
            />
            {!passkeySupported && (
              <p className='text-muted-foreground text-xs'>
                {t('Passkey is not supported on this device.')}
              </p>
            )}
          </div>
        )}

        <OAuthProviders
          status={status}
          redirectTo={redirectTo}
          disabled={isLoading || !legalConsent.agreed}
          onWeChatLogin={hasWeChatLogin ? handleOpenWeChatDialog : undefined}
          withDivider={false}
        />
      </form>

      {hasWeChatLogin && (
        <WeChatLoginDialog
          open={isWeChatDialogOpen}
          onOpenChange={setIsWeChatDialogOpen}
          status={status}
          redirectTo={redirectTo}
        />
      )}
    </Form>
  )
}
