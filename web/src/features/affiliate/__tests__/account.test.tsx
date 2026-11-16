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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatCurrencyAmount } from '@/lib/currency'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { AffiliateCard } from '../components/affiliate-card'
import { AffiliateHistory } from '../components/affiliate-history'
import { AffiliateOverview } from '../components/affiliate-overview'
import type { AffiliateSummary } from '../types'

const summary: AffiliateSummary = {
  user_id: 2,
  inviter_id: 0,
  inviter_name: '',
  invite_count: 2,
  rate_bps: 1250,
  balance_cents: 123456,
  earned_cents: 200000,
  paid_cents: 76544,
  reversed_cents: 0,
}
const originalConfig = useSystemConfigStore.getState().config
function renderAccount(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  useSystemConfigStore.setState({ config: originalConfig })
  localStorage.clear()
  await i18next.changeLanguage('en')
})

it.each(['zhCN', 'zhTW', 'en', 'fr', 'ja', 'ru', 'vi', 'bad_locale!'])(
  'formats actual CNY cents in %s regardless of API display currency',
  (language) => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'TOKENS',
        usdExchangeRate: 99,
      },
    })
    const locale = toIntlLocale(language)
    expect(formatCurrencyAmount(1234.56, 'CNY', { locale })).toBe(
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'CNY',
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(1234.56)
    )
    expect(formatCurrencyAmount(-0.01, 'CNY', { locale })).toBe(
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'CNY',
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(-0.01)
    )
  }
)

it('updates monetary formatting on language changes and shows reversal debt', async () => {
  renderAccount(
    <AffiliateOverview summary={{ ...summary, balance_cents: -123456 }} />
  )
  expect(screen.getByText('-¥1,234.56')).toBeVisible()
  await act(async () => {
    await i18next.changeLanguage('fr')
  })
  expect(screen.getByText(/-1\s234,56\s¥/)).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Future cashback will offset this amount'
  )
})

it('the user card is read-only and shows empty history with disabled navigation', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/history') ? { items: [], total: 0 } : summary,
    },
  }))
  renderAccount(<AffiliateCard />)
  expect(await screen.findByText('¥1,234.56')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Record full payout' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Save referral settings' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Cashback history' })
  )
  expect(await screen.findByText('No cashback records yet')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
})

it('history retries API failures and loads the next page', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({ data: { success: false, message: 'Unavailable' } })
    .mockImplementation(async (_url, config) => ({
      data: {
        success: true,
        data: {
          total: 11,
          items: [
            {
              id: (config?.params as { p: number })?.p,
              kind: 'credit',
              trade_no:
                (config?.params as { p: number })?.p === 2
                  ? 'second-order'
                  : 'first-order',
              base_cents: 10000,
              rate_bps: 1250,
              amount_cents: 1250,
              note: '',
              created_at: 1700000000,
            },
          ],
        },
      },
    }))
  renderAccount(<AffiliateHistory />)
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('first-order')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('second-order')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(get).toHaveBeenLastCalledWith('/api/user/affiliate/history', {
    params: { p: 2, page_size: 10 },
  })
})
