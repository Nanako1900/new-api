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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

type MeowClosingProps = {
  isAuthenticated: boolean
}

/** Slim closing call to action: one line of copy and the sign-up button. */
export function MeowClosing(props: MeowClosingProps) {
  const { t } = useTranslation()

  return (
    <section className='mx-auto max-w-6xl px-4 pb-24 sm:px-8'>
      <div className='relative isolate flex flex-col items-start gap-5 overflow-hidden rounded-3xl border border-white/75 bg-linear-to-r from-[#FCE3CE]/90 via-[#FDF0E4]/55 to-white/25 px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_48px_-30px_rgba(30,27,23,0.3)] sm:flex-row sm:items-center sm:px-10 dark:border-[#4A3020] dark:from-[#3B2416] dark:via-[#2A1D14] dark:to-[#1E1B17]'>
        <div
          aria-hidden='true'
          className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-16 -left-10 -z-10 h-40 w-64 rounded-full opacity-45 blur-[56px]'
        />
        <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
          <h2 className='text-2xl font-extrabold tracking-[-0.03em] md:text-[28px]'>
            {t('Ready? Just meow.')}
          </h2>
          <p className='text-muted-foreground text-[15px]'>
            {t('Sign up and make your first call in minutes.')}
          </p>
        </div>
        {props.isAuthenticated ? (
          <Button
            className='h-11 shrink-0 rounded-xl px-6 text-[15px] font-extrabold'
            render={<Link to='/dashboard' />}
          >
            {t('Go to Dashboard')}
          </Button>
        ) : (
          <Button
            className='h-11 shrink-0 rounded-xl px-6 text-[15px] font-extrabold'
            render={<Link to='/sign-up' />}
          >
            {t('Sign up free')}
          </Button>
        )}
      </div>
    </section>
  )
}
