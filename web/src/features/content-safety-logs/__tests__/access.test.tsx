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
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { ROLE } from '@/lib/roles'
import { Route as ContentSafetyRoute } from '@/routes/_authenticated/usage-logs/content-safety'
import { type UserPermissions, useAuthStore } from '@/stores/auth-store'

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

async function openAs(role: number, permissions: UserPermissions | undefined) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'tester',
    role,
    permissions,
  })
  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/usage-logs/content-safety',
        beforeLoad: ContentSafetyRoute.options.beforeLoad as () => void,
        component: () => <p>Content safety page</p>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/403',
        component: () => <p>Forbidden page</p>,
      }),
    ]),
    history: createMemoryHistory({
      initialEntries: ['/usage-logs/content-safety'],
    }),
  })
  render(<RouterProvider router={router} />)
  await act(() => router.load())
  return router
}

const auditRead = { admin_permissions: { audit: { read: true } } }

it.each([
  {
    label: 'an admin without the audit read permission',
    role: ROLE.ADMIN,
    permissions: undefined,
    pathname: '/403',
    text: 'Forbidden page',
  },
  {
    label: 'an admin with the audit read permission',
    role: ROLE.ADMIN,
    permissions: auditRead,
    pathname: '/usage-logs/content-safety',
    text: 'Content safety page',
  },
  {
    label: 'a regular user holding the audit read permission',
    role: ROLE.USER,
    permissions: auditRead,
    pathname: '/403',
    text: 'Forbidden page',
  },
  {
    label: 'a root user without explicit permissions',
    role: ROLE.SUPER_ADMIN,
    permissions: undefined,
    pathname: '/usage-logs/content-safety',
    text: 'Content safety page',
  },
])('$label ends up on $pathname', async (testCase) => {
  const router = await openAs(testCase.role, testCase.permissions)
  expect(await screen.findByText(testCase.text)).toBeVisible()
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(testCase.pathname)
  )
})
