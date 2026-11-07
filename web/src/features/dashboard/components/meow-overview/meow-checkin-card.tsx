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
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { GeetestCaptcha } from '@/components/geetest-captcha'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getCheckinStatus, performCheckin } from '@/features/profile/api'
import { useCaptcha } from '@/hooks/use-captcha'
import { getSelf } from '@/lib/api'
import { isCaptchaRejection } from '@/lib/captcha'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  checkinStreak,
  lastSevenDays,
  toDateKey,
  toMonthKey,
} from '../../lib/meow-checkin'
import { MeowCheckinMonth } from './meow-checkin-month'
import { MeowCheckinWeek } from './meow-checkin-week'

type CheckinView = 'week' | 'month'

const CHECKIN_VIEWS: { id: CheckinView; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

/**
 * Month check-in records. Shares the query key with the profile page's
 * calendar card, so both read the same cache.
 */
function useCheckinMonth(month: string, enabled: boolean) {
  const { t } = useTranslation()
  return useQuery({
    queryKey: ['checkin-status', month],
    queryFn: async () => {
      const res = await getCheckinStatus(month)
      if (res.success && res.data) return res.data
      throw createServerError(res, t('Failed to fetch checkin status'))
    },
    enabled,
    staleTime: 30000,
  })
}

/**
 * Daily check-in: the last seven days as paws or the month calendar, the
 * current streak and one button. Check-in and the human verification retry
 * follow the profile calendar card.
 */
export function MeowCheckinCard() {
  const { t } = useTranslation()
  const { captchaId } = useCaptcha()
  const setUser = useAuthStore((state) => state.auth.setUser)
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [captchaOpen, setCaptchaOpen] = useState(false)
  const [captchaWidgetKey, setCaptchaWidgetKey] = useState(0)

  const today = useMemo(() => new Date(), [])
  const week = useMemo(() => lastSevenDays(today), [today])
  const currentMonth = toMonthKey(today)
  const current = useCheckinMonth(currentMonth, true)
  // The week, or a streak running since the 1st, reaches into last month.
  const needsPreviousMonth =
    today.getDate() < 7 ||
    (current.data?.stats?.records ?? []).some(
      (record) => record.checkin_date === `${currentMonth}-01`
    )
  const previous = useCheckinMonth(
    toMonthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    needsPreviousMonth
  )

  const checkedDates = useMemo(() => {
    const dates = new Set<string>()
    for (const record of [
      ...(current.data?.stats?.records ?? []),
      ...(previous.data?.stats?.records ?? []),
    ]) {
      dates.add(record.checkin_date)
    }
    return dates
  }, [current.data, previous.data])

  const [view, setView] = useState<CheckinView>('week')
  const [viewMonth, setViewMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  )
  const shown = useCheckinMonth(toMonthKey(viewMonth), view === 'month')
  const monthAwards = useMemo(() => {
    const awards = new Map<string, number>()
    for (const record of shown.data?.stats?.records ?? []) {
      awards.set(record.checkin_date, record.quota_awarded)
    }
    return awards
  }, [shown.data])

  const checkedToday = current.data?.stats?.checked_in_today === true
  const streak = checkinStreak(today, checkedDates)
  const queryClient = useQueryClient()

  const doCheckin = useCallback(
    async (token?: string) => {
      setCheckinLoading(true)
      try {
        const res = await performCheckin(token)
        if (res.success && res.data) {
          toast.success(
            `${t('Check-in successful! Received')} ${formatQuotaWithCurrency(res.data.quota_awarded)}`
          )
          setCaptchaOpen(false)
          void queryClient.invalidateQueries({ queryKey: ['checkin-status'] })
          // Refresh the balance shown on the overview.
          const self = await getSelf().catch(() => null)
          if (self?.success && self.data) setUser(self.data)
          return
        }
        const captchaRejected = isCaptchaRejection(res)
        if (!token && captchaRejected) {
          if (!captchaId) {
            toast.error(t('GeeTest is enabled but the captcha ID is empty.'))
            return
          }
          setCaptchaOpen(true)
          return
        }
        if (token) {
          // The result is spent: retry with a fresh challenge, or close the
          // check when verification was not what failed.
          setCaptchaWidgetKey((v) => v + 1)
          if (!captchaRejected) setCaptchaOpen(false)
        }
        handleServerError(res, t('Check-in failed'))
      } catch (error) {
        if (token) setCaptchaWidgetKey((v) => v + 1)
        handleServerError(error, t('Check-in failed'))
      } finally {
        setCheckinLoading(false)
      }
    },
    [captchaId, queryClient, setUser, t]
  )

  const todayKey = toDateKey(today)

  let buttonLabel = t('Check in now')
  if (checkinLoading) buttonLabel = t('Loading...')
  else if (checkedToday) buttonLabel = t('Checked in today · see you tomorrow')

  return (
    <div className='bg-card border-border flex flex-col gap-4 rounded-[22px] border p-5'>
      <Dialog
        open={captchaOpen}
        onOpenChange={(open) => {
          setCaptchaOpen(open)
          if (!open) setCaptchaWidgetKey((v) => v + 1)
        }}
        title={t('Security Check')}
        contentClassName='sm:max-w-md'
        contentHeight='auto'
        bodyClassName='space-y-4'
      >
        <div className='text-muted-foreground text-sm'>
          {t('Please complete the security check to continue.')}
        </div>
        <div className='flex justify-center py-4'>
          <GeetestCaptcha
            key={captchaWidgetKey}
            captchaId={captchaId}
            onVerify={(token) => {
              void doCheckin(token)
            }}
          />
        </div>
      </Dialog>

      <div className='flex items-start justify-between gap-3'>
        <div className='flex flex-col gap-0.5'>
          <h2 className='text-base font-extrabold'>{t('Daily Check-in')}</h2>
          <span className='text-primary text-[13px] font-bold'>
            {streak > 0
              ? t('{{count}}-day streak', { count: streak })
              : t('Check in daily to receive random quota rewards')}
          </span>
        </div>
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as CheckinView)}
        >
          <TabsList className='h-8 rounded-[10px] p-0.5'>
            {CHECKIN_VIEWS.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className='h-7 rounded-[8px] px-2.5 text-[12px] font-bold'
              >
                {t(item.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {view === 'week' ? (
        <MeowCheckinWeek
          days={week}
          todayKey={todayKey}
          checkedDates={checkedDates}
          isLoading={current.isLoading}
        />
      ) : (
        <MeowCheckinMonth
          month={viewMonth}
          onMonthChange={setViewMonth}
          canGoNext={toMonthKey(viewMonth) < currentMonth}
          todayKey={todayKey}
          awards={monthAwards}
          totalCheckins={shown.data?.stats?.total_checkins ?? 0}
          totalQuota={shown.data?.stats?.total_quota ?? 0}
          isLoading={shown.isLoading}
        />
      )}

      <Button
        className={cn(
          'mt-auto h-11 w-full rounded-xl text-[15px] font-extrabold',
          checkedToday &&
            'bg-muted text-muted-foreground hover:bg-muted disabled:opacity-100'
        )}
        disabled={checkedToday || checkinLoading || current.isLoading}
        onClick={() => void doCheckin()}
      >
        {buttonLabel}
      </Button>
    </div>
  )
}
