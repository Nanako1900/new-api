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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  claimCacheSubsidy,
  getUserCacheSubsidies,
} from '@/features/cache-subsidy/api'
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '@/features/cache-subsidy/constants'
import { cacheSubsidyQueryKeys } from '@/features/cache-subsidy/lib/query-keys'
import type { UserCacheSubsidy } from '@/features/cache-subsidy/types'
import { useCaptcha } from '@/hooks/use-captcha'
import { toIntlLocale } from '@/i18n/languages'
import { getSelf } from '@/lib/api'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { formatCompactNumber, formatPercent } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

const EMPTY_SUBSIDIES: UserCacheSubsidy[] = []

function formatMinute(seconds: number): string {
  return dayjs(seconds * 1000).format('YYYY-MM-DD HH:mm')
}

function isClaimable(item: UserCacheSubsidy, nowSeconds: number): boolean {
  if (item.grant.status !== 'pending') return false
  const deadline = item.campaign.claim_deadline
  return deadline <= 0 || deadline > nowSeconds
}

/**
 * Cache subsidies the user can claim (or has claimed): the amount, the cache
 * usage it refunds and one claim button per campaign. Claims go through the
 * same human verification as the daily check-in. Renders nothing until the
 * user has a subsidy.
 */
export function MeowCacheSubsidyCard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const setUser = useAuthStore((state) => state.auth.setUser)
  const queryClient = useQueryClient()
  const [claimingId, setClaimingId] = useState<number | null>(null)

  const subsidiesQuery = useQuery({
    queryKey: cacheSubsidyQueryKeys.user(),
    queryFn: async () =>
      requireServerSuccess(await getUserCacheSubsidies()).data ??
      EMPTY_SUBSIDIES,
    staleTime: 60 * 1000,
    // An optional card: a failure hides it instead of a toast or the 500 page.
    meta: { errorToast: false, errorPage: false },
  })
  const subsidies = subsidiesQuery.data ?? EMPTY_SUBSIDIES
  const nowSeconds = Math.floor(Date.now() / 1000)
  const anyClaimable = subsidies.some((item) => isClaimable(item, nowSeconds))
  // No GeeTest traffic while nothing can be claimed.
  const captcha = useCaptcha({ active: anyClaimable || claimingId !== null })

  async function claim(campaignId: number) {
    setClaimingId(campaignId)
    try {
      const res = await captcha.run((token) =>
        claimCacheSubsidy(campaignId, token)
      )
      if (!res) return
      void queryClient.invalidateQueries({
        queryKey: cacheSubsidyQueryKeys.user(),
      })
      if (res.success && res.data) {
        toast.success(
          t(SUCCESS_MESSAGES.CLAIMED, {
            quota: formatQuotaWithCurrency(res.data.quota),
          })
        )
        // Refresh the balance shown on the overview.
        const self = await getSelf().catch(() => null)
        if (self?.success && self.data) setUser(self.data)
        return
      }
      handleServerError(res, t(ERROR_MESSAGES.CLAIM_FAILED))
    } catch (error) {
      handleServerError(error, t(ERROR_MESSAGES.CLAIM_FAILED))
    } finally {
      setClaimingId(null)
    }
  }

  if (subsidies.length === 0) return null

  return (
    <section
      aria-labelledby='meow-cache-subsidy-title'
      className='bg-card border-border relative isolate flex flex-col gap-4 overflow-hidden rounded-[22px] border p-5'
    >
      <div
        aria-hidden='true'
        className='meow-drift-b bg-primary pointer-events-none absolute -top-12 -right-10 -z-10 h-28 w-40 rounded-full opacity-25 blur-[38px] dark:opacity-20'
      />
      <div className='flex flex-col gap-0.5'>
        <h2 id='meow-cache-subsidy-title' className='text-base font-extrabold'>
          {t('Cache subsidy')}
        </h2>
        <span className='text-muted-foreground text-[13px]'>
          {t('Part of the cache cost you paid is coming back to your wallet.')}
        </span>
      </div>

      {subsidies.map((item) => {
        const claimed = item.grant.status === 'claimed'
        const claimable = isClaimable(item, nowSeconds)
        const isClaiming = claimingId === item.campaign.id
        const stats: [string, string][] = [
          [
            t('Cache reads'),
            t('{{value}} tokens', {
              value: formatCompactNumber(item.grant.cache_read_tokens, locale),
            }),
          ],
          [t('Cache cost'), formatQuotaWithCurrency(item.grant.cache_quota)],
        ]
        if (item.campaign.include_cache_writes) {
          stats.splice(1, 0, [
            t('Cache writes'),
            t('{{value}} tokens', {
              value: formatCompactNumber(item.grant.cache_write_tokens, locale),
            }),
          ])
        }

        let buttonLabel = t('Claim {{amount}}', {
          amount: formatQuotaWithCurrency(item.grant.subsidy_quota),
        })
        if (isClaiming) buttonLabel = t('Loading...')
        else if (claimed) {
          buttonLabel =
            item.grant.claimed_at > 0
              ? t('Claimed · {{time}}', {
                  time: formatMinute(item.grant.claimed_at),
                })
              : t('Claimed')
        } else if (!claimable) buttonLabel = t('Claim period ended')

        return (
          <article
            key={item.campaign.id}
            aria-label={item.campaign.name}
            className='border-border/70 flex flex-col gap-3 border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0'
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 flex-col gap-0.5'>
                <h3 className='truncate text-sm font-bold'>
                  {item.campaign.name}
                </h3>
                {item.campaign.description && (
                  <p className='text-muted-foreground line-clamp-2 text-xs leading-relaxed'>
                    {item.campaign.description}
                  </p>
                )}
              </div>
              <span className='bg-primary/10 text-primary shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums'>
                {t('{{percent}} back', {
                  percent: formatPercent(item.campaign.subsidy_percent),
                })}
              </span>
            </div>

            <p className='text-3xl font-extrabold tracking-tight tabular-nums'>
              {formatQuotaWithCurrency(item.grant.subsidy_quota)}
            </p>

            {/* One row per figure: the card column is too narrow for side-by-side
                tiles, which cut token counts off even on wide screens. */}
            <dl className='bg-muted/60 flex flex-col gap-1.5 rounded-xl px-3 py-2.5 text-xs'>
              {stats.map(([label, value]) => (
                <div
                  key={label}
                  className='flex items-baseline justify-between gap-3'
                >
                  <dt className='text-muted-foreground font-semibold'>
                    {label}
                  </dt>
                  <dd className='text-right text-sm font-extrabold whitespace-nowrap tabular-nums'>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <dl className='text-muted-foreground flex flex-col gap-1 text-xs'>
              <div className='flex justify-between gap-3'>
                <dt>{t('Usage window')}</dt>
                <dd className='text-foreground text-right tabular-nums'>
                  {formatMinute(item.campaign.window_start)} –{' '}
                  {formatMinute(item.campaign.window_end)}
                </dd>
              </div>
              {item.campaign.claim_deadline > 0 && (
                <div className='flex justify-between gap-3'>
                  <dt>{t('Claim by')}</dt>
                  <dd className='text-foreground tabular-nums'>
                    {formatMinute(item.campaign.claim_deadline)}
                  </dd>
                </div>
              )}
            </dl>

            <Button
              className={cn(
                'h-11 w-full rounded-xl text-[15px] font-extrabold',
                !claimable &&
                  'bg-muted text-muted-foreground hover:bg-muted disabled:opacity-100'
              )}
              disabled={!claimable || claimingId !== null}
              onClick={() => void claim(item.campaign.id)}
            >
              {buttonLabel}
            </Button>
          </article>
        )
      })}
    </section>
  )
}
