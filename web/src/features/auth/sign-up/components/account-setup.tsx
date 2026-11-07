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
import { Loader2, MailCheck, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'

import { register } from '../../api'
import { LegalConsent } from '../../components/legal-consent'
import { accountSetupSchema } from '../../constants'
import { useAuthRedirect } from '../../hooks/use-auth-redirect'
import type { LegalConsentState } from '../../hooks/use-legal-consent'
import { getAffiliateCode } from '../../lib/storage'
import type { SystemStatus } from '../../types'
import {
  endsEmailCheck,
  getRegistrationMessageKey,
  REGISTRATION_MESSAGES,
} from '../lib/registration-errors'

type AccountSetupValues = z.infer<typeof accountSetupSchema>

type AccountSetupProps = {
  /** The verified address and the flow token that proves it. */
  email: string
  registrationToken: string
  status: SystemStatus | null
  legalConsent: LegalConsentState
  /** Back to step 1, with the reason (a message key) if any. */
  onRestart: (notice?: string) => void
}

/** Sign-up step 2: the account itself; success signs the user in. */
export function AccountSetup(props: AccountSetupProps) {
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { handleLoginResult } = useAuthRedirect()
  const form = useForm<AccountSetupValues>({
    resolver: zodResolver(accountSetupSchema),
    defaultValues: { username: '', password: '', confirmPassword: '' },
  })
  const failedMessage = t('Failed to create account')

  async function onSubmit(values: AccountSetupValues) {
    if (!props.legalConsent.ensureAgreed()) return

    setIsSubmitting(true)
    let failure: unknown
    try {
      const res = await register({
        username: values.username,
        password: values.password,
        registration_token: props.registrationToken,
        aff_code: getAffiliateCode(),
      })
      if (res.success) {
        if (await handleLoginResult(res.data)) {
          toast.success(t('Account created'))
        }
        return
      }
      failure = createServerError(res, failedMessage)
    } catch (error) {
      failure = AuthOperationError.from(error, failedMessage)
    } finally {
      setIsSubmitting(false)
    }

    const messageKey = getRegistrationMessageKey(failure)
    if (
      messageKey === REGISTRATION_MESSAGES.usernameTaken ||
      messageKey === REGISTRATION_MESSAGES.usernameHasAt
    ) {
      form.setError('username', { message: messageKey }, { shouldFocus: true })
    } else if (endsEmailCheck(messageKey)) {
      props.onRestart(messageKey)
    } else {
      handleServerError(failure)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='grid gap-4'>
        <div className='border-border/60 bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2'>
          <MailCheck
            className='text-meow-accent-text size-4 shrink-0'
            aria-hidden='true'
          />
          <div className='grid min-w-0 flex-1 text-sm'>
            <span className='text-muted-foreground text-xs'>
              {t('Verified email')}
            </span>
            <span className='truncate font-medium'>{props.email}</span>
          </div>
          <Button
            type='button'
            variant='link'
            size='sm'
            onClick={() => props.onRestart()}
          >
            {t('Change')}
          </Button>
        </div>
        <FormField
          control={form.control}
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Username')}</FormLabel>
              <FormControl>
                <Input
                  autoComplete='username'
                  // Mounted only after the code is verified: keep keyboard
                  // focus on the step the user just reached.
                  autoFocus
                  placeholder={t('Choose a username')}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {t('Up to 20 characters, without @.')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Password')}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete='new-password' {...field} />
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
        <LegalConsent
          status={props.status}
          checked={props.legalConsent.checked}
          onCheckedChange={props.legalConsent.setChecked}
        />
        <Button
          type='submit'
          className='w-full justify-center gap-2'
          disabled={isSubmitting || !props.legalConsent.agreed}
        >
          {isSubmitting ? (
            <Loader2 className='animate-spin' aria-hidden='true' />
          ) : (
            <UserPlus aria-hidden='true' />
          )}
          {t('Create account')}
        </Button>
      </form>
    </Form>
  )
}
