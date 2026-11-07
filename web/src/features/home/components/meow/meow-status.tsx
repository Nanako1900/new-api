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

import { PawPrint, SleepingCat } from '@/components/cat-art'
import {
  formatLatency,
  formatUptimePct,
  getSuccessRateLevel,
  type SuccessRateLevel,
} from '@/features/performance-metrics/lib/format'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import {
  HOME_HEALTH_HOURS,
  useProviderHealth,
} from '../../hooks/use-provider-health'
import {
  canShowLiveStatus,
  type ProviderHealth,
} from '../../lib/provider-health'
import { HOME_PROVIDERS, type HomeProvider } from '../../lib/provider-models'

const PROVIDER_LABEL = { claude: 'Claude', gpt: 'GPT' } as const

// Health dots use the MeowAPI status palette instead of upstream emerald.
const DOT_CLASS: Record<SuccessRateLevel, string> = {
  excellent: 'bg-success',
  good: 'bg-success',
  warning: 'bg-warning',
  critical: 'bg-destructive',
  unknown: 'bg-muted-foreground/50',
}

// Promise dots take the calico colours in turn and never a status colour:
// the promises say nothing about current health.
const PROMISE_DOT_CLASS = [
  'bg-meow-orange',
  'bg-meow-ink dark:bg-white',
  'border-meow-ink border-[1.5px] bg-white dark:border-white dark:bg-transparent',
]

/**
 * The bar under the hero that the calico cat sleeps on. It shows live
 * Claude / GPT success rate and latency while both look healthy, and the
 * service promises when either one dips, has no data, or can't be loaded.
 */
export function MeowStatus() {
  const { t } = useTranslation()
  const { health, isLoading } = useProviderHealth()

  // While loading, the empty bar and the cat already hold their place, so
  // the promises never flash in ahead of the live numbers.
  let label = t('Live status')
  let content: ReactNode = null
  if (canShowLiveStatus(health)) {
    content = <LiveStatus health={health} />
  } else if (!isLoading) {
    label = t('Peace of mind')
    content = <ServicePromises />
  }

  return (
    <section
      aria-label={label}
      className='relative mx-auto max-w-6xl px-4 pb-14 sm:px-8'
    >
      <div className='relative isolate flex min-h-13 flex-wrap items-center gap-x-10 gap-y-3 rounded-2xl border border-white/75 bg-white/30 py-4 pr-16 pl-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_20px_40px_-28px_rgba(30,27,23,0.28)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none'>
        {/*
          Asleep on the bar's top edge, tail hanging over the front. The
          bar's wider right padding keeps the text out from under the tail.
        */}
        <SleepingCat className='absolute right-10 bottom-full w-[150px] translate-y-[34.4%] lg:right-6 lg:w-[208px]' />
        {content}
      </div>
    </section>
  )
}

type LiveStatusProps = {
  health: Record<HomeProvider, ProviderHealth>
}

/** Success rate and latency per provider over the home health window. */
function LiveStatus(props: LiveStatusProps) {
  const { t } = useTranslation()

  return (
    <>
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
        const item = props.health[provider]
        const level = getSuccessRateLevel(item.successRate)
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
          </span>
        )
      })}
    </>
  )
}

/** What a user can count on regardless of today's numbers. */
function ServicePromises() {
  const { t } = useTranslation()
  const { status } = useStatus()

  // Failed requests refund their pre-charged quota (relay/request_billing.go).
  const promises = [t('No charge for failed requests')]
  if (status?.checkin_enabled === true) {
    promises.push(t('Daily check-in credits'))
  }
  promises.push(t('Invite friends, earn rewards'))

  return (
    <>
      <span className='flex items-center gap-2 text-sm font-extrabold'>
        <PawPrint className='text-meow-accent-text' />
        {t('Peace of mind')}
      </span>
      {promises.map((promise, index) => (
        <span
          key={promise}
          className='flex items-center gap-2 text-sm font-bold'
        >
          <span
            aria-hidden='true'
            className={cn('size-2 rounded-full', PROMISE_DOT_CLASS[index])}
          />
          {promise}
        </span>
      ))}
    </>
  )
}
