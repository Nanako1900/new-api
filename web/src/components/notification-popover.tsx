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
import type { TFunction } from 'i18next'
import { Bell, CheckCheck, CircleAlert, Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { RichContent } from '@/components/rich-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertHistoryList } from '@/features/console-alerts/components/alert-history-list'
import type { ConsoleAlert } from '@/features/console-alerts/types'
import { getAnnouncementColorClass } from '@/lib/colors'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { NotificationTab } from '@/stores/notification-store'

interface AnnouncementItem {
  id?: number | string
  type?: string
  content?: string
  extra?: string
  publishDate?: string | Date
}

interface NotificationPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unreadCount: number
  unreadAlertsCount?: number
  unreadNoticeCount?: number
  unreadAnnouncementsCount?: number
  activeTab: NotificationTab
  onTabChange: (tab: NotificationTab) => void
  showAlertsTab?: boolean
  alerts?: ConsoleAlert[]
  dismissedAlertKeys?: string[]
  onDismissAlert?: (alert: ConsoleAlert) => void
  onRestoreAlert?: (alert: ConsoleAlert) => void
  onRestoreAllAlerts?: () => void
  onMarkAllRead?: () => void
  notice: string
  announcements: AnnouncementItem[]
  loading: boolean
  className?: string
}

/**
 * Get relative time string from a date
 */
function getRelativeTime(publishDate: string | Date, t: TFunction): string {
  if (!publishDate) return ''

  const now = new Date()
  const pubDate = new Date(publishDate)

  // If invalid date, return original string
  if (Number.isNaN(pubDate.getTime())) {
    return typeof publishDate === 'string' ? publishDate : ''
  }

  const diffMs = now.getTime() - pubDate.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  // If future time, show specific date
  if (diffMs < 0) return formatDateTimeObject(pubDate)

  // Return relative time based on difference
  if (diffSeconds < 60) return t('Just now')
  if (diffMinutes < 60) {
    return diffMinutes === 1
      ? t('1 minute ago')
      : t('{{count}} minutes ago', { count: diffMinutes })
  }
  if (diffHours < 24) {
    return diffHours === 1
      ? t('1 hour ago')
      : t('{{count}} hours ago', { count: diffHours })
  }
  if (diffDays < 7) {
    return diffDays === 1
      ? t('1 day ago')
      : t('{{count}} days ago', { count: diffDays })
  }
  if (diffWeeks < 4) {
    return diffWeeks === 1
      ? t('1 week ago')
      : t('{{count}} weeks ago', { count: diffWeeks })
  }
  if (diffMonths < 12) {
    return diffMonths === 1
      ? t('1 month ago')
      : t('{{count}} months ago', { count: diffMonths })
  }
  if (diffYears < 2) return t('1 year ago')

  // Over 2 years, show specific date
  return formatDateTimeObject(pubDate)
}

/**
 * Announcement status dot indicator
 */
function AnnouncementDot({ type }: { type?: string }) {
  return (
    <span
      className={cn(
        'mt-1.5 inline-block size-2 shrink-0 rounded-full',
        getAnnouncementColorClass(type)
      )}
    />
  )
}

function getAnnouncementRenderKey(announcement: AnnouncementItem): string {
  if (announcement.id !== undefined && announcement.id !== null) {
    return `id:${announcement.id}`
  }

  return JSON.stringify({
    content: announcement.content ?? '',
    extra: announcement.extra ?? '',
    publishDate: announcement.publishDate ?? '',
    type: announcement.type ?? '',
  })
}

/**
 * Notice tab content
 */
function NoticeContent(props: {
  notice: string
  loading: boolean
  t: TFunction
}) {
  if (props.loading) {
    return (
      <EmptyState
        icon={Bell}
        title={props.t('Loading...')}
        description={props.t('Latest platform updates and notices')}
        className='min-h-48 border-0 p-4'
      />
    )
  }

  if (!props.notice) {
    return (
      <EmptyState
        icon={Bell}
        title={props.t('No announcements at this time')}
        className='min-h-48 border-0 p-4'
      />
    )
  }

  return (
    <ScrollArea className='h-[min(52vh,28rem)] pr-3'>
      <RichContent breaks content={props.notice} />
    </ScrollArea>
  )
}

/**
 * Announcements tab content
 */
