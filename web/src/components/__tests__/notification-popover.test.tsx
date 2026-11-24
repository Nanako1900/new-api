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
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { NotificationPopover } from '@/components/notification-popover'
import { getAlertDismissKey } from '@/features/console-alerts/lib/dismiss-key'
import type { ConsoleAlert } from '@/features/console-alerts/types'
import { useNotifications } from '@/hooks/use-notifications'
import { api } from '@/lib/api'
import { useAlertDismissalStore } from '@/stores/alert-dismissal-store'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'

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

function makeAlert(overrides: Partial<ConsoleAlert> = {}): ConsoleAlert {
  return {
    id: 1,
    title: 'Top-up bonus',
    content: 'Get **10% extra** credit today.',
    level: 'info',
    dismissible: true,
    enabled: true,
    ...overrides,
  }
}

test('shows live, dismissed, and expired alerts with restore and hide actions in the bell popover', async () => {
  const user = userEvent.setup()
  const dismissedAlert = makeAlert({ id: 1, title: 'Dismissed promo' })
  const pinnedAlert = makeAlert({
    id: 2,
    title: 'Active maintenance',
    level: 'warning',
    content: 'Scheduled maintenance tonight.',
  })
  const expiredAlert = makeAlert({
    id: 3,
    title: 'Past top-up event',
    content: 'Holiday top-up bonus has ended.',
    endsAt: '2020-01-01T00:00:00Z',
  })

  const onRestoreAlert = vi.fn()
  const onDismissAlert = vi.fn()
  const onRestoreAllAlerts = vi.fn()
  const onMarkAllRead = vi.fn()

  render(
    <NotificationPopover
      open
      onOpenChange={vi.fn()}
      unreadCount={2}
      unreadAlertsCount={1}
      unreadNoticeCount={1}
      unreadAnnouncementsCount={0}
      activeTab='alerts'
      onTabChange={vi.fn()}
      showAlertsTab
      alerts={[dismissedAlert, pinnedAlert, expiredAlert]}
      dismissedAlertKeys={[getAlertDismissKey(dismissedAlert)]}
      onDismissAlert={onDismissAlert}
      onRestoreAlert={onRestoreAlert}
      onRestoreAllAlerts={onRestoreAllAlerts}
      onMarkAllRead={onMarkAllRead}
      notice='Welcome notice'
      announcements={[]}
      loading={false}
    />
  )

  expect(screen.getByRole('tab', { name: 'Alerts' })).toBeInTheDocument()
  expect(screen.getByText('Dismissed promo')).toBeInTheDocument()
  expect(screen.getByText('Active maintenance')).toBeInTheDocument()
  expect(screen.getByText('Past top-up event')).toBeInTheDocument()
  expect(screen.getByText('Dismissed')).toBeInTheDocument()
  expect(screen.getByText('Pinned')).toBeInTheDocument()
  expect(screen.getByText('Expired')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Show at top' }))
  expect(onRestoreAlert).toHaveBeenCalledWith(dismissedAlert)

  await user.click(screen.getByRole('button', { name: 'Hide from top' }))
  expect(onDismissAlert).toHaveBeenCalledWith(pinnedAlert)

  await user.click(screen.getByRole('button', { name: 'Restore all' }))
  expect(onRestoreAllAlerts).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: 'Mark all read' }))
  expect(onMarkAllRead).toHaveBeenCalledTimes(1)
})

test('hides the Alerts tab and Mark all read button when signed out with no unread items', () => {
  render(
    <NotificationPopover
      open
      onOpenChange={vi.fn()}
      unreadCount={0}
      activeTab='notice'
      onTabChange={vi.fn()}
      showAlertsTab={false}
      onMarkAllRead={vi.fn()}
      notice='Public notice'
      announcements={[]}
      loading={false}
    />
  )

  expect(screen.queryByRole('tab', { name: 'Alerts' })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Notice' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Mark all read' })
  ).not.toBeInTheDocument()
})

beforeEach(() => {
  localStorage.clear()
  useAlertDismissalStore.setState({ dismissedKeys: [] })
  useNotificationStore.setState({
    lastReadNotice: '',
    readAnnouncementKeys: [],
    readAlertKeys: [],
    popoverOpen: false,
    activeTab: 'notice',
  })
  useAuthStore.setState((state) => ({
    ...state,
    auth: { ...state.auth, user: null },
  }))
  vi.restoreAllMocks()
})

