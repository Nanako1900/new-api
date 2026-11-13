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
import i18next, { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next, setI18n } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { type AuthUser, useAuthStore } from '@/stores/auth-store'

import { MeowAnalyticsCard } from '../components/meow-overview/meow-analytics-card'
import { MeowOverview } from '../components/meow-overview/meow-overview'

let client: QueryClient | undefined

afterEach(() => {
  setI18n(i18next)
  client?.clear()
  useAuthStore.getState().auth.setUser(null)
  localStorage.clear()
  vi.restoreAllMocks()
})

test('the compact usage card clearly identifies the separate monitoring site with a primary keyboard-accessible action', async () => {
  const user = userEvent.setup()
  render(
    <MeowAnalyticsCard quota={1230000} requestCount={1234} isLoading={false} />
  )

  const link = screen.getByRole('link', {
    name: /Open dedicated monitoring site/,
  })
  expect(link).toHaveAttribute('href', 'https://dash.meowapi.dev')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(link).toHaveAccessibleName(/Open in new tab/)
  expect(link).toHaveClass('bg-primary', 'w-full')
  expect(screen.getByText('dash.meowapi.dev')).toBeVisible()
  expect(screen.getByText('Detailed analytics and live logs')).toBeVisible()
  const activate = vi.fn((event: Event) => event.preventDefault())
  link.addEventListener('click', activate)
  await user.tab()
  expect(link).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(activate).toHaveBeenCalledOnce()
  expect(screen.getByText('Spend (24h)')).toBeVisible()
  expect(screen.getByText('Requests (24h)')).toBeVisible()
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
})

test('switching language updates the compact statistics and allows longer dashboard links to wrap', async () => {
  const resources = { en, zhCN: zh, zhTW, fr, ja, ru, vi: viLocale }
  const formattedCounts: Record<string, string> = {
    en: '1,234',
    zhCN: '1,234',
    zhTW: '1,234',
    ja: '1,234',
    fr: '1\u202f234',
    ru: '1\u00a0234',
    vi: '1.234',
  }
  const i18n = createInstance()
  await i18n
    .use(initReactI18next)
    .init({ lng: 'en', fallbackLng: 'en', resources })
  render(
    <I18nextProvider i18n={i18n}>
      <MeowAnalyticsCard
        quota={1230000}
        requestCount={1234}
        isLoading={false}
      />
    </I18nextProvider>
  )

  for (const [language, resource] of Object.entries(resources)) {
    await act(async () => {
      await i18n.changeLanguage(language)
    })
    const label = resource.translation['Open dedicated monitoring site']
    expect(
      screen.getByText(resource.translation['Requests (24h)'])
    ).toBeVisible()
    expect(screen.getByRole('link')).toHaveAccessibleName(
      `${label} · ${resource.translation['Open in new tab']}`
    )
    expect(screen.getByText(label)).toHaveClass('whitespace-normal')
    expect(screen.getAllByRole('definition')[1].textContent).toBe(
      formattedCounts[language]
    )
  }
  await act(async () => {
    await i18n.changeLanguage('invalid_locale')
  })
  expect(screen.getByText('Requests (24h)')).toBeVisible()
  expect(screen.getAllByRole('definition')[1]).toHaveTextContent('1,234')
})

test('an overview with no usage keeps both detailed-dashboard entries and fetches summaries without request logs', async () => {
  const requests: string[] = []
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    requests.push(url)
    if (url === '/api/user/aff') {
      return { data: { success: true, data: 'preview' } }
    }
    if (url === '/api/pricing') {
      return { data: { success: true, data: [], vendors: [] } }
    }
    if (url === '/api/perf-metrics/summary') {
      return { data: { success: true, data: { models: [] } } }
    }
    if (url === '/api/data/self') return { data: { success: true, data: [] } }
    if (url.startsWith('/api/token/')) {
      return { data: { success: true, data: { total: 0, items: [] } } }
    }
    throw new Error(`Unexpected overview request: ${url}`)
  })
  useAuthStore.getState().auth.setUser({
    id: 7,
    username: 'overview-user',
    display_name: 'Overview User',
    role: 1,
    quota: 1000000,
    used_quota: 0,
    request_count: 0,
  } as AuthUser)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(STATUS_QUERY_KEY, {
    checkin_enabled: false,
    announcements: [],
    faq: [],
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: MeowOverview }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultHashScrollIntoView: false,
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  expect(
    await screen.findByText('No usage in the last 7 days yet.')
  ).toBeVisible()
  await waitFor(() => expect(client?.isFetching()).toBe(0))
  expect(
    screen.getByRole('link', { name: /Open dedicated monitoring site/ })
  ).toHaveAttribute('href', 'https://dash.meowapi.dev')
  expect(
    screen.getByRole('link', { name: /^Monitoring site/ })
  ).toHaveAttribute('href', 'https://dash.meowapi.dev')
  expect(
    screen.getByRole('heading', { name: 'Spend, last 7 days' })
  ).toBeVisible()
  expect(screen.getByRole('region', { name: 'Overview' })).toHaveClass(
    'lg:grid-cols-2'
  )
  expect(
    screen.queryByRole('heading', { name: 'Detailed analytics and live logs' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'Recent calls' })
  ).not.toBeInTheDocument()
  expect(requests).toContain('/api/data/self')
  expect(requests.filter((url) => url.startsWith('/api/log/'))).toEqual([])
})
