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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'

import { monthGrid, toDateKey } from '../../lib/meow-checkin'

// 2026-11-01 is a Sunday; the next seven days give the weekday names.
const SUNDAY = new Date(2026, 10, 1)

type MeowCheckinMonthProps = {
  month: Date
  onMonthChange: (month: Date) => void
  canGoNext: boolean
  todayKey: string
  /** Quota awarded per `YYYY-MM-DD` in the shown month. */
  awards: Map<string, number>
  totalCheckins: number
  totalQuota: number
  isLoading: boolean
}

/** Month calendar for the check-in card, in the profile card's layout. */
export function MeowCheckinMonth(props: MeowCheckinMonthProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
  const monthFormat = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  })
  let monthQuota = 0
  for (const quota of props.awards.values()) monthQuota += quota

  const shift = (months: number) =>
    props.onMonthChange(
      new Date(props.month.getFullYear(), props.month.getMonth() + months, 1)
    )

  const stats = [
    [t('Total check-ins'), String(props.totalCheckins)],
    [t('This month'), formatQuotaWithCurrency(monthQuota, { digitsLarge: 0 })],
    [
      t('Total earned'),
      formatQuotaWithCurrency(props.totalQuota, { digitsLarge: 0 }),
    ],
  ]

  return (
    <TooltipProvider delay={100}>
      <div className='flex flex-col gap-3'>
        <dl className='bg-muted/60 grid grid-cols-3 rounded-xl py-2.5 text-center'>
          {stats.map(([label, value]) => (
            <div key={label} className='flex flex-col-reverse gap-0.5'>
              <dt className='text-muted-foreground text-[11px] font-semibold'>
                {label}
              </dt>
              <dd className='text-base font-extrabold tabular-nums'>{value}</dd>
            </div>
          ))}
        </dl>

        <div className='flex items-center justify-between'>
          <span className='text-sm font-bold'>
            {monthFormat.format(props.month)}
          </span>
          <div className='flex gap-0.5'>
            <Button
              variant='ghost'
              size='icon'
              className='size-8'
              aria-label={t('Previous month')}
              onClick={() => shift(-1)}
            >
              <ChevronLeft className='size-4' aria-hidden='true' />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='size-8'
              aria-label={t('Next month')}
              disabled={!props.canGoNext}
              onClick={() => shift(1)}
            >
              <ChevronRight className='size-4' aria-hidden='true' />
            </Button>
          </div>
        </div>

        {props.isLoading ? (
          <Skeleton className='h-56 rounded-xl' />
        ) : (
          <div className='grid grid-cols-7 gap-1'>
            {Array.from({ length: 7 }, (_, index) => {
              const day = new Date(SUNDAY)
              day.setDate(SUNDAY.getDate() + index)
              return (
                <span
                  key={index}
                  className='text-muted-foreground flex h-7 items-center justify-center text-[11px] font-semibold'
                >
                  {weekdayFormat.format(day)}
                </span>
              )
            })}
            {monthGrid(props.month).map((cell) => {
              const key = toDateKey(cell.date)
              const award = cell.inMonth ? props.awards.get(key) : undefined
              const isToday = key === props.todayKey
              const dayCell = (
                <span
                  key={key}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-[10px] text-[13px] tabular-nums',
                    !cell.inMonth && 'text-muted-foreground/35',
                    cell.inMonth && award === undefined && 'text-foreground/80',
                    award !== undefined &&
                      'bg-meow-orange text-meow-ink font-bold',
                    isToday &&
                      award === undefined &&
                      'ring-foreground font-bold ring-1 ring-inset'
                  )}
                >
                  {cell.date.getDate()}
                </span>
              )
              if (award === undefined) return dayCell
              return (
                <Tooltip key={key}>
                  <TooltipTrigger render={dayCell} />
                  <TooltipContent>
                    {t('Checked in')} +{formatQuotaWithCurrency(award)}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
