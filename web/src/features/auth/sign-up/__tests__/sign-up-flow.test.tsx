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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore, type AuthBundle } from '@/stores/auth-store'

import { SignUp } from '..'
import type { SystemStatus } from '../../types'

const START_URL = '/api/user/register/email/start'
const VERIFY_URL = '/api/user/register/email/verify'
const REGISTER_URL = '/api/user/register'
const EXPIRED =
  'Email verification expired or is invalid. Please verify your email again.'

const now = Math.floor(Date.now() / 1000)
const startedFlow = {
  flow_token: 'flow-1',
  email: 'alice@example.com',
  expires_at: now + 600,
  resend_at: now + 60,
}
const bundle: AuthBundle = {
  access_token: 'access-token',
  token_type: 'Bearer',
  access_expires_at: now + 600,
  user: { id: 7, username: 'alice', role: 1 },
  session: {
    sid: 'session-new',
    current: true,
    login_method: 'password',
    ip: '127.0.0.1',
    user_agent: 'test',
    created_at: now,
    last_active_at: now,
    expires_at: now + 3600,
  },
}

/** The server's answer to each endpoint, as {success, message, ...}. */
let responses: Record<string, unknown> = {}
let requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter

function failure(messageKey: string) {
  return { success: false, message: messageKey, message_key: messageKey }
}

function sentBody(url: string): unknown {
  const request = requests.find((config) => config.url === url)
  return request ? JSON.parse(request.data as string) : undefined
}

async function renderSignUp(status: SystemStatus = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, { geetest_check: false, ...status })
  const route = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <SignUp />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/sign-up'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return router
}

function activeStep(): HTMLElement | undefined {
  const steps = screen.getByRole('list', { name: 'Sign-up steps' })
  return within(steps)
    .getAllByRole('listitem')
    .find((item) => item.getAttribute('aria-current') === 'step')
}

async function sendCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByRole('textbox', { name: 'Email' }),
    'alice@example.com'
  )
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  return screen.findByRole('textbox', { name: 'Verification code' })
}

async function verifyCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await sendCode(user), '123456')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  return screen.findByRole('textbox', { name: 'Username' })
}

async function fillAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await verifyCode(user), 'alice')
  await user.type(screen.getByLabelText('Password'), 'Correct-Horse-9')
  await user.type(screen.getByLabelText('Confirm password'), 'Correct-Horse-9')
}

