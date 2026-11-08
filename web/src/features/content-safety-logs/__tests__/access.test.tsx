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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { ROLE } from '@/lib/roles'
import { Route as ContentSafetyRoute } from '@/routes/_authenticated/usage-logs/content-safety'
import { type UserPermissions, useAuthStore } from '@/stores/auth-store'

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

async function openAsAdmin(permissions: UserPermissions | undefined) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'admin',
    role: ROLE.ADMIN,
    permissions,
  })
  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/usage-logs/content-safety',
        beforeLoad: ContentSafetyRoute.options.beforeLoad as () => void,
      }),
      createRoute({ getParentRoute: () => root, path: '/403' }),
    ]),
    history: createMemoryHistory({
      initialEntries: ['/usage-logs/content-safety'],
    }),
  })
  render(<RouterProvider router={router} />)
  await act(() => router.load())
  return router
}

it.each([
  {
    label: 'without the audit read permission',
    permissions: undefined,
    pathname: '/403',
  },
  {
    label: 'with the audit read permission',
    permissions: { admin_permissions: { audit: { read: true } } },
    pathname: '/usage-logs/content-safety',
  },
])('an admin $label ends up on $pathname', async (testCase) => {
  const router = await openAsAdmin(testCase.permissions)
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(testCase.pathname)
  )
})
