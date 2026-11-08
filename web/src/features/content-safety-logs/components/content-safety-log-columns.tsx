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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BadgeListCell, TruncatedCell } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { ModelBadge } from '@/features/usage-logs/components/model-badge'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { translateServerText } from '@/lib/server-error-message'

import {
  decisionPresentation,
  failureReasonLabelKey,
  parseStringList,
} from '../lib/log-fields'
import type { ContentSafetyLog } from '../types'
import { ContentSafetyLogDetailsDialog } from './content-safety-log-details-dialog'

export function useContentSafetyLogColumns(): ColumnDef<ContentSafetyLog>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  // The explicit type argument gives the cell callbacks their row type.
  return useMemo<ColumnDef<ContentSafetyLog>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        size: 170,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {Number.isFinite(row.original.created_at)
              ? dayjs
                  .unix(row.original.created_at)
                  .format('YYYY-MM-DD HH:mm:ss')
              : '—'}
          </span>
        ),
        meta: { label: t('Time'), mobileTitle: true },
      },
      {
        accessorKey: 'username',
        header: t('User'),
        size: 140,
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate'>{row.original.username || '—'}</div>
            <div className='text-muted-foreground font-mono text-xs'>
              #{row.original.user_id}
            </div>
          </div>
        ),
        meta: { label: t('User') },
      },
      {
        accessorKey: 'model',
        header: t('Model'),
        size: 180,
        cell: ({ row }) =>
          row.original.model ? (
            <ModelBadge modelName={row.original.model} />
          ) : (
            '—'
          ),
        meta: { label: t('Model') },
      },
      {
        accessorKey: 'decision',
        header: t('Decision'),
        size: 160,
        cell: ({ row }) => {
          const decision = decisionPresentation(row.original.decision)
          return (
            <div className='space-y-1'>
              <StatusBadge
                label={translateServerText(t, decision.labelKey)}
                variant={decision.variant}
                copyable={false}
              />
              {row.original.failure_reason && (
                <div className='text-muted-foreground text-xs'>
                  {translateServerText(
                    t,
                    failureReasonLabelKey(row.original.failure_reason)
                  )}
                </div>
              )}
            </div>
          )
        },
        meta: { label: t('Decision'), mobileBadge: true },
      },
      {
        id: 'hit_words',
        header: t('Hit words'),
        size: 200,
        cell: ({ row }) => (
          <BadgeListCell
            expandable
            expandLabel={t('Hit words')}
            items={parseStringList(row.original.hit_words, {
              unique: true,
            }).map((word) => (
              <StatusBadge
                key={word}
                label={word}
                variant='neutral'
                copyable={false}
              />
            ))}
          />
        ),
        meta: { label: t('Hit words') },
      },
      {
        accessorKey: 'latency_ms',
        header: t('Latency'),
        size: 100,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {row.original.decision === 'keyword_blocked'
              ? '—'
              : `${formatNumber(row.original.latency_ms, locale)} ${t('ms')}`}
          </span>
        ),
        meta: { label: t('Latency'), mobileHidden: true },
      },
      {
        accessorKey: 'request_path',
        header: t('Request Path'),
        size: 200,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-48 font-mono'>
            {row.original.request_path || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Request Path'), mobileHidden: true },
      },
      {
        id: 'details',
        header: t('Details'),
        size: 70,
        enableHiding: false,
        cell: ({ row }) => (
          <ContentSafetyLogDetailsDialog entry={row.original} />
        ),
        meta: { label: t('Details') },
      },
    ],
    [locale, t]
  )
}
