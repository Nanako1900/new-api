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
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'
import type { PerformanceGroup } from '@/features/performance-metrics/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { useBillingTime } from '../../hooks/use-billing-time'
import { toStatusSlots } from '../../lib/meow-catalog'
import {
  getMeowChannelPrices,
  type MeowPriceOptions,
} from '../../lib/meow-price'
import type { PriceType, PricingModel } from '../../types'
import { ModelPriceCell } from '../model-price-cell'
import { MeowPriceValue } from './meow-price-value'
import { MeowStatusBar } from './meow-status-bar'

export type { MeowPriceOptions } from '../../lib/meow-price'

/** Desktop column widths shared by the header row and the model rows. */
export const MEOW_ROW_GRID =
  'md:grid-cols-[minmax(0,2.1fr)_repeat(3,minmax(0,1.15fr))_minmax(0,1fr)_minmax(0,1.4fr)]'

const TOKEN_PRICE_COLUMNS: {
  type: PriceType
  labelKey: string
}[] = [
  { type: 'input', labelKey: 'Input' },
  { type: 'output', labelKey: 'Output' },
  { type: 'cache', labelKey: 'Cache Read' },
]

export interface MeowModelRowProps {
  model: PricingModel
  group: string
  prices: MeowPriceOptions
  perf: PerformanceGroup | undefined
  windowEnd: number | undefined
  onSelect: (modelName: string) => void
}

export function MeowModelRow(props: MeowModelRowProps) {
  const { t, i18n } = useTranslation()
  // Re-render when the display currency changes; the price formatters read it.
  useSystemConfigStore((state) => state.config.currency)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const name = props.model.model_name
  const billingTime = useBillingTime(props.model.billing_expr)
  const channelPrices = getMeowChannelPrices(
    props.model,
    props.group,
    props.prices,
    billingTime === undefined ? undefined : new Date(billingTime)
  )
  const successRate = props.perf?.success_rate
  const hasSuccessRate =
    successRate !== undefined &&
    Number.isFinite(successRate) &&
    successRate >= 0 &&
    successRate <= 100

  // ModelPriceCell takes the ratio of `selectedGroup` from the model's own
  // groups; pin this channel's group and the page's ratios (a model enabled for
  // `all` would otherwise get ratio 1).
  const channelModel = useMemo(
    () => ({
      ...props.model,
      enable_groups: [props.group],
      group_ratio: props.prices.groupRatio,
    }),
    [props.model, props.group, props.prices.groupRatio]
  )

  let priceCells: ReactNode
  if (channelPrices.kind === 'token') {
    priceCells = TOKEN_PRICE_COLUMNS.map((column, index) => (
      <div
        key={column.type}
        role='cell'
        aria-label={t(column.labelKey)}
        className='order-3 min-w-0 md:order-none md:text-right'
      >
        <span className='text-muted-foreground block text-[11px] md:hidden'>
          {t(column.labelKey)}
        </span>
        <MeowPriceValue price={channelPrices.values[index]} />
      </div>
    ))
  } else {
    priceCells = (
      <div
        role='cell'
        aria-colspan={3}
        className='order-3 col-span-3 min-w-0 md:order-none'
      >
        {channelPrices.kind === 'request' ? (
          <MeowPriceValue price={`${channelPrices.price} / ${t('request')}`} />
        ) : (
          <ModelPriceCell
            model={channelModel}
            options={{
              tokenUnit: 'M',
              priceRate: props.prices.priceRate,
              usdExchangeRate: props.prices.usdExchangeRate,
              showRechargePrice: false,
              selectedGroup: props.group,
            }}
            showExpression={false}
          />
        )}
      </div>
    )
  }

  return (
    <div
      role='row'
      className={cn(
        'hover:bg-muted/40 relative grid grid-cols-3 gap-x-3 gap-y-1.5 border-t px-4 py-3 text-sm transition-colors md:items-center',
        MEOW_ROW_GRID
      )}
    >
      <div
        role='cell'
        className='order-1 col-span-2 min-w-0 md:order-none md:col-span-1'
      >
        <div className='flex min-w-0 items-center gap-1'>
          <Button
            variant='ghost'
            aria-haspopup='dialog'
            onClick={() => props.onSelect(name)}
            className='h-auto min-w-0 flex-1 justify-start rounded-sm p-0 text-left font-mono font-medium'
            title={name}
          >
            <span className='truncate'>{name}</span>
          </Button>
          <CopyButton
            value={name}
            tooltip={t('Copy model name')}
            className='relative z-10 size-6'
            iconClassName='size-3'
          />
        </div>
        {channelPrices.kind === 'token' && channelPrices.currentPeriod && (
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Current period price')}
          </p>
        )}
        {channelPrices.kind === 'token' && channelPrices.variable && (
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Prices vary by usage tier and request conditions')}
          </p>
        )}
        {props.model.context_length ? (
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {t('{{value}} context', {
              value: formatCompactNumber(props.model.context_length, locale),
            })}
          </p>
        ) : null}
      </div>
      {priceCells}
      <div
        role='cell'
        className='order-2 text-right font-mono text-xs tabular-nums md:order-none md:text-left'
      >
        <span className='text-muted-foreground block text-[11px] md:sr-only'>
          {t('24h status')}
        </span>
        {hasSuccessRate ? (
          formatUptimePct(successRate)
        ) : (
          <span aria-label={t('No monitoring data')}>—</span>
        )}
        {props.perf && props.windowEnd !== undefined && (
          <MeowStatusBar
            slots={toStatusSlots(props.perf.series, props.windowEnd)}
            className='mt-1 hidden md:flex'
          />
        )}
      </div>
      <div
        role='cell'
        className='text-muted-foreground hidden font-mono text-xs tabular-nums md:block'
      >
        {props.perf ? (
          <>
            <span className='inline-block whitespace-nowrap'>
              {formatLatency(props.perf.avg_ttft_ms)}
            </span>
            {' · '}
            <span className='inline-block whitespace-nowrap'>
              {formatThroughput(props.perf.avg_tps)}
            </span>
          </>
        ) : (
          '—'
        )}
      </div>
    </div>
  )
}
