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
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { getUserQuotaDates } from '@/features/dashboard/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { lastSevenDays, toDateKey } from '../../lib/meow-checkin'
import { PROVIDER_SERIES } from '../../lib/meow-model-colors'
import { dailyProviderSpend } from '../../lib/meow-usage'
import { SpendBars, SpendLegend } from './meow-spend-bars'

/** Daily spend for the last seven days, stacked by Claude, GPT and other. */
export function MeowUsageTrend() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const days = useMemo(() => lastSevenDays(new Date()), [])
  const start = Math.floor(days[0].getTime() / 1000)

  const query = useQuery({
    queryKey: ['dashboard', 'overview', 'spend-7d', start],
    queryFn: async () =>
      requireServerSuccess(
        await getUserQuotaDates({
          start_timestamp: start,
          end_timestamp: Math.floor(Date.now() / 1000),
        })
      ),
    staleTime: 5 * 60 * 1000,
  })

  const spend = useMemo(
    () => dailyProviderSpend(query.data?.data ?? [], days),
    [query.data, days]
  )
  const weekTotal = spend.reduce((sum, day) => sum + day.total, 0)
  const todayKey = toDateKey(days[6])
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const dateFormat = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
  })
  const isToday = (date: Date) => toDateKey(date) === todayKey

  return (
    <figure className='bg-card border-border m-0 flex flex-1 flex-col gap-4 rounded-[22px] border p-5'>
      <figcaption className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-baseline gap-3'>
          <h2 className='text-base font-extrabold'>
            {t('Spend, last 7 days')}
          </h2>
          {!query.isLoading && (
            <span className='text-meow-heading text-sm font-extrabold tabular-nums'>
              {formatQuota(weekTotal)}
            </span>
          )}
        </div>
        <div className='flex items-center gap-4'>
          <SpendLegend buckets={spend} series={PROVIDER_SERIES} />
          <Link
            to='/dashboard/$section'
            params={{ section: 'models' }}
            className='text-primary inline-flex items-center gap-1 text-[13px] font-bold'
          >
            {t('Dashboard')}
            <ArrowRight className='size-3.5' aria-hidden='true' />
          </Link>
        </div>
      </figcaption>

      {query.isLoading ? (
        <Skeleton className='h-44 rounded-xl' />
      ) : (
        <SpendBars
          buckets={spend}
          series={PROVIDER_SERIES}
          ariaLabel={t('Daily spend, last 7 days')}
          emptyText={t('No usage in the last 7 days yet.')}
          title={(day) => dateFormat.format(day.date)}
          label={(day) =>
            isToday(day.date) ? t('Today') : weekdayFormat.format(day.date)
          }
          isHighlighted={(day) => isToday(day.date)}
        />
      )}
    </figure>
  )
}
