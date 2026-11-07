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
import { Info } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { useStatus } from '@/hooks/use-status'

import { AuthDivider } from '../../components/auth-divider'
import { LegalConsent } from '../../components/legal-consent'
import { OAuthProviders } from '../../components/oauth-providers'
import { WeChatLoginDialog } from '../../components/wechat-login-dialog'
import { useLegalConsent } from '../../hooks/use-legal-consent'
import { hasOAuthProviders } from '../../lib/oauth'
import type { RegistrationEmailFlow } from '../../types'
import { AccountSetup } from './account-setup'
import { CodeEntry } from './code-entry'
import { EmailEntry } from './email-entry'
import { SignUpSteps } from './sign-up-steps'

type SignUpStage =
  | { step: 'email'; notice: string; returned: boolean }
  | { step: 'code'; flow: RegistrationEmailFlow }
  | { step: 'account'; email: string; registrationToken: string }

/**
 * Two-step password sign-up (verify the email, then set up the account),
 * followed by the OAuth sign-up options.
 */
export function SignUpForm() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const legalConsent = useLegalConsent(status)
  const [stage, setStage] = useState<SignUpStage>({
    step: 'email',
    notice: '',
    returned: false,
  })
  // The last address used, so going back to step 1 keeps it.
  const [email, setEmail] = useState('')
  const [isWeChatDialogOpen, setIsWeChatDialogOpen] = useState(false)

  // Password sign-up always verifies the email, so it needs email delivery.
  const passwordSignUpAvailable =
    status?.password_register_enabled !== false &&
    status?.email_delivery_configured !== false
  const oauthRegisterEnabled =
    (status?.oauth_register_enabled ?? status?.data?.oauth_register_enabled) !==
    false
  const hasOAuthSignUp =
    hasOAuthProviders(status) ||
    (status?.custom_oauth_providers?.length ?? 0) > 0
  const hasWeChatLogin = Boolean(status?.wechat_login)
  const showOAuth =
    oauthRegisterEnabled && hasOAuthSignUp && stage.step !== 'account'

  function restart(notice = '') {
    setStage({ step: 'email', notice, returned: true })
  }

  function handleCodeSent(flow: RegistrationEmailFlow) {
    setEmail(flow.email)
    setStage({ step: 'code', flow })
  }

  function handleOpenWeChatDialog() {
    if (!legalConsent.ensureAgreed()) return
    setIsWeChatDialogOpen(true)
  }

  return (
    <div className='grid gap-6'>
      {passwordSignUpAvailable ? (
        <div className='grid gap-5'>
          <SignUpSteps current={stage.step === 'account' ? 1 : 0} />
          {stage.step === 'email' && (
            <EmailEntry
              defaultEmail={email}
              notice={stage.notice}
              autoFocus={stage.returned}
              onSent={handleCodeSent}
            />
          )}
          {stage.step === 'code' && (
            <CodeEntry
              key={stage.flow.flow_token}
              flow={stage.flow}
              onVerified={(verifiedEmail) =>
                setStage({
                  step: 'account',
                  email: verifiedEmail,
                  registrationToken: stage.flow.flow_token,
                })
              }
              onResent={handleCodeSent}
              onRestart={restart}
            />
          )}
          {stage.step === 'account' && (
            <AccountSetup
              email={stage.email}
              registrationToken={stage.registrationToken}
              status={status}
              legalConsent={legalConsent}
              onRestart={restart}
            />
          )}
        </div>
      ) : (
        <Alert role='note'>
          <Info aria-hidden='true' />
          <AlertDescription className='text-foreground'>
            <p>
              {t('Sign-up with email and password is currently unavailable.')}
            </p>
            {oauthRegisterEnabled && hasOAuthSignUp && (
              <p>
                {t(
                  'You can still create an account with one of the options below.'
                )}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {showOAuth && (
        <div className='grid gap-4'>
          {passwordSignUpAvailable && (
            <AuthDivider>{t('Or continue with')}</AuthDivider>
          )}
          <LegalConsent
            status={status}
            checked={legalConsent.checked}
            onCheckedChange={legalConsent.setChecked}
          />
          <OAuthProviders
            status={status}
            disabled={!legalConsent.agreed}
            onWeChatLogin={hasWeChatLogin ? handleOpenWeChatDialog : undefined}
            withDivider={false}
          />
        </div>
      )}

      {hasWeChatLogin && (
        <WeChatLoginDialog
          open={isWeChatDialogOpen}
          onOpenChange={setIsWeChatDialogOpen}
          status={status}
        />
      )}
    </div>
  )
}
