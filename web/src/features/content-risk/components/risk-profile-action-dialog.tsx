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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { handleServerError } from '@/lib/handle-server-error'

import { resetRiskProfile, setRiskProfileTrust } from '../api'
import { RISK_PROFILES_QUERY_KEY } from '../constants'
import type { RiskProfileAction } from '../types'

// All values are i18n keys; render them with t(key).
const ACTION_COPY: Record<
  RiskProfileAction['kind'],
  {
    title: string
    description: string
    confirm: string
    success: string
    destructive: boolean
  }
> = {
  reset: {
    title: 'Reset score and unblock?',
    description:
      'The risk score of {{username}} returns to 0 and a block is lifted, so the account can use the API again. The verdict counts are kept.',
    confirm: 'Reset score and unblock',
    success: 'Risk score reset',
    destructive: false,
  },
  trust: {
    title: 'Trust this account?',
    description:
      '{{username}} will never be reviewed first, throttled or blocked. Its requests are still reviewed in the background and logged.',
    confirm: 'Trust account',
    success: 'Account trusted',
    destructive: true,
  },
  untrust: {
    title: 'Stop trusting this account?',
    description: 'The risk level of {{username}} takes effect again.',
    confirm: 'Stop trusting',
    success: 'Account no longer trusted',
    destructive: false,
  },
}

export function RiskProfileActionDialog(props: {
  pending: RiskProfileAction | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (action: RiskProfileAction) =>
      action.kind === 'reset'
        ? resetRiskProfile(action.profile.user_id)
        : setRiskProfileTrust(action.profile.user_id, action.kind === 'trust'),
    onSuccess: (_result, action) => {
      toast.success(t(ACTION_COPY[action.kind].success))
      props.onClose()
      void queryClient.invalidateQueries({
        queryKey: [RISK_PROFILES_QUERY_KEY],
      })
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })
  const copy = props.pending ? ACTION_COPY[props.pending.kind] : null

  return (
    <ConfirmDialog
      open={props.pending !== null}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={copy ? t(copy.title) : ''}
      desc={
        copy && props.pending
          ? t(copy.description, {
              username:
                props.pending.profile.username ||
                `#${props.pending.profile.user_id}`,
            })
          : ''
      }
      confirmText={copy ? t(copy.confirm) : undefined}
      destructive={copy?.destructive}
      isLoading={mutation.isPending}
      handleConfirm={() => {
        if (props.pending) mutation.mutate(props.pending)
      }}
      className='max-w-md'
    />
  )
}
