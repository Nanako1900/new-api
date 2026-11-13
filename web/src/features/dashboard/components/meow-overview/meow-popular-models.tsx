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
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import type { PricingModel } from '@/features/pricing/types'
import { getRankings } from '@/features/rankings/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  isUnpricedModel,
  popularModels,
  tokenPriceSummary,
  type ModelFamily,
} from '../../lib/meow-popular-models'
import { MeowGlassPanel } from './meow-glass-panel'

// Same dots as the model scopes on the API key rows.
const COLUMNS: { family: ModelFamily; label: string; dot: string }[] = [
  { family: 'claude', label: 'Claude', dot: 'bg-meow-orange' },
  { family: 'gpt', label: 'Codex', dot: 'bg-meow-ink dark:bg-white' },
]

type Rates = { priceRate: number; usdExchangeRate: number }

/** One ranked model: its place, name and input / output price. */
function ModelRow(props: { model: PricingModel; rank: number; rates: Rates }) {
  const { t } = useTranslation()
  const unpriced = isUnpricedModel(props.model)
  const price = unpriced ? null : tokenPriceSummary(props.model, props.rates)

  let priceView = (
    <Link
      to='/pricing'
      className='text-primary shrink-0 text-[13px] font-bold underline-offset-4 hover:underline'
    >
      {t('View price')}
    </Link>
  )
  if (unpriced) {
    priceView = (
      <span className='bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold'>
        {t('In beta · price not set yet')}
      </span>
    )
  } else if (price) {
    priceView = (
      <span className='shrink-0 text-right font-mono text-[14px] whitespace-nowrap tabular-nums'>
        <span className='sr-only'>{t('Input')} </span>
        <b className='font-bold'>{price.input}</b>
        <span className='text-muted-foreground'> / </span>
        <span className='sr-only'>{t('Output')} </span>
        <b className='font-bold'>{price.output}</b>
      </span>
    )
  }

  return (
    <li className='flex min-h-12 items-center gap-3 rounded-[12px] px-3 py-2'>
      <span
        aria-hidden='true'
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold tabular-nums',
          props.rank === 1
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {props.rank}
      </span>
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate font-mono text-[13px] font-bold'>
          {props.model.model_name}
        </span>
        {price?.tiered && (
          <span className='text-muted-foreground text-[11px]'>
            {t('Tiered by context length')}
          </span>
        )}
      </span>
      {priceView}
    </li>
  )
}

/**
 * Overview card after setup: the two most used Claude and Codex models
 * this week, with their input / output prices per 1M tokens. A model
 * without a price yet says so.
 */
export function MeowPopularModels() {
  const { t } = useTranslation()
  const pricing = usePricingData()
  // Shares the rankings page's cache. Without usage data the card falls
  // back to the default models, so a failure stays silent.
  const rankingsQuery = useQuery({
    queryKey: ['rankings', 'week'],
    queryFn: async () => requireServerSuccess(await getRankings('week')),
    staleTime: 5 * 60 * 1000,
    retry: false,
    meta: { errorToast: false },
  })

  const columns = useMemo(() => {
    const ranked = [...(rankingsQuery.data?.data?.models ?? [])]
      .sort((a, b) => a.rank - b.rank)
      .map((item) => item.model_name)
    const byName = new Map(
      pricing.models.map((model) => [model.model_name, model])
    )
    const available = [...byName.keys()]
    return COLUMNS.map((column) => ({
      ...column,
      models: popularModels(column.family, ranked, available).flatMap(
        (name) => byName.get(name) ?? []
      ),
    }))
  }, [rankingsQuery.data, pricing.models])

  const rates = {
    priceRate: pricing.priceRate,
    usdExchangeRate: pricing.usdExchangeRate,
  }

  return (
    <MeowGlassPanel>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <h2 className='text-base font-extrabold'>{t('Popular models')}</h2>
          <p className='text-muted-foreground text-[13px]'>
            {t('Most used on MeowAPI this week.')}
          </p>
        </div>
        <Link
          to='/pricing'
          className='text-primary inline-flex shrink-0 items-center gap-1 pt-0.5 text-[13px] font-bold underline-offset-4 hover:underline'
        >
          {t('See all models')}
          <ArrowRight className='size-3.5' aria-hidden='true' />
        </Link>
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        {columns.map((column) => (
          <section
            key={column.family}
            aria-label={column.label}
            className='flex flex-col rounded-[16px] bg-white/70 p-1.5 dark:bg-white/[0.04]'
          >
            <div className='flex items-center justify-between gap-2 px-3 pt-2 pb-1'>
              <span className='inline-flex items-center gap-2 text-[13px] font-extrabold'>
                <span
                  aria-hidden='true'
                  className={cn('size-2 rounded-full', column.dot)}
                />
                {column.label}
              </span>
              <span className='text-muted-foreground text-[11px] font-semibold'>
                {t('Input / output per 1M tokens')}
              </span>
            </div>
            {pricing.isLoading && (
              <div className='flex flex-col gap-1.5 p-1.5'>
                <Skeleton className='h-11 rounded-xl' />
                <Skeleton className='h-11 rounded-xl' />
              </div>
            )}
            <ol className='flex flex-col'>
              {column.models.map((model, index) => (
                <ModelRow
                  key={model.model_name}
                  model={model}
                  rank={index + 1}
                  rates={rates}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </MeowGlassPanel>
  )
}
