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
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import type { ClaudeApiStatus } from '@/features/performance-metrics/api'
import { api } from '@/lib/api'

import { MeowStatus } from '../components/meow/meow-status'

type PerfModel = {
  model_name: string
  success_rate: number
  avg_ttft_ms?: number
}

const HEALTHY: PerfModel[] = [
  { model_name: 'claude-opus-5-5', success_rate: 99, avg_ttft_ms: 420 },
  { model_name: 'gpt-6.1-sol', success_rate: 98, avg_ttft_ms: 1250 },
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
function mockApi(
  perf: PerfModel[] | 'fail' | 'pending',
  status: () => ClaudeApiStatus | Promise<ClaudeApiStatus> = () => ({
    status: 'partial_outage',
    incidents: [
      { id: 'incident-a', name: 'Elevated API errors', status: 'monitoring' },
    ],
    checked_at: 1_800_000_000,
    stale: false,
  })
) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/perf-metrics/summary') {
      if (perf === 'fail') throw new Error('network down')
      if (perf === 'pending') return new Promise(() => undefined)
      const models = perf.map((model) => ({ ...model, avg_latency_ms: 3000 }))
      return { data: { success: true, data: { models } } }
    }
    if (url === '/api/status/claude') {
      return { data: { success: true, data: await status() } }
    }
    if (url === '/api/pricing') {
      return { data: { success: true, data: [], vendors: [] } }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
}

function renderStatus(
  checkinEnabled = true,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  client.setQueryData(['status'], { checkin_enabled: checkinEnabled })
  return render(
    <QueryClientProvider client={client}>
      <MeowStatus />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('healthy providers show live success rates and time to first token', async () => {
  mockApi(HEALTHY)
  renderStatus()

  const bar = await screen.findByRole('region', { name: 'Live status' })
  expect(await screen.findAllByText('Success rate')).toHaveLength(2)
  expect(bar).toHaveTextContent('Time to first token 420ms')
  expect(bar).toHaveTextContent('Time to first token 1.25s')
  expect(bar).not.toHaveTextContent('No charge for failed requests')
})

test('healthy providers without first-token measurements show dashes', async () => {
  mockApi([
    { model_name: 'claude-opus-5-5', success_rate: 99 },
    { model_name: 'gpt-6.1-sol', success_rate: 98, avg_ttft_ms: 0 },
  ])
  renderStatus()

  const bar = await screen.findByRole('region', { name: 'Live status' })
  expect(await screen.findAllByText('Success rate')).toHaveLength(2)
  expect(screen.getAllByText('—')).toHaveLength(2)
  expect(bar).toHaveTextContent('Time to first token —')
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

test('shows official API incidents even when local provider metrics are hidden', async () => {
  mockApi(GPT_DIPPED)
  renderStatus()

  const bar = await screen.findByRole('region', { name: 'Peace of mind' })
  expect(await within(bar).findByText('Partial outage')).toBeInTheDocument()
  expect(within(bar).getByText('Elevated API errors')).toBeInTheDocument()
  expect(
    within(bar).getByRole('link', { name: 'Claude API official status' })
  ).toHaveAttribute('href', 'https://status.claude.com')
})

test.each([false, true])(
  'refreshes a nearly expired official report on its original deadline after remount (stale=%s)',
  async (stale) => {
    vi.useFakeTimers()
    const client = new QueryClient()
    const loadStatus = vi.fn(() => ({
      status: 'operational',
      incidents: [],
      checked_at: 1_800_000_000,
      stale,
      refresh_after_seconds: 2,
    }))
    mockApi(HEALTHY, loadStatus)
    const view = renderStatus(true, client)
    await act(() => vi.advanceTimersByTimeAsync(500))
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    renderStatus(true, client)
    await act(() => vi.advanceTimersByTimeAsync(499))
    expect(loadStatus).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(loadStatus).toHaveBeenCalledTimes(2)
  }
)

test('refreshes the official report at five minutes and retries a failed refresh after one minute', async () => {
  vi.useFakeTimers()
  const checkedAt = 1_800_000_000
  const client = new QueryClient()
  let offline = false
  let component = 'operational'
  const loadStatus = vi.fn(async () => {
    if (offline) {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      throw new Error('Network error')
    }
    return {
      status: component,
      incidents: [],
      checked_at: checkedAt,
      stale: false,
    }
  })
  mockApi(HEALTHY, loadStatus)
  const view = renderStatus(true, client)
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(screen.getByText('Operational')).toBeInTheDocument()
  offline = true
  await act(() => vi.advanceTimersByTimeAsync(299_998))
  expect(loadStatus).toHaveBeenCalledTimes(1)
  await act(() => vi.advanceTimersByTimeAsync(2))
  expect(loadStatus).toHaveBeenCalledTimes(2)
  await act(() => vi.advanceTimersByTimeAsync(5000))
  expect(screen.getByText('Showing last known status')).toBeInTheDocument()
  expect(screen.getByText('Operational')).toBeInTheDocument()
  expect(screen.getByRole('time')).toHaveAttribute(
    'datetime',
    new Date(checkedAt * 1000).toISOString()
  )
  offline = false
  component = 'degraded_performance'
  view.unmount()
  await act(() => vi.advanceTimersByTimeAsync(30_000))
  renderStatus(true, client)
  await act(() => vi.advanceTimersByTimeAsync(29_998))
  expect(loadStatus).toHaveBeenCalledTimes(2)
  await act(() => vi.advanceTimersByTimeAsync(2))
  expect(screen.getByText('Degraded performance')).toBeInTheDocument()
  expect(
    screen.queryByText('Showing last known status')
  ).not.toBeInTheDocument()
})

test('shows unavailable when the first official check fails and keeps live gateway metrics', async () => {
  mockApi(HEALTHY, () => {
    throw new Error('Status unavailable')
  })
  renderStatus()
  expect(await screen.findByText('Unavailable')).toBeInTheDocument()
  expect(await screen.findAllByText('Success rate')).toHaveLength(2)
  expect(screen.queryByRole('time')).not.toBeInTheDocument()
})
