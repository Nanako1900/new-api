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
import type { Table as TanstackTable } from '@tanstack/react-table'
import { Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPercent, formatQuota, formatTimestampToDate } from '@/lib/format'

import { hasCampaignGrants } from '../lib'
import type { Campaign } from '../types'
import { CampaignRowActions } from './campaign-row-actions'
import { CampaignStatusBadge } from './campaign-status-badge'

const MOBILE_SKELETON_KEYS = [
  'cache-subsidy-mobile-skeleton-1',
  'cache-subsidy-mobile-skeleton-2',
  'cache-subsidy-mobile-skeleton-3',
]

interface CampaignsMobileListProps {
  table: TanstackTable<Campaign>
  isLoading: boolean
}

export function CampaignsMobileList(props: CampaignsMobileListProps) {
  const { t } = useTranslation()
  const rows = props.table.getRowModel().rows

  if (props.isLoading) {
    return (
      <div className='divide-border overflow-hidden rounded-lg border'>
        {MOBILE_SKELETON_KEYS.map((key) => (
          <div
            key={key}
            className='space-y-2 border-b px-3 py-2.5 last:border-b-0'
          >
            <div className='flex items-center justify-between'>
              <Skeleton className='h-4 w-32' />
              <Skeleton className='h-5 w-16 rounded-md' />
            </div>
            <Skeleton className='h-3 w-44' />
            <Skeleton className='h-3 w-28' />
          </div>
        ))}
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className='rounded-lg border p-8'>
        <Empty className='border-none p-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Database className='size-6' />
            </EmptyMedia>
            <EmptyTitle>{t('No cache subsidy campaigns')}</EmptyTitle>
            <EmptyDescription>
              {t(
                'Create a campaign to refund part of the cache cost users paid from their wallets.'
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className='divide-border overflow-hidden rounded-lg border'>
      {rows.map((row) => {
        const campaign = row.original
        const calculated = hasCampaignGrants(campaign.status)
        return (
          <div
            key={row.id}
            className='bg-card space-y-2.5 border-b px-3 py-2.5 last:border-b-0'
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-semibold'>
                  {campaign.name}
                </div>
                <div className='text-muted-foreground font-mono text-[11px]'>
                  {formatTimestampToDate(campaign.window_start)} →{' '}
                  {formatTimestampToDate(campaign.window_end)}
                </div>
              </div>
              <CampaignStatusBadge campaign={campaign} />
            </div>

            <div className='flex items-center justify-between gap-2 text-xs'>
              <span className='text-muted-foreground'>{t('Subsidy')}</span>
              <span className='font-medium tabular-nums'>
                {formatPercent(campaign.subsidy_percent)}
              </span>
            </div>
            {calculated && (
              <div className='flex items-center justify-between gap-2 text-xs'>
                <span className='text-muted-foreground'>
                  {t('Total subsidy')}
                </span>
                <span className='font-medium tabular-nums'>
                  {formatQuota(campaign.total_subsidy_quota)}
                </span>
              </div>
            )}
            <div className='flex items-center justify-between gap-2'>
              <span className='text-muted-foreground font-mono text-[11px]'>
                {t('Claim deadline')}{' '}
                {formatTimestampToDate(campaign.claim_deadline)}
              </span>
              <CampaignRowActions campaign={campaign} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
