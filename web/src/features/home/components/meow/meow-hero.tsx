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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CatEyes } from '@/components/cat-art'
import { Button } from '@/components/ui/button'

import { MeowCodeCard } from './meow-code-card'

type MeowHeroProps = {
  isAuthenticated: boolean
}

export function MeowHero(props: MeowHeroProps) {
  const { t } = useTranslation()

  return (
    <section className='mx-auto flex max-w-6xl flex-col gap-16 px-4 pt-14 pb-20 sm:px-8 md:pt-20 lg:flex-row lg:items-center lg:pb-24'>
      <div className='flex min-w-0 flex-1 flex-col items-start gap-6'>
        <span className='border-border inline-flex items-center gap-2.5 rounded-full border py-1.5 pr-3.5 pl-2.5 text-sm font-bold'>
          <CatEyes />
          {t('Claude · GPT official channels')}
        </span>

        <h1 className='text-[clamp(2.6rem,5.6vw,4.5rem)] leading-[1.06] font-extrabold tracking-[-0.035em]'>
          <span className='text-meow-heading'>{t('Claude and GPT')}</span>
          <br />
          {t('One key,')}{' '}
          <span className='relative isolate inline-block whitespace-nowrap'>
            {t('all set')}
            <span
              aria-hidden='true'
              className='bg-meow-orange absolute inset-x-0 bottom-1 -z-10 h-3 rounded-full opacity-45'
            />
          </span>
        </h1>

        <p className='text-muted-foreground max-w-lg text-lg leading-relaxed'>
          {t('Swap one Base URL, pay as you go, and see every call itemized.')}
        </p>

        <div className='flex flex-wrap items-center gap-5'>
          {props.isAuthenticated ? (
            <Button
              className='h-12 rounded-[14px] px-6 text-base font-extrabold'
              render={<Link to='/dashboard' />}
            >
              {t('Go to Dashboard')}
            </Button>
          ) : (
            <Button
              className='h-12 rounded-[14px] px-6 text-base font-extrabold'
              render={<Link to='/sign-up' />}
            >
              {t('Get Started')}
            </Button>
          )}
          <Link
            to='/pricing'
            className='text-primary inline-flex items-center gap-1.5 text-base font-bold'
          >
            {t('View Pricing')}
            <ArrowRight className='size-4' aria-hidden='true' />
          </Link>
        </div>
      </div>

      <MeowCodeCard className='min-w-0 flex-1' />
    </section>
  )
}
