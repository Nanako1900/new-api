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

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { MEOW_AVATAR_FALLBACK_DELAY, getUserAvatarUrl } from '@/lib/meow-avatar'
import { useAuthStore } from '@/stores/auth-store'

import { greetingFor, splitAroundName } from '../../lib/meow-setup'

const GREETING_KEY = {
  morning: 'Good morning, {{name}}',
  afternoon: 'Good afternoon, {{name}}',
  evening: 'Good evening, {{name}}',
} as const

/**
 * The overview greeting: the user's avatar beside "Good evening, name" and
 * today's date. The avatar is only shown here; it is changed on the profile
 * page.
 */
export function MeowOverviewGreeting() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)

  const now = new Date()
  const name = user?.display_name || user?.username || ''
  const avatarName = user?.username || name
  const avatarUrl = getUserAvatarUrl(user?.id, user?.setting)
  const greeting = splitAroundName((placeholder) =>
    t(GREETING_KEY[greetingFor(now.getHours())], { name: placeholder })
  )
  const dateLine = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now)

  return (
    <div className='flex min-w-0 items-center gap-3.5 sm:gap-4'>
      <Avatar className='size-12 text-base sm:size-14 sm:text-lg'>
        <AvatarImage src={avatarUrl} alt='' />
        <AvatarFallback
          delay={avatarUrl ? MEOW_AVATAR_FALLBACK_DELAY : undefined}
          className='font-bold text-white'
          style={getUserAvatarStyle(avatarName)}
        >
          {getUserAvatarFallback(avatarName)}
        </AvatarFallback>
      </Avatar>
      <div className='flex min-w-0 flex-col gap-1'>
        <h1 className='truncate text-2xl font-extrabold tracking-[-0.03em] sm:text-[1.75rem]'>
          {greeting.before}
          <span className='text-meow-heading'>{name}</span>
          {greeting.after}
        </h1>
        <span className='text-muted-foreground text-sm'>{dateLine}</span>
      </div>
    </div>
  )
}
