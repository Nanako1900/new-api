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
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatCurrencyAmount } from '@/lib/currency'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { AffiliateCard } from '../components/affiliate-card'
import { AffiliateHistory } from '../components/affiliate-history'
import { AffiliateOverview } from '../components/affiliate-overview'
import type { AffiliateSummary, InviteeTopUps } from '../types'

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
function renderAccount(children: React.ReactNode, staleTime = 0) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime } },
  })
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 2, username: 'owner', role: 1 })
})
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
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
      data: url === '/api/user/affiliate' ? summary : { items: [], total: 0 },
    },
  }))
  renderAccount(<AffiliateCard />)
  expect(await screen.findByText('¥1,234.56')).toBeVisible()
  expect(await screen.findByText('No invited users yet')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Record full payout' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Save referral settings' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Cashback history' })
  )
  const history = within(await screen.findByRole('dialog'))
  expect(await history.findByText('No cashback records yet')).toBeVisible()
  expect(history.getByRole('button', { name: 'Previous' })).toBeDisabled()
  expect(history.getByRole('button', { name: 'Next' })).toBeDisabled()
})

it('lists invitees with exact totals per currency and paginates non-qualifying invitees', async () => {
  const paidInvitee: InviteeTopUps = {
    id: 4,
    display_name: 'Visible buyer',
    topup_count: 3,
    topup_totals: [
      { currency: 'CNY', paid_cents: '525' },
      { currency: 'GBP', paid_cents: '9007199254741001' },
    ],
    last_settled_at: new Date(2025, 1, 5, 12, 30).getTime() / 1000,
  }
  const otherInvitee: InviteeTopUps = {
    id: 3,
    display_name: 'Other invitee',
    topup_count: 0,
    topup_totals: [],
    last_settled_at: null,
  }
  const get = vi.spyOn(api, 'get').mockImplementation(async (url, config) => ({
    data: {
      success: true,
      data:
        url === '/api/user/affiliate/invitees'
          ? {
              total: 11,
              items: [
                (config?.params as { p?: number } | undefined)?.p === 2
                  ? otherInvitee
                  : paidInvitee,
              ],
            }
          : summary,
    },
  }))
  renderAccount(<AffiliateCard />)
  const invitees = within(
    await screen.findByRole('table', { name: 'Invited users' })
  )
  const row = within(invitees.getByRole('row', { name: /Visible buyer/ }))
  expect(row.getByRole('cell', { name: '3' })).toBeVisible()
  expect(row.getByText('CNY 5.25')).toBeVisible()
  expect(row.getByText('GBP 90,071,992,547,410.01')).toBeVisible()
  expect(row.getByText('2025-02-05 12:30:00')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  const otherRow = within(
    await screen.findByRole('row', { name: /Other invitee/ })
  )
  expect(otherRow.getByRole('cell', { name: '0' })).toBeVisible()
  expect(otherRow.getByText('No eligible recharges yet')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(get).toHaveBeenCalledWith('/api/user/affiliate/invitees', {
    params: { p: 2, page_size: 10 },
  })
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
              buyer_name: 'Visible buyer',
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
  expect(screen.getByText('Visible buyer')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('second-order')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(get).toHaveBeenLastCalledWith('/api/user/affiliate/history', {
    params: { p: 2, page_size: 10 },
  })
})

it('shows the recorded payer for a reversal and distinguishes missing payers from payouts', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 3,
            kind: 'reversal',
            trade_no: 'reversed-order',
            buyer_name: 'Reversed buyer',
            amount_cents: -500,
          },
          {
            id: 2,
            kind: 'credit',
            trade_no: 'missing-payer',
            rate_bps: 1000,
            base_cents: 2500,
            amount_cents: 250,
          },
          { id: 1, kind: 'withdrawal', amount_cents: -1000 },
        ],
        total: 3,
      },
    },
  })
  renderAccount(<AffiliateHistory />)
  expect(
    await screen.findByRole('columnheader', { name: 'Paid by' })
  ).toBeVisible()
  expect(
    within(screen.getByRole('row', { name: /reversed-order/ })).getByText(
      'Reversed buyer'
    )
  ).toBeVisible()
  expect(
    within(screen.getByRole('row', { name: /missing-payer/ })).getByText(
      'Payer unavailable'
    )
  ).toBeVisible()
  const payoutCells = within(
    screen.getByRole('row', { name: /Manual payout/ })
  ).getAllByRole('cell')
  const payerColumn = screen
    .getAllByRole('columnheader')
    .findIndex((header) => header.textContent === 'Paid by')
  expect(payoutCells[payerColumn]).toHaveTextContent(/^—$/)
})

it('switching accounts clears the previously displayed invitee and payer data', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const owner = useAuthStore.getState().auth.user?.id
    let data: unknown = { ...summary, user_id: owner }
    if (url.endsWith('/invitees')) {
      data = {
        total: 1,
        items: [
          {
            id: owner,
            display_name: `Invitee for ${owner}`,
            topup_count: 0,
            topup_totals: [],
            last_settled_at: null,
          },
        ],
      }
    } else if (url.endsWith('/history')) {
      data = {
        total: 1,
        items: [
          {
            id: owner,
            kind: 'credit',
            buyer_name: `Payer for ${owner}`,
            rate_bps: 1000,
            base_cents: 2500,
            amount_cents: 250,
          },
        ],
      }
    }
    return { data: { success: true, data } }
  })
  renderAccount(<AffiliateCard />, Infinity)
  expect(await screen.findByText('Invitee for 2')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Cashback history' })
  )
  expect(await screen.findByText('Payer for 2')).toBeVisible()
  act(() => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 5, username: 'other-owner', role: 1 })
  })
  expect(screen.queryByText('Payer for 2')).not.toBeInTheDocument()
  expect(screen.queryByText('Invitee for 2')).not.toBeInTheDocument()
  expect(await screen.findByText('Payer for 5')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(await screen.findByText('Invitee for 5')).toBeVisible()
})
