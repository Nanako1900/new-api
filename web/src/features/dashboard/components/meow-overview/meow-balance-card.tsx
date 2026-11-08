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

import { RollingNumber } from '@/components/rolling-number'
import { Button } from '@/components/ui/button'
import { formatQuota } from '@/lib/format'

import { splitAroundName } from '../../lib/meow-setup'

type MeowBalanceCardProps = {
  remainQuota: number
  usedQuota: number
}

/**
 * Balance on a dark tile like the logo, with the orange calico glow. The
 * amounts roll when the live balance changes.
 */
export function MeowBalanceCard(props: MeowBalanceCardProps) {
  const { t } = useTranslation()
  // The used amount sits inside a translated sentence; split around it.
  const used = splitAroundName((placeholder) =>
    t('Used {{amount}}', { amount: placeholder })
  )

  return (
    <div className='bg-meow-ink relative isolate flex flex-col gap-5 overflow-hidden rounded-[22px] px-6 py-6 text-white dark:bg-[#25211C]'>
      <div
        aria-hidden='true'
        className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-16 -left-14 -z-10 h-44 w-56 rounded-full opacity-55 blur-[50px]'
      />
      <span className='text-sm font-bold text-white/70'>{t('Balance')}</span>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div className='flex flex-col gap-1'>
          <span className='text-4xl font-extrabold tracking-[-0.03em] tabular-nums'>
            <RollingNumber value={props.remainQuota} format={formatQuota} />
          </span>
          <span className='text-[13px] text-white/60'>
            {used.before}
            <RollingNumber value={props.usedQuota} format={formatQuota} />
            {used.after}
          </span>
        </div>
        <div className='flex gap-2'>
          <Button
            className='h-10 rounded-xl px-4 font-extrabold'
            render={<Link to='/wallet' />}
          >
            {t('Top up')}
          </Button>
          <Button
            variant='outline'
            className='h-10 rounded-xl border-white/25 bg-transparent px-4 font-bold text-white hover:bg-white/10 hover:text-white dark:bg-transparent'
            render={<Link to='/wallet' />}
          >
            {t('Redeem code')}
          </Button>
        </div>
      </div>
    </div>
  )
}
