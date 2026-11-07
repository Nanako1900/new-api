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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InternalAxiosRequestConfig } from 'axios'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { ForgotPasswordForm } from '../components/forgot-password-form'

const originalAdapter = api.defaults.adapter
let resetRequests: InternalAxiosRequestConfig[] = []
let resetSucceeds = true

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // No human verification on this site: only the send result matters here.
  client.setQueryData(STATUS_QUERY_KEY, { geetest_check: false })
  render(
    <QueryClientProvider client={client}>
      <ForgotPasswordForm />
    </QueryClientProvider>
  )
}

async function sendResetLink(email: string) {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Email' }), email)
  await user.click(screen.getByRole('button', { name: /Send reset email/ }))
  return user
}

beforeEach(() => {
  resetRequests = []
  resetSucceeds = true
  api.defaults.adapter = async (config) => {
    if (config.url === '/api/user/password-reset/start') {
      resetRequests.push(config)
    }
    return {
      data: resetSucceeds
        ? { success: true, message: '' }
        : { success: false, message: 'Rejected by the test server' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
})

describe('forgot password confirmation', () => {
  it('after a successful send, shows the address and locks resending during the countdown', async () => {
    renderForm()
    await sendResetLink('alice@example.com')

    const confirmation = await screen.findByRole('status')
    expect(confirmation).toHaveTextContent('Check your email')
    expect(confirmation).toHaveTextContent('alice@example.com')
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
    expect(screen.getByRole('button', { name: /Resend/ })).toBeDisabled()
    expect(resetRequests).toHaveLength(1)
    expect(api.getUri(resetRequests[0])).toBe('/api/user/password-reset/start')
    expect(JSON.parse(resetRequests[0].data as string)).toEqual({
      email: 'alice@example.com',
    })
  })

  it('resending stays locked for the full minute the server allows one mail per address', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderForm()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.type(
        screen.getByRole('textbox', { name: 'Email' }),
        'alice@example.com'
      )
      await user.click(screen.getByRole('button', { name: /Send reset email/ }))
      await screen.findByRole('status')

      act(() => {
        vi.advanceTimersByTime(59_000)
      })
      expect(screen.getByRole('button', { name: /Resend/ })).toBeDisabled()

      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      expect(
        await screen.findByRole('button', { name: /Send reset email/ })
      ).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('choosing a different email returns to the email field with the address kept', async () => {
    renderForm()
    const user = await sendResetLink('alice@example.com')

    await user.click(
      await screen.findByRole('button', { name: 'Use a different email' })
    )

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue(
      'alice@example.com'
    )
  })

  it('a rejected send keeps the email form and shows no confirmation', async () => {
    resetSucceeds = false
    const showError = vi.spyOn(toast, 'error')
    renderForm()
    await sendResetLink('alice@example.com')

    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith('Rejected by the test server')
    )
    expect(screen.queryByText('Check your email')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue(
      'alice@example.com'
    )
  })
})
