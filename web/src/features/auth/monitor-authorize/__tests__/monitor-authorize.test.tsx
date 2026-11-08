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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'

import { MonitorAuthorize } from '../index'
import type { MonitorAuthorizeSearch } from '../lib'

const validSearch: MonitorAuthorizeSearch = {
  redirect_uri: 'https://my.meowapi.dev/auth/callback',
  state: 'state-value_0123456789',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderAuthorize(search: MonitorAuthorizeSearch) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: false, message: 'unavailable' },
  })
  const onAuthorized = vi.fn()
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <MonitorAuthorize search={search} onAuthorized={onAuthorized} />
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  )
  return onAuthorized
}

test('a valid sign-in link requests one code and returns to the monitor callback with code and state', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { code: 'one-time-code' } },
  })

  const onAuthorized = renderAuthorize(validSearch)

  await waitFor(() => expect(onAuthorized).toHaveBeenCalledTimes(1))
  expect(post).toHaveBeenCalledTimes(1)
  expect(post.mock.calls[0][0]).toBe('/api/user/monitor/authorize')
  expect(post.mock.calls[0][1]).toEqual({
    redirect_uri: validSearch.redirect_uri,
    code_challenge: validSearch.code_challenge,
    code_challenge_method: 'S256',
  })
  expect(onAuthorized).toHaveBeenCalledWith(
    'https://my.meowapi.dev/auth/callback#code=one-time-code&state=state-value_0123456789'
  )
})

test('a malformed sign-in link explains the problem without requesting a code', async () => {
  const post = vi.spyOn(api, 'post')

  renderAuthorize({ ...validSearch, code_challenge_method: 'plain' })

  expect(
    await screen.findByText(
      'This sign-in link is invalid. Open the monitor console again to sign in.'
    )
  ).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: 'Retry' })
  ).not.toBeInTheDocument()
})

test('a callback address the server rejects is explained and cannot be retried', async () => {
  vi.spyOn(api, 'post').mockRejectedValue({
    response: { status: 400, data: { code: 'MONITOR_REDIRECT_URI_INVALID' } },
  })

  const onAuthorized = renderAuthorize(validSearch)

  expect(
    await screen.findByText(
      'This monitor console address is not allowed to sign in.'
    )
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Retry' })
  ).not.toBeInTheDocument()
  expect(onAuthorized).not.toHaveBeenCalled()
})

test('a transient failure offers a retry that completes the sign-in', async () => {
  vi.spyOn(api, 'post')
    .mockRejectedValueOnce({ response: { status: 500, data: {} } })
    .mockResolvedValueOnce({
      data: { success: true, data: { code: 'second-code' } },
    })
  const onAuthorized = renderAuthorize(validSearch)

  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))

  await waitFor(() => expect(onAuthorized).toHaveBeenCalledTimes(1))
  expect(onAuthorized.mock.calls[0][0]).toContain('code=second-code')
})
