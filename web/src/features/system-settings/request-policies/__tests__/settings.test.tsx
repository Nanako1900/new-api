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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route as ModelsRoute } from '@/routes/_authenticated/system-settings/models/$section'
import { Route as OperationsRoute } from '@/routes/_authenticated/system-settings/operations/$section'
import { Route as PoliciesRoute } from '@/routes/_authenticated/system-settings/request-policies/$section'
import { Route as PolicyIndexRoute } from '@/routes/_authenticated/system-settings/request-policies/index'
import { Route as SecurityRoute } from '@/routes/_authenticated/system-settings/security/$section'

import { RequestPolicies } from '..'
import {
  defaultRequestPolicySettings,
  type RequestPolicySettings,
} from '../defaults'

type PolicyBeforeLoad = (context: { params: { section: string } }) => void

let queryClient: QueryClient
let settings: RequestPolicySettings

function optionsResponse() {
  return {
    success: true,
    data: Object.entries(settings).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  }
}

async function renderPolicies(path: string) {
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const policyRoute = createRoute({
    getParentRoute: () => authenticated,
    path: '/system-settings/request-policies/$section',
    beforeLoad: PoliciesRoute.options.beforeLoad as PolicyBeforeLoad,
    component: RequestPolicies,
  })
  const routes = [
    policyRoute,
    createRoute({
      getParentRoute: () => authenticated,
      path: '/system-settings/request-policies/',
      beforeLoad: PolicyIndexRoute.options.beforeLoad as () => void,
    }),
    createRoute({
      getParentRoute: () => authenticated,
      path: '/system-settings/models/$section',
      beforeLoad: ModelsRoute.options.beforeLoad as PolicyBeforeLoad,
    }),
    createRoute({
      getParentRoute: () => authenticated,
      path: '/system-settings/security/$section',
      beforeLoad: SecurityRoute.options.beforeLoad as PolicyBeforeLoad,
    }),
    createRoute({
      getParentRoute: () => authenticated,
      path: '/system-settings/operations/$section',
      beforeLoad: OperationsRoute.options.beforeLoad as PolicyBeforeLoad,
    }),
  ]
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren(routes)]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await act(() => router.load())
  return router
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  settings = {
    ...defaultRequestPolicySettings,
    RetryTimes: 2,
    AutomaticRetryStatusCodes: '429,500-503',
    AutomaticDisableChannelEnabled: true,
    AutomaticEnableChannelEnabled: true,
    'monitor_setting.auto_test_channel_enabled': true,
    CheckSensitiveEnabled: true,
    CheckSensitiveOnPromptEnabled: true,
    SensitiveWords: 'blocked',
    'channel_affinity_setting.rules': JSON.stringify([
      {
        name: 'Existing session rule',
        model_regex: ['gpt-.*'],
        path_regex: ['/v1/chat/completions'],
        key_sources: [{ type: 'request_header', key: 'X-Session-ID' }],
        ttl_seconds: 600,
        skip_retry_on_failure: true,
        include_using_group: true,
        include_model_name: false,
        include_rule_name: true,
        param_override_template: { temperature: 0 },
      },
    ]),
  }
  vi.spyOn(api, 'patch').mockResolvedValue({
    data: {
      success: true,
      data: { options: {} },
    },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/') return { data: optionsResponse() }
    if (url === '/api/option/request_policy') {
      return {
        data: {
          success: true,
          data: {
            options: Object.fromEntries(
              Object.entries(settings).map(([key, value]) => [
                key,
                String(value),
              ])
            ),
          },
        },
      }
    }
    if (url === '/api/channel/models_enabled') {
      return { data: { success: true, data: ['judge-model', 'backup-judge'] } }
    }
    if (url === '/api/group/') {
      return { data: { success: true, data: ['default', 'vip'] } }
    }
    return {
      data: {
        success: true,
        data: {
          enabled: false,
          total: 0,
          unknown: 0,
          by_rule_name: {},
          cache_capacity: 100000,
          cache_algo: 'lru',
        },
      },
    }
  })
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

