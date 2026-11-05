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

import { Playground } from '@/features/playground'

/**
 * MeowAPI playground: the original chat with a page title, the calico
 * glows behind the composer and the MeowAPI message styles
 * (`.meow-playground` in meow.css).
 */
export function MeowPlayground() {
  const { t } = useTranslation()

  return (
    <div className='meow-playground relative flex size-full min-h-0 flex-col overflow-hidden'>
      <header className='mx-auto flex w-full max-w-4xl flex-col gap-1 px-4 pt-6 sm:px-6'>
        <h1 className='text-2xl font-extrabold tracking-[-0.03em] sm:text-[1.75rem]'>
          {t('Playground')}
        </h1>
        <p className='text-muted-foreground text-sm'>
          {t('Try Claude and GPT right here. Calls use your balance.')}
        </p>
      </header>
      <div className='relative isolate flex min-h-0 flex-1 flex-col'>
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-x-0 bottom-0 -z-10 mx-auto h-40 w-full max-w-4xl'
        >
          <div className='meow-drift-a bg-meow-orange absolute bottom-6 left-0 h-28 w-60 rounded-full opacity-45 blur-[46px]' />
          <div className='meow-drift-b bg-meow-ink absolute right-10 bottom-10 h-24 w-44 rounded-full opacity-25 blur-[46px] dark:bg-white dark:opacity-10' />
        </div>
        <Playground />
      </div>
    </div>
  )
}
