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

import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { useLiveBalanceTotals } from '@/hooks/use-live-balance'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatCompactNumber, formatQuota } from '@/lib/format'
import { getRoleLabel } from '@/lib/roles'
import { cn } from '@/lib/utils'

import { getDisplayName } from '../lib'
import type { UserProfile } from '../types'

type MeowProfileHeaderProps = {
  profile: UserProfile | null
  loading: boolean
}

const BADGE_ON_DARK = 'border-white/15! bg-white/10! text-white/85!'

function StatTile(props: { label: string; value: string; accent?: boolean }) {
  return (
    <div className='isolate flex min-w-0 flex-col justify-between gap-3 rounded-[20px] border border-white/85 bg-[#fffbf5]/60 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_24px_48px_-30px_rgba(30,27,23,0.3)] sm:px-6 sm:py-5 dark:border-white/10 dark:bg-white/[0.05] dark:shadow-none'>
      <span className='text-muted-foreground truncate text-[13px] font-bold'>
        {props.label}
      </span>
      <span
        className={cn(
          'truncate text-xl leading-none font-extrabold tracking-[-0.03em] tabular-nums sm:text-[1.75rem]',
          props.accent && 'text-meow-heading'
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

/**
 * Profile header in the MeowAPI look: the account on a dark tile with the
 * calico glow, then balance, usage and requests. Same props and content as
 * the original `ProfileHeader`; the numbers stay live while the page is open.
 */
export function MeowProfileHeader(props: MeowProfileHeaderProps) {
  const { t } = useTranslation()
  const totals = useLiveBalanceTotals(props.profile)

  if (props.loading) {
    return (
      <div className='flex flex-col gap-4'>
        <Skeleton className='h-28 rounded-[22px]' />
        <div className='grid grid-cols-3 gap-3 sm:gap-4'>
          {['balance', 'usage', 'requests'].map((key) => (
            <Skeleton key={key} className='h-24 rounded-[20px]' />
          ))}
        </div>
      </div>
    )
  }

  const profile = props.profile
  if (!profile) return null

  const displayName = getDisplayName(profile)
  const avatarName = profile.username || displayName
  const details = [`@${profile.username}`, profile.email, profile.group].filter(
    Boolean
  )

  return (
    <div className='flex flex-col gap-4'>
      <div className='bg-meow-ink relative isolate overflow-hidden rounded-[22px] px-5 py-5 text-white sm:px-7 sm:py-6 dark:bg-[#25211C]'>
        <div
          aria-hidden='true'
          className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-16 -left-12 -z-10 h-44 w-60 rounded-full opacity-55 blur-[50px]'
        />
        <div className='flex items-center gap-4'>
          <Avatar className='size-14 rounded-2xl text-lg ring-2 ring-white/15 sm:size-16'>
            <AvatarFallback
              className='rounded-2xl font-bold text-white'
              style={getUserAvatarStyle(avatarName)}
            >
              {getUserAvatarFallback(avatarName)}
            </AvatarFallback>
          </Avatar>
          <div className='flex min-w-0 flex-1 flex-col gap-2'>
            <div className='flex min-w-0 flex-wrap items-center gap-2'>
              <h1 className='truncate text-2xl font-extrabold tracking-[-0.03em] sm:text-[1.75rem]'>
                {displayName}
              </h1>
              <StatusBadge
                label={getRoleLabel(profile.role)}
                variant='neutral'
                copyable={false}
                className={BADGE_ON_DARK}
              />
              <StatusBadge
                label={`${t('User ID')} ${profile.id}`}
                variant='info'
                copyText={String(profile.id)}
                className={BADGE_ON_DARK}
              />
            </div>
            <p className='flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-sm text-white/65'>
              {details.map((detail) => (
                <span key={detail} className='truncate'>
                  {detail}
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>

      <div className='relative isolate grid grid-cols-3 gap-3 sm:gap-4'>
        <div
          aria-hidden='true'
          className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-6 -left-4 -z-10 h-36 w-60 rounded-full opacity-50 blur-[50px]'
        />
        <div
          aria-hidden='true'
          className='meow-drift-b bg-meow-ink pointer-events-none absolute top-4 right-8 -z-10 h-32 w-44 rounded-full opacity-25 blur-[54px] dark:bg-white dark:opacity-10'
        />
        <StatTile
          label={t('Current Balance')}
          value={formatQuota(totals.quota)}
          accent
        />
        <StatTile
          label={t('Total Usage')}
          value={formatQuota(totals.usedQuota)}
        />
        <StatTile
          label={t('API Requests')}
          value={formatCompactNumber(totals.requestCount)}
        />
      </div>
    </div>
  )
}