beforeEach(() => {
  requests = []
  responses = {
    [START_URL]: { success: true, message: '', data: startedFlow },
    [VERIFY_URL]: {
      success: true,
      message: '',
      data: { email: 'alice@example.com', expires_at: now + 1800 },
    },
    [REGISTER_URL]: { success: true, message: '', data: bundle },
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
  useAuthStore.getState().auth.reset('idle')
  localStorage.clear()
})

describe('sign-up password feedback', () => {
  it('after email verification, password feedback updates and a mismatch is shown only once', async () => {
    const user = userEvent.setup()
    await renderSignUp()
    await user.type(await verifyCode(user), 'alice')

    const password = screen.getByLabelText('Password')
    const confirmation = screen.getByLabelText('Confirm password')
    expect(
      screen.getByRole('meter', { name: 'Password strength' })
    ).toHaveAttribute('aria-valuenow', '0')
    await user.type(password, 'Correct-Horse-9')
    expect(password).toHaveAccessibleDescription(
      expect.stringContaining('Password requirements met')
    )
    await user.type(confirmation, 'different-password')
    expect(screen.getByText('Passwords do not match')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText("Passwords don't match.")).toBeVisible()
    expect(
      screen.getAllByText(/Passwords (?:do not|don't) match\.?/)
    ).toHaveLength(1)
    expect(sentBody(REGISTER_URL)).toBeUndefined()

    await user.clear(confirmation)
    await user.type(confirmation, 'Correct-Horse-9')
    expect(confirmation).toHaveAccessibleDescription(
      expect.stringContaining('Passwords match')
    )
  })
})

describe('sign-up step 1: verify email', () => {
  it('sending the code shows a labelled code entry and neutral copy', async () => {
    const user = userEvent.setup()
    await renderSignUp()
    expect(activeStep()).toHaveTextContent('Verify email')

    const code = await sendCode(user)

    expect(sentBody(START_URL)).toEqual({ email: 'alice@example.com' })
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    expect(code).toHaveAttribute('inputmode', 'numeric')
    expect(screen.getByRole('status')).toHaveTextContent(
      'If this address can be used, we sent a 6-digit code to alice@example.com.'
    )
    expect(activeStep()).toHaveTextContent('Verify email')
  })

  it('a wrong code shows an error on the code field and keeps the step', async () => {
    responses[VERIFY_URL] = failure('Email verification code is incorrect.')
    const user = userEvent.setup()
    await renderSignUp()

    await user.type(await sendCode(user), '000000')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const code = screen.getByRole('textbox', { name: 'Verification code' })
    await waitFor(() => expect(code).toHaveAttribute('aria-invalid', 'true'))
    expect(code).toHaveAccessibleDescription(
      'Email verification code is incorrect.'
    )
    expect(activeStep()).toHaveTextContent('Verify email')
  })

  it('too many wrong codes return to the email field with the reason', async () => {
    const tooMany = 'Too many incorrect codes. Start email verification again.'
    responses[VERIFY_URL] = failure(tooMany)
    const user = userEvent.setup()
    await renderSignUp()

    await user.type(await sendCode(user), '000000')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(tooMany)
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue(
      'alice@example.com'
    )
  })

  it.each([
    ['ahead of', now - 3600],
    ['behind', now + 3600],
  ])(
    'the resend countdown lasts one minute when the device clock is %s the server',
    async (_, resendAt) => {
      responses[START_URL] = {
        success: true,
        message: '',
        data: { ...startedFlow, resend_at: resendAt },
      }
      const user = userEvent.setup()
      await renderSignUp()

      await sendCode(user)

      expect(
        screen.getByRole('button', { name: 'Resend (60s)' })
      ).toBeDisabled()
    }
  )

  it('"Use a different email" goes back to the email field with the address kept', async () => {
    const user = userEvent.setup()
    await renderSignUp()
    expect(
      await screen.findByRole('textbox', { name: 'Email' })
    ).not.toHaveFocus()
    await sendCode(user)

    await user.click(
      screen.getByRole('button', { name: 'Use a different email' })
    )

    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue(
      'alice@example.com'
    )
    expect(
      screen.queryByRole('textbox', { name: 'Verification code' })
    ).toBeNull()
  })
})

describe('sign-up step 2: set up account', () => {
  it('a verified code moves to account setup with the verified email', async () => {
    const user = userEvent.setup()
    await renderSignUp()

    await verifyCode(user)

    expect(sentBody(VERIFY_URL)).toEqual({
      flow_token: 'flow-1',
      code: '123456',
    })
    expect(activeStep()).toHaveTextContent('Set up account')
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveAttribute(
      'autocomplete',
      'username'
    )
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveFocus()
  })

  it('creating the account sends the registration token and signs the user in', async () => {
    localStorage.setItem('aff', 'INVITE')
    const user = userEvent.setup()
    const router = await renderSignUp()
    await fillAccount(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/dashboard')
    )
    expect(sentBody(REGISTER_URL)).toEqual({
      username: 'alice',
      password: 'Correct-Horse-9',
      registration_token: 'flow-1',
      aff_code: 'INVITE',
    })
    expect(useAuthStore.getState().auth.session?.sid).toBe('session-new')
  })

  it('a username with @ is rejected on the field before any request', async () => {
    const user = userEvent.setup()
    await renderSignUp()
    await user.type(await verifyCode(user), 'alice@home')
    await user.type(screen.getByLabelText('Password'), 'Correct-Horse-9')
    await user.type(
      screen.getByLabelText('Confirm password'),
      'Correct-Horse-9'
    )

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    const username = screen.getByRole('textbox', { name: 'Username' })
    await waitFor(() =>
      expect(username).toHaveAttribute('aria-invalid', 'true')
    )
    expect(username).toHaveAccessibleDescription(
      expect.stringContaining('Username cannot contain @')
    )
    expect(sentBody(REGISTER_URL)).toBeUndefined()
  })

  it('a taken username is shown on the username field', async () => {
    const taken = 'Username already exists or has been deleted'
    responses[REGISTER_URL] = failure(taken)
    const user = userEvent.setup()
    await renderSignUp()
    await fillAccount(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    const username = screen.getByRole('textbox', { name: 'Username' })
    await waitFor(() =>
      expect(username).toHaveAttribute('aria-invalid', 'true')
    )
    expect(username).toHaveAccessibleDescription(expect.stringContaining(taken))
    expect(activeStep()).toHaveTextContent('Set up account')
  })

  it('an expired registration token returns to step 1 with the reason', async () => {
    responses[REGISTER_URL] = failure(EXPIRED)
    const user = userEvent.setup()
    await renderSignUp()
    await fillAccount(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(EXPIRED)
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue(
      'alice@example.com'
    )
    expect(activeStep()).toHaveTextContent('Verify email')
  })
})

describe('sign-up availability', () => {
  it.each([
    ['registration is disabled', { register_enabled: false }],
    ['the site is in self-use mode', { self_use_mode_enabled: true }],
  ])('when %s, shows a notice and no form', async (_case, status) => {
    await renderSignUp({ ...status, github_oauth: true })

    expect(await screen.findByRole('note')).toHaveTextContent(
      'New user registration has been disabled by administrator'
    )
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
    expect(screen.queryByRole('button', { name: /GitHub/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it.each([
    ['email delivery is not configured', { email_delivery_configured: false }],
    ['password sign-up is disabled', { password_register_enabled: false }],
  ])(
    'when %s, explains password sign-up is unavailable and keeps OAuth',
    async (_case, status) => {
      await renderSignUp({ ...status, github_oauth: true })

      expect(await screen.findByRole('note')).toHaveTextContent(
        'Sign-up with email and password is currently unavailable.'
      )
      expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
      expect(
        screen.getByRole('button', { name: 'Continue with GitHub' })
      ).toBeInTheDocument()
    }
  )
})
