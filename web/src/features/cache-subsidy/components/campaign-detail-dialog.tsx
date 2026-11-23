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
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatNumber,
  formatPercent,
  formatQuota,
  formatTimestampToDate,
} from '@/lib/format'
import { createServerError } from '@/lib/server-error-message'

import { getCampaign } from '../api'
import {
  CAMPAIGN_POLL_INTERVAL_MS,
  ERROR_MESSAGES,
  SKIP_REASON_LABELS,
} from '../constants'
import {
  cacheSubsidyQueryKeys,
  hasCampaignGrants,
  isCampaignComputing,
} from '../lib'
import type { Campaign, SkipReason } from '../types'
import { useCacheSubsidy } from './cache-subsidy-provider'
import { CampaignStatusBadge } from './campaign-status-badge'

type Stat = { label: string; value: string }

function StatList(props: { stats: Stat[]; label: string }) {
  return (
    <dl
      aria-label={props.label}
      className='grid grid-cols-2 gap-2 sm:grid-cols-3'
    >
      {props.stats.map((stat) => (
        <div
          key={stat.label}
          className='bg-muted/60 flex flex-col-reverse gap-0.5 rounded-lg px-3 py-2'
        >
          <dt className='text-muted-foreground text-xs'>{stat.label}</dt>
          <dd className='text-base font-semibold tabular-nums'>{stat.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Campaign rules, calculation progress and the totals preview. The campaign
 * is polled while the server is still calculating.
 */
export function CampaignDetailDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaign?: Campaign
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { setOpen, setCurrentRow, setPendingAction } = useCacheSubsidy()
  const id = props.campaign?.id

  const campaignQuery = useQuery({
    queryKey: cacheSubsidyQueryKeys.campaign(id ?? 0),
    queryFn: async () => {
      const result = await getCampaign(id ?? 0)
      if (!result.success || !result.data) {
        throw createServerError(result, t(ERROR_MESSAGES.LOAD_CAMPAIGN_FAILED))
      }
      return result.data
    },
    enabled: props.open && id !== undefined,
    placeholderData: props.campaign,
    refetchInterval: (query) =>
      isCampaignComputing(query.state.data?.status)
        ? CAMPAIGN_POLL_INTERVAL_MS
        : false,
    // The dialog shows a failed load itself; a failed poll keeps the last data.
    meta: { errorPage: false },
  })

  const campaign = campaignQuery.data
  const computing = isCampaignComputing(campaign?.status)
  const calculated = hasCampaignGrants(campaign?.status)
  const count = (value: number) => formatNumber(value, locale)

  const skipReasons = Object.entries(campaign?.skip_reasons ?? {}).filter(
    ([, value]) => value > 0
  )

  let footer: ReactNode = null
  if (campaign && calculated) {
    footer = (
      <>
        <Button
          variant='outline'
          onClick={() => {
            setCurrentRow(campaign)
            setOpen('grants')
          }}
        >
          {t('View grants')}
        </Button>
        {campaign.status === 'calculated' && (
          <Button
            onClick={() => setPendingAction({ campaign, action: 'open' })}
          >
            {t('Open claims')}
          </Button>
        )}
      </>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={campaign?.name ?? t('Campaign')}
      description={
        campaign
          ? `${formatTimestampToDate(campaign.window_start)} → ${formatTimestampToDate(campaign.window_end)}`
          : undefined
      }
      footer={footer}
    >
      {campaignQuery.isError && !campaign && (
        <ErrorState
          title={t(ERROR_MESSAGES.LOAD_CAMPAIGN_FAILED)}
          description={campaignQuery.error.message}
          onRetry={() => void campaignQuery.refetch()}
        />
      )}
      {campaign && (
        <div className='flex flex-col gap-5'>
          <section className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-center gap-2'>
              <CampaignStatusBadge campaign={campaign} />
              <span className='text-muted-foreground text-sm'>
                {t('{{percent}} of cache cost', {
                  percent: formatPercent(campaign.subsidy_percent),
                })}
                {' · '}
                {campaign.include_cache_writes
                  ? t('Reads + writes')
                  : t('Reads only')}
              </span>
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {(campaign.model_rules ?? []).map((rule) => (
                <StatusBadge
                  key={rule}
                  label={rule}
                  variant='neutral'
                  copyable={false}
                  className='font-mono'
                />
              ))}
            </div>
            {campaign.description && (
              <p className='text-muted-foreground text-sm'>
                {campaign.description}
              </p>
            )}
          </section>

          {computing && (
            <Progress value={campaign.progress}>
              <ProgressLabel>
                {campaign.status === 'queued'
                  ? t('Waiting for the calculation task')
                  : t('Scanning consume logs')}
              </ProgressLabel>
              <ProgressValue />
            </Progress>
          )}

          {(computing || calculated) && (
            <StatList
              label={t('Scan results')}
              stats={[
                {
                  label: t('Scanned logs'),
                  value: count(campaign.scanned_logs),
                },
                {
                  label: t('Matched logs'),
                  value: count(campaign.matched_logs),
                },
                {
                  label: t('Skipped logs'),
                  value: count(campaign.skipped_logs),
                },
              ]}
            />
          )}

          {skipReasons.length > 0 && (
            <section className='flex flex-col gap-2'>
              <h3 className='text-sm font-semibold'>
                {t('Skipped logs by reason')}
              </h3>
              <ul className='divide-border rounded-lg border text-sm'>
                {skipReasons.map(([reason, value]) => (
                  <li
                    key={reason}
                    className='flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0'
                  >
                    <span>
                      {t(SKIP_REASON_LABELS[reason as SkipReason] ?? reason)}
                    </span>
                    <span className='tabular-nums'>{count(value)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {calculated && (
            <StatList
              label={t('Totals')}
              stats={[
                {
                  label: t('Eligible users'),
                  value: count(campaign.eligible_users),
                },
                {
                  label: t('Total cache cost'),
                  value: formatQuota(campaign.total_cache_quota),
                },
                {
                  label: t('Total subsidy'),
                  value: formatQuota(campaign.total_subsidy_quota),
                },
                ...(campaign.status === 'calculated'
                  ? []
                  : [
                      {
                        label: t('Claimed users'),
                        value: count(campaign.claimed_users),
                      },
                      {
                        label: t('Claimed amount'),
                        value: formatQuota(campaign.claimed_quota),
                      },
                    ]),
              ]}
            />
          )}

          {campaign.status === 'draft' && (
            <p className='text-muted-foreground text-sm'>
              {t(
                'Start the calculation after the window has ended to preview each user’s subsidy.'
              )}
            </p>
          )}

          <p className='text-muted-foreground text-xs'>
            {t('Claim deadline')}:{' '}
            {formatTimestampToDate(campaign.claim_deadline)}
          </p>
        </div>
      )}
    </Dialog>
  )
}
