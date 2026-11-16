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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { UsersProvider } from '@/features/users/components/users-provider'
import { api } from '@/lib/api'

import { AffiliateAdminDialog } from '../components/affiliate-admin-dialog'
import { AffiliateSettingsForm } from '../components/affiliate-settings-form'
import type { AffiliateSummary } from '../types'

const summary: AffiliateSummary = {
  user_id: 2,
  inviter_id: 0,
  inviter_name: '',
  invite_count: 3,
  rate_bps: 1000,
  balance_cents: 1234,
  earned_cents: 1434,
  paid_cents: 200,
  reversed_cents: 0,
}
function renderAffiliate(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <UsersProvider>{children}</UsersProvider>
    </QueryClientProvider>
  )
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('searching a different inviter retains the selected identity and submits the rate in basis points', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: {
        items: url.includes('Bob')
          ? [{ id: 8, username: 'bob', display_name: 'Bob' }]
          : [
              { id: 7, username: 'alice', display_name: 'Alice' },
              { id: 2, username: 'self' },
            ],
      },
    },
  }))
  const submit = vi.fn()
  renderAffiliate(<AffiliateSettingsForm summary={summary} onSubmit={submit} />)
  await userEvent.type(
    screen.getByLabelText('Search inviter by ID or username'),
    'Alice'
  )
  await waitFor(() => expect(api.get).toHaveBeenCalled())
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  expect(
    screen.queryByRole('option', { name: 'self (#2)' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    await screen.findByRole('option', { name: 'Alice (#7)' })
  )
  await userEvent.clear(
    screen.getByLabelText('Search inviter by ID or username')
  )
  await userEvent.type(
    screen.getByLabelText('Search inviter by ID or username'),
    'Bob'
  )
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('Bob'))
  )
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Inviter' })).toHaveValue(
      'Alice (#7)'
    )
  )
  const rate = screen.getByLabelText('Cashback rate (%)')
  await userEvent.clear(rate)
  await userEvent.type(rate, '100.01')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save referral settings' })
  )
  expect(await screen.findByText('Invalid referral settings')).toBeVisible()
  expect(submit).not.toHaveBeenCalled()
  await userEvent.clear(rate)
  await userEvent.type(rate, '12.34')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save referral settings' })
  )
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      user_id: 2,
      action: 'settings',
      inviter_id: 7,
      rate_bps: 1234,
    })
  )
})

it('recording a payout requires a note and single-use proof bound to the previewed balance', async () => {
  let current = summary
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/verify/methods') {
      return {
        data: {
          success: true,
          data: {
            scope: 'admin.user.affiliate',
            methods: [{ method: '2fa', available: true }],
            oauth_providers: [],
            password_encryption_enabled: false,
          },
        },
      }
    }
    return { data: { success: true, data: current } }
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/verify') {
      return {
        data: {
          success: true,
          data: {
            proof_token: 'payout-proof',
            scope: 'admin.user.affiliate',
            method: '2fa',
            expires_at: 9999999999,
          },
        },
      }
    }
    current = {
      ...summary,
      balance_cents: 300,
      earned_cents: 1734,
      paid_cents: 1434,
    }
    return { data: { success: true } }
  })
  renderAffiliate(
    <AffiliateAdminDialog
      userId={2}
      username='Alice'
      open
      onOpenChange={vi.fn()}
    />
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Record full payout' })
  )
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await userEvent.type(
    screen.getByLabelText('Payment reference or reason'),
    'bank-123'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByLabelText('Authenticator code or backup code')
  expect(post).not.toHaveBeenCalledWith(
    '/api/user/2/affiliate',
    expect.anything(),
    expect.anything()
  )
  await userEvent.type(
    screen.getByLabelText('Authenticator code or backup code'),
    '123456'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
  const action = {
    user_id: 2,
    action: 'withdrawal',
    amount_cents: 1234,
    expected_paid_cents: 200,
    request_id: expect.any(String),
    note: 'bank-123',
  }
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/2/affiliate', action, {
      headers: { 'X-Security-Proof': 'payout-proof' },
      singleUseAuthorization: true,
    })
  )
  expect(post).toHaveBeenCalledWith(
    '/api/verify',
    expect.objectContaining({ scope: 'admin.user.affiliate', context: action }),
    expect.anything()
  )
  expect(await screen.findByText('¥3')).toBeVisible()
})

it('cancelling verification keeps the payout confirmation without submitting money changes', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/verify/methods'
          ? {
              scope: 'admin.user.affiliate',
              methods: [{ method: '2fa', available: true }],
              oauth_providers: [],
              password_encryption_enabled: false,
            }
          : summary,
    },
  }))
  const post = vi.spyOn(api, 'post')
  renderAffiliate(
    <AffiliateAdminDialog
      userId={2}
      username='Alice'
      open
      onOpenChange={vi.fn()}
    />
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Record full payout' })
  )
  await userEvent.type(
    screen.getByLabelText('Payment reference or reason'),
    'bank-123'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByLabelText('Authenticator code or backup code')
  await userEvent.keyboard('{Escape}')
  expect(await screen.findByRole('alertdialog')).toBeVisible()
  expect(screen.getByLabelText('Payment reference or reason')).toHaveValue(
    'bank-123'
  )
  expect(post).not.toHaveBeenCalled()
})
