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
  Outlet,
  RouterProvider,
  useSearch,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { ResetPasswordConfirm } from '..'
import { PASSWORD_RESET_TOKEN_STORAGE_KEY } from '../lib/reset-link'

const VERIFY_URL = '/api/user/password-reset/verify'
const COMPLETE_URL = '/api/user/password-reset/complete'
const INVALID_LINK =
  'This password reset link is invalid or has expired. Request a new one.'

/** The server's answer to each endpoint, as {success, message, ...}. */
let responses: Record<string, unknown> = {}
let requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter

function failure(messageKey: string, code?: string) {
  return { success: false, message: messageKey, message_key: messageKey, code }
}

function sentBodies(url: string): unknown[] {
  return requests
    .filter((config) => config.url === url)
    .map((config) => JSON.parse(config.data as string))
}

async function openResetLink(href = '/user/reset?token=link-token-1') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {})
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <Outlet />
      </QueryClientProvider>
    ),
  })
  const resetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/user/reset',
    validateSearch: (search: Record<string, unknown>) => ({
      token: typeof search.token === 'string' ? search.token : undefined,
    }),
    component: function ResetRoute() {
      const search = useSearch({ strict: false })
      return <ResetPasswordConfirm token={search.token} />
    },
  })
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    component: () => <h1>Sign-in page</h1>,
  })
  const forgotRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    component: () => <h1>Forgot-password page</h1>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([resetRoute, signInRoute, forgotRoute]),
    history: createMemoryHistory({ initialEntries: [href] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return router
}

async function enterNewPassword(password: string, confirmation = password) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('New password'), password)
  await user.type(screen.getByLabelText('Confirm password'), confirmation)
  await user.click(screen.getByRole('button', { name: 'Update password' }))
  return user
}

beforeEach(() => {
  requests = []
  responses = {
    [VERIFY_URL]: {
      success: true,
      message: '',
      data: { email: 'a***@example.com', expires_at: 1_900_000_000 },
    },
    [COMPLETE_URL]: { success: true, message: '' },
  }
  api.defaults.adapter = async (config) => {
    requests.push(config)
    return {
      data: responses[config.url ?? ''] ?? failure('Unexpected request'),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  sessionStorage.clear()
})

describe('password reset link page', () => {
  it('opening a link removes the token from the address bar and shows the masked email', async () => {
    const router = await openResetLink()

    expect(await screen.findByText('a***@example.com')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.href).toBe('/user/reset'))
    expect(router.history.location.search).toBe('')
    expect(sentBodies(VERIFY_URL)).toContainEqual({ token: 'link-token-1' })
  })

  it('uses the token the index.html bootstrap moved into session storage, then forgets it', async () => {
    sessionStorage.setItem(PASSWORD_RESET_TOKEN_STORAGE_KEY, 'stored-token')

    await openResetLink('/user/reset')

    expect(await screen.findByText('a***@example.com')).toBeInTheDocument()
    expect(sentBodies(VERIFY_URL)).toContainEqual({ token: 'stored-token' })
    expect(sessionStorage.getItem(PASSWORD_RESET_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('while the page is open, the document sends no referrer', async () => {
    await openResetLink()
    await screen.findByText('a***@example.com')

    expect(
      document.head.querySelector('meta[name="referrer"]')
    ).toHaveAttribute('content', 'no-referrer')
  })

  it('a confirmation that does not match shows an error on that field and sends nothing', async () => {
    await openResetLink()

    await enterNewPassword('Correct-Horse-9', 'Correct-Horse-8')

    const confirmation = screen.getByLabelText('Confirm password')
    await waitFor(() =>
      expect(confirmation).toHaveAttribute('aria-invalid', 'true')
    )
    expect(confirmation).toHaveAccessibleDescription("Passwords don't match.")
    expect(sentBodies(COMPLETE_URL)).toEqual([])
  })

  it('a too short password shows the length rule on the password field and sends nothing', async () => {
    await openResetLink()

    await enterNewPassword('short')

    const password = screen.getByLabelText('New password')
    await waitFor(() =>
      expect(password).toHaveAttribute('aria-invalid', 'true')
    )
    expect(
      screen.getByText('Password must contain between 8 and 128 characters.')
    ).toBeInTheDocument()
    expect(sentBodies(COMPLETE_URL)).toEqual([])
  })

  it('a matching new password posts the token and password, then offers sign-in without signing in', async () => {
    const router = await openResetLink()

    const user = await enterNewPassword('Correct-Horse-9')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password updated. Sign in with your new password.'
    )
    expect(sentBodies(COMPLETE_URL)).toEqual([
      { token: 'link-token-1', password: 'Correct-Horse-9' },
    ])
    expect(screen.queryByLabelText('New password')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('a password the server policy rejects shows its message on the password field', async () => {
    const tooLong =
      'Long passwords are unavailable until the password storage upgrade is complete.'
    responses[COMPLETE_URL] = failure(tooLong, 'PASSWORD_POLICY_REJECTED')
    await openResetLink()

    await enterNewPassword('Correct-Horse-9')

    const password = screen.getByLabelText('New password')
    await waitFor(() =>
      expect(password).toHaveAttribute('aria-invalid', 'true')
    )
    expect(password).toHaveAccessibleDescription(
      expect.stringContaining(tooLong)
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('an invalid or expired link shows the reason and a link to request a new one', async () => {
    responses[VERIFY_URL] = failure(INVALID_LINK)
    const router = await openResetLink()

    expect(await screen.findByText(INVALID_LINK)).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).toBeNull()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Request a new link' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/forgot-password')
    )
  })

  it('a link spent before submitting switches to the invalid link state', async () => {
    responses[COMPLETE_URL] = failure(INVALID_LINK)
    await openResetLink()

    await enterNewPassword('Correct-Horse-9')

    expect(await screen.findByText(INVALID_LINK)).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('a link without a token shows the invalid link state without asking the server', async () => {
    await openResetLink('/user/reset')

    expect(await screen.findByText(INVALID_LINK)).toBeInTheDocument()
    expect(requests).toEqual([])
  })

  it('when the link check cannot reach the server, retrying checks it again', async () => {
    let attempts = 0
    api.defaults.adapter = async (config) => {
      requests.push(config)
      attempts += 1
      if (attempts === 1) {
        throw new AxiosError('Network Error', 'ERR_NETWORK', config)
      }
      return {
        data: responses[VERIFY_URL],
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    await openResetLink()

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('a***@example.com')).toBeInTheDocument()
    expect(sentBodies(VERIFY_URL)).toEqual([
      { token: 'link-token-1' },
      { token: 'link-token-1' },
    ])
  })
})