describe('request policy settings', () => {
  it.each(['retry', 'health', 'filtering', 'affinity'])(
    'opening %s and saving unchanged values does not write options',
    async (section) => {
      await renderPolicies(`/system-settings/request-policies/${section}`)
      const save = await screen.findByRole('button', { name: 'Save Changes' })
      expect(api.patch).not.toHaveBeenCalled()
      await userEvent.click(save)
      await waitFor(() => expect(save).toBeEnabled())
      expect(api.patch).not.toHaveBeenCalled()
    }
  )

  it('saving request checks whose stored review model has surrounding spaces without edits writes nothing', async () => {
    settings['content_safety_setting.review_model'] = ' judge-model '
    await renderPolicies('/system-settings/request-policies/filtering')
    const save = await screen.findByRole('button', { name: 'Save Changes' })
    await userEvent.click(save)
    await waitFor(() => expect(save).toBeEnabled())
    expect(api.patch).not.toHaveBeenCalled()
  })

  it.each([
    [
      'health',
      'Channel test concurrency',
      '4',
      'monitor_setting.channel_test_concurrency',
      4,
    ],
  ])(
    'saving a changed %s field writes only that original option key',
    async (section, label, input, key, value) => {
      await renderPolicies(`/system-settings/request-policies/${section}`)
      fireEvent.change(await screen.findByRole('spinbutton', { name: label }), {
        target: { value: input },
      })
      await userEvent.click(
        screen.getByRole('button', { name: 'Save Changes' })
      )
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledExactlyOnceWith(
          '/api/option/request_policy',
          { options: { [key]: String(value) } }
        )
      )
    }
  )

  it('turning filtering off preserves the prompt switch and keyword list', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable filtering' })
    )
    const prompt = screen.getByRole('switch', { name: 'Inspect user prompts' })
    expect(prompt).toHaveAttribute('aria-disabled', 'true')
    expect(prompt).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Block words' })).toHaveValue(
      'blocked'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledExactlyOnceWith(
        '/api/option/request_policy',
        { options: { CheckSensitiveEnabled: 'false' } }
      )
    )
  })

  it('refreshing another policy keeps unsaved filter text', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    const keywords = await screen.findByRole('textbox', {
      name: 'Block words',
    })
    fireEvent.change(keywords, { target: { value: 'unsaved' } })
    settings.RetryTimes = 5
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['system-options'] })
    })
    expect(keywords).toHaveValue('unsaved')
  })

  it('saving a changed log retention also sends the current review switch and group', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    fireEvent.change(
      await screen.findByRole('spinbutton', {
        name: 'Content safety log retention (days)',
      }),
      { target: { value: '45' } }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledExactlyOnceWith(
        '/api/option/request_policy',
        {
          options: {
            'content_safety_setting.review_enabled': 'false',
            'content_safety_setting.review_group': 'default',
            'content_safety_setting.log_retention_days': '45',
          },
        }
      )
    )
  })

  it('AI review options stay hidden until AI review is switched on', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    const toggle = await screen.findByRole('switch', {
      name: 'Enable AI review',
    })
    expect(toggle).not.toBeChecked()
    expect(
      screen.queryByRole('group', { name: 'AI review options' })
    ).not.toBeInTheDocument()
    await userEvent.click(toggle)
    const options = screen.getByRole('group', { name: 'AI review options' })
    expect(
      within(options).getByRole('textbox', { name: 'Review words' })
    ).toBeVisible()
    expect(
      within(options).getByRole('combobox', { name: 'Review model' })
    ).toBeVisible()
    expect(
      within(options).getByRole('combobox', { name: 'Review group' })
    ).toBeVisible()
  })

  it('enabling AI review without a model or review words shows field errors and does not write options', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Review words' })
      ).toHaveAttribute('aria-invalid', 'true')
    )
    expect(
      screen.getByRole('combobox', { name: 'Review model' })
    ).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter at least one review word')).toBeVisible()
    expect(screen.getByText('Select a review model')).toBeVisible()
    const modelInput = screen.getByRole('combobox', { name: 'Review model' })
    expect(modelInput).toHaveAccessibleDescription(
      expect.stringContaining('Select a review model')
    )
    expect(modelInput).toHaveFocus()
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('a valid AI review setup writes exactly the changed content safety options', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Review words' }), {
      target: { value: 'knife' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Review model' }), {
      target: { value: 'judge-model' },
    })
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Review timeout (seconds)' }),
      { target: { value: '20' } }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledExactlyOnceWith(
        '/api/option/request_policy',
        {
          options: {
            'content_safety_setting.review_enabled': 'true',
            'content_safety_setting.review_group': 'default',
            'content_safety_setting.review_words': 'knife',
            'content_safety_setting.review_model': 'judge-model',
            'content_safety_setting.review_timeout_seconds': '20',
          },
        }
      )
    )
  })

  it('an out-of-range review timeout shows the allowed range and does not write options', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    )
    const timeout = screen.getByRole('spinbutton', {
      name: 'Review timeout (seconds)',
    })
    fireEvent.change(timeout, { target: { value: '61' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(timeout).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText('Enter an integer from 1 to 60')).toBeVisible()
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('an invalid option revealed by saving stays open and focused while it is corrected', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    expect(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    ).not.toBeChecked()
    // The timeout is invalid while AI review is off, so saving must open the
    // group that holds it and focus the field.
    await userEvent.click(
      screen.getByRole('switch', { name: 'Enable AI review' })
    )
    const timeout = screen.getByRole('spinbutton', {
      name: 'Review timeout (seconds)',
    })
    fireEvent.change(timeout, { target: { value: '61' } })
    await userEvent.click(
      screen.getByRole('switch', { name: 'Enable AI review' })
    )
    expect(
      screen.queryByRole('group', { name: 'AI review options' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    const options = await screen.findByRole('group', {
      name: 'AI review options',
    })
    const invalid = within(options).getByRole('spinbutton', {
      name: 'Review timeout (seconds)',
    })
    await waitFor(() => expect(invalid).toHaveFocus())
    expect(invalid).toHaveAttribute('aria-invalid', 'true')
    expect(api.patch).not.toHaveBeenCalled()

    fireEvent.change(invalid, { target: { value: '20' } })
    await waitFor(() =>
      expect(invalid).toHaveAttribute('aria-invalid', 'false')
    )

    expect(
      screen.getByRole('group', { name: 'AI review options' })
    ).toBeVisible()
    expect(invalid).toHaveFocus()
    expect(invalid).toHaveValue(20)
  })

  it('toggling Enable filtering while an invalid option is revealed keeps focus on the toggle', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    const toggle = await screen.findByRole('switch', {
      name: 'Enable AI review',
    })
    await userEvent.click(toggle)
    const timeout = screen.getByRole('spinbutton', {
      name: 'Review timeout (seconds)',
    })
    fireEvent.change(timeout, { target: { value: '61' } })
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    const revealed = await screen.findByRole('spinbutton', {
      name: 'Review timeout (seconds)',
    })
    await waitFor(() => expect(revealed).toHaveFocus())

    const filtering = screen.getByRole('switch', { name: 'Enable filtering' })
    await userEvent.click(filtering)

    expect(filtering).toHaveFocus()
  })

  it('a save with nothing changed closes the options an invalid save revealed', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    const toggle = await screen.findByRole('switch', {
      name: 'Enable AI review',
    })
    await userEvent.click(toggle)
    const timeout = screen.getByRole('spinbutton', {
      name: 'Review timeout (seconds)',
    })
    fireEvent.change(timeout, { target: { value: '61' } })
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    const revealed = await screen.findByRole('spinbutton', {
      name: 'Review timeout (seconds)',
    })

    fireEvent.change(revealed, { target: { value: '15' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'AI review options' })
      ).not.toBeInTheDocument()
    )
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('an invalid log retention does not open the AI review options', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    const retention = await screen.findByRole('spinbutton', {
      name: 'Content safety log retention (days)',
    })
    fireEvent.change(retention, { target: { value: '0' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(retention).toHaveAttribute('aria-invalid', 'true')
    )
    expect(
      screen.queryByRole('group', { name: 'AI review options' })
    ).not.toBeInTheDocument()
  })

  it('the AI review options are described by the fail-closed note', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    )
    expect(
      screen.getByRole('group', { name: 'AI review options' })
    ).toHaveAccessibleDescription(expect.stringMatching(/fails closed/))
  })

  it('numeric review options state their allowed range from one shared message', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    )
    expect(screen.getByText(/Allowed range: 1–60/)).toBeVisible()
    expect(screen.getByText(/Allowed range: 0–604,800/)).toBeVisible()
    expect(screen.getByText(/Allowed range: 1–3,650/)).toBeVisible()
  })

  it('the AI review notes are one static note, not a live alert', async () => {
    await renderPolicies('/system-settings/request-policies/filtering')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Enable AI review' })
    )
    const options = screen.getByRole('group', { name: 'AI review options' })
    expect(within(options).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(options).getByText(/fails closed/)).toBeVisible()
    expect(within(options).getByText(/prompt injection/)).toBeVisible()
  })

  it('changing only the review words still sends the review switch and group', async () => {
    settings['content_safety_setting.review_enabled'] = true
    settings['content_safety_setting.review_model'] = 'judge-model'
    settings['content_safety_setting.review_words'] = 'knife'
    await renderPolicies('/system-settings/request-policies/filtering')
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Review words' }),
      { target: { value: 'knife\ngun' } }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledExactlyOnceWith(
        '/api/option/request_policy',
        {
          options: {
            'content_safety_setting.review_enabled': 'true',
            'content_safety_setting.review_group': 'default',
            'content_safety_setting.review_words': 'knife\ngun',
          },
        }
      )
    )
  })

  it('invalid retry status ranges show validation and do not write options', async () => {
    await renderPolicies('/system-settings/request-policies/retry')
    const codes = await screen.findByRole('textbox', {
      name: 'Auto-retry status codes',
    })
    expect(codes).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Advanced settings' })
    ).not.toBeInTheDocument()
    fireEvent.change(codes, { target: { value: '599-500' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(codes).toHaveAttribute('aria-invalid', 'true')
    expect(api.put).not.toHaveBeenCalled()
  })

  it('a rejected save keeps the edited retry value and allows another save', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      data: { success: false, message: 'Save rejected' },
    })
    await renderPolicies('/system-settings/request-policies/retry')
    const retries = await screen.findByRole('spinbutton', {
      name: 'Maximum retries',
    })
    fireEvent.change(retries, { target: { value: '4' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
    )
    expect(retries).toHaveValue(4)
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2))
  })

  it('failed initial loading shows a retry action instead of editable fallback values', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Unavailable'))
    await renderPolicies('/system-settings/request-policies/retry')
    expect(await screen.findByText('Failed to load settings')).toBeVisible()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('spinbutton', {
        name: 'Maximum retries',
      })
    ).toHaveValue(2)
    expect(api.put).not.toHaveBeenCalled()
  })

  it('turning scheduled checks off explains recovery without changing the recovery setting', async () => {
    await renderPolicies('/system-settings/request-policies/health')
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Scheduled channel tests' })
    )
    expect(
      screen.getByText(
        'Scheduled recovery is off. Bulk channel tests can still re-enable automatically disabled channels.'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'Re-enable on success' })
    ).toBeChecked()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('the affinity cache section opens with the keyboard and keeps the existing values', async () => {
    await renderPolicies('/system-settings/request-policies/affinity')
    const toggle = await screen.findByRole('button', {
      name: 'Affinity cache settings',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('spinbutton', { name: 'Maximum cached sessions' })
    ).toHaveValue(100000)
    expect(
      screen.getByRole('spinbutton', {
        name: 'Default session lifetime (seconds)',
      })
    ).toHaveValue(3600)
    expect(api.put).not.toHaveBeenCalled()
  })

  it.each([
    ['/system-settings/models/channel-affinity', 'routing'],
    ['/system-settings/models/routing-reliability', 'routing'],
    ['/system-settings/security/sensitive-words', 'filtering'],
    ['/system-settings/operations/monitoring', 'health'],
    ['/system-settings/request-policies/', 'routing'],
    ['/system-settings/request-policies/unknown', 'routing'],
  ])('%s opens the corresponding policy page', async (path, section) => {
    const router = await renderPolicies(path)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/system-settings/request-policies/${section}`
      )
    )
    expect(api.put).not.toHaveBeenCalled()
  })
})
