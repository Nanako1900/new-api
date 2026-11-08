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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Main } from '@/components/layout'
import { getUserQuotaDates } from '@/features/dashboard/api'
import { useProviderHealth } from '@/features/home/hooks/use-provider-health'
import { HOME_PROVIDERS } from '@/features/home/lib/provider-models'
import { getSuccessRateLevel } from '@/features/performance-metrics/lib/format'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { computeTimeRange } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { useAnnouncements, useFAQ } from '../../hooks/use-status-data'
import { healthBadge } from '../../lib/meow-setup'
import { AnnouncementsPanel } from '../overview/announcements-panel'
import { FAQPanel } from '../overview/faq-panel'
import { MeowBalanceCard } from './meow-balance-card'
import { MeowCheckinCard } from './meow-checkin-card'
import { MeowInviteCard } from './meow-invite-card'
import { MeowOverviewGreeting } from './meow-overview-greeting'
import { MeowQuickSetup } from './meow-quick-setup'
import { MeowRecentCalls } from './meow-recent-calls'
import { MeowUsageTrend } from './meow-usage-trend'

const PROVIDER_LABEL = { claude: 'Claude', gpt: 'GPT' } as const

const HEALTH_DOT = {
  healthy: 'bg-success',
  degraded: 'bg-warning',
  unstable: 'bg-destructive',
  unknown: 'bg-muted-foreground/50',
} as const

const HEALTH_LABEL = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unstable: 'Unstable',
  unknown: 'No data',
} as const

function ProviderStatusPills() {
  const { t } = useTranslation()
  const { health, isError } = useProviderHealth()
  if (isError) return null

  return (
    <div className='flex flex-wrap gap-2'>
      {HOME_PROVIDERS.map((provider) => {
        const item = health[provider]
        const badge = healthBadge(
          getSuccessRateLevel(item?.successRate ?? Number.NaN)
        )
        return (
          <span
            key={provider}
            title={item ? `${item.successRate.toFixed(1)}%` : undefined}
            className='bg-card border-border inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-bold'
          >
            <span
              aria-hidden='true'
              className={cn('size-[7px] rounded-full', HEALTH_DOT[badge])}
            />
            {PROVIDER_LABEL[provider]} {t(HEALTH_LABEL[badge])}
          </span>
        )
      })}
    </div>
  )
}

function StatCard(props: { label: string; value: string; accent?: boolean }) {
  return (
    <div className='bg-card border-border flex h-full flex-col justify-between gap-4 rounded-[22px] border p-6'>
      <span className='text-muted-foreground text-sm font-bold'>
        {props.label}
      </span>
      <span
        className={cn(
          'text-[2rem] leading-none font-extrabold tracking-[-0.03em] tabular-nums',
          props.accent && 'text-meow-heading'
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

/**
 * Spend and request count over the last 24 hours. Fetched again, up to the
 * current time, whenever the live balance shows new spend.
 */
function useUsage24h() {
  const usedQuota = useAuthStore((state) => state.auth.user?.used_quota)
  const usageQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'usage-24h', usedQuota],
    queryFn: async () =>
      requireServerSuccess(await getUserQuotaDates(computeTimeRange(1))),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })

  const usage = useMemo(() => {
    let quota = 0
    let count = 0
    for (const item of usageQuery.data?.data ?? []) {
      quota += Number(item.quota) || 0
      count += Number(item.count) || 0
    }
    return { quota, count }
  }, [usageQuery.data])

  return { usage, isLoading: usageQuery.isLoading }
}

/**
 * MeowAPI console overview: greeting, balance, last-24-hour usage, quick
 * setup, daily check-in and recent calls, plus announcements and FAQ when
 * the admin has added any.
 */
export function MeowOverview() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)
  const { status } = useStatus()
  const announcements = useAnnouncements()
  const faq = useFAQ()
  const { usage, isLoading } = useUsage24h()

  const checkinEnabled = status?.checkin_enabled === true
  const hasAnnouncements = announcements.items.length > 0
  const hasFaq = faq.items.length > 0

  return (
    <Main>
      <div className='min-h-0 flex-1 overflow-auto px-4 pt-6 pb-8 sm:px-8 sm:pt-8'>
        <div className='mx-auto flex w-full max-w-[1440px] flex-col gap-5'>
          <header className='flex flex-wrap items-center justify-between gap-4'>
            <MeowOverviewGreeting />
            <ProviderStatusPills />
          </header>

          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12'>
            <div className='sm:col-span-2 lg:col-span-6'>
              <MeowBalanceCard
                remainQuota={Number(user?.quota ?? 0)}
                usedQuota={Number(user?.used_quota ?? 0)}
              />
            </div>
            <div className='lg:col-span-3'>
              <StatCard
                label={t('Spend (24h)')}
                value={isLoading ? '—' : formatQuota(usage.quota)}
                accent
              />
            </div>
            <div className='lg:col-span-3'>
              <StatCard
                label={t('Requests (24h)')}
                value={isLoading ? '—' : formatNumber(usage.count, locale)}
              />
            </div>
          </div>

          {/* Left: setup and spend. Right: check-in and invites. */}
          <div className='grid grid-cols-1 gap-4 lg:grid-cols-12'>
            <div className='flex flex-col gap-4 lg:col-span-8'>
              <MeowQuickSetup />
              <MeowUsageTrend />
            </div>
            <div className='flex flex-col gap-4 lg:col-span-4'>
              {checkinEnabled && <MeowCheckinCard />}
              <MeowInviteCard />
            </div>
          </div>

          <MeowRecentCalls />

          {(hasAnnouncements || hasFaq) && (
            <div
              className={cn(
                'grid grid-cols-1 gap-4',
                hasAnnouncements && hasFaq && 'lg:grid-cols-2'
              )}
            >
              {hasAnnouncements && <AnnouncementsPanel />}
              {hasFaq && <FAQPanel />}
            </div>
          )}
        </div>
      </div>
    </Main>
  )
}
