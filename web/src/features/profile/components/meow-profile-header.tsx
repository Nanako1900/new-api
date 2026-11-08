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
import { Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLiveBalanceTotals } from '@/hooks/use-live-balance'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatCompactNumber, formatQuota } from '@/lib/format'
import { MEOW_AVATAR_FALLBACK_DELAY, getUserAvatarUrl } from '@/lib/meow-avatar'
import { getRoleLabel } from '@/lib/roles'
import { cn } from '@/lib/utils'

import { getDisplayName } from '../lib'
import type { UserProfile } from '../types'
import { AvatarEditorDialog } from './avatar-editor/avatar-editor-dialog'

type MeowProfileHeaderProps = {
  profile: UserProfile | null
  loading: boolean
  onProfileUpdate?: () => void
}

const BADGE_ON_DARK = 'border-white/15! bg-white/10! text-white/85!'

/** One figure in the card's stats panel; the balance is the accented one. */
function CardStat(props: {
  label: string
  value: ReactNode
  title: string
  accent?: boolean
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1.5 px-3 sm:px-5'>
      <dt className='truncate text-xs font-bold text-white/55 sm:text-[13px]'>
        {props.label}
      </dt>
      <dd
        title={props.title}
        className={cn(
          'truncate text-lg leading-none font-extrabold tracking-[-0.03em] tabular-nums sm:text-2xl @4xl:text-[1.625rem]',
          props.accent && 'text-meow-orange'
        )}
      >
        {props.value}
      </dd>
    </div>
  )
}

/**
 * Profile header in the MeowAPI look: one dark card with the calico glow,
 * holding the account on the left and its balance, usage and requests on
 * the right once the card is 56rem wide (below the account when narrower,
 * whatever the sidebar does). Same props and content as the original
 * `ProfileHeader`; the numbers stay live while the page is open.
 */
export function MeowProfileHeader(props: MeowProfileHeaderProps) {
  const { t } = useTranslation()
  const totals = useLiveBalanceTotals(props.profile)
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false)

  if (props.loading) {
    return <Skeleton className='h-[272px] rounded-[22px] xl:h-[162px]' />
  }

  const profile = props.profile
  if (!profile) return null

  const displayName = getDisplayName(profile)
  const avatarName = profile.username || displayName
  const avatarUrl = getUserAvatarUrl(profile.id, profile.setting)
  const details = [`@${profile.username}`, profile.email, profile.group].filter(
    Boolean
  )

  const balance = formatQuota(totals.quota)
  const usage = formatQuota(totals.usedQuota)
  const requests = formatCompactNumber(totals.requestCount)

  return (
    <div className='bg-meow-ink @container relative isolate overflow-hidden rounded-[22px] px-5 py-6 text-white sm:px-8 sm:py-7 dark:bg-[#25211C]'>
      <div
        aria-hidden='true'
        className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-16 -left-12 -z-10 h-52 w-72 rounded-full opacity-55 blur-[56px]'
      />
      <div
        aria-hidden='true'
        className='meow-drift-b bg-meow-orange pointer-events-none absolute -right-20 -bottom-28 -z-10 h-60 w-96 rounded-full opacity-20 blur-[64px]'
      />
      <div className='flex flex-col gap-6 @4xl:flex-row @4xl:items-center @4xl:gap-8'>
        {/* The avatar leads the card; its corners follow the logo's (23%). */}
        <div className='flex min-w-0 flex-1 items-center gap-5 sm:gap-7'>
          <Button
            variant='ghost'
            aria-label={t('Change avatar')}
            title={t('Change avatar')}
            onClick={() => setAvatarEditorOpen(true)}
            className='group/avatar-edit relative size-auto shrink-0 rounded-[23%] p-0 hover:bg-transparent'
          >
            <Avatar className='size-[88px] rounded-[23%] text-2xl ring-2 ring-white/15 transition-transform group-hover/avatar-edit:scale-[1.03] sm:size-[104px] sm:text-3xl'>
              <AvatarImage src={avatarUrl} alt='' className='rounded-[23%]' />
              <AvatarFallback
                delay={avatarUrl ? MEOW_AVATAR_FALLBACK_DELAY : undefined}
                className='rounded-[23%] font-bold text-white'
                style={getUserAvatarStyle(avatarName)}
              >
                {getUserAvatarFallback(avatarName)}
              </AvatarFallback>
            </Avatar>
            <span
              aria-hidden='true'
              className='bg-meow-orange text-meow-ink ring-meow-ink absolute -right-1.5 -bottom-1.5 grid size-8 place-items-center rounded-full ring-[3px] dark:ring-[#25211C]'
            >
              <Pencil className='size-3.5' />
            </span>
          </Button>
          {avatarEditorOpen && (
            <AvatarEditorDialog
              open={avatarEditorOpen}
              onOpenChange={setAvatarEditorOpen}
              userId={profile.id}
              setting={profile.setting}
              onSaved={() => props.onProfileUpdate?.()}
            />
          )}
          <div className='flex min-w-0 flex-1 flex-col gap-1.5 sm:gap-2'>
            <h1 className='truncate text-[1.625rem] leading-tight font-extrabold tracking-[-0.03em] sm:text-[2.125rem]'>
              {displayName}
            </h1>
            <p className='flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-sm text-white/65'>
              {details.map((detail) => (
                <span key={detail} className='truncate'>
                  {detail}
                </span>
              ))}
            </p>
            <div className='mt-1 flex min-w-0 flex-wrap items-center gap-2'>
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
          </div>
        </div>

        <dl className='grid shrink-0 grid-cols-3 divide-x divide-white/10 rounded-[18px] bg-white/[0.06] py-4 ring-1 ring-white/10 @4xl:grid-cols-[repeat(3,minmax(8.5rem,auto))] @4xl:py-5'>
          <CardStat
            label={t('Current Balance')}
            value={balance}
            title={balance}
            accent
          />
          <CardStat label={t('Total Usage')} value={usage} title={usage} />
          <CardStat
            label={t('API Requests')}
            value={requests}
            title={requests}
          />
        </dl>
      </div>
    </div>
  )
}
