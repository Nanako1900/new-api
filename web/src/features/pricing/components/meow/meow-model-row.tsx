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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  formatLatency,
  formatThroughput,
} from '@/features/performance-metrics/lib/format'
import type { PerformanceGroup } from '@/features/performance-metrics/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { QUOTA_TYPE_VALUES } from '../../constants'
import {
  getDynamicPricingSummary,
  isDynamicPricingModel,
} from '../../lib/dynamic-price'
import { toStatusSlots } from '../../lib/meow-catalog'
import { formatFixedPrice, formatGroupPrice } from '../../lib/price'
import type { PriceType, PricingModel } from '../../types'
import { MeowStatusBar } from './meow-status-bar'

/** Desktop column widths shared by the header row and the model rows. */
export const MEOW_ROW_GRID =
  'md:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.5fr)_minmax(0,1.3fr)]'

export type MeowPriceOptions = {
  showRechargePrice: boolean
  priceRate: number
  usdExchangeRate: number
  groupRatio: Record<string, number>
}

const TOKEN_PRICE_COLUMNS: {
  type: PriceType
  field: string
  labelKey: string
}[] = [
  { type: 'input', field: 'inputPrice', labelKey: 'Input' },
  { type: 'output', field: 'outputPrice', labelKey: 'Output' },
  { type: 'cache', field: 'cacheReadPrice', labelKey: 'Cache Read' },
]

type ChannelPrices =
  | { kind: 'token'; values: string[] }
  | { kind: 'request'; price: string }
  | { kind: 'dynamic' }

/** A model's prices in one channel, already multiplied by the channel ratio. */
function getChannelPrices(
  model: PricingModel,
  group: string,
  ratio: number,
  prices: MeowPriceOptions
): ChannelPrices {
  if (isDynamicPricingModel(model)) {
    const summary = getDynamicPricingSummary(model, {
      tokenUnit: 'M',
      showRechargePrice: prices.showRechargePrice,
      priceRate: prices.priceRate,
      usdExchangeRate: prices.usdExchangeRate,
      groupRatioMultiplier: ratio,
    })
    const entries =
      summary && !summary.isSpecialExpression ? summary.entries : []
    const tokenPrices = new Map(
      entries
        .filter((entry) => entry.unit === 'token')
        .map(
          (entry) =>
            [entry.field, entry.formattedRange ?? entry.formatted] as const
        )
    )
    if (!tokenPrices.has('inputPrice')) return { kind: 'dynamic' }
    return {
      kind: 'token',
      values: TOKEN_PRICE_COLUMNS.map(
        (column) => tokenPrices.get(column.field) ?? '—'
      ),
    }
  }
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return {
      kind: 'request',
      price: formatFixedPrice(
        model,
        group,
        prices.showRechargePrice,
        prices.priceRate,
        prices.usdExchangeRate,
        prices.groupRatio
      ),
    }
  }
  return {
    kind: 'token',
    values: TOKEN_PRICE_COLUMNS.map((column) => {
      if (column.type === 'cache' && model.cache_ratio == null) return '—'
      return formatGroupPrice(
        model,
        group,
        column.type,
        'M',
        prices.showRechargePrice,
        prices.priceRate,
        prices.usdExchangeRate,
        prices.groupRatio
      )
    }),
  }
}

export interface MeowModelRowProps {
  model: PricingModel
  group: string
  ratio: number
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
  const channelPrices = getChannelPrices(
    props.model,
    props.group,
    props.ratio,
    props.prices
  )
  const successRate = props.perf?.success_rate
  const hasSuccessRate =
    successRate !== undefined &&
    Number.isFinite(successRate) &&
    successRate >= 0 &&
    successRate <= 100
  const missingPerfTitle = props.perf
    ? undefined
    : t('No performance data available')

  let priceCells: ReactNode
  if (channelPrices.kind === 'token') {
    priceCells = TOKEN_PRICE_COLUMNS.map((column, index) => (
      <div
        key={column.type}
        role='cell'
        className='order-3 min-w-0 md:order-none'
      >
        <span className='text-muted-foreground block text-[11px] md:hidden'>
          {t(column.labelKey)}
        </span>
        <span className='font-mono tabular-nums'>
          {channelPrices.values[index]}
        </span>
      </div>
    ))
  } else {
    priceCells = (
      <div
        role='cell'
        className='text-muted-foreground order-3 col-span-3 font-mono md:order-none'
      >
        {channelPrices.kind === 'request'
          ? `${channelPrices.price} / ${t('request')}`
          : t('Dynamic Pricing')}
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
          <button
            type='button'
            onClick={() => props.onSelect(name)}
            className='focus-visible:after:ring-ring truncate text-left font-mono font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset'
          >
            {name}
          </button>
          <CopyButton
            value={name}
            tooltip={t('Copy model name')}
            className='relative z-10 size-6'
            iconClassName='size-3'
          />
        </div>
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
        title={missingPerfTitle}
        className='order-2 text-right font-mono text-xs tabular-nums md:order-none md:text-left'
      >
        {hasSuccessRate ? `${successRate.toFixed(2)}%` : '—'}
        {props.perf && props.windowEnd !== undefined && (
          <MeowStatusBar
            slots={toStatusSlots(props.perf.series, props.windowEnd)}
            className='mt-1 hidden md:flex'
          />
        )}
      </div>
      <div
        role='cell'
        title={missingPerfTitle}
        className='text-muted-foreground hidden font-mono text-xs tabular-nums md:block'
      >
        {props.perf
          ? `${formatLatency(props.perf.avg_latency_ms)} · ${formatThroughput(props.perf.avg_tps)}`
          : '—'}
      </div>
    </div>
  )
}
