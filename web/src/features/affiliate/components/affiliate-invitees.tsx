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

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyCents } from '@/lib/currency'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { AFFILIATE_PAGE_SIZE, getInvitees } from '../api'
import type { Invitee, InviteeTopUps } from '../types'

export function AffiliateInvitees({ userId }: { userId?: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const accountId = useAuthStore((state) => state.auth.user?.id)
  const self = userId === undefined
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: self
      ? ['affiliate', 'self', accountId, 'invitees', page]
      : ['affiliate', userId, 'invitees', page],
    enabled: !self || accountId !== undefined,
    queryFn: () => getInvitees(userId, page),
  })
  if (self && accountId === undefined) return null
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  const nameColumn: StaticDataTableColumn<Invitee | InviteeTopUps> = {
    id: 'name',
    header: t('Display name'),
    cell: (user) => user.display_name,
  }
  const columns: StaticDataTableColumn<Invitee | InviteeTopUps>[] = self
    ? [
        nameColumn,
        {
          id: 'count',
          header: t('Cashback-eligible recharges'),
          cell: (user) =>
            'topup_count' in user
              ? formatNumber(user.topup_count, locale)
              : '—',
        },
        {
          id: 'total',
          header: t('Eligible recharge total'),
          cell: (user) =>
            'topup_totals' in user && user.topup_totals.length > 0 ? (
              <ul className='space-y-1 whitespace-nowrap'>
                {user.topup_totals.map(({ currency, paid_cents }) => (
                  <li key={currency}>
                    {formatCurrencyCents(paid_cents, currency, locale)}
                  </li>
                ))}
              </ul>
            ) : (
              t('No eligible recharges yet')
            ),
        },
        {
          id: 'last-settled',
          header: t('Latest eligible recharge'),
          cell: (user) =>
            'last_settled_at' in user && user.last_settled_at !== null
              ? formatTimestampToDate(user.last_settled_at)
              : '—',
        },
      ]
    : [
        { id: 'id', header: t('ID'), cell: (user) => user.id },
        {
          id: 'username',
          header: t('Username'),
          cell: (user) => ('username' in user ? user.username : '—'),
        },
        nameColumn,
      ]

  return (
    <div className='space-y-3'>
      <StaticDataTable
        data={query.data.items}
        getRowKey={(user) => user.id}
        emptyContent={t('No invited users yet')}
        tableProps={{ 'aria-label': t('Invited users') }}
        columns={columns}
      />
      <div className='flex justify-end gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={page === 1 || query.isFetching}
          onClick={() => setPage(page - 1)}
        >
          {t('Previous')}
        </Button>
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
