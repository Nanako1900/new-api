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
import type { Row } from '@tanstack/react-table'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { Route as ContentRiskRoute } from '@/routes/_authenticated/usage-logs/content-risk'
import { type UserPermissions, useAuthStore } from '@/stores/auth-store'

import type { User } from '../../types'
import { DataTableRowActions } from '../data-table-row-actions'
import { UsersProvider } from '../users-provider'

const target: User = {
  id: 42,
  username: 'flagged-user',
  display_name: 'Flagged user',
  role: 1,
  status: 1,
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
}

const auditRead: UserPermissions = {
  admin_permissions: { audit: { read: true } },
}

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

async function openMenu(
  user: User,
  viewerPermissions: UserPermissions | undefined
) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'operator',
    role: ROLE.ADMIN,
    permissions: viewerPermissions,
  })
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const router = createRouter({
    routeTree: root.addChildren([
      authenticated.addChildren([
        createRoute({
          getParentRoute: () => authenticated,
          path: '/users',
          component: () => (
            <DataTableRowActions row={{ original: user } as Row<User>} />
          ),
        }),
        createRoute({
          getParentRoute: () => authenticated,
          path: '/usage-logs/content-risk',
          validateSearch: ContentRiskRoute.options.validateSearch,
          component: () => <p>Risk page</p>,
        }),
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: ['/users'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <UsersProvider>
        <RouterProvider router={router} />
      </UsersProvider>
    </QueryClientProvider>
  )
  await act(() => router.load())
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open menu' })
  )
  await screen.findAllByRole('menuitem')
  return router
}

it('Risk profile opens the risk page filtered to that user', async () => {
  const router = await openMenu(target, auditRead)
  await userEvent.click(screen.getByRole('menuitem', { name: 'Risk profile' }))
  expect(await screen.findByText('Risk page')).toBeVisible()
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/usage-logs/content-risk')
  )
  expect(router.state.location.search).toEqual({ user_id: 42 })
})

it.each([
  {
    label: 'a viewer without the audit read permission',
    user: target,
    permissions: undefined,
  },
  {
    label: 'a root account, which is never scored',
    user: { ...target, role: ROLE.SUPER_ADMIN },
    permissions: auditRead,
  },
])('the menu offers no Risk profile for $label', async (testCase) => {
  await openMenu(testCase.user, testCase.permissions)
  expect(
    screen.queryByRole('menuitem', { name: 'Risk profile' })
  ).not.toBeInTheDocument()
})
