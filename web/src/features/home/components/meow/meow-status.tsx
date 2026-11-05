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

import {
  formatLatency,
  formatUptimePct,
  getSuccessRateLevel,
  type SuccessRateLevel,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import {
  HOME_HEALTH_HOURS,
  useProviderHealth,
} from '../../hooks/use-provider-health'
import { HOME_PROVIDERS } from '../../lib/provider-models'

const PROVIDER_LABEL = { claude: 'Claude', gpt: 'GPT' } as const

// Health dots use the MeowAPI status palette instead of upstream emerald.
const DOT_CLASS: Record<SuccessRateLevel, string> = {
  excellent: 'bg-success',
  good: 'bg-success',
  warning: 'bg-warning',
  critical: 'bg-destructive',
  unknown: 'bg-muted-foreground/50',
}

/** Live success rate and latency for Claude and GPT, under the hero. */
export function MeowStatus() {
  const { t } = useTranslation()
  const { health, isLoading, isError } = useProviderHealth()

  if (isLoading || isError) {
    return null
  }

  return (
    <section
      aria-label={t('Live status')}
      className='relative mx-auto max-w-6xl px-4 pb-14 sm:px-8'
    >
      <div className='relative flex flex-wrap items-center gap-x-10 gap-y-3 rounded-2xl border border-white/75 bg-white/30 px-6 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_20px_40px_-28px_rgba(30,27,23,0.28)] backdrop-blur-xl backdrop-saturate-125 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none'>
        <span className='flex items-center gap-2 text-sm font-extrabold'>
          <span className='relative flex size-2'>
            <span className='bg-success absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none' />
            <span className='bg-success relative inline-flex size-2 rounded-full' />
          </span>
          {t('Live status')}
          <span className='text-muted-foreground font-semibold'>
            · {t('Last {{count}} hours', { count: HOME_HEALTH_HOURS })}
          </span>
        </span>
        {HOME_PROVIDERS.map((provider) => {
          const item = health[provider]
          const level = getSuccessRateLevel(item?.successRate ?? Number.NaN)
          return (
            <span
              key={provider}
              className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'
            >
              <span className='flex items-center gap-2 font-extrabold'>
                <span
                  aria-hidden='true'
                  className={cn('size-2 rounded-full', DOT_CLASS[level])}
                />
                {PROVIDER_LABEL[provider]}
              </span>
              {item ? (
                <>
                  <span className='text-muted-foreground'>
                    {t('Success rate')}{' '}
                    <b className='text-foreground font-extrabold'>
                      {formatUptimePct(item.successRate)}
                    </b>
                  </span>
                  <span className='text-muted-foreground'>
                    {t('Average latency')}{' '}
                    <b className='text-foreground font-extrabold'>
                      {formatLatency(item.avgLatencyMs)}
                    </b>
                  </span>
                </>
              ) : (
                <span className='text-muted-foreground'>{t('No data')}</span>
              )}
            </span>
          )
        })}
      </div>
    </section>
  )
}