function ConnectedBell() {
  const notifications = useNotifications()
  return (
    <NotificationPopover
      open={notifications.popoverOpen}
      onOpenChange={notifications.setPopoverOpen}
      unreadCount={notifications.unreadCount}
      unreadAlertsCount={notifications.unreadAlertsCount}
      unreadNoticeCount={notifications.unreadNoticeCount}
      unreadAnnouncementsCount={notifications.unreadAnnouncementsCount}
      activeTab={notifications.activeTab}
      onTabChange={notifications.setActiveTab}
      showAlertsTab={notifications.showAlertsTab}
      alerts={notifications.alerts}
      dismissedAlertKeys={notifications.dismissedAlertKeys}
      onDismissAlert={notifications.dismissAlert}
      onRestoreAlert={notifications.restoreAlert}
      onRestoreAllAlerts={notifications.restoreAllAlerts}
      onMarkAllRead={notifications.markAllRead}
      notice={notifications.notice}
      announcements={notifications.announcements}
      loading={notifications.loading}
    />
  )
}

test('renders an empty state in the Alerts tab when there are no published alerts', () => {
  render(
    <NotificationPopover
      open
      onOpenChange={vi.fn()}
      unreadCount={0}
      activeTab='alerts'
      onTabChange={vi.fn()}
      showAlertsTab
      alerts={[]}
      dismissedAlertKeys={[]}
      notice=''
      announcements={[]}
      loading={false}
    />
  )

  expect(screen.getByText('No site alerts')).toBeInTheDocument()
})

test('useNotifications opens to unread Alerts tab, excludes expired alerts from unread count, and marks tabs read individually', async () => {
  const user = userEvent.setup()
  const liveAlert = makeAlert({ id: 10, title: 'Live billing update' })
  const dismissedAlert = makeAlert({
    id: 11,
    title: 'Dismissed top-up promo',
    content: 'Restore me',
  })
  const expiredAlert = makeAlert({
    id: 12,
    title: 'Expired past promo',
    endsAt: '2020-01-01T00:00:00Z',
  })

  useAuthStore.setState((state) => ({
    ...state,
    auth: {
      ...state.auth,
      user: {
        id: 1,
        username: 'alice',
        display_name: 'Alice',
        role: 1,
        status: 1,
        email: 'alice@example.com',
        quota: 0,
        used_quota: 0,
        request_count: 0,
        group: 'default',
        aff_code: '',
        aff_count: 0,
        aff_quota: 0,
        aff_history_quota: 0,
        inviter_id: 0,
      },
    },
  }))
  useAlertDismissalStore.setState({
    dismissedKeys: [getAlertDismissKey(dismissedAlert)],
  })
  useNotificationStore.setState({
    activeTab: 'announcements',
  })

  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/alerts') {
      return {
        data: {
          success: true,
          data: [liveAlert, dismissedAlert, expiredAlert],
        },
      }
    }
    if (url === '/api/notice') {
      return { data: { success: true, data: 'New system notice' } }
    }
    if (url === '/api/status') {
      return {
        data: {
          success: true,
          data: { announcements_enabled: false, announcements: [] },
        },
      }
    }
    return { data: { success: true, data: null } }
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ConnectedBell />
    </QueryClientProvider>
  )

  const bellButton = screen.getByRole('button', { name: 'Notifications' })
  // 1 unread live alert (dismissed + expired are excluded) + 1 unread notice = 2
  await waitFor(() => expect(bellButton).toHaveTextContent('2'))

  await user.click(bellButton)

  // Smart default opens to Alerts tab because it has unread items; opening marks Alerts read while Notice stays unread (1 left)
  expect(await screen.findByText('Live billing update')).toBeInTheDocument()
  expect(screen.getByText('Dismissed top-up promo')).toBeInTheDocument()
  expect(screen.getByText('Expired past promo')).toBeInTheDocument()
  await waitFor(() => expect(bellButton).toHaveTextContent('1'))

  // Restoring dismissed alert updates alert dismissal store
  await user.click(screen.getByRole('button', { name: 'Show at top' }))
  expect(useAlertDismissalStore.getState().dismissedKeys).toEqual([])

  // Mark all read clears remaining unread Notice
  await user.click(screen.getByRole('button', { name: 'Mark all read' }))
  await waitFor(() => expect(bellButton).not.toHaveTextContent('1'))
})
