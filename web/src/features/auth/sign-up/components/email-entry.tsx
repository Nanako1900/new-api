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
import { ArrowRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'

import { startRegistrationEmail } from '../../api'
import { AuthCaptcha } from '../../components/auth-captcha'
import { registrationEmailSchema } from '../../constants'
import { useAuthCaptcha } from '../../hooks/use-auth-captcha'
import type { RegistrationEmailFlow } from '../../types'

type EmailEntryValues = z.infer<typeof registrationEmailSchema>

type EmailEntryProps = {
  defaultEmail: string
  /** Why the user is back here, such as an expired check (a message key). */
  notice: string
  /** Focus the field when the user comes back to this step, not on page load. */
  autoFocus: boolean
  onSent: (flow: RegistrationEmailFlow) => void
}

/** Sign-up step 1, first half: the address to verify and the human check. */
export function EmailEntry(props: EmailEntryProps) {
  const { t } = useTranslation()
  const [isSending, setIsSending] = useState(false)
  const captcha = useAuthCaptcha()
  const form = useForm<EmailEntryValues>({
    resolver: zodResolver(registrationEmailSchema),
    defaultValues: { email: props.defaultEmail },
  })
  const failedMessage = t('Failed to send verification email')

  async function onSubmit(values: EmailEntryValues) {
    const captchaToken = captcha.takeToken()
    if (captchaToken === null) return

    setIsSending(true)
    try {
      const res = await startRegistrationEmail(values.email, captchaToken)
      if (res.success && res.data) {
        props.onSent(res.data)
        return
      }
      handleServerError(createServerError(res, failedMessage))
    } catch (error) {
      handleServerError(AuthOperationError.from(error, failedMessage))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='grid gap-4'>
        {props.notice && (
          <Alert variant='destructive'>
            <AlertDescription>{t(props.notice)}</AlertDescription>
          </Alert>
        )}
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
                  autoFocus={props.autoFocus}
                  placeholder={t('name@example.com')}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <AuthCaptcha captcha={captcha} />
        <Button
          type='submit'
          className='w-full justify-center gap-2'
          disabled={isSending || !captcha.ready}
          {...captcha.gateProps}
        >
          {t('Send code')}
          {isSending ? (
            <Loader2 className='animate-spin' aria-hidden='true' />
          ) : (
            <ArrowRight aria-hidden='true' />
          )}
        </Button>
      </form>
    </Form>
  )
}
