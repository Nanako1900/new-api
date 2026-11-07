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
import { ArrowRight, Loader2, MailCheck } from 'lucide-react'
import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { sendPasswordResetEmail } from '@/features/auth/api'
import { AuthCaptcha } from '@/features/auth/components/auth-captcha'
import {
  forgotPasswordFormSchema,
  PASSWORD_RESET_COUNTDOWN,
} from '@/features/auth/constants'
import { useAuthCaptcha } from '@/features/auth/hooks/use-auth-captcha'
import { useCountdown } from '@/hooks/use-countdown'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>

export function ForgotPasswordForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  // The address the last link was sent to; set, the form shows the result.
  const [sentTo, setSentTo] = useState('')
  const captcha = useAuthCaptcha()
  const {
    secondsLeft,
    isActive,
    start: startCountdown,
  } = useCountdown({ initialSeconds: PASSWORD_RESET_COUNTDOWN })

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: ForgotPasswordFormValues) {
    const captchaToken = captcha.takeToken()
    if (captchaToken === null) return

    setIsLoading(true)
    try {
      const res = await sendPasswordResetEmail(data.email, captchaToken)
      if (res?.success) {
        setSentTo(data.email)
        startCountdown()
        toast.success(t('Reset email sent, please check your inbox'))
      } else {
        handleServerError(
          createServerError(res, t('Failed to send reset email'))
        )
      }
    } catch (_error) {
      handleServerError(
        AuthOperationError.from(_error, t('Failed to send reset email'))
      )
    } finally {
      setIsLoading(false)
    }
  }

  const submitLabel = isActive
    ? t('Resend ({{seconds}}s)', { seconds: secondsLeft })
    : t('Send reset email')
  const submitButton = (
    <Button
      type='submit'
      className='w-full justify-center gap-2'
      disabled={isLoading || isActive || !captcha.ready}
      {...captcha.gateProps}
    >
      {submitLabel}
      {isLoading ? (
        <Loader2 className='animate-spin' aria-hidden='true' />
      ) : (
        <ArrowRight aria-hidden='true' />
      )}
    </Button>
  )

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-4', className)}
        {...props}
      >
        {sentTo ? (
          <>
            <div
              role='status'
              className='border-border/60 bg-muted/40 flex items-start gap-3 rounded-lg border p-4'
            >
              <MailCheck
                className='text-meow-accent-text mt-0.5 size-5 shrink-0'
                aria-hidden='true'
              />
              <div className='grid min-w-0 gap-1 text-sm'>
                <p className='font-semibold'>{t('Check your email')}</p>
                <p className='text-muted-foreground'>
                  {t(
                    'If an account uses this address, a password reset link is on its way:'
                  )}
                </p>
                <p className='font-medium break-all'>{sentTo}</p>
              </div>
            </div>
            <AuthCaptcha captcha={captcha} />
            {submitButton}
            <Button
              type='button'
              variant='ghost'
              className='w-full'
              onClick={() => setSentTo('')}
            >
              {t('Use a different email')}
            </Button>
          </>
        ) : (
          <>
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Email')}</FormLabel>
                  <FormControl>
                    <Input
                      type='email'
                      autoComplete='email'
                      placeholder={t('name@example.com')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <AuthCaptcha captcha={captcha} />
            {submitButton}
          </>
        )}
      </form>
    </Form>
  )
}
