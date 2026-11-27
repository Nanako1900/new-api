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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyAmount } from '@/lib/currency'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { AFFILIATE_PAGE_SIZE, getAffiliateHistory } from '../api'
import type { AffiliateEntry } from '../types'

export function AffiliateHistory(props: {
  userId?: number
  onReverse?: (entry: AffiliateEntry) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const accountId = useAuthStore((state) => state.auth.user?.id)
  const self = props.userId === undefined
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: self
      ? ['affiliate', 'self', accountId, 'history', page]
      : ['affiliate', props.userId, 'history', page],
    enabled: !self || accountId !== undefined,
    queryFn: () => getAffiliateHistory(props.userId, page),
  })
  if (self && accountId === undefined) return null
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className='space-y-3'>
      <StaticDataTable<AffiliateEntry>
        data={query.data.items}
        getRowKey={(entry) => entry.id}
        emptyContent={t('No cashback records yet')}
        columns={[
          {
            id: 'time',
            header: t('Time'),
            cell: (entry) => formatTimestampToDate(entry.created_at),
          },
          {
            id: 'kind',
            header: t('Type'),
            cell: (entry) => {
              if (entry.kind === 'credit') return t('Recharge cashback')
              if (entry.kind === 'withdrawal') return t('Manual payout')
              return t('Cashback reversal')
            },
          },
          {
            id: 'order',
            header: t('Order number'),
            cell: (entry) => entry.trade_no || '—',
          },
          ...(self
            ? [
                {
                  id: 'payer',
                  header: t('Paid by'),
                  cell: (entry: AffiliateEntry) =>
                    entry.kind === 'withdrawal'
                      ? '—'
                      : entry.buyer_name || t('Payer unavailable'),
                },
              ]
            : []),
          {
            id: 'base',
            header: t('Cashback basis (CNY)'),
            cell: (entry) =>
              entry.kind === 'credit'
                ? formatCurrencyAmount(entry.base_cents / 100, 'CNY', {
                    locale,
                  })
                : '—',
          },
          {
            id: 'rate',
            header: t('Cashback rate (%)'),
            cell: (entry) =>
              entry.kind === 'credit'
                ? `${formatNumber(entry.rate_bps / 100, locale)}%`
                : '—',
          },
          {
            id: 'amount',
            header: t('Amount'),
            cell: (entry) =>
              formatCurrencyAmount(entry.amount_cents / 100, 'CNY', { locale }),
          },
          {
            id: 'note',
            header: t('Remark'),
            cell: (entry) => (
              <span className='break-words whitespace-pre-wrap'>
                {entry.note || '—'}
              </span>
            ),
          },
          ...(props.onReverse
            ? [
                {
                  id: 'actions',
                  header: t('Actions'),
                  cell: (entry: AffiliateEntry) =>
                    entry.kind === 'credit' && entry.amount_cents > 0 ? (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => props.onReverse?.(entry)}
                      >
                        {t('Reverse cashback')}
                      </Button>
                    ) : null,
                },
              ]
            : []),
        ]}
      />
      <div className='flex items-center justify-end gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={page === 1 || query.isFetching}
          onClick={() => setPage(page - 1)}
        >
          {t('Previous')}
        </Button>
        <span className='text-xs'>{t('Page {{page}}', { page })}</span>
        <Button
          variant='outline'
          size='sm'
          disabled={
            page * AFFILIATE_PAGE_SIZE >= query.data.total || query.isFetching
          }
          onClick={() => setPage(page + 1)}
        >
          {t('Next')}
        </Button>
      </div>
    </div>
  )
}
