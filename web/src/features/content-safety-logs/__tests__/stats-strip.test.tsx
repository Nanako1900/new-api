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
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { ContentSafetyStatsStrip } from '../components/content-safety-stats-strip'

const stats = {
  counts: [
    { decision: 'keyword_blocked', mode: '', failure_reason: '', total: 50 },
    { decision: 'review_passed', mode: 'sync', failure_reason: '', total: 1200 },
    { decision: 'review_flagged', mode: 'async', failure_reason: '', total: 7 },
    { decision: 'review_rejected', mode: 'sync', failure_reason: '', total: 3 },
    {
      decision: 'review_controversial',
      mode: 'sync',
      failure_reason: 'refused',
      total: 4,
    },
    { decision: 'review_failed', mode: 'sync', failure_reason: 'timeout', total: 2 },
  ],
  latency_p50_ms: 850,
  latency_p95_ms: 2400,
  latency_samples: 300,
}

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

function renderStrip() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => (
          <QueryClientProvider client={client}>
            <ContentSafetyStatsStrip />
          </QueryClientProvider>
        ),
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/403',
        component: () => <p>Forbidden page</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

function figure(label: string) {
  const term = screen.getByText(label)
  return term.nextElementSibling
}

it('shows the review figures of the last 24 hours from the stats API', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: stats } })
  renderStrip()
  await waitFor(() => expect(figure('Reviews')).toHaveTextContent('1,216'))
  expect(get).toHaveBeenCalledWith('/api/content_safety/stats', {
    params: { hours: 24 },
  })
  expect(figure('Flagged or rejected')).toHaveTextContent('10')
  expect(figure('Controversial')).toHaveTextContent('4')
  expect(figure('Failed')).toHaveTextContent('2')
  expect(figure('Refused')).toHaveTextContent('4')
  expect(figure('Latency p50')).toHaveTextContent('850 ms')
  expect(figure('Latency p95')).toHaveTextContent('2,400 ms')
})

it('choosing 7 days requests 168 hours', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: stats } })
  renderStrip()
  await screen.findByText('Reviews')
  await userEvent.click(screen.getByRole('button', { name: '7 days' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/content_safety/stats', {
      params: { hours: 168 },
    })
  )
})

it('a failed response shows an error and Retry loads the figures', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Invalid content safety stats query' },
    })
    .mockResolvedValue({ data: { success: true, data: stats } })
  renderStrip()
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Failed to load content safety statistics')
  await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(figure('Reviews')).toHaveTextContent('1,216'))
  expect(get).toHaveBeenCalledTimes(2)
})

it('leaves for /403 and records the lost permission when the API answers 403', async () => {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'admin',
    role: ROLE.ADMIN,
    permissions: { admin_permissions: { audit: { read: true } } },
  })
  vi.spyOn(api, 'get').mockRejectedValue(
    Object.assign(new Error('forbidden'), { response: { status: 403 } })
  )
  const router = renderStrip()
  expect(await screen.findByText('Forbidden page')).toBeVisible()
  expect(router.state.location.pathname).toBe('/403')
  expect(
    useAuthStore.getState().auth.user?.permissions?.admin_permissions?.audit
      ?.read
  ).toBe(false)
})
