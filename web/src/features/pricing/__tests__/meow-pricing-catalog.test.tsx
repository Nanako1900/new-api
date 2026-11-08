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
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { MeowPricingCatalog } from '../components/meow/meow-pricing-catalog'
import type { PricingData, PricingModel } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

const LAST_HOUR = 1_800_000_000

const SONNET: PricingModel = {
  id: 1,
  model_name: 'claude-sonnet',
  quota_type: 0,
  model_ratio: 1.5,
  completion_ratio: 5,
  cache_ratio: 0.1,
  enable_groups: ['official', 'kiro'],
}

const PRICING: PricingData = {
  success: true,
  data: [SONNET],
  vendors: [],
  group_ratio: { official: 1.5, kiro: 0.9 },
  // The endpoint sends group → description strings.
  usable_group: {
    official: 'Official',
    kiro: 'Kiro',
  } as unknown as PricingData['usable_group'],
  supported_endpoint: {},
  auto_groups: [],
}

/** Serves the page requests; `perf` maps group → success rate, or fails. */
function mockApi(
  options: {
    pricing?: PricingData | 'fail' | 'fail-once'
    perf?: Record<string, number> | 'fail'
  } = {}
) {
  let pricingCalls = 0
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === '/api/pricing') {
      pricingCalls += 1
      if (options.pricing === 'fail') throw new Error('pricing down')
      if (options.pricing === 'fail-once' && pricingCalls === 1) {
        throw new Error('pricing down')
      }
      if (options.pricing === 'fail-once') return { data: PRICING }
      return { data: options.pricing ?? PRICING }
    }
    if (url === '/api/perf-metrics') {
      if (options.perf === 'fail') {
        throw Object.assign(new Error('metrics down'), {
          response: { status: 500 },
        })
      }
      const groups = Object.entries(options.perf ?? {}).map(
        ([group, rate]) => ({
          group,
          success_rate: rate,
          avg_latency_ms: 1300,
          avg_tps: 74,
          avg_ttft_ms: 400,
          series: [],
        })
      )
      return {
        data: {
          success: true,
          data: {
            model_name: (config?.params as { model?: string } | undefined)
              ?.model,
            window_end: LAST_HOUR,
            groups,
          },
        },
      }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

function renderCatalog(
  status = { price: 1, usd_exchange_rate: 1 },
  onInternalServerError = vi.fn()
) {
  const client = createAppQueryClient(onInternalServerError)
  client.setQueryData(['status'], status)
  render(
    <QueryClientProvider client={client}>
      <MeowPricingCatalog />
    </QueryClientProvider>
  )
  return client
}

async function sonnetRow(tableName: string) {
  const table = await screen.findByRole('table', { name: tableName })
  return within(table).getByRole('row', { name: /claude-sonnet/ })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('meow pricing catalog', () => {
  it('hides the price mode switch when recharge and exchange rates match', async () => {
    mockApi()
    renderCatalog({ price: 1, usd_exchange_rate: 1 })

    await sonnetRow('Claude · Official')

    expect(
      screen.queryByRole('button', { name: 'Recharge' })
    ).not.toBeInTheDocument()
  })

  it('switches to recharge prices when top-ups are discounted', async () => {
    const user = userEvent.setup()
    mockApi()
    renderCatalog({ price: 4, usd_exchange_rate: 8 })
    expect(await sonnetRow('Claude · Official')).toHaveTextContent('$4.5')

    await user.click(screen.getByRole('button', { name: 'Recharge' }))

    expect(await sonnetRow('Claude · Official')).toHaveTextContent('$2.25')
  })

  it('opens the details drawer when a model name is clicked', async () => {
    // The drawer loads lazily; warm its chunk so a cold module cache cannot
    // outlast the lookup below.
    await import('../components/model-details')
    const user = userEvent.setup()
    mockApi()
    renderCatalog()

    await user.click(
      within(await sonnetRow('Claude · Official')).getByRole('button', {
        name: 'claude-sonnet',
      })
    )

    expect(
      await screen.findByRole('dialog', { name: 'claude-sonnet' })
    ).toBeInTheDocument()
  }, 60_000)

  it('shows each channel the success rate measured for its group', async () => {
    mockApi({ perf: { official: 99.95, kiro: 97.8 } })
    renderCatalog()

    const official = await sonnetRow('Claude · Official')
    await waitFor(() => expect(official).toHaveTextContent('99.95%'))
    expect(await sonnetRow('Claude · Kiro')).toHaveTextContent('97.80%')
  })

  it('keeps prices, stays on the page and stays quiet when the metrics request fails', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const onInternalServerError = vi.fn()
    mockApi({ perf: 'fail' })
    const client = renderCatalog(
      { price: 1, usd_exchange_rate: 1 },
      onInternalServerError
    )

    const row = await sonnetRow('Claude · Official')
    await waitFor(() =>
      expect(
        client.getQueryState(['perf-metrics', 'claude-sonnet'])?.status
      ).toBe('error')
    )
    expect(onInternalServerError).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    const cells = within(row).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('$4.5')
    expect(cells[4]).toHaveTextContent('—')
  })

  it('shows the empty state when no channel has models', async () => {
    mockApi({ pricing: { ...PRICING, data: [] } })
    renderCatalog()

    expect(await screen.findByText('No models available')).toBeInTheDocument()
  })

  it('shows the error state with a retry button when pricing fails to load', async () => {
    mockApi({ pricing: 'fail' })
    renderCatalog()

    expect(await screen.findByText('Failed to load models')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('loads the price list after a retry when pricing failed once', async () => {
    const user = userEvent.setup()
    mockApi({ pricing: 'fail-once' })
    renderCatalog()

    expect(await screen.findByText('Failed to load models')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await sonnetRow('Claude · Official')).toBeInTheDocument()
  })
})
