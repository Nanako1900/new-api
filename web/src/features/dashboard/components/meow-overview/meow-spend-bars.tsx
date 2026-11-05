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

import { formatQuota, parseQuotaFromDollars } from '@/lib/format'
import { cn } from '@/lib/utils'

import { niceTicks } from '../../lib/meow-chart-scale'
import type { ChartSeries } from '../../lib/meow-model-colors'
import type { SpendBucket } from '../../lib/meow-usage'

/** Legend for the series that have spend, bottom of the stack first. */
export function SpendLegend(props: {
  buckets: SpendBucket[]
  series: ChartSeries[]
}) {
  const { t } = useTranslation()
  const shown = props.series.filter((item) =>
    props.buckets.some((bucket) => (bucket.values[item.id] ?? 0) > 0)
  )
  const legend = shown.length > 0 ? shown : props.series.slice(-2)
  return (
    <ul className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-bold'>
      {[...legend].reverse().map((item) => (
        <li key={item.id} className='inline-flex items-center gap-1.5'>
          <span
            aria-hidden='true'
            className={cn('size-2.5 shrink-0 rounded-[3px]', item.className)}
          />
          {t(item.label)}
        </li>
      ))}
    </ul>
  )
}

type SpendBarsProps = {
  buckets: SpendBucket[]
  /** Stack segments, top of the stack first. */
  series: ChartSeries[]
  /** Axis label under a bar, or '' to leave it blank. */
  label: (bucket: SpendBucket, index: number) => string
  /** Hover text for a bar's date or hour. */
  title: (bucket: SpendBucket) => string
  isHighlighted?: (bucket: SpendBucket) => boolean
  ariaLabel: string
  emptyText: string
}

/** Quota ticks on round amounts of the display currency. */
function quotaTicks(max: number): number[] {
  const unit = parseQuotaFromDollars(1) || 1
  return niceTicks(max / unit).map((tick) => tick * unit)
}

/** Stacked spend bars per time bucket, with a value axis and labels. */
export function SpendBars(props: SpendBarsProps) {
  const max = Math.max(0, ...props.buckets.map((bucket) => bucket.total))
  const ticks = quotaTicks(max)
  const top = ticks.at(-1) ?? 0
  const dense = props.buckets.length > 12
  const gap = dense ? 'gap-1 sm:gap-1.5' : 'gap-3 sm:gap-5'

  return (
    <div className='relative flex flex-1 flex-col'>
      <div className='flex min-h-36 flex-1'>
        <div
          aria-hidden='true'
          className='text-muted-foreground relative w-14 shrink-0 text-[11px] tabular-nums'
        >
          {top > 0 &&
            ticks.map((tick) => (
              <span
                key={tick}
                className='absolute right-2 translate-y-1/2 leading-none'
                style={{ bottom: `${(tick / top) * 100}%` }}
              >
                {formatQuota(tick)}
              </span>
            ))}
        </div>
        <div className='border-border relative flex-1 border-b'>
          {top > 0 &&
            ticks
              .slice(1)
              .map((tick) => (
                <div
                  key={tick}
                  aria-hidden='true'
                  className='border-border/70 absolute inset-x-0 border-t border-dashed'
                  style={{ bottom: `${(tick / top) * 100}%` }}
                />
              ))}
          <div
            role='img'
            aria-label={props.ariaLabel}
            className={cn('relative flex h-full items-end px-1', gap)}
          >
            {props.buckets.map((bucket) => (
              <SpendBar
                key={bucket.date.getTime()}
                bucket={bucket}
                series={props.series}
                max={top}
                title={`${props.title(bucket)} · ${formatQuota(bucket.total)}`}
              />
            ))}
          </div>
        </div>
      </div>
      {max === 0 && (
        <p className='text-muted-foreground absolute inset-x-0 top-12 text-center text-sm'>
          {props.emptyText}
        </p>
      )}
      <div
        className={cn(
          'text-muted-foreground mt-2 flex pr-1 pl-[3.75rem] text-[11px] whitespace-nowrap',
          gap
        )}
      >
        {props.buckets.map((bucket, index) => (
          <span
            key={bucket.date.getTime()}
            className={cn(
              'min-w-0 flex-1 text-center',
              props.isHighlighted?.(bucket) && 'text-foreground font-bold'
            )}
          >
            {props.label(bucket, index)}
          </span>
        ))}
      </div>
    </div>
  )
}

function SpendBar(props: {
  bucket: SpendBucket
  series: ChartSeries[]
  max: number
  title: string
}) {
  if (props.bucket.total <= 0 || props.max <= 0) {
    return (
      <div className='flex h-full min-w-0 flex-1 items-end' title={props.title}>
        <div className='bg-muted mx-auto h-1 w-full max-w-16 rounded-full' />
      </div>
    )
  }
  const height = Math.max((props.bucket.total / props.max) * 100, 4)
  return (
    <div className='flex h-full min-w-0 flex-1 items-end' title={props.title}>
      <div
        className='mx-auto flex w-full max-w-16 flex-col justify-end gap-0.5 overflow-hidden rounded-t-[6px] rounded-b-[2px]'
        style={{ height: `${height}%` }}
      >
        {props.series.map((item) => {
          const value = props.bucket.values[item.id] ?? 0
          if (value <= 0) return null
          return (
            <div
              key={item.id}
              className={cn('min-h-0.5 rounded-[2px]', item.className)}
              style={{ flex: `${value} 1 0` }}
            />
          )
        })}
      </div>
    </div>
  )
}
