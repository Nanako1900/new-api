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
import { Badge } from '@/components/ui/badge'
import { getUserQuotaDates } from '@/features/dashboard/api'
import { useProviderHealth } from '@/features/home/hooks/use-provider-health'
import { HOME_PROVIDERS } from '@/features/home/lib/provider-models'
import { getSuccessRateLevel } from '@/features/performance-metrics/lib/format'
import { useStatus } from '@/hooks/use-status'
import { requireServerSuccess } from '@/lib/server-error-message'
import { computeTimeRange } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { useAnnouncements, useFAQ } from '../../hooks/use-status-data'
import { healthBadge } from '../../lib/meow-setup'
import { AnnouncementsPanel } from '../overview/announcements-panel'
import { FAQPanel } from '../overview/faq-panel'
import { MeowAnalyticsCard } from './meow-analytics-card'
import { MeowBalanceCard } from './meow-balance-card'
import { MeowCheckinCard } from './meow-checkin-card'
import { MeowGettingStarted } from './meow-getting-started'
import { MeowInviteCard } from './meow-invite-card'
import { MeowOverviewGreeting } from './meow-overview-greeting'
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
          <Badge
            key={provider}
            variant='outline'
            title={item ? `${item.successRate.toFixed(1)}%` : undefined}
            className='h-auto gap-2 px-3 py-1.5'
          >
            <span
              aria-hidden='true'
              className={cn('size-[7px] rounded-full', HEALTH_DOT[badge])}
            />
            {PROVIDER_LABEL[provider]} {t(HEALTH_LABEL[badge])}
          </Badge>
        )
      })}
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
 * MeowAPI console overview: greeting, balance, last-24-hour usage, the
 * getting-started checklist (popular models once done), daily check-in,
 * announcements and FAQ. Detailed analytics and live logs have a dedicated
 * dashboard; this page only loads aggregate usage.
 */
export function MeowOverview() {
  const { t } = useTranslation()
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
        <div className='mx-auto flex w-full max-w-[1440px] flex-col gap-6'>
          <header className='flex flex-wrap items-center justify-between gap-4'>
            <MeowOverviewGreeting />
            <ProviderStatusPills />
          </header>

          <section
            aria-label={t('Overview')}
            className='grid grid-cols-1 gap-4 lg:grid-cols-2'
          >
            <MeowBalanceCard
              remainQuota={Number(user?.quota ?? 0)}
              usedQuota={Number(user?.used_quota ?? 0)}
            />
            <MeowAnalyticsCard
              quota={usage.quota}
              requestCount={usage.count}
              isLoading={isLoading}
            />
          </section>

          {/* Usage is the primary content; account actions sit alongside it. */}
          <div className='grid grid-cols-1 items-start gap-4 lg:grid-cols-12'>
            <div className='flex min-w-0 flex-col gap-4 lg:col-span-8'>
              <MeowUsageTrend />
              <MeowGettingStarted />
            </div>
            <div className='flex min-w-0 flex-col gap-4 lg:col-span-4'>
              {checkinEnabled && <MeowCheckinCard />}
              <MeowInviteCard />
            </div>
          </div>

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
