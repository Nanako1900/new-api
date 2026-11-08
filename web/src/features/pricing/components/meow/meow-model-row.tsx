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

import { QUOTA_TYPE_VALUES } from '../../constants'
import { isDynamicPricingModel } from '../../lib/dynamic-price'
import { toStatusSlots } from '../../lib/meow-catalog'
import { formatFixedPrice, formatGroupPrice } from '../../lib/price'
import type { PriceType, PricingModel } from '../../types'
import { ModelPriceCell } from '../model-price-cell'
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
  labelKey: string
}[] = [
  { type: 'input', labelKey: 'Input' },
  { type: 'output', labelKey: 'Output' },
  { type: 'cache', labelKey: 'Cache Read' },
]

type ChannelPrices =
  | { kind: 'token'; values: string[] }
  | { kind: 'request'; price: string }
  | { kind: 'dynamic' }

/** A model's prices in one channel, from the page's group ratios. */
function getChannelPrices(
  model: PricingModel,
  group: string,
  prices: MeowPriceOptions
): ChannelPrices {
  if (isDynamicPricingModel(model)) return { kind: 'dynamic' }
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
  const channelPrices = getChannelPrices(props.model, props.group, props.prices)
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
        aria-colspan={3}
        className='order-3 col-span-3 min-w-0 md:order-none'
      >
        {channelPrices.kind === 'request' ? (
          <span className='font-mono tabular-nums'>
            {`${channelPrices.price} / ${t('request')}`}
          </span>
        ) : (
          <ModelPriceCell
            model={channelModel}
            options={{
              tokenUnit: 'M',
              priceRate: props.prices.priceRate,
              usdExchangeRate: props.prices.usdExchangeRate,
              showRechargePrice: props.prices.showRechargePrice,
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
          <button
            type='button'
            aria-haspopup='dialog'
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
        className='order-2 text-right font-mono text-xs tabular-nums md:order-none md:text-left'
      >
        {hasSuccessRate ? formatUptimePct(successRate) : '—'}
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
        {props.perf
          ? `${formatLatency(props.perf.avg_latency_ms)} · ${formatThroughput(props.perf.avg_tps)}`
          : '—'}
      </div>
    </div>
  )
}
