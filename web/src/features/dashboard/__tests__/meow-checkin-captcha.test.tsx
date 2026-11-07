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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { MeowCheckinCard } from '../components/meow-overview/meow-checkin-card'

type CheckinReply = {
  success: boolean
  message: string
  code?: string
  data?: { quota_awarded: number; checkin_date: string }
}

const originalAdapter = api.defaults.adapter
let checkinRequests: InternalAxiosRequestConfig[] = []
let checkinReplies: CheckinReply[] = []

/** Stands in for gt4.js: its button passes the challenge when clicked. */
function installFakeGeetest() {
  window.initGeetest4 = ((
    _config: unknown,
    callback: (captcha: unknown) => void
  ) => {
    let succeed = () => {}
    const instance = {
      appendTo: (target: HTMLElement) => {
        const button = document.createElement('button')
        button.textContent = 'Pass GeeTest'
        button.addEventListener('click', () => succeed())
        target.appendChild(button)
        return instance
      },
      getValidate: () => ({
        lot_number: 'lot',
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

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    checkin_enabled: true,
    geetest_check: true,
    geetest_captcha_id: 'captcha-id',
  })
  render(
    <QueryClientProvider client={client}>
      <MeowCheckinCard />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  checkinRequests = []
  checkinReplies = []
  installFakeGeetest()
  api.defaults.adapter = async (config) => {
    let data: unknown = { success: false, message: '' }
    if (
      config.url?.startsWith('/api/user/checkin') &&
      config.method === 'get'
    ) {
      data = {
        success: true,
        data: { stats: { checked_in_today: false, records: [] } },
      }
    }
    if (config.url === '/api/user/checkin' && config.method === 'post') {
      checkinRequests.push(config)
      data = checkinReplies.shift()
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  delete window.initGeetest4
})

describe('Meow check-in with GeeTest', () => {
  it('when the server asks for verification, opens GeeTest, retries with its token and closes', async () => {
    checkinReplies = [
      {
        success: false,
        message: 'Please complete the human verification first',
        code: 'CAPTCHA_REQUIRED',
      },
      {
        success: true,
        message: 'Check-in successful',
        data: { quota_awarded: 100, checkin_date: '2026-11-07' },
      },
    ]
    const user = userEvent.setup()
    renderCard()

    await user.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )
    expect(await screen.findByRole('dialog')).toBeVisible()
    await user.click(
      await screen.findByRole('button', { name: 'Pass GeeTest' })
    )

    await waitFor(() => expect(checkinRequests).toHaveLength(2))
    expect(checkinRequests[0].headers.has('X-Captcha-Token')).toBe(false)
    expect(
      JSON.parse(checkinRequests[1].headers.get('X-Captcha-Token') as string)
    ).toEqual({
      lot_number: 'lot',
      captcha_output: 'output',
      pass_token: 'pass',
      gen_time: '1700000000',
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('when check-in fails after verification for another reason, closes the check', async () => {
    checkinReplies = [
      {
        success: false,
        message: 'Please complete the human verification first',
        code: 'CAPTCHA_REQUIRED',
      },
      { success: false, message: 'Already checked in today' },
    ]
    const user = userEvent.setup()
    renderCard()

    await user.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )
    await user.click(
      await screen.findByRole('button', { name: 'Pass GeeTest' })
    )

    await waitFor(() => expect(checkinRequests).toHaveLength(2))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('when check-in fails for another reason, does not open GeeTest', async () => {
    checkinReplies = [
      { success: false, message: 'Check-in feature is not enabled' },
    ]
    const user = userEvent.setup()
    renderCard()

    await user.click(
      await screen.findByRole('button', { name: 'Check in now' })
    )

    await waitFor(() => expect(checkinRequests).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
