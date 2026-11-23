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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'

import { CONSOLE_ALERTS_QUERY_KEY } from '@/features/console-alerts/constants'
import { getAlertDismissKey } from '@/features/console-alerts/lib/dismiss-key'
import type {
  AlertHistoryEntry,
  ConsoleAlert,
} from '@/features/console-alerts/types'
import { useNotifications } from '@/hooks/use-notifications'
import { api } from '@/lib/api'
import { useAlertDismissalStore } from '@/stores/alert-dismissal-store'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'

import { NotificationPopover } from '../notification-popover'

function makeAlert(overrides: Partial<ConsoleAlert> = {}): ConsoleAlert {
  return {
    id: 1,
    title: 'Weekly update',
    content: 'Gemini models now cost less.',
    level: 'info',
    dismissible: true,
    enabled: true,
    ...overrides,
  }
}

/** Answers the requests behind the bell; returns the `api.get` spy. */
function mockBellRequests(sources: {
  alerts?: ConsoleAlert[]
  pastAlerts?: AlertHistoryEntry[]
  notice?: string
}) {
  return vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/alerts') {
      return { data: { success: true, data: sources.alerts ?? [] } }
    }
    if (url === '/api/alerts/history') {
      return { data: { success: true, data: sources.pastAlerts ?? [] } }
    }
    if (url === '/api/notice') {
      return { data: { success: true, data: sources.notice ?? '' } }
    }
    if (url === '/api/status') {
      return { data: { success: true, data: { announcements_enabled: false } } }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

function signIn() {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
}

/** The header wiring from AppHeader. */
function Bell() {
  const notifications = useNotifications()
  return (
    <NotificationPopover
      open={notifications.popoverOpen}
      onOpenChange={notifications.setPopoverOpen}
      unreadCount={notifications.unreadCount}
      activeTab={notifications.activeTab}
      onTabChange={notifications.setActiveTab}
      tabs={notifications.tabs}
      alerts={notifications.alerts}
      pastAlerts={notifications.pastAlerts}
      notice={notifications.notice}
      announcements={notifications.announcements}
      loading={notifications.loading}
    />
  )
}

function renderBell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Bell />
    </QueryClientProvider>
  )
  return { client, bell: screen.getByRole('button', { name: 'Notifications' }) }
}

// jsdom lacks the Web Animations API the popover's scroll area waits on.
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

afterAll(() => {
  if (getAnimationsDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      getAnimationsDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

beforeEach(() => {
  useAlertDismissalStore.setState({ dismissedKeys: [] })
  useNotificationStore.setState({
    lastReadNotice: '',
    readAnnouncementKeys: [],
    readAlertKeys: [],
  })
})

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  window.localStorage.clear()
})

test('an alert closed on the console banner is still listed in the bell', async () => {
  signIn()
  useAlertDismissalStore.setState({
    dismissedKeys: [getAlertDismissKey(makeAlert())],
  })
  mockBellRequests({ alerts: [makeAlert()] })
  const { bell } = renderBell()

  await userEvent.click(bell)

  const list = await screen.findByRole('list', { name: 'Site alerts' })
  expect(within(list).getByText('Weekly update')).toBeInTheDocument()
  expect(
    within(list).getByText('Gemini models now cost less.')
  ).toBeInTheDocument()
})

test('alerts as the only source are shown without a tab bar', async () => {
  signIn()
  mockBellRequests({ alerts: [makeAlert()] })
  const { bell } = renderBell()

  await userEvent.click(bell)

  expect(
    await screen.findByRole('list', { name: 'Site alerts' })
  ).toBeInTheDocument()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
})

test('the badge counts unread alerts and clears once the bell is opened', async () => {
  signIn()
  mockBellRequests({
    alerts: [makeAlert(), makeAlert({ id: 2, title: 'Top-up bonus' })],
  })
  const { bell } = renderBell()

  expect(await within(bell).findByText('2')).toBeInTheDocument()
  await userEvent.click(bell)
  await screen.findByRole('list', { name: 'Site alerts' })

  expect(within(bell).queryByText('2')).not.toBeInTheDocument()
})

test('an alert closed on the console banner does not count as unread', async () => {
  signIn()
  useAlertDismissalStore.setState({
    dismissedKeys: [getAlertDismissKey(makeAlert())],
  })
  mockBellRequests({
    alerts: [makeAlert(), makeAlert({ id: 2, title: 'Top-up bonus' })],
  })
  const { bell } = renderBell()

  expect(await within(bell).findByText('1')).toBeInTheDocument()
})

test('an edited alert counts as unread again after it was read', async () => {
  signIn()
  useNotificationStore.setState({
    readAlertKeys: [getAlertDismissKey(makeAlert())],
  })
  mockBellRequests({
    alerts: [makeAlert({ content: 'Top-ups over 100 get 5% off.' })],
  })
  const { bell } = renderBell()

  expect(await within(bell).findByText('1')).toBeInTheDocument()
})

test('the bell opens on the first tab that has unread items', async () => {
  signIn()
  useNotificationStore.setState({
    readAlertKeys: [getAlertDismissKey(makeAlert())],
  })
  mockBellRequests({ alerts: [makeAlert()], notice: 'Site notice' })
  const { bell } = renderBell()

  expect(await within(bell).findByText('1')).toBeInTheDocument()
  await userEvent.click(bell)

  expect(await screen.findByRole('tab', { name: 'Notice' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveAttribute(
    'aria-selected',
    'false'
  )
})

test('alerts that ended or were deleted are listed as past alerts and are not unread', async () => {
  signIn()
  const get = mockBellRequests({
    pastAlerts: [
      {
        id: 7,
        title: 'Top-up bonus',
        content: '5% off top-ups over 100',
        level: 'success',
        publishedAt: '2026-11-20T00:00:00Z',
      },
    ],
  })
  const { bell } = renderBell()
  await waitFor(() =>
    expect(get.mock.calls.map((call) => call[0])).toContain(
      '/api/alerts/history'
    )
  )

  await userEvent.click(bell)

  const past = await screen.findByRole('list', { name: 'Past alerts' })
  expect(within(past).getByText('Top-up bonus')).toBeInTheDocument()
  expect(within(bell).queryByText('1')).not.toBeInTheDocument()
})

test('visitors who are not signed in never request alerts', async () => {
  const get = mockBellRequests({ alerts: [makeAlert()], notice: 'Site notice' })
  const { client } = renderBell()

  await waitFor(() =>
    expect(get.mock.calls.map((call) => call[0])).toContain('/api/notice')
  )
  expect(get.mock.calls.map((call) => call[0])).not.toContain('/api/alerts')
  expect(get.mock.calls.map((call) => call[0])).not.toContain(
    '/api/alerts/history'
  )
  expect(client.getQueryState(CONSOLE_ALERTS_QUERY_KEY)?.fetchStatus).toBe(
    'idle'
  )
})
