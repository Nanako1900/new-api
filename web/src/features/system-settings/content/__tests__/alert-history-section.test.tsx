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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { AlertHistorySection } from '../alert-history-section'

const HISTORY = [
  {
    id: 2,
    title: 'Top-up bonus',
    content: '5% off top-ups over 100',
    level: 'success',
    publishedAt: '2026-11-20T00:00:00Z',
  },
  {
    id: 1,
    content: 'Wrong price posted by mistake',
    level: 'info',
    publishedAt: '2026-11-18T00:00:00Z',
  },
]

function renderSection(alerts: unknown[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AlertHistorySection
        history={JSON.stringify(HISTORY)}
        alerts={JSON.stringify(alerts)}
      />
    </QueryClientProvider>
  )
}

function rowOf(text: string) {
  return screen.getByText(text).closest('tr') as HTMLElement
}

test('an alert still in the alert list cannot be removed from history', () => {
  renderSection([
    { id: 2, content: '5% off top-ups over 100', level: 'success' },
  ])

  expect(
    within(rowOf('Top-up bonus')).getByRole('button', {
      name: 'Remove from history',
    })
  ).toBeDisabled()
  expect(
    within(rowOf('Wrong price posted by mistake')).getByRole('button', {
      name: 'Remove from history',
    })
  ).toBeEnabled()
})

test('removing a deleted alert asks first, then deletes it on the server', async () => {
  const user = userEvent.setup()
  const remove = vi
    .spyOn(api, 'delete')
    .mockResolvedValue({ data: { success: true, message: '' } })
  renderSection([])

  await user.click(
    within(rowOf('Wrong price posted by mistake')).getByRole('button', {
      name: 'Remove from history',
    })
  )
  expect(remove).not.toHaveBeenCalled()
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Remove from history',
    })
  )

  await waitFor(() =>
    expect(remove).toHaveBeenCalledWith('/api/option/alert_history/1')
  )
})

test('an empty history says so', () => {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <AlertHistorySection history='[]' alerts='[]' />
    </QueryClientProvider>
  )

  expect(screen.getByText('No alert history yet')).toBeInTheDocument()
})
