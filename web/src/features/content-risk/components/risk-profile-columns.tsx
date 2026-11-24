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
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { DataTableRowActionMenu } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  RISK_CATEGORIES,
  RISK_CATEGORY_LABEL_KEYS,
} from '@/features/system-settings/request-policies/risk-form'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { translateServerText } from '@/lib/server-error-message'

import { RISK_LEVEL_PRESENTATION, RISK_LEVELS } from '../constants'
import type {
  RiskLevelPresentation,
  RiskProfile,
  RiskProfileAction,
  RiskView,
} from '../types'

/** A level the server added later is shown as stored, without a color. */
function levelPresentation(level: string): RiskLevelPresentation {
  const known = RISK_LEVELS.find((item) => item === level)
  return known
    ? RISK_LEVEL_PRESENTATION[known]
    : { labelKey: level, variant: 'neutral' }
}

const ZERO_TOLERANCE_REASON_PREFIX = 'zero_tolerance:'

/**
 * Why an account is blocked, from the stored reason: `score_threshold`, or
 * `zero_tolerance:<category>` for one unsafe verdict in a zero-tolerance
 * category. A reason the server added later is shown as stored.
 */
function blockedReasonText(t: TFunction, reason: string): string {
  if (reason === 'score_threshold') {
    return t('Score reached the block threshold')
  }
  if (!reason.startsWith(ZERO_TOLERANCE_REASON_PREFIX)) {
    return translateServerText(t, reason)
  }
  const category = reason.slice(ZERO_TOLERANCE_REASON_PREFIX.length)
  const known = RISK_CATEGORIES.find((item) => item === category)
  return t('Zero-tolerance category: {{category}}', {
    category: known ? t(RISK_CATEGORY_LABEL_KEYS[known]) : category,
  })
}

export function useRiskProfileColumns(
  view: RiskView,
  onAction: (action: RiskProfileAction) => void
): ColumnDef<RiskProfile>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const shadow = view === 'shadow'
  // The explicit type argument gives the cell callbacks their row type.
  return useMemo<ColumnDef<RiskProfile>[]>(
    () => [
      {
        accessorKey: 'username',
        header: t('Account'),
        size: 160,
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate'>{row.original.username || '—'}</div>
            <div className='text-muted-foreground font-mono text-xs'>
              #{row.original.user_id}
            </div>
          </div>
        ),
        meta: { label: t('Account'), mobileTitle: true },
      },
      {
        id: 'level',
        header: t('Level'),
        size: 170,
        cell: ({ row }) => {
          const level = levelPresentation(
            shadow ? row.original.shadow_level : row.original.level
          )
          return (
            <div className='space-y-1'>
              <div className='flex flex-wrap gap-1'>
                <StatusBadge
                  label={translateServerText(t, level.labelKey)}
                  variant={level.variant}
                  copyable={false}
                />
                {shadow && row.original.would_block && (
                  <StatusBadge
                    label={t('Would block')}
                    variant='danger'
                    copyable={false}
                  />
                )}
              </div>
              {!shadow &&
                row.original.blocked &&
                row.original.blocked_reason && (
                  <div className='text-muted-foreground text-xs'>
                    {blockedReasonText(t, row.original.blocked_reason)}
                  </div>
                )}
            </div>
          )
        },
        meta: { label: t('Level'), mobileBadge: true },
      },
      {
        id: 'score',
        header: shadow ? t('Shadow score') : t('Score'),
        size: 100,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {formatNumber(
              shadow ? row.original.shadow_score : row.original.score,
              locale
            )}
          </span>
        ),
        meta: { label: shadow ? t('Shadow score') : t('Score') },
      },
      {
        accessorKey: 'trusted',
        header: t('Trusted'),
        size: 100,
        cell: ({ row }) =>
          row.original.trusted ? (
            <StatusBadge label={t('Trusted')} variant='info' copyable={false} />
          ) : (
            '—'
          ),
        meta: { label: t('Trusted') },
      },
      {
        accessorKey: 'unsafe_count',
        header: t('Unsafe'),
        size: 90,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {formatNumber(row.original.unsafe_count, locale)}
          </span>
        ),
        meta: { label: t('Unsafe'), mobileHidden: true },
      },
      {
        accessorKey: 'controversial_count',
        header: t('Controversial'),
        size: 110,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {formatNumber(row.original.controversial_count, locale)}
          </span>
        ),
        meta: { label: t('Controversial'), mobileHidden: true },
      },
      {
        accessorKey: 'last_event_at',
        header: t('Last event'),
        size: 140,
        cell: ({ row }) => (
          <TimestampCell
            timestamp={row.original.last_event_at}
            locale={locale}
            justNowLabel={t('Just now')}
          />
        ),
        meta: { label: t('Last event') },
      },
      {
        id: 'actions',
        header: t('Actions'),
        size: 70,
        enableHiding: false,
        cell: ({ row }) => (
          <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
            <DropdownMenuItem
              onClick={() => onAction({ kind: 'reset', profile: row.original })}
            >
              {t('Reset score and unblock')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                onAction({
                  kind: row.original.trusted ? 'untrust' : 'trust',
                  profile: row.original,
                })
              }
            >
              {row.original.trusted ? t('Stop trusting') : t('Trust account')}
            </DropdownMenuItem>
          </DataTableRowActionMenu>
        ),
        meta: { label: t('Actions') },
      },
    ],
    [locale, onAction, shadow, t]
  )
}
