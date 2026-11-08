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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InternalAxiosRequestConfig } from 'axios'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { ForgotPasswordForm } from '../forgot-password/components/forgot-password-form'
import { UserAuthForm } from '../sign-in/components/user-auth-form'
import { SignUpForm } from '../sign-up/components/sign-up-form'

type Reply = { success: boolean; message: string; code?: string }

const LOGIN_URL = '/api/user/login'
const REGISTER_START_URL = '/api/user/register/email/start'
const RESET_START_URL = '/api/user/password-reset/start'
const GUARDED_URLS = new Set([LOGIN_URL, REGISTER_START_URL, RESET_START_URL])
const CAPTCHA_REQUIRED: Reply = {
  success: false,
  message: 'Please complete the human verification first',
  code: 'CAPTCHA_REQUIRED',
}

const originalAdapter = api.defaults.adapter
const startedRegistrationFlow = {
  flow_token: 'flow-1',
  email: 'alice@example.com',
  expires_at: Math.floor(Date.now() / 1000) + 600,
  // Already past, so resending is allowed right away.
  resend_at: Math.floor(Date.now() / 1000) - 1,
}
let guardedRequests: InternalAxiosRequestConfig[] = []
/** Replies the test server gives before its defaults, in order. */
let queuedReplies: Reply[] = []
let challengesShown = 0
let challengeAnswers: Array<'pass' | 'close'> = []

/** Stands in for gt4.js in bind mode; every pass yields a new lot number. */
function installFakeGeetest() {
  window.initGeetest4 = ((
    _config: unknown,
    callback: (captcha: unknown) => void
  ) => {
    let onReady = () => {}
    let onSuccess = () => {}
    let onClose = () => {}
    let lotNumber = ''
    const instance = {
      getValidate: () => ({
        lot_number: lotNumber,
        captcha_output: 'output',
        pass_token: 'pass',
        gen_time: '1700000000',
      }),
      // The user answers the challenge right after it opens.
      showCaptcha: () => {
        challengesShown += 1
        const answer = challengeAnswers.shift() ?? 'pass'
        setTimeout(() => {
          if (answer === 'close') {
            onClose()
            return
          }
          lotNumber = `lot-${challengesShown}`
          onSuccess()
        })
      },
      onReady: (next: () => void) => {
        onReady = next
        return instance
      },
      onSuccess: (next: () => void) => {
        onSuccess = next
        return instance
      },
      onClose: (next: () => void) => {
        onClose = next
        return instance
      },
      onError: () => instance,
      destroy: () => {},
    }
    callback(instance)
    onReady()
  }) as unknown as Window['initGeetest4']
}

/** Lot number of each guarded request, or null for one sent without a result. */
function sentLotNumbers(): Array<string | null> {
  return guardedRequests.map((config) => {
    const token = config.headers.get('X-Captcha-Token')
    return typeof token === 'string' ? JSON.parse(token).lot_number : null
  })
}

function defaultReply(url: string | undefined) {
  // Sign-up's email check succeeds, so its resend can be exercised.
  if (url === REGISTER_START_URL) {
    return { success: true, message: '', data: startedRegistrationFlow }
  }
  if (url === RESET_START_URL) return { success: true, message: '' }
  return { success: false, message: 'Rejected by the test server' }
}

async function renderForm(Form: ComponentType, mode: 'always' | 'risk') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    geetest_check: true,
    geetest_captcha_id: 'captcha-id',
    geetest_check_mode: mode,
  })
  const route = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <Form />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Username or Email'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'secret-password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  guardedRequests = []
  queuedReplies = []
  challengesShown = 0
  challengeAnswers = []
  installFakeGeetest()
  api.defaults.adapter = async (config) => {
    let data: unknown = defaultReply(config.url)
    if (GUARDED_URLS.has(config.url ?? '')) {
      guardedRequests.push(config)
      data = queuedReplies.shift() ?? data
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  api.defaults.adapter = originalAdapter
  delete window.initGeetest4
})

describe('auth forms in risk mode', () => {
  it('sign-in: sends without a result and challenges only when the server asks', async () => {
    queuedReplies = [CAPTCHA_REQUIRED]
    const user = userEvent.setup()
    await renderForm(UserAuthForm, 'risk')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()

    await signIn(user)

    await waitFor(() => expect(sentLotNumbers()).toEqual([null, 'lot-1']))
    expect(challengesShown).toBe(1)
  })

  it('sign-in: a failure that is not a captcha request shows no challenge', async () => {
    const user = userEvent.setup()
    await renderForm(UserAuthForm, 'risk')

    await signIn(user)

    await waitFor(() => expect(sentLotNumbers()).toEqual([null]))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    )
    expect(challengesShown).toBe(0)
  })

  it('sign-up: the email step resends with the result after CAPTCHA_REQUIRED and moves on', async () => {
    queuedReplies = [CAPTCHA_REQUIRED]
    const user = userEvent.setup()
    await renderForm(SignUpForm, 'risk')
    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'alice@example.com'
    )

    await user.click(screen.getByRole('button', { name: /Send code/ }))

    expect(
      await screen.findByRole('textbox', { name: 'Verification code' })
    ).toBeInTheDocument()
    expect(sentLotNumbers()).toEqual([null, 'lot-1'])
  })

  it('forgot password: resending the link challenges only when the server asks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderForm(ForgotPasswordForm, 'risk')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    await user.click(screen.getByRole('button', { name: /Send reset email/ }))
    await screen.findByRole('status')

    // Resending opens after the one-minute wait.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    queuedReplies = [CAPTCHA_REQUIRED]
    await user.click(
      await screen.findByRole('button', { name: /Send reset email/ })
    )

    await waitFor(() => expect(sentLotNumbers()).toEqual([null, null, 'lot-1']))
  })
})

describe('auth forms in always mode', () => {
  it('sign-in: challenges before every attempt and spends each result once', async () => {
    const user = userEvent.setup()
    await renderForm(UserAuthForm, 'always')
    const submit = screen.getByRole('button', { name: 'Sign in' })
    expect(submit).toBeEnabled()

    await signIn(user)
    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1']))
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1', 'lot-2']))
  })

  it('sign-in: closing the challenge sends nothing and lets the user try again', async () => {
    challengeAnswers = ['close']
    const user = userEvent.setup()
    await renderForm(UserAuthForm, 'always')

    await signIn(user)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    )
    expect(challengesShown).toBe(1)
    expect(sentLotNumbers()).toEqual([])
  })

  it('sign-up: sending the code and resending it each take a new result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderForm(SignUpForm, 'always')
    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'alice@example.com'
    )
    await user.click(screen.getByRole('button', { name: /Send code/ }))
    await screen.findByRole('textbox', { name: 'Verification code' })

    // Resending opens after the one-minute wait.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    await user.click(await screen.findByRole('button', { name: 'Resend code' }))

    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1', 'lot-2']))
  })

  it('forgot password: challenges before sending the link', async () => {
    const user = userEvent.setup()
    await renderForm(ForgotPasswordForm, 'always')
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')

    await user.click(screen.getByRole('button', { name: /Send reset email/ }))

    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1']))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'alice@example.com'
    )
  })
})
