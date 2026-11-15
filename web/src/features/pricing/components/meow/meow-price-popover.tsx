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
import { ChevronDown } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { toIntlLocale } from '@/i18n/languages'
import { getCurrencyFractionDigits } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import type { MeowPriceOptions } from '../../lib/meow-price'
import type { ReferencePriceComparison } from '../../lib/reference-price'
import type { PricingModel } from '../../types'
import { DynamicPricingBreakdown } from '../dynamic-pricing-breakdown'
import { GroupPricingSection } from '../group-pricing-section'
import { MeowReferencePriceBadge } from './meow-reference-price-badge'

export function MeowPricePopover(props: {
  model: PricingModel
  group: string
  prices: MeowPriceOptions
  comparison: ReferencePriceComparison | null
}) {
  const { t, i18n } = useTranslation()
  const popupRef = useRef<HTMLDivElement>(null)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const reference = props.prices.reference
  const referenceModel = reference?.models[props.model.model_name]
  const hasReference = Boolean(
    referenceModel &&
    reference &&
    reference.currency === 'USD' &&
    referenceModel.billing_mode === 'tiered_expr' &&
    referenceModel.billing_expr &&
    Number.isFinite(reference.usd_to_cny_rate) &&
    reference.usd_to_cny_rate > 0
  )
  const title = t('Price details for {{model}}', {
    model: props.model.model_name,
  })

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={title}
            className='text-muted-foreground shrink-0'
          />
        }
      >
        <ChevronDown
          aria-hidden
          className='size-4 transition-transform in-aria-expanded:rotate-180'
        />
      </PopoverTrigger>
      <PopoverContent
        ref={popupRef}
        initialFocus={popupRef}
        align='start'
        collisionPadding={16}
        className='max-h-[min(75dvh,var(--available-height))] w-[36rem] max-w-[calc(100vw-2rem)] gap-4 overflow-y-auto overscroll-contain p-4'
      >
        <PopoverTitle className='break-all'>{title}</PopoverTitle>
        <GroupPricingSection
          model={{
            ...props.model,
            enable_groups: [props.group],
            group_ratio: props.prices.groupRatio,
          }}
          selectedGroup={props.group}
          groupRatio={props.prices.groupRatio}
          usableGroup={{
            [props.group]: {
              desc: props.group,
              ratio: props.prices.groupRatio[props.group],
            },
          }}
          autoGroups={[]}
          priceRate={props.prices.priceRate}
          usdExchangeRate={props.prices.usdExchangeRate}
          tokenUnit='M'
          showRechargePrice={false}
          compact
        />
        <Separator />
        {hasReference && reference && referenceModel ? (
          <section
            className='min-w-0 space-y-2'
            aria-label={t('Reference prices')}
          >
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <h3 className='font-medium'>{t('Reference prices')}</h3>
              <MeowReferencePriceBadge comparison={props.comparison} />
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Reference prices are shown in USD and CNY per 1M tokens unless another unit is stated.'
              )}
            </p>
            <DynamicPricingBreakdown
              billingExpr={referenceModel.billing_expr}
              compact
              showZeroPrices
              formatUnitPrice={(value) => {
                const usd = new Intl.NumberFormat(locale, {
                  style: 'currency',
                  currency: 'USD',
                  currencyDisplay: 'narrowSymbol',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: getCurrencyFractionDigits(value, {
                    digitsLarge: 4,
                    digitsSmall: 6,
                  }),
                }).format(value)
                const converted = value * reference.usd_to_cny_rate
                const cny = new Intl.NumberFormat(locale, {
                  style: 'currency',
                  currency: 'CNY',
                  currencyDisplay: 'narrowSymbol',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: getCurrencyFractionDigits(converted, {
                    digitsLarge: 4,
                    digitsSmall: 6,
                  }),
                }).format(converted)
                return `${usd} · ${cny}`
              }}
            />
            {props.comparison && (
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Compares all listed unit prices across matching tiers. Savings use the smallest reduction; additional fees are excluded.'
                )}
              </p>
            )}
            {!props.comparison && (
              <p className='text-muted-foreground text-xs'>
                {t(
                  'These prices cannot be compared on the same basis, so no overall discount is shown.'
                )}
              </p>
            )}
            <p className='text-muted-foreground text-xs'>
              {t(
                'Comparison rate: 1 USD = {{rate}} CNY. This fixed reference rate is not a live exchange quote.',
                { rate: formatNumber(reference.usd_to_cny_rate, locale) }
              )}
            </p>
            <a
              className='text-primary block text-xs underline underline-offset-4'
              href={reference.source_url}
              target='_blank'
              rel='noopener noreferrer'
            >
              {t('Source: Basellm reference data')}
            </a>
            {reference.updated_at > 0 && (
              <p className='text-muted-foreground text-xs'>
                {t('Reference updated: {{time}}', {
                  time: new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(reference.updated_at * 1000)),
                })}
              </p>
            )}
            {reference.stale && (
              <p className='text-muted-foreground text-xs'>
                {t('Using the last cached reference; refresh is pending.')}
              </p>
            )}
          </section>
        ) : (
          <p className='text-muted-foreground text-xs'>
            {t(
              'No matching reference price is available. Channel prices remain valid.'
            )}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
