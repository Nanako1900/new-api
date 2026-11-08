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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { SystemStatus } from '../types'

/**
 * Consent to the user agreement and privacy policy before signing in or
 * signing up. Sites that publish neither document need no consent.
 */
export function useLegalConsent(status: SystemStatus | null) {
  const { t } = useTranslation()
  const [checked, setChecked] = useState(false)
  const required = Boolean(
    status?.user_agreement_enabled || status?.privacy_policy_enabled
  )
  const agreed = !required || checked

  /** Whether the user may continue; tells them to agree first if not. */
  function ensureAgreed(): boolean {
    if (agreed) return true
    toast.error(t('Please agree to the legal terms first'))
    return false
  }

  return { required, agreed, checked, setChecked, ensureAgreed }
}

export type LegalConsentState = ReturnType<typeof useLegalConsent>
