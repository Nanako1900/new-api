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
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { deleteCampaign, transitionCampaign } from '../api'
import { CAMPAIGN_ACTION_COPY, ERROR_MESSAGES } from '../constants'
import { cacheSubsidyQueryKeys } from '../lib'
import type { Campaign } from '../types'
import {
  type PendingCampaignAction,
  useCacheSubsidy,
} from './cache-subsidy-provider'

/**
 * Confirms and sends a status change or deletion. Starting a calculation
 * opens the details dialog so its progress is visible right away.
 */
export function CampaignActionDialog() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const { pendingAction, setPendingAction, setOpen, setCurrentRow } =
    useCacheSubsidy()

  const actionMutation = useMutation({
    mutationFn: async (
      pending: PendingCampaignAction
    ): Promise<Campaign | null> => {
      if (pending.action === 'delete') {
        const result = await deleteCampaign(pending.campaign.id)
        if (!result.success) throw createServerError(result)
        return null
      }
      const result = await transitionCampaign(
        pending.campaign.id,
        pending.action
      )
      if (!result.success) throw createServerError(result)
      return result.data ?? null
    },
    onSuccess: (updated, pending) => {
      toast.success(t(CAMPAIGN_ACTION_COPY[pending.action].success))
      setPendingAction(null)
      if (updated) {
        queryClient.setQueryData(
          cacheSubsidyQueryKeys.campaign(updated.id),
          updated
        )
      }
      void queryClient.invalidateQueries({
        queryKey: cacheSubsidyQueryKeys.admin(),
      })
      if (pending.action === 'delete') {
        setOpen(null)
        setCurrentRow(null)
        return
      }
      if (pending.action === 'calculate') {
        setCurrentRow(updated ?? pending.campaign)
        setOpen('details')
      }
    },
    onError: (error) =>
      handleServerError(error, t(ERROR_MESSAGES.ACTION_FAILED)),
  })

  const copy = pendingAction ? CAMPAIGN_ACTION_COPY[pendingAction.action] : null
  const campaign = pendingAction?.campaign

  return (
    <ConfirmDialog
      open={pendingAction !== null}
      onOpenChange={(open) => {
        if (!open && !actionMutation.isPending) setPendingAction(null)
      }}
      title={copy ? t(copy.title) : ''}
      desc={
        copy && campaign
          ? t(copy.description, {
              name: campaign.name,
              users: formatNumber(campaign.eligible_users, locale),
              amount: formatQuota(campaign.total_subsidy_quota),
              deadline: formatTimestampToDate(campaign.claim_deadline),
            })
          : ''
      }
      confirmText={copy ? t(copy.confirm) : undefined}
      destructive={copy?.destructive}
      isLoading={actionMutation.isPending}
      handleConfirm={() => {
        if (pendingAction) actionMutation.mutate(pendingAction)
      }}
      className='max-w-md'
    />
  )
}
