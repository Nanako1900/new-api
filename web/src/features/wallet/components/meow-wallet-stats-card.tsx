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
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useLiveBalanceTotals } from '@/hooks/use-live-balance'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import type { UserWalletData } from '../types'

type MeowWalletStatsCardProps = {
  user: UserWalletData | null
  loading?: boolean
}

function StatTile(props: { label: string; value: string }) {
  return (
    <div className='bg-card border-border flex h-full min-w-0 flex-col justify-between gap-3 rounded-[22px] border p-5 sm:p-6'>
      <span className='text-muted-foreground text-sm font-bold'>
        {props.label}
      </span>
      <span className='truncate text-2xl leading-none font-extrabold tracking-[-0.03em] tabular-nums sm:text-[1.75rem]'>
        {props.value}
      </span>
    </div>
  )
}

/**
 * Wallet header stats in the MeowAPI look: the balance on a dark tile with
 * the calico glow, then total usage and request count. Same props as the
 * original `WalletStatsCard`; the numbers stay live while the page is open.
 */
export function MeowWalletStatsCard(props: MeowWalletStatsCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const totals = useLiveBalanceTotals(props.user)

  if (props.loading) {
    return (
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-12'>
        <Skeleton className='col-span-2 h-32 rounded-[22px] lg:col-span-6' />
        <Skeleton className='h-32 rounded-[22px] lg:col-span-3' />
        <Skeleton className='h-32 rounded-[22px] lg:col-span-3' />
      </div>
    )
  }

  return (
    <div className='grid grid-cols-2 gap-4 lg:grid-cols-12'>
      <div className='bg-meow-ink relative isolate col-span-2 flex flex-col justify-between gap-4 overflow-hidden rounded-[22px] px-6 py-6 text-white lg:col-span-6 dark:bg-[#25211C]'>
        <div
          aria-hidden='true'
          className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-16 -left-14 -z-10 h-44 w-56 rounded-full opacity-55 blur-[50px]'
        />
        <span className='text-sm font-bold text-white/70'>
          {t('Current Balance')}
        </span>
        <span className='text-4xl font-extrabold tracking-[-0.03em] tabular-nums sm:text-[2.75rem]'>
          {formatQuota(totals.quota)}
        </span>
      </div>
      <div className='lg:col-span-3'>
        <StatTile
          label={t('Total Usage')}
          value={formatQuota(totals.usedQuota)}
        />
      </div>
      <div className='lg:col-span-3'>
        <StatTile
          label={t('API Requests')}
          value={formatNumber(totals.requestCount, locale)}
        />
      </div>
    </div>
  )
}
