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

const originalAdapter = api.defaults.adapter
const startedRegistrationFlow = {
  flow_token: 'flow-1',
  email: 'alice@example.com',
  expires_at: Math.floor(Date.now() / 1000) + 600,
  // Already past, so resending is allowed right away.
  resend_at: Math.floor(Date.now() / 1000) - 1,
}
let guardedRequests: InternalAxiosRequestConfig[] = []

/** Stands in for gt4.js; every pass yields a new lot number. */
function installFakeGeetest() {
  let passes = 0
  window.initGeetest4 = ((
    _config: unknown,
    callback: (captcha: unknown) => void
  ) => {
    let succeed = () => {}
    let lotNumber = ''
    const instance = {
      appendTo: (target: HTMLElement) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Pass GeeTest'
        button.addEventListener('click', () => {
          passes += 1
          lotNumber = `lot-${passes}`
          succeed()
        })
        target.appendChild(button)
        return instance
      },
      getValidate: () => ({
        lot_number: lotNumber,
        captcha_output: 'output',
        pass_token: 'pass',
        gen_time: '1700000000',
      }),
      onSuccess: (next: () => void) => {
        succeed = next
        return instance
      },
      onError: () => instance,
      destroy: () => {},
    }
    callback(instance)
  }) as unknown as Window['initGeetest4']
}

function sentLotNumbers(): string[] {
  return guardedRequests.map(
    (config) =>
      JSON.parse(config.headers.get('X-Captcha-Token') as string).lot_number
  )
}

async function renderForm(Form: ComponentType) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    geetest_check: true,
    geetest_captcha_id: 'captcha-id',
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

beforeEach(() => {
  guardedRequests = []
  installFakeGeetest()
  api.defaults.adapter = async (config) => {
    if (config.headers.has('X-Captcha-Token')) guardedRequests.push(config)
    // Sign-up's email check succeeds, so its resend can be exercised.
    if (config.url === '/api/user/register/email/start') {
      return {
        data: { success: true, message: '', data: startedRegistrationFlow },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    return {
      data: { success: false, message: 'Rejected by the test server' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
  api.defaults.adapter = originalAdapter
  delete window.initGeetest4
})

describe('auth forms spend each GeeTest result once', () => {
  it('sign-up: sending the code spends the pass, and resending needs a new one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderForm(SignUpForm)
    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'alice@example.com'
    )
    const send = screen.getByRole('button', { name: /Send code/ })
    expect(send).toBeDisabled()

    await user.click(
      await screen.findByRole('button', { name: 'Pass GeeTest' })
    )
    await user.click(send)
    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1']))
    expect(
      await screen.findByRole('textbox', { name: 'Verification code' })
    ).toBeInTheDocument()

    // Resending opens after the one-minute wait.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    const resend = await screen.findByRole('button', { name: 'Resend code' })
    expect(resend).toBeDisabled()
    expect(resend).toHaveAccessibleDescription(
      'Please complete the human verification first'
    )
    await user.click(
      await screen.findByRole('button', { name: 'Pass GeeTest' })
    )
    await user.click(resend)
    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1', 'lot-2']))
  })

  it('sign-up: the human verification comes before the send button', async () => {
    await renderForm(SignUpForm)
    const send = screen.getByRole('button', { name: /Send code/ })
    const captcha = await screen.findByRole('button', { name: 'Pass GeeTest' })

    expect(send).toHaveAccessibleDescription(
      'Please complete the human verification first'
    )
    expect(
      captcha.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('sign-in: after a failed sign-in, requires a new pass before the next attempt', async () => {
    const user = userEvent.setup()
    await renderForm(UserAuthForm)
    await user.type(screen.getByLabelText('Username or Email'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'secret-password')
    const submit = screen.getByRole('button', { name: 'Sign in' })
    expect(submit).toBeDisabled()

    await user.click(
      await screen.findByRole('button', { name: 'Pass GeeTest' })
    )
    await user.click(submit)
    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1']))

    await waitFor(() => expect(submit).toBeDisabled())
    await user.click(
      await screen.findByRole('button', { name: 'Pass GeeTest' })
    )
    await user.click(submit)
    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1', 'lot-2']))
  })

  it('sign-in: before a pass, the locked submit button explains what is missing', async () => {
    await renderForm(UserAuthForm)
    const submit = screen.getByRole('button', { name: 'Sign in' })
    const captcha = await screen.findByRole('button', { name: 'Pass GeeTest' })

    expect(submit).toHaveAccessibleDescription(
      'Please complete the human verification first'
    )
    expect(
      captcha.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('forgot password: after a failed send, requires a new pass before resending', async () => {
    const user = userEvent.setup()
    await renderForm(ForgotPasswordForm)
    await user.type(screen.getByLabelText('Email'), 'alice@example.com')
    const submit = screen.getByRole('button', { name: /Send reset email/ })
    expect(submit).toBeDisabled()

    await user.click(
      await screen.findByRole('button', { name: 'Pass GeeTest' })
    )
    await user.click(submit)
    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1']))

    await waitFor(() => expect(submit).toBeDisabled())
    await user.click(
      await screen.findByRole('button', { name: 'Pass GeeTest' })
    )
    await user.click(submit)
    await waitFor(() => expect(sentLotNumbers()).toEqual(['lot-1', 'lot-2']))
  })

  it('forgot password: the human verification comes before the send button', async () => {
    await renderForm(ForgotPasswordForm)
    const submit = screen.getByRole('button', { name: /Send reset email/ })
    const captcha = await screen.findByRole('button', { name: 'Pass GeeTest' })

    expect(submit).toHaveAccessibleDescription(
      'Please complete the human verification first'
    )
    expect(
      captcha.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
