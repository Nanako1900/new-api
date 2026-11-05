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

import { PawPrint } from '@/components/cat-art'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import { toDateKey } from '../../lib/meow-checkin'

type MeowCheckinWeekProps = {
  days: Date[]
  todayKey: string
  checkedDates: Set<string>
  isLoading: boolean
}

/** The last seven days as paws: orange when checked in. */
export function MeowCheckinWeek(props: MeowCheckinWeekProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short' })

  if (props.isLoading) return <Skeleton className='h-[52px] rounded-xl' />

  return (
    <ol className='grid grid-cols-7 gap-1.5'>
      {props.days.map((day) => {
        const key = toDateKey(day)
        const done = props.checkedDates.has(key)
        const isToday = key === props.todayKey
        return (
          <li key={key} className='flex flex-col items-center gap-1.5'>
            <span
              className={cn(
                'flex size-8 items-center justify-center rounded-[10px] border',
                done &&
                  'bg-meow-orange border-meow-orange text-meow-ink dark:text-meow-ink',
                !done && isToday && 'border-foreground bg-card',
                !done && !isToday && 'bg-muted border-transparent',
                !done && 'text-input'
              )}
            >
              <PawPrint className='size-3.5' />
            </span>
            <span
              className={cn(
                'text-muted-foreground text-[11px]',
                isToday && 'text-foreground font-bold'
              )}
            >
              {isToday ? t('Today') : weekdayFormat.format(day)}
            </span>
            <span className='sr-only'>
              {done ? t('Checked in') : t('Not checked in')}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
