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

import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyAmount } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import type { AffiliateSummary } from '../types'

export function AffiliateOverview(props: { summary: AffiliateSummary }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const summary = props.summary
  return (
    <div className='space-y-3'>
      <dl className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
        {[
          [t('Pending cashback'), summary.balance_cents],
          [t('Lifetime cashback'), summary.earned_cents],
          [t('Cashback paid out'), summary.paid_cents],
          [t('Cashback reversed'), summary.reversed_cents],
        ].map(([label, cents]) => (
          <div key={label} className='min-w-0'>
            <dt className='text-muted-foreground text-xs'>{label}</dt>
            <dd className='mt-1 font-semibold break-words tabular-nums'>
              {formatCurrencyAmount(Number(cents) / 100, 'CNY', { locale })}
            </dd>
          </div>
        ))}
      </dl>
      <p className='text-muted-foreground text-xs'>
        {t('Cashback rate: {{rate}}% · Invited users: {{count}}', {
          rate: formatNumber(summary.rate_bps / 100, locale),
          count: formatNumber(summary.invite_count, locale),
        })}
      </p>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Cashback is recorded in CNY separately from your API balance. Payouts are recorded by an administrator.'
        )}
      </p>
      {summary.balance_cents < 0 && (
        <p role='status' className='text-destructive text-xs'>
          {t(
            'Reversed cashback exceeds unpaid earnings. Future cashback will offset this amount.'
          )}
        </p>
      )}
    </div>
  )
}
