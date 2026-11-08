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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ContentSafetyLogTable } from '../components/content-safety-log-table'
import type { ContentSafetyLog } from '../types'

const rejected: ContentSafetyLog = {
  id: 1,
  event_id: 'event-rejected',
  created_at: 1788600600,
  request_id: 'req-42',
  user_id: 7,
  username: 'alice',
  token_id: 3,
  token_name: 'prod-key',
  group: 'default',
  model: 'custom-chat-model',
  request_path: '/v1/chat/completions',
  decision: 'review_rejected',
  failure_reason: '',
  hit_words: '["knife"]',
  snippets: '["how to sharpen a kitchen knife"]',
  ai_category: 'violence',
  ai_reason: 'Describes hurting a person',
  review_channel_id: 12,
  review_model: 'judge-model',
  latency_ms: 1350,
  review_tokens: 210,
  cache_hit: false,
}

function mockLogs(items: ContentSafetyLog[]) {
  return vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { items, total: items.length, page: 1, page_size: 20 },
    },
  })
}

function renderTable() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ContentSafetyLogTable />
    </QueryClientProvider>
  )
}

it('shows each record returned by the content safety log API as a row', async () => {
  const get = mockLogs([rejected])
  renderTable()
  const row = await screen.findByRole('row', { name: /alice/ })
  expect(within(row).getByText('Review rejected')).toBeVisible()
  expect(within(row).getByText('knife')).toBeVisible()
  expect(within(row).getByText('custom-chat-model')).toBeVisible()
  expect(get).toHaveBeenCalledWith('/api/content_safety/logs', {
    params: { p: 1, page_size: 20 },
  })
})

it('choosing a decision requests only that decision from the first page', async () => {
  const get = mockLogs([rejected])
  renderTable()
  const user = userEvent.setup()
  await screen.findByRole('row', { name: /alice/ })
  await user.click(screen.getByRole('combobox', { name: 'Decision' }))
  await user.click(await screen.findByRole('option', { name: 'Review failed' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/content_safety/logs', {
      params: { p: 1, page_size: 20, decision: 'review_failed' },
    })
  )
})

it('a user ID that is not a positive integer pauses loading and explains why', async () => {
  const get = mockLogs([rejected])
  renderTable()
  await screen.findByRole('row', { name: /alice/ })
  fireEvent.change(screen.getByRole('textbox', { name: 'User ID' }), {
    target: { value: 'abc' },
  })
  expect(
    await screen.findByText('User ID must be a positive integer')
  ).toBeVisible()
  expect(get).not.toHaveBeenCalledWith('/api/content_safety/logs', {
    params: expect.objectContaining({ user_id: 'abc' }),
  })
})

it('typing a request id sends request_id from the first page', async () => {
  const get = mockLogs([rejected])
  renderTable()
  const user = userEvent.setup()
  await screen.findByRole('row', { name: /alice/ })
  await user.type(screen.getByRole('textbox', { name: 'Request ID' }), 'req-42')
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/content_safety/logs', {
      params: { p: 1, page_size: 20, request_id: 'req-42' },
    })
  )
})

it('a request id longer than 64 characters pauses loading and explains why', async () => {
  const get = mockLogs([rejected])
  renderTable()
  await screen.findByRole('row', { name: /alice/ })
  const tooLong = 'a'.repeat(65)
  fireEvent.change(screen.getByRole('textbox', { name: 'Request ID' }), {
    target: { value: tooLong },
  })
  expect(
    await screen.findByText('Request ID must be at most 64 characters')
  ).toBeVisible()
  expect(get).not.toHaveBeenCalledWith('/api/content_safety/logs', {
    params: expect.objectContaining({ request_id: tooLong }),
  })
})

it('an unknown decision and failure reason are shown as stored without interpolation', async () => {
  mockLogs([
    {
      ...rejected,
      decision: 'future_{{count}}',
      failure_reason: 'odd_{{reason}}',
    },
  ])
  renderTable()
  const row = await screen.findByRole('row', { name: /alice/ })
  expect(within(row).getByText('future_{{count}}')).toBeVisible()
  expect(within(row).getByText('odd_{{reason}}')).toBeVisible()
})

it('keeps rows whose log ids are all zero as separate rows', async () => {
  mockLogs([
    { ...rejected, id: 0, event_id: 'e1', username: 'alice' },
    { ...rejected, id: 0, event_id: 'e2', username: 'bob' },
  ])
  renderTable()
  expect(await screen.findByRole('row', { name: /alice/ })).toBeVisible()
  expect(screen.getByRole('row', { name: /bob/ })).toBeVisible()
})
