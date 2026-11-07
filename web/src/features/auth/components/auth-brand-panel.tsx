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

import { CatEyes, PawPrint, SleepingCat } from '@/components/cat-art'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'

// MeowAPI: the brand side of the auth pages. Styling hooks are the
// data-slot attributes (see `.meow-auth` in meow.css).

const SELLING_POINTS = [
  'Official channels',
  'Pay as you go',
  'Every call itemized',
] as const

/** Logo tile and site name, linking home. */
export function AuthBrandLink() {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  return (
    <Link
      to='/'
      data-slot='auth-brand'
      aria-label={loading ? t('Home') : undefined}
      className='inline-flex items-center gap-2.5 transition-opacity hover:opacity-80'
    >
      {loading ? (
        <Skeleton data-slot='auth-brand-logo' className='size-9' />
      ) : (
        <img
          data-slot='auth-brand-logo'
          src={logo}
          alt=''
          className='size-9 object-cover'
        />
      )}
      {loading ? (
        <Skeleton className='h-6 w-24' />
      ) : (
        <span data-slot='auth-brand-name' className='text-xl'>
          {systemName}
        </span>
      )}
    </Link>
  )
}

/**
 * Left half of the auth pages on large screens: brand, headline, three
 * selling points, and the sleeping cat on a glass ledge. Text only repeats
 * the home page, so it adds no landmark headings; the art is aria-hidden.
 */
export function AuthBrandPanel() {
  const { t } = useTranslation()

  return (
    <aside
      data-slot='auth-brand-panel'
      className='relative hidden w-[46%] max-w-[44rem] shrink-0 flex-col justify-between gap-12 p-10 lg:flex xl:p-14'
    >
      <AuthBrandLink />

      <div className='flex flex-col gap-8'>
        <p className='text-[clamp(2.25rem,3.4vw,3.25rem)] leading-[1.08] font-extrabold tracking-[-0.03em]'>
          <span className='text-meow-accent-text'>{t('Claude and GPT')}</span>
          <br />
          {t('One key,')}{' '}
          <span className='relative isolate inline-block whitespace-nowrap'>
            {t('all set')}
            <span
              aria-hidden='true'
              className='bg-meow-orange absolute inset-x-0 bottom-1 -z-10 h-3 rounded-full opacity-45'
            />
          </span>
        </p>

        <ul className='flex flex-col gap-3.5'>
          {SELLING_POINTS.map((point) => (
            <li
              key={point}
              className='flex items-center gap-3 text-base font-semibold'
            >
              <span
                aria-hidden='true'
                className='bg-meow-orange/15 text-meow-accent-text grid size-8 shrink-0 place-items-center rounded-full'
              >
                <PawPrint className='size-4' />
              </span>
              {t(point)}
            </li>
          ))}
        </ul>
      </div>

      <div
        data-slot='auth-brand-ledge'
        className='relative mt-16 flex items-center gap-2.5 py-4 pr-48 pl-5 text-sm font-bold'
      >
        <SleepingCat className='absolute right-6 bottom-full w-[176px] translate-y-[34.4%]' />
        <CatEyes />
        {t('Ready? Just meow.')}
      </div>
    </aside>
  )
}
