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
import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'

import { completePasswordReset } from '../../api'
import { passwordResetFormSchema } from '../../constants'
import { classifyPasswordResetFailure } from '../lib/reset-link'

type NewPasswordValues = z.infer<typeof passwordResetFormSchema>

type NewPasswordFormProps = {
  /** The reset link token, kept in memory only. */
  token: string
  onCompleted: () => void
  /** The link stopped being usable (expired, used, account changed). */
  onLinkInvalid: () => void
}

/** The new password for a verified reset link. */
export function NewPasswordForm(props: NewPasswordFormProps) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<NewPasswordValues>({
    resolver: zodResolver(passwordResetFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })
  const failedMessage = t('Failed to reset password')

  async function onSubmit(values: NewPasswordValues) {
    setIsSubmitting(true)
    let failure: unknown
    try {
      const res = await completePasswordReset(props.token, values.password)
      if (res.success) {
        props.onCompleted()
        return
      }
      failure = createServerError(res, failedMessage)
    } catch (error) {
      failure = AuthOperationError.from(error, failedMessage)
    } finally {
      setIsSubmitting(false)
    }

    const result = classifyPasswordResetFailure(failure)
    if (result.kind === 'invalid-link') {
      props.onLinkInvalid()
    } else if (result.kind === 'password-policy') {
      form.setError(
        'password',
        { message: result.messageKey },
        { shouldFocus: true }
      )
    } else {
      handleServerError(failure)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='grid gap-4'>
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('New password')}</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete='new-password'
                  // Mounted once the link checks out: start where the user types.
                  autoFocus
                  {...field}
                />
              </FormControl>
              <FormDescription>{t('Use 8–128 characters.')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Confirm password')}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete='new-password' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type='submit'
          className='w-full justify-center gap-2'
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className='animate-spin' aria-hidden='true' />
          ) : (
            <KeyRound aria-hidden='true' />
          )}
          {t('Update password')}
        </Button>
      </form>
    </Form>
  )
}
