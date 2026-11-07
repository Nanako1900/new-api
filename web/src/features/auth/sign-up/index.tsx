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
import { Info } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { useStatus } from '@/hooks/use-status'

import { AuthLayout } from '../auth-layout'
import { AuthHeader } from '../components/auth-header'
import { saveAffiliateCode } from '../lib/storage'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const registrationOpen =
    !status?.self_use_mode_enabled && status?.register_enabled !== false

  // Keep the inviter of a ?aff= link for registration, OAuth included.
  useEffect(() => {
    const aff = new URLSearchParams(window.location.search).get('aff')?.trim()
    if (aff) saveAffiliateCode(aff)
  }, [])

  return (
    <AuthLayout>
      <AuthHeader title={t('Create an account')}>
        <p className='text-muted-foreground text-sm'>
          {t('Already have an account?')}{' '}
          <Link
            to='/sign-in'
            className='hover:text-primary font-medium underline underline-offset-4'
          >
            {t('Sign in')}
          </Link>
        </p>
      </AuthHeader>

      {registrationOpen ? (
        <SignUpForm />
      ) : (
        <Alert role='note'>
          <Info aria-hidden='true' />
          <AlertDescription className='text-foreground'>
            {t('New user registration has been disabled by administrator')}
          </AlertDescription>
        </Alert>
      )}
    </AuthLayout>
  )
}
