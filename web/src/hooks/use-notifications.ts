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
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'

import {
  activeAlertsQueryOptions,
  alertHistoryQueryOptions,
} from '@/features/console-alerts/api'
import { getAlertDismissKey } from '@/features/console-alerts/lib/dismiss-key'
import type {
  AlertHistoryEntry,
  ConsoleAlert,
} from '@/features/console-alerts/types'
import { useStatus } from '@/hooks/use-status'
import { getNotice } from '@/lib/api'
import { hashString } from '@/lib/hash'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAlertDismissalStore } from '@/stores/alert-dismissal-store'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'

/** Bell tabs: console alerts, the Notice text and the announcement timeline. */
export type NotificationTab = 'alerts' | 'notice' | 'announcements'

const NO_ALERTS: ConsoleAlert[] = []
const NO_PAST_ALERTS: AlertHistoryEntry[] = []

/**
 * Generate a unique key for an announcement
 * Prefer backend id, fall back to a content hash so edits register
 */
function getAnnouncementKey(item: Record<string, unknown>): string {
  if (!item) return ''

  if (item.id !== undefined && item.id !== null) {
    return `id:${item.id}`
  }

  const fingerprint = JSON.stringify({
    publishDate: (item?.publishDate as string) || '',
    content: ((item?.content as string) || '').trim(),
    extra: ((item?.extra as string) || '').trim(),
    type: (item?.type as string) || '',
    title: ((item?.title as string) || '').trim(),
    link: ((item?.link as string) || '').trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

/**
 * Hook to manage notifications (console alerts, Notice and Announcements)
 * Provides unread counts and read status management
 */
export function useNotifications() {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<NotificationTab>('alerts')

  // Fetch Notice from API
  const {
    data: noticeResponse,
    isLoading: noticeLoading,
    refetch: refetchNotice,
  } = useQuery({
    queryKey: ['notice'],
    queryFn: async () => requireServerSuccess(await getNotice()),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Fetch Announcements from status
  const { status, loading: statusLoading } = useStatus()
  const announcementsEnabled = status?.announcements_enabled ?? false
  const announcements = useMemo<Record<string, unknown>[]>(() => {
    if (!announcementsEnabled) return []
    return ((status?.announcements || []) as Record<string, unknown>[]).slice(
      0,
      20
    )
  }, [announcementsEnabled, status?.announcements])

  // Console alerts: the list behind the console banner, including the ones
  // closed there. `/api/alerts` needs a session, so visitors skip it.
  const signedIn = useAuthStore((s) => !!s.auth.user)
  const alertsQuery = useQuery({
    ...activeAlertsQueryOptions,
    enabled: signedIn,
  })
  const alerts = (signedIn && alertsQuery.data) || NO_ALERTS
  const dismissedAlertKeys = useAlertDismissalStore((s) => s.dismissedKeys)
  // Alerts that ended or were deleted; already seen, so never unread
  const historyQuery = useQuery({
    ...alertHistoryQueryOptions,
    enabled: signedIn,
  })
  const pastAlerts = (signedIn && historyQuery.data) || NO_PAST_ALERTS

  // Notification store
  const {
    lastReadNotice,
    readAlertKeys,
    markNoticeRead,
    markAnnouncementsRead,
    markAlertsRead,
    isAnnouncementRead,
  } = useNotificationStore()

  // Extract notice content
  const noticeContent = noticeResponse?.success
    ? (noticeResponse.data || '').trim()
    : ''

  // Tabs with something to show, in display order
  const tabs = useMemo(() => {
    const available: NotificationTab[] = []
    if (alerts.length > 0 || pastAlerts.length > 0) available.push('alerts')
    if (noticeContent) available.push('notice')
    if (announcements.length > 0) available.push('announcements')
    return available
  }, [alerts.length, pastAlerts.length, noticeContent, announcements.length])

  // Calculate unread counts
  const unreadCounts = useMemo(() => {
    const noticeUnread =
      noticeContent && noticeContent !== lastReadNotice ? 1 : 0

    const announcementsUnread = announcements.filter(
      (item: Record<string, unknown>) => {
        const key = getAnnouncementKey(item)
        return !isAnnouncementRead(key)
      }
    ).length

    // Closing an alert on the banner counts as reading it
    const alertsUnread = alerts.filter((alert) => {
      const key = getAlertDismissKey(alert)
      return !readAlertKeys.includes(key) && !dismissedAlertKeys.includes(key)
    }).length

    return {
      alerts: alertsUnread,
      notice: noticeUnread,
      announcements: announcementsUnread,
      total: alertsUnread + noticeUnread + announcementsUnread,
    }
  }, [
    noticeContent,
    lastReadNotice,
    announcements,
    isAnnouncementRead,
    alerts,
    readAlertKeys,
    dismissedAlertKeys,
  ])

  const markAnnouncementsAsRead = () => {
    if (announcements.length > 0) {
      const allKeys = announcements.map((item: Record<string, unknown>) =>
        getAnnouncementKey(item)
      )
      markAnnouncementsRead(allKeys)
    }
  }

  const markTabRead = (tab: NotificationTab) => {
    if (tab === 'announcements') {
      markAnnouncementsAsRead()
    }
    if (tab === 'alerts' && alerts.length > 0) {
      markAlertsRead(alerts.map((alert) => getAlertDismissKey(alert)))
    }
  }

  // Handle popover open. Without a tab, open the first one with unread items,
  // else stay on the last tab while it still has content.
  const handleOpenPopover = (tab?: NotificationTab) => {
    let nextTab = tab ?? tabs.find((candidate) => unreadCounts[candidate] > 0)
    if (!nextTab) {
      nextTab = tabs.includes(activeTab) ? activeTab : (tabs[0] ?? activeTab)
    }

    // Mark currently visible content as read when opening the notification center
    if (noticeContent) {
      markNoticeRead(noticeContent)
    }
    markTabRead(nextTab)

    setActiveTab(nextTab)
    setPopoverOpen(true)
  }

  const handlePopoverOpenChange = (open: boolean) => {
    if (open) {
      handleOpenPopover()
      return
    }

    setPopoverOpen(false)
  }

  // Handle tab change - mark the tab's items as read when switching to it
  const handleTabChange = (tab: NotificationTab) => {
    setActiveTab(tab)
    markTabRead(tab)
  }

  return {
    // Data
    alerts,
    pastAlerts,
    notice: noticeContent,
    announcements,
    tabs,
    loading:
      noticeLoading ||
      statusLoading ||
      (signedIn && (alertsQuery.isLoading || historyQuery.isLoading)),

    // Unread counts
    unreadCount: unreadCounts.total,
    unreadAlertsCount: unreadCounts.alerts,
    unreadNoticeCount: unreadCounts.notice,
    unreadAnnouncementsCount: unreadCounts.announcements,

    // Popover state
    popoverOpen,
    setPopoverOpen: handlePopoverOpenChange,
    activeTab,
    setActiveTab: handleTabChange,

    // Actions
    openPopover: handleOpenPopover,
    closePopover: () => setPopoverOpen(false),
    refetchNotice,
  }
}
