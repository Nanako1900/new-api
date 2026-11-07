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
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Loader2, MailCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { useCountdown } from '@/hooks/use-countdown'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { startRegistrationEmail, verifyRegistrationEmail } from '../../api'
import { AuthCaptcha } from '../../components/auth-captcha'
import {
  OTP_LENGTH,
  REGISTRATION_RESEND_SECONDS,
  registrationCodeSchema,
} from '../../constants'
import { useAuthCaptcha } from '../../hooks/use-auth-captcha'
import type { RegistrationEmailFlow } from '../../types'
import {
  endsEmailCheck,
  getRegistrationMessageKey,
  REGISTRATION_MESSAGES,
} from '../lib/registration-errors'

type CodeEntryValues = z.infer<typeof registrationCodeSchema>

type CodeEntryProps = {
  flow: RegistrationEmailFlow
  onVerified: (email: string) => void
  /** A new code was requested; the new flow replaces this one. */
  onResent: (flow: RegistrationEmailFlow) => void
  /** Back to the email field, with the reason (a message key) if any. */
  onRestart: (notice?: string) => void
}

/** Sign-up step 1, second half: the code sent to the address. */
export function CodeEntry(props: CodeEntryProps) {
  const { t } = useTranslation()
  const [isVerifying, setIsVerifying] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const captcha = useAuthCaptcha()
  const resend = useCountdown()
  const startResendCountdown = resend.start
  const form = useForm<CodeEntryValues>({
    resolver: zodResolver(registrationCodeSchema),
    defaultValues: { code: '' },
  })
  const sentMessage = t(
    'If this address can be used, we sent a 6-digit code to {{email}}.',
    { email: props.flow.email }
  )

  // The parent keys this component by flow token, so mounting means a code was
  // just sent.
  useEffect(() => {
    startResendCountdown(REGISTRATION_RESEND_SECONDS)
  }, [startResendCountdown])

  async function onSubmit(values: CodeEntryValues) {
    setIsVerifying(true)
    let failure: unknown
    try {
      const res = await verifyRegistrationEmail(
        props.flow.flow_token,
        values.code
      )
      if (res.success) {
        props.onVerified(res.data?.email || props.flow.email)
        return
      }
      failure = createServerError(res, t('Verification failed'))
    } catch (error) {
      failure = AuthOperationError.from(error, t('Verification failed'))
    } finally {
      setIsVerifying(false)
    }

    const messageKey = getRegistrationMessageKey(failure)
    if (messageKey === REGISTRATION_MESSAGES.wrongCode) {
      form.setError('code', { message: messageKey }, { shouldFocus: true })
    } else if (endsEmailCheck(messageKey)) {
      props.onRestart(messageKey)
    } else {
      handleServerError(failure)
    }
  }

  async function handleResend() {
    const captchaToken = captcha.takeToken()
    if (captchaToken === null) return

    const failedMessage = t('Failed to send verification email')
    setIsResending(true)
    try {
      const res = await startRegistrationEmail(props.flow.email, captchaToken)
      if (res.success && res.data) {
        toast.success(sentMessage)
        props.onResent(res.data)
        return
      }
      handleServerError(createServerError(res, failedMessage))
    } catch (error) {
      handleServerError(AuthOperationError.from(error, failedMessage))
    } finally {
      setIsResending(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='grid gap-4'>
        <div
          role='status'
          className='border-border/60 bg-muted/40 flex items-start gap-3 rounded-lg border p-4 text-sm'
        >
          <MailCheck
            className='text-meow-accent-text mt-0.5 size-5 shrink-0'
            aria-hidden='true'
          />
          <p className='min-w-0 break-words'>{sentMessage}</p>
        </div>
        <FormField
          control={form.control}
          name='code'
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('Verification code')}</FormLabel>
              <FormControl>
                <InputOTP
                  {...field}
                  maxLength={OTP_LENGTH}
                  pattern={REGEXP_ONLY_DIGITS}
                  inputMode='numeric'
                  autoComplete='one-time-code'
                  autoFocus
                >
                  <InputOTPGroup>
                    {Array.from({ length: OTP_LENGTH }, (_, index) => (
                      <InputOTPSlot
                        key={index}
                        index={index}
                        className={cn(
                          'size-11 text-lg sm:size-12',
                          fieldState.error && 'border-destructive'
                        )}
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type='submit'
          className='w-full justify-center gap-2'
          disabled={isVerifying}
        >
          {isVerifying && (
            <Loader2 className='animate-spin' aria-hidden='true' />
          )}
          {t('Continue')}
        </Button>
        {!resend.isActive && <AuthCaptcha captcha={captcha} />}
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => props.onRestart()}
          >
            {t('Use a different email')}
          </Button>
          <Button
            type='button'
            variant='outline'
            disabled={isResending || resend.isActive || !captcha.ready}
            onClick={() => void handleResend()}
            {...(resend.isActive ? {} : captcha.gateProps)}
          >
            {isResending && (
              <Loader2 className='animate-spin' aria-hidden='true' />
            )}
            {resend.isActive
              ? t('Resend ({{seconds}}s)', { seconds: resend.secondsLeft })
              : t('Resend code')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
