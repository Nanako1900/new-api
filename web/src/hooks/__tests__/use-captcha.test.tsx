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
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { InternalAxiosRequestConfig } from 'axios'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { useCaptcha } from '../use-captcha'

type FakeConfig = {
  captchaId: string
  product: string
  hideSuccess?: boolean
  language: string
  protocol?: string
  offlineCb?: () => void
}

type Reply = { success: boolean; message: string; code?: string }

const enabledStatus = { geetest_check: true, geetest_captcha_id: 'captcha-id' }
const originalAdapter = api.defaults.adapter
let statusRequests: InternalAxiosRequestConfig[] = []

/**
 * Stands in for gt4.js in bind mode. Each `showCaptcha` is answered by the
 * next queued user action (a pass by default); every pass has a new lot number.
 */
function installFakeGeetest(
  options: { offline?: boolean; readyOnInit?: boolean } = {}
) {
  const configs: FakeConfig[] = []
  const answers: Array<'pass' | 'close'> = []
  const destroy = vi.fn()
  const showCaptcha = vi.fn()
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
      captcha_id: 'not-sent',
    }),
    showCaptcha: () => {
      showCaptcha()
      const answer = answers.shift() ?? 'pass'
      setTimeout(() => {
        if (answer === 'close') {
          onClose()
          return
        }
        lotNumber = `lot-${showCaptcha.mock.calls.length}`
        onSuccess()
      })
    },
    onReady: (callback: () => void) => {
      onReady = callback
      return instance
    },
    onSuccess: (callback: () => void) => {
      onSuccess = callback
      return instance
    },
    onClose: (callback: () => void) => {
      onClose = callback
      return instance
    },
    onError: () => instance,
    destroy,
  }
  window.initGeetest4 = ((
    config: FakeConfig,
    callback: (captcha: typeof instance) => void
  ) => {
    configs.push(config)
    // gt4.js runs offlineCb when it cannot reach GeeTest, then still hands
    // back an instance.
    if (options.offline) config.offlineCb?.()
    callback(instance)
    if (options.readyOnInit !== false) onReady()
  }) as unknown as Window['initGeetest4']
  return {
    configs,
    destroy,
    showCaptcha,
    answers,
    ready: () => act(() => onReady()),
  }
}

function renderCaptcha(status: Record<string, unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, status)
  return renderHook(() => useCaptcha(), {
    wrapper: (props: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    ),
  })
}

/** A guarded request that records the token it was given. */
function fakeSend(...replies: Reply[]) {
  return vi.fn(
    async (_token?: string): Promise<Reply> =>
      replies.shift() ?? { success: true, message: '' }
  )
}

function sentLotNumbers(send: ReturnType<typeof fakeSend>) {
  return send.mock.calls.map(([token]) =>
    token === undefined ? null : JSON.parse(token).lot_number
  )
}

beforeEach(() => {
  statusRequests = []
  api.defaults.adapter = async (config) => {
    if (config.url === '/api/status') statusRequests.push(config)
    return {
      data: { success: true, message: '', data: enabledStatus },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
})

afterEach(async () => {
  // Unmount first: a mounted hook would re-initialize on the language reset.
  cleanup()
  vi.restoreAllMocks()
  api.defaults.adapter = originalAdapter
  // A reloaded status is also cached in localStorage.
  localStorage.clear()
  delete window.initGeetest4
  document.head
    .querySelectorAll('script[src*="geetest"]')
    .forEach((script) => script.remove())
  await act(() => i18next.changeLanguage('en'))
})

describe('useCaptcha GeeTest setup', () => {
  it.each([
    ['zhCN', 'zho'],
    ['zhTW', 'zho-tw'],
    ['en', 'eng'],
    ['fr', 'fra'],
    ['ru', 'rus'],
    ['ja', 'jpn'],
    ['vi', 'eng'],
    ['xx', 'eng'],
  ])(
    'with interface language %s, starts GeeTest bind mode in %s on mount',
    async (language, geetestLanguage) => {
      const geetest = installFakeGeetest()
      if (!i18next.hasResourceBundle(language, 'translation')) {
        i18next.addResourceBundle(language, 'translation', {})
      }
      await act(() => i18next.changeLanguage(language))

      renderCaptcha(enabledStatus)

      await waitFor(() => expect(geetest.configs).toHaveLength(1))
      expect(geetest.configs[0]).toEqual(
        expect.objectContaining({
          captchaId: 'captcha-id',
          product: 'bind',
          hideSuccess: true,
          language: geetestLanguage,
          protocol: 'https://',
        })
      )
      expect(geetest.showCaptcha).not.toHaveBeenCalled()
    }
  )

  it('when unmounted, destroys the GeeTest instance', async () => {
    const geetest = installFakeGeetest()
    const view = renderCaptcha(enabledStatus)
    await waitFor(() => expect(geetest.configs).toHaveLength(1))

    view.unmount()

    expect(geetest.destroy).toHaveBeenCalledTimes(1)
  })

  it('when GeeTest is off, sends once without a token and loads no GeeTest', async () => {
    const geetest = installFakeGeetest()
    const send = fakeSend()
    const view = renderCaptcha({ geetest_check: false })

    await act(() => view.result.current.run(send))

    expect(sentLotNumbers(send)).toEqual([null])
    expect(geetest.configs).toHaveLength(0)
  })
})

describe('useCaptcha in always mode', () => {
  it('challenges before sending and sends only the four result fields', async () => {
    const geetest = installFakeGeetest()
    const send = fakeSend()
    const view = renderCaptcha({
      ...enabledStatus,
      geetest_check_mode: 'always',
    })

    await act(() => view.result.current.run(send))

    expect(geetest.showCaptcha).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(send.mock.calls[0][0] as string)).toEqual({
      lot_number: 'lot-1',
      captcha_output: 'output',
      pass_token: 'pass',
      gen_time: '1700000000',
    })
  })

  it('with the mode missing from the status, still challenges before sending', async () => {
    installFakeGeetest()
    const send = fakeSend()
    const view = renderCaptcha(enabledStatus)

    await act(() => view.result.current.run(send))

    expect(sentLotNumbers(send)).toEqual(['lot-1'])
  })

  it('gives each request its own challenge and result', async () => {
    const geetest = installFakeGeetest()
    const send = fakeSend()
    const view = renderCaptcha(enabledStatus)

    await act(() => view.result.current.run(send))
    await act(() => view.result.current.run(send))

    expect(geetest.showCaptcha).toHaveBeenCalledTimes(2)
    expect(sentLotNumbers(send)).toEqual(['lot-1', 'lot-2'])
  })

  it('when submitted before GeeTest is ready, opens the challenge once it is', async () => {
    const geetest = installFakeGeetest({ readyOnInit: false })
    const send = fakeSend()
    const view = renderCaptcha(enabledStatus)
    await waitFor(() => expect(geetest.configs).toHaveLength(1))

    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = view.result.current.run(send)
    })
    expect(geetest.showCaptcha).not.toHaveBeenCalled()
    geetest.ready()
    await act(() => pending)

    expect(sentLotNumbers(send)).toEqual(['lot-1'])
  })
})

