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
import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatNumber,
  formatPercent,
  formatQuota,
  formatTimestampToDate,
} from '@/lib/format'

import { hasCampaignGrants } from '../lib'
import type { Campaign } from '../types'
import { useCacheSubsidy } from './cache-subsidy-provider'
import { CampaignRowActions } from './campaign-row-actions'
import { CampaignStatusBadge } from './campaign-status-badge'

const EMPTY = <span className='text-muted-foreground text-sm'>-</span>

export function useCampaignsColumns(): ColumnDef<Campaign>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { setOpen, setCurrentRow } = useCacheSubsidy()

  return [
    {
      accessorKey: 'name',
      header: t('Name'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='flex min-w-0 flex-col gap-0.5'>
          <Button
            variant='link'
            className='text-foreground hover:text-primary h-auto max-w-full justify-start truncate p-0 font-medium'
            onClick={() => {
              setCurrentRow(row.original)
              setOpen('details')
            }}
          >
            {row.original.name}
          </Button>
          {row.original.description && (
            <span className='text-muted-foreground line-clamp-1 text-xs'>
              {row.original.description}
            </span>
          )}
        </div>
      ),
      size: 220,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => (
        <CampaignStatusBadge campaign={row.original} className='-ml-1.5' />
      ),
      size: 140,
    },
    {
      id: 'window',
      header: t('Window'),
      cell: ({ row }) => (
        <div className='flex flex-col font-mono text-xs leading-5'>
          <span>{formatTimestampToDate(row.original.window_start)}</span>
          <span className='text-muted-foreground'>
            {formatTimestampToDate(row.original.window_end)}
          </span>
        </div>
      ),
      size: 170,
    },
    {
      accessorKey: 'subsidy_percent',
      header: t('Subsidy'),
      cell: ({ row }) => (
        <div className='flex flex-col leading-5'>
          <span className='font-semibold tabular-nums'>
            {formatPercent(row.original.subsidy_percent)}
          </span>
          <span className='text-muted-foreground text-xs'>
            {row.original.include_cache_writes
              ? t('Reads + writes')
              : t('Reads only')}
          </span>
        </div>
      ),
      size: 120,
    },
    {
      accessorKey: 'eligible_users',
      header: t('Eligible users'),
      cell: ({ row }) =>
        hasCampaignGrants(row.original.status) ? (
          <span className='tabular-nums'>
            {formatNumber(row.original.eligible_users, locale)}
          </span>
        ) : (
          EMPTY
        ),
      size: 120,
    },
    {
      accessorKey: 'total_subsidy_quota',
      header: t('Total subsidy'),
      cell: ({ row }) =>
        hasCampaignGrants(row.original.status) ? (
          <span className='font-medium tabular-nums'>
            {formatQuota(row.original.total_subsidy_quota)}
          </span>
        ) : (
          EMPTY
        ),
      size: 130,
    },
    {
      id: 'claimed',
      header: t('Claimed'),
      cell: ({ row }) =>
        hasCampaignGrants(row.original.status) ? (
          <div className='flex flex-col leading-5'>
            <span className='tabular-nums'>
              {t('{{claimed}} / {{total}} users', {
                claimed: formatNumber(row.original.claimed_users, locale),
                total: formatNumber(row.original.eligible_users, locale),
              })}
            </span>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {formatQuota(row.original.claimed_quota)}
            </span>
          </div>
        ) : (
          EMPTY
        ),
      size: 140,
    },
    {
      accessorKey: 'claim_deadline',
      header: t('Claim deadline'),
      cell: ({ row }) => (
        <span className='font-mono text-xs'>
          {formatTimestampToDate(row.original.claim_deadline)}
        </span>
      ),
      size: 170,
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      cell: ({ row }) => <CampaignRowActions campaign={row.original} />,
      meta: { pinned: 'right' as const },
    },
  ]
}
