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
import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { MeowStatus } from '../components/meow/meow-status'

type PerfModel = { model_name: string; success_rate: number }

const HEALTHY: PerfModel[] = [
  { model_name: 'claude-opus-5-5', success_rate: 99 },
  { model_name: 'gpt-6.1-sol', success_rate: 98 },
]

// A rarely used GPT model failing every request sits below the busy ones.
const QUIET_MODEL_FAILING: PerfModel[] = [
  { model_name: 'claude-opus-5-5', success_rate: 99.93 },
  { model_name: 'gpt-6.1-sol', success_rate: 96.36 },
  { model_name: 'gpt-6-sol', success_rate: 100 },
  { model_name: 'gpt-5.6-luna', success_rate: 0 },
]

const GPT_DIPPED: PerfModel[] = [
  { model_name: 'claude-opus-5-5', success_rate: 99 },
  { model_name: 'gpt-6.1-sol', success_rate: 74.96 },
]

/** Serves the home page requests; `perf` decides the health summary. */
function mockApi(perf: PerfModel[] | 'fail' | 'pending') {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/perf-metrics/summary') {
      if (perf === 'fail') throw new Error('network down')
      if (perf === 'pending') return new Promise(() => undefined)
      const models = perf.map((model) => ({ ...model, avg_latency_ms: 3000 }))
      return { data: { success: true, data: { models } } }
    }
    if (url === '/api/pricing') {
      return { data: { success: true, data: [], vendors: [] } }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

function renderStatus(checkinEnabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], { checkin_enabled: checkinEnabled })
  return render(
    <QueryClientProvider client={client}>
      <MeowStatus />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('healthy providers show the live success rates', async () => {
  mockApi(HEALTHY)
  renderStatus()

  const bar = await screen.findByRole('region', { name: 'Live status' })
  expect(await screen.findAllByText('Success rate')).toHaveLength(2)
  expect(bar).not.toHaveTextContent('No charge for failed requests')
})

test('a failing quiet model does not hide healthy live numbers', async () => {
  mockApi(QUIET_MODEL_FAILING)
  renderStatus()

  const bar = await screen.findByRole('region', { name: 'Live status' })
  expect(await screen.findAllByText('Success rate')).toHaveLength(2)
  expect(bar).toHaveTextContent('96.36%')
  expect(bar).not.toHaveTextContent('No charge for failed requests')
})

test('a provider below 95% swaps the live numbers for the promises', async () => {
  mockApi(GPT_DIPPED)
  renderStatus()

  const bar = await screen.findByRole('region', { name: 'Peace of mind' })
  expect(bar).toHaveTextContent('No charge for failed requests')
  expect(bar).toHaveTextContent('Invite friends, earn rewards')
  expect(bar).not.toHaveTextContent('Success rate')
})

test('a failed health request shows the promises', async () => {
  mockApi('fail')
  renderStatus()

  const bar = await screen.findByRole('region', { name: 'Peace of mind' })
  expect(bar).toHaveTextContent('No charge for failed requests')
})

test('while health loads the bar shows neither numbers nor promises', () => {
  mockApi('pending')
  renderStatus()

  const bar = screen.getByRole('region', { name: 'Live status' })
  expect(bar).not.toHaveTextContent('Success rate')
  expect(bar).not.toHaveTextContent('No charge for failed requests')
})

test('the check-in promise shows when check-in is enabled', async () => {
  mockApi(GPT_DIPPED)
  renderStatus(true)

  const bar = await screen.findByRole('region', { name: 'Peace of mind' })
  expect(bar).toHaveTextContent('Daily check-in credits')
})

test('the check-in promise is left out when check-in is disabled', async () => {
  mockApi(GPT_DIPPED)
  renderStatus(false)

  const bar = await screen.findByRole('region', { name: 'Peace of mind' })
  expect(bar).not.toHaveTextContent('Daily check-in credits')
})
