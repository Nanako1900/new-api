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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { BillingHistoryDialog } from '../components/dialogs/billing-history-dialog'

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('manual completion submits verified amount and currency, rejects malformed money and resets the next order', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  const records = ['first', 'second'].map((trade_no, id) => ({
    id,
    trade_no,
    status: 'pending',
    amount: 10,
    money: 10,
    payment_method: 'stripe',
    create_time: 1,
  }))
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: { success: true, data: { items: records, total: records.length } },
  }))
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    records.shift()
    return { data: { success: true } }
  })
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  await userEvent.click(
    (await screen.findAllByRole('button', { name: 'Complete Order' }))[0]
  )
  const input = screen.getByLabelText('Verified payment amount')
  await userEvent.type(input, '-10')
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await userEvent.clear(input)
  await userEvent.type(input, '12.34')
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Payment currency' })
  )
  await userEvent.click(await screen.findByRole('option', { name: 'USD' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/topup/complete', {
      trade_no: 'first',
      payment: { amount: '12.34', currency: 'USD' },
    })
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Complete Order' })
  )
  expect(screen.getByLabelText('Verified payment amount')).toHaveValue('')
  expect(
    screen.getByRole('combobox', { name: 'Payment currency' })
  ).toHaveTextContent('CNY')
})