describe('useCaptcha in risk mode', () => {
  const riskStatus = { ...enabledStatus, geetest_check_mode: 'risk' }

  it.each([
    ['a success', { success: true, message: '' }],
    ['a wrong password', { success: false, message: 'Invalid credentials' }],
    [
      'an unavailable check',
      {
        success: false,
        message: 'Human verification is temporarily unavailable',
        code: 'CAPTCHA_UNAVAILABLE',
      },
    ],
  ])(
    'when the server answers with %s, returns it without a challenge',
    async (_name, reply) => {
      const geetest = installFakeGeetest()
      const send = fakeSend(reply)
      const view = renderCaptcha(riskStatus)

      let result: unknown
      await act(async () => {
        result = await view.result.current.run(send)
      })

      expect(result).toEqual(reply)
      expect(sentLotNumbers(send)).toEqual([null])
      expect(geetest.showCaptcha).not.toHaveBeenCalled()
    }
  )

  it('when the server answers CAPTCHA_REQUIRED, challenges and resends once with the result', async () => {
    const geetest = installFakeGeetest()
    const send = fakeSend(
      { success: false, message: 'Required', code: 'CAPTCHA_REQUIRED' },
      { success: true, message: 'Signed in' }
    )
    const view = renderCaptcha(riskStatus)

    let result: unknown
    await act(async () => {
      result = await view.result.current.run(send)
    })

    expect(geetest.showCaptcha).toHaveBeenCalledTimes(1)
    expect(sentLotNumbers(send)).toEqual([null, 'lot-1'])
    expect(result).toEqual({ success: true, message: 'Signed in' })
  })

  it('when the console has no captcha ID but the server asks, shows the server message and reloads the site settings', async () => {
    const error = vi.spyOn(toast, 'error')
    const geetest = installFakeGeetest()
    const send = fakeSend({
      success: false,
      message: 'Please complete the human verification first',
      code: 'CAPTCHA_REQUIRED',
    })
    const view = renderCaptcha({ geetest_check: false })

    let result: unknown
    await act(async () => {
      result = await view.result.current.run(send)
    })

    expect(result).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(
      'Please complete the human verification first'
    )
    await waitFor(() => expect(statusRequests).toHaveLength(1))
    // The reloaded settings turn GeeTest on for the next attempt.
    await waitFor(() => expect(geetest.configs).toHaveLength(1))
  })
})

describe('useCaptcha when the challenge does not pass', () => {
  it.each([
    ['always', 0],
    ['risk', 1],
  ])(
    'in %s mode, closing the challenge stops the request and asks for the check',
    async (mode, requests) => {
      const info = vi.spyOn(toast, 'info')
      const geetest = installFakeGeetest()
      geetest.answers.push('close')
      const send = fakeSend({
        success: false,
        message: 'Required',
        code: 'CAPTCHA_REQUIRED',
      })
      const view = renderCaptcha({
        ...enabledStatus,
        geetest_check_mode: mode,
      })

      let result: unknown
      await act(async () => {
        result = await view.result.current.run(send)
      })

      expect(result).toBeNull()
      expect(send).toHaveBeenCalledTimes(requests)
      expect(info).toHaveBeenCalledWith(
        'Please complete the human verification first'
      )
    }
  )

  it('when gt4.js fails to load, shows the load error and sends nothing', async () => {
    const error = vi.spyOn(toast, 'error')
    const send = fakeSend()
    const view = renderCaptcha(enabledStatus)
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[src="https://static.geetest.com/v4/gt4.js"]'
    )
    expect(script).not.toBeNull()

    act(() => {
      script?.dispatchEvent(new Event('error'))
    })
    await act(() => view.result.current.run(send))

    expect(send).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'Human verification failed to load. Refresh the page and try again.'
    )
  })

  it('when GeeTest is offline, never opens its local-pass challenge', async () => {
    const error = vi.spyOn(toast, 'error')
    const geetest = installFakeGeetest({ offline: true })
    const send = fakeSend()
    const view = renderCaptcha(enabledStatus)

    await act(() => view.result.current.run(send))

    expect(geetest.showCaptcha).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'Human verification failed to load. Refresh the page and try again.'
    )
  })
})
