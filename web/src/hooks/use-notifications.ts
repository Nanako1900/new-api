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
import { useCallback, useEffect, useMemo } from 'react'

import { getPublishedAlerts } from '@/features/console-alerts/api'
import { CONSOLE_ALERTS_HISTORY_QUERY_KEY } from '@/features/console-alerts/constants'
import { getAlertStatus } from '@/features/console-alerts/lib/alert-status'
import { getAlertDismissKey } from '@/features/console-alerts/lib/dismiss-key'
import type { ConsoleAlert } from '@/features/console-alerts/types'
import { useStatus } from '@/hooks/use-status'
import { getNotice } from '@/lib/api'
import { hashString } from '@/lib/hash'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAlertDismissalStore } from '@/stores/alert-dismissal-store'
import { useAuthStore } from '@/stores/auth-store'
import {
  useNotificationStore,
  type NotificationTab,
} from '@/stores/notification-store'

const ALERTS_STALE_TIME_MS = 60 * 1000
const ALERTS_REFETCH_INTERVAL_MS = 5 * 60 * 1000

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
 * Hook to manage notifications (Alerts + Notice + Announcements)
 * Provides unread counts, read status, and alert banner restore/dismiss actions
 */
export function useNotifications() {
  const signedIn = useAuthStore((s) => !!s.auth.user)

  // Notification store selectors
  const popoverOpen = useNotificationStore((s) => s.popoverOpen)
  const storedActiveTab = useNotificationStore((s) => s.activeTab)
  const setPopoverOpenStore = useNotificationStore((s) => s.setPopoverOpen)
  const setActiveTabStore = useNotificationStore((s) => s.setActiveTab)
  const lastReadNotice = useNotificationStore((s) => s.lastReadNotice)
  const readAnnouncementKeys = useNotificationStore(
    (s) => s.readAnnouncementKeys
  )
  const readAlertKeys = useNotificationStore((s) => s.readAlertKeys)
  const markNoticeRead = useNotificationStore((s) => s.markNoticeRead)
  const markAnnouncementsRead = useNotificationStore(
    (s) => s.markAnnouncementsRead
  )
  const markAlertsRead = useNotificationStore((s) => s.markAlertsRead)
  const pruneReadAlerts = useNotificationStore((s) => s.pruneReadAlerts)

  // Alert dismissal store selectors
  const dismissedAlertKeys = useAlertDismissalStore((s) => s.dismissedKeys)
  const dismissAlertKey = useAlertDismissalStore((s) => s.dismiss)
  const restoreAlertKey = useAlertDismissalStore((s) => s.restore)
  const restoreAllAlertKeys = useAlertDismissalStore((s) => s.restoreAll)

  // Fetch published alerts (live + expired history) when signed in
  const alertsQuery = useQuery({
    queryKey: CONSOLE_ALERTS_HISTORY_QUERY_KEY,
    queryFn: async () =>
      requireServerSuccess(await getPublishedAlerts()).data ?? [],
    enabled: signedIn,
    staleTime: ALERTS_STALE_TIME_MS,
    refetchInterval: ALERTS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    meta: { errorToast: false },
  })

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

  const alerts = useMemo<ConsoleAlert[]>(() => {
    if (!signedIn) return []
    return alertsQuery.data ?? []
  }, [signedIn, alertsQuery.data])

  useEffect(() => {
    if (signedIn && alertsQuery.data) {
      pruneReadAlerts(
        alertsQuery.data.map((alert) => getAlertDismissKey(alert))
      )
    }
  }, [signedIn, alertsQuery.data, pruneReadAlerts])

  // Extract notice content
  const noticeContent = noticeResponse?.success
    ? (noticeResponse.data || '').trim()
    : ''

  const effectiveTab: NotificationTab =
    !signedIn && storedActiveTab === 'alerts' ? 'notice' : storedActiveTab

  // Classify live alerts (re-evaluated when alerts change or popover toggles)
  const liveAlerts = useMemo(() => {
    const now = Date.now()
    return alerts.filter((alert) => getAlertStatus(alert, now) === 'live')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, popoverOpen])

  // Calculate unread counts
  const unreadCounts = useMemo(() => {
    const alertsUnread = liveAlerts.filter((alert) => {
      const key = getAlertDismissKey(alert)
      const isDismissed = alert.dismissible && dismissedAlertKeys.includes(key)
      return !isDismissed && !readAlertKeys.includes(key)
    }).length

    const noticeUnread =
      noticeContent && noticeContent !== lastReadNotice ? 1 : 0

    const announcementsUnread = announcements.filter(
      (item: Record<string, unknown>) => {
        const key = getAnnouncementKey(item)
        return !readAnnouncementKeys.includes(key)
      }
    ).length

    return {
      alerts: alertsUnread,
      notice: noticeUnread,
      announcements: announcementsUnread,
      total: alertsUnread + noticeUnread + announcementsUnread,
    }
  }, [
    liveAlerts,
    dismissedAlertKeys,
    readAlertKeys,
    noticeContent,
    lastReadNotice,
    announcements,
    readAnnouncementKeys,
  ])

  // Mark active tab's items as read whenever the popover is open on that tab
  useEffect(() => {
    if (!popoverOpen) return

    if (effectiveTab === 'alerts') {
      if (liveAlerts.length > 0) {
        markAlertsRead(liveAlerts.map((alert) => getAlertDismissKey(alert)))
      }
      return
    }

    if (effectiveTab === 'notice') {
      if (noticeContent) {
        markNoticeRead(noticeContent)
      }
      return
    }

    if (effectiveTab === 'announcements' && announcements.length > 0) {
      markAnnouncementsRead(
        announcements.map((item) => getAnnouncementKey(item))
      )
    }
  }, [
    popoverOpen,
    effectiveTab,
    liveAlerts,
    noticeContent,
    announcements,
    markAlertsRead,
    markNoticeRead,
    markAnnouncementsRead,
  ])

  const pickDefaultTab = useCallback((): NotificationTab => {
    const tabUnread: Record<NotificationTab, number> = {
      alerts: unreadCounts.alerts,
      notice: unreadCounts.notice,
      announcements: unreadCounts.announcements,
    }
    if (tabUnread[effectiveTab] > 0) return effectiveTab

    if (signedIn && unreadCounts.alerts > 0) return 'alerts'
    if (unreadCounts.notice > 0) return 'notice'
    if (unreadCounts.announcements > 0) return 'announcements'

    const tabHasContent: Record<NotificationTab, boolean> = {
      alerts: signedIn && alerts.length > 0,
      notice: noticeContent.length > 0,
      announcements: announcements.length > 0,
    }
    if (tabHasContent[effectiveTab]) return effectiveTab

    if (tabHasContent.alerts) return 'alerts'
    if (tabHasContent.notice) return 'notice'
    if (tabHasContent.announcements) return 'announcements'
    return effectiveTab
  }, [
    effectiveTab,
    signedIn,
    unreadCounts,
    alerts.length,
    noticeContent,
    announcements.length,
  ])

  const handleOpenPopover = useCallback(
    (tab?: NotificationTab) => {
      const requestedTab =
        tab && (tab !== 'alerts' || signedIn) ? tab : pickDefaultTab()
      setActiveTabStore(requestedTab)
      setPopoverOpenStore(true)
    },
    [signedIn, pickDefaultTab, setActiveTabStore, setPopoverOpenStore]
  )

  const handlePopoverOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        handleOpenPopover()
        return
      }
      setPopoverOpenStore(false)
    },
    [handleOpenPopover, setPopoverOpenStore]
  )

  const handleTabChange = useCallback(
    (tab: NotificationTab) => {
      if (tab === 'alerts' && !signedIn) return
      setActiveTabStore(tab)
    },
    [signedIn, setActiveTabStore]
  )

  const markAllRead = useCallback(() => {
    if (liveAlerts.length > 0) {
      markAlertsRead(liveAlerts.map((alert) => getAlertDismissKey(alert)))
    }
    if (noticeContent) {
      markNoticeRead(noticeContent)
    }
    if (announcements.length > 0) {
      markAnnouncementsRead(
        announcements.map((item) => getAnnouncementKey(item))
      )
    }
  }, [
    liveAlerts,
    noticeContent,
    announcements,
    markAlertsRead,
    markNoticeRead,
    markAnnouncementsRead,
  ])

  const dismissAlert = useCallback(
    (alert: ConsoleAlert) => {
      const key = getAlertDismissKey(alert)
      dismissAlertKey(key)
      markAlertsRead([key])
    },
    [dismissAlertKey, markAlertsRead]
  )

  const restoreAlert = useCallback(
    (alert: ConsoleAlert) => {
      restoreAlertKey(getAlertDismissKey(alert))
    },
    [restoreAlertKey]
  )

  return {
    // Data
    showAlertsTab: signedIn,
    alerts,
    dismissedAlertKeys,
    notice: noticeContent,
    announcements,
    loading:
      noticeLoading || statusLoading || (signedIn && alertsQuery.isLoading),

    // Unread counts
    unreadCount: unreadCounts.total,
    unreadAlertsCount: unreadCounts.alerts,
    unreadNoticeCount: unreadCounts.notice,
    unreadAnnouncementsCount: unreadCounts.announcements,

    // Popover state
    popoverOpen,
    setPopoverOpen: handlePopoverOpenChange,
    activeTab: effectiveTab,
    setActiveTab: handleTabChange,

    // Actions
    openPopover: handleOpenPopover,
    closePopover: () => setPopoverOpenStore(false),
    markAllRead,
    dismissAlert,
    restoreAlert,
    restoreAllAlerts: restoreAllAlertKeys,
    refetchNotice,
  }
}
