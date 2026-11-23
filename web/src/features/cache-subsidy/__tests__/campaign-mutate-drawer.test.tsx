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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { CampaignMutateDrawer } from '../components/campaign-mutate-drawer'
import type { Campaign, CampaignPayload, CampaignStatus } from '../types'

// Local midnights, so the pickers show the same dates in every time zone.
const WINDOW_START = new Date(2026, 10, 13).getTime() / 1000
const WINDOW_END = new Date(2026, 10, 20).getTime() / 1000
const CLAIM_DEADLINE = new Date(2026, 11, 20).getTime() / 1000

function campaign(status: CampaignStatus): Campaign {
  return {
    id: 7,
    name: 'November cache refund',
    description: 'Thanks for your patience',
    status,
    window_start: WINDOW_START,
    window_end: WINDOW_END,
    model_rules: ['claude*', 'gpt*'],
    include_cache_writes: true,
    subsidy_percent: 75,
    claim_deadline: CLAIM_DEADLINE,
    // Not a whole cent: a rounded display amount must not replace it.
    per_user_cap_quota: 1_234_567,
    min_subsidy_quota: 0,
    scanned_logs: 0,
    matched_logs: 0,
    skipped_logs: 0,
    skip_reasons: {},
    progress: 0,
    last_error: '',
    eligible_users: 0,
    total_cache_quota: 0,
    total_subsidy_quota: 0,
    claimed_users: 0,
    claimed_quota: 0,
    calculated_at: 0,
    opened_at: 0,
    closed_at: 0,
    created_at: 0,
    updated_at: 0,
  }
}

function renderDrawer(currentRow?: Campaign) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CampaignMutateDrawer
        open
        currentRow={currentRow}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>
  )
  return { onOpenChange }
}

beforeEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      displayInCurrency: true,
      quotaDisplayType: 'USD',
      quotaPerUnit: 500000,
      usdExchangeRate: 1,
      customCurrencySymbol: '¤',
      customCurrencyExchangeRate: 1,
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('campaign drawer', () => {
  test('creating without a name or window end shows both errors and sends nothing', async () => {
    const post = vi.spyOn(api, 'post')
    const user = userEvent.setup()
    renderDrawer()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Name is required')).toBeVisible()
    expect(screen.getByText('Select when the window ends')).toBeVisible()
    expect(post).not.toHaveBeenCalled()
  })

  test('a draft rejects a percentage above 100, then saves the corrected value and keeps the exact cap', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, data: campaign('draft') } })
    const user = userEvent.setup()
    const { onOpenChange } = renderDrawer(campaign('draft'))
    const percent = screen.getByLabelText('Subsidy percentage')

    await user.clear(percent)
    await user.type(percent, '120')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('Enter a percentage between 0 and 100')
    ).toBeVisible()
    expect(percent).toHaveAttribute('aria-invalid', 'true')
    expect(put).not.toHaveBeenCalled()

    await user.clear(percent)
    await user.type(percent, '80')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    const [url, body] = put.mock.calls[0] as [string, CampaignPayload]
    expect(url).toBe('/api/cache_subsidy/admin/campaigns/7')
    expect(body).toEqual({
      name: 'November cache refund',
      description: 'Thanks for your patience',
      window_start: WINDOW_START,
      window_end: WINDOW_END,
      model_rules: ['claude*', 'gpt*'],
      include_cache_writes: true,
      subsidy_percent: 80,
      claim_deadline: CLAIM_DEADLINE,
      per_user_cap_quota: 1_234_567,
      min_subsidy_quota: 0,
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('an open campaign locks the rule fields but saves a new name with the rules unchanged', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true, data: campaign('open') } })
    const user = userEvent.setup()
    renderDrawer(campaign('open'))

    expect(
      screen.getByText(
        'Claims are open. Only the name, description and claim deadline can change.'
      )
    ).toBeVisible()
    expect(screen.getByLabelText('Subsidy percentage')).toBeDisabled()
    expect(screen.getByLabelText('Per-user cap (USD)')).toBeDisabled()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: '2026-11-13' })).toBeDisabled()
    const name = screen.getByLabelText('Name')
    expect(name).toBeEnabled()

    await user.clear(name)
    await user.type(name, 'Cache refund, round one')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    const body = put.mock.calls[0][1] as CampaignPayload
    expect(body.name).toBe('Cache refund, round one')
    expect(body.model_rules).toEqual(['claude*', 'gpt*'])
    expect(body.subsidy_percent).toBe(75)
    expect(body.window_end).toBe(WINDOW_END)
  })
})
