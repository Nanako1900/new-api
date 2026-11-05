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

import { CopyButton } from '@/components/copy-button'
import { useAffiliate } from '@/features/wallet/hooks/use-affiliate'
import { formatQuota } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Referral link and rewards, in the calico style: glass with the orange
 * patch glow. Transfers stay on the wallet page.
 */
export function MeowInviteCard() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const { affiliateLink, loading } = useAffiliate()

  const stats = [
    [t('Invites'), String(user?.aff_count ?? 0)],
    [t('Available Rewards'), formatQuota(user?.aff_quota ?? 0)],
  ]

  return (
    <div className='bg-card border-border relative isolate flex flex-1 flex-col gap-3 overflow-hidden rounded-[22px] border p-5'>
      <div
        aria-hidden='true'
        className='meow-drift-a bg-meow-orange pointer-events-none absolute -top-10 -left-10 -z-10 h-28 w-36 rounded-full opacity-45 blur-[34px] dark:opacity-30'
      />
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-base font-extrabold'>{t('Invite friends')}</h2>
        <Link
          to='/wallet'
          className='text-primary inline-flex items-center gap-1 text-[13px] font-bold'
        >
          {t('Wallet')}
          <ArrowRight className='size-3.5' aria-hidden='true' />
        </Link>
      </div>
      <p className='text-muted-foreground text-[13px] leading-relaxed'>
        {t('Friends sign up with your link, you earn rewards.')}
      </p>
      <dl className='grid grid-cols-2 gap-2'>
        {stats.map(([label, value]) => (
          <div
            key={label}
            className='bg-muted/60 flex flex-col-reverse gap-0.5 rounded-xl px-3 py-2'
          >
            <dt className='text-muted-foreground text-[11px] font-semibold'>
              {label}
            </dt>
            <dd className='text-base font-extrabold tabular-nums'>{value}</dd>
          </div>
        ))}
      </dl>
      <CopyButton
        value={affiliateLink}
        variant='outline'
        size='default'
        className='mt-auto h-10 w-full rounded-xl font-bold'
        iconClassName='size-4'
        aria-label={t('Copy referral link')}
      >
        {loading ? t('Loading...') : t('Copy referral link')}
      </CopyButton>
    </div>
  )
}
