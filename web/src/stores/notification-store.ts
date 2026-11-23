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
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type NotificationTab = 'alerts' | 'notice' | 'announcements'

interface NotificationState {
  // Last read Notice content signature (full trimmed message)
  lastReadNotice: string
  // Array of read announcement keys (id or content hash)
  readAnnouncementKeys: string[]
  // Array of read console alert keys (id:contentHash)
  readAlertKeys: string[]
  // Timestamp of last "Close Today" action
  closedUntilDate: string | null

  // Non-persisted popover UI coordination state
  popoverOpen: boolean
  activeTab: NotificationTab

  // Actions
  markNoticeRead: (noticeContent: string) => void
  markAnnouncementsRead: (keys: string[]) => void
  markAlertsRead: (keys: string[]) => void
  pruneReadAlerts: (validKeys: string[]) => void
  setClosedUntilDate: (date: string | null) => void
  setPopoverOpen: (open: boolean) => void
  setActiveTab: (tab: NotificationTab) => void
  openNotificationTab: (tab: NotificationTab) => void
  isAnnouncementRead: (key: string) => boolean
  isAlertRead: (key: string) => boolean
  isNoticeClosed: () => boolean
}

/**
 * Notification store for tracking read status of Alerts, Notice and Announcements
 * Persists read state to localStorage to maintain state across sessions
 */
export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      lastReadNotice: '',
      readAnnouncementKeys: [],
      readAlertKeys: [],
      closedUntilDate: null,
      popoverOpen: false,
      activeTab: 'notice',

      markNoticeRead: (noticeContent: string) => {
        // Persist the full trimmed content so edits beyond 100 chars register
        const normalizedContent = noticeContent.trim()
        if (get().lastReadNotice === normalizedContent) return
        set({ lastReadNotice: normalizedContent })
      },

      markAnnouncementsRead: (keys: string[]) => {
        const existing = get().readAnnouncementKeys
        const next = [...new Set([...existing, ...keys])]
        if (next.length === existing.length) return
        set({ readAnnouncementKeys: next })
      },

      markAlertsRead: (keys: string[]) => {
        const existing = get().readAlertKeys
        const next = [...new Set([...existing, ...keys])]
        if (next.length === existing.length) return
        set({ readAlertKeys: next })
      },

      pruneReadAlerts: (validKeys: string[]) => {
        const existing = get().readAlertKeys
        const kept = existing.filter((key) => validKeys.includes(key))
        if (kept.length !== existing.length) {
          set({ readAlertKeys: kept })
        }
      },

      setClosedUntilDate: (date: string | null) => {
        set({ closedUntilDate: date })
      },

      setPopoverOpen: (open: boolean) => {
        set({ popoverOpen: open })
      },

      setActiveTab: (tab: NotificationTab) => {
        set({ activeTab: tab })
      },

      openNotificationTab: (tab: NotificationTab) => {
        set({ activeTab: tab, popoverOpen: true })
      },

      isAnnouncementRead: (key: string) => {
        return get().readAnnouncementKeys.includes(key)
      },

      isAlertRead: (key: string) => {
        return get().readAlertKeys.includes(key)
      },

      isNoticeClosed: () => {
        const { closedUntilDate } = get()
        if (!closedUntilDate) return false

        const today = new Date().toDateString()
        return closedUntilDate === today
      },
    }),
    {
      name: 'notification-storage',
      partialize: (state) => ({
        lastReadNotice: state.lastReadNotice,
        readAnnouncementKeys: state.readAnnouncementKeys,
        readAlertKeys: state.readAlertKeys,
        closedUntilDate: state.closedUntilDate,
      }),
    }
  )
)