function AnnouncementsContent(props: {
  announcements: AnnouncementItem[]
  loading: boolean
  t: TFunction
}) {
  if (props.loading) {
    return (
      <EmptyState
        icon={Megaphone}
        title={props.t('Loading...')}
        description={props.t('Latest platform updates and notices')}
        className='min-h-48 border-0 p-4'
      />
    )
  }

  if (props.announcements.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title={props.t('No system announcements')}
        className='min-h-48 border-0 p-4'
      />
    )
  }

  return (
    <ScrollArea className='h-[min(52vh,28rem)] pr-3'>
      <div className='flex flex-col'>
        {props.announcements.map((item, idx) => {
          const announcementKey = getAnnouncementRenderKey(item)
          const publishDate = item.publishDate
            ? new Date(item.publishDate)
            : null
          const relativeTime = publishDate
            ? getRelativeTime(publishDate, props.t)
            : ''
          const absoluteTime = publishDate
            ? formatDateTimeObject(publishDate)
            : ''

          return (
            <div key={announcementKey}>
              <div className='py-3'>
                <div className='flex items-start gap-3'>
                  <AnnouncementDot type={item.type} />
                  <div className='flex min-w-0 flex-1 flex-col gap-2'>
                    <div className='text-sm'>
                      <RichContent breaks content={item.content || ''} />
                    </div>

                    {item.extra ? (
                      <div className='text-muted-foreground text-xs'>
                        <RichContent breaks content={item.extra} />
                      </div>
                    ) : null}

                    {absoluteTime ? (
                      <div className='text-muted-foreground text-xs'>
                        {relativeTime ? `${relativeTime} • ` : null}
                        {absoluteTime}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              {idx < props.announcements.length - 1 ? <Separator /> : null}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

/**
 * Notification popover with Site Alerts, Notice and Timeline tabs
 */
export function NotificationPopover(props: NotificationPopoverProps) {
  const { t } = useTranslation()
  const showAlertsTab = props.showAlertsTab ?? false
  const unreadAlerts = props.unreadAlertsCount ?? 0
  const unreadNotice = props.unreadNoticeCount ?? 0
  const unreadAnnouncements = props.unreadAnnouncementsCount ?? 0

  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            className={cn('relative size-9', props.className)}
            aria-label={t('Notifications')}
          />
        }
      >
        <Bell className='size-[1.2rem]' aria-hidden='true' />
        {props.unreadCount > 0 ? (
          <Badge
            variant='destructive'
            className='absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-semibold tabular-nums'
          >
            {props.unreadCount > 99 ? '99+' : props.unreadCount}
          </Badge>
        ) : null}
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={8}
        className='w-[min(26rem,calc(100vw-1rem))] gap-3 p-3'
      >
        <div className='flex items-start justify-between gap-2 px-1'>
          <PopoverHeader className='gap-1'>
            <PopoverTitle>{t('System Announcements')}</PopoverTitle>
            <p className='text-muted-foreground text-xs'>
              {t('Latest platform updates and notices')}
            </p>
          </PopoverHeader>
          {props.unreadCount > 0 && props.onMarkAllRead ? (
            <Button
              type='button'
              variant='ghost'
              size='xs'
              className='text-muted-foreground hover:text-foreground shrink-0 gap-1 text-xs'
              onClick={props.onMarkAllRead}
            >
              <CheckCheck aria-hidden='true' className='size-3.5' />
              {t('Mark all read')}
            </Button>
          ) : null}
        </div>

        <Tabs
          value={props.activeTab}
          onValueChange={props.onTabChange as (value: string) => void}
        >
          <TabsList
            className={cn(
              'grid w-full',
              showAlertsTab ? 'grid-cols-3' : 'grid-cols-2'
            )}
          >
            {showAlertsTab ? (
              <TabsTrigger value='alerts' className='gap-1.5'>
                <CircleAlert aria-hidden='true' className='size-3.5' />
                <span className='truncate'>{t('Alerts')}</span>
                {unreadAlerts > 0 ? (
                  <span
                    aria-hidden='true'
                    className='bg-destructive size-1.5 shrink-0 rounded-full'
                  />
                ) : null}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value='notice' className='gap-1.5'>
              <Bell aria-hidden='true' className='size-3.5' />
              <span className='truncate'>{t('Notice')}</span>
              {unreadNotice > 0 ? (
                <span
                  aria-hidden='true'
                  className='bg-destructive size-1.5 shrink-0 rounded-full'
                />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value='announcements' className='gap-1.5'>
              <Megaphone aria-hidden='true' className='size-3.5' />
              <span className='truncate'>{t('Timeline')}</span>
              {unreadAnnouncements > 0 ? (
                <span
                  aria-hidden='true'
                  className='bg-destructive size-1.5 shrink-0 rounded-full'
                />
              ) : null}
            </TabsTrigger>
          </TabsList>

          {showAlertsTab ? (
            <TabsContent value='alerts' className='mt-2'>
              <AlertHistoryList
                alerts={props.alerts ?? []}
                dismissedKeys={props.dismissedAlertKeys ?? []}
                loading={props.loading}
                onDismissAlert={props.onDismissAlert}
                onRestoreAlert={props.onRestoreAlert}
                onRestoreAllAlerts={props.onRestoreAllAlerts}
              />
            </TabsContent>
          ) : null}

          <TabsContent value='notice' className='mt-2'>
            <NoticeContent
              notice={props.notice}
              loading={props.loading}
              t={t}
            />
          </TabsContent>

          <TabsContent value='announcements' className='mt-2'>
            <AnnouncementsContent
              announcements={props.announcements}
              loading={props.loading}
              t={t}
            />
          </TabsContent>
        </Tabs>

        <div className='flex justify-end'>
          <Button size='sm' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
