import { useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ALERT_LEVEL_META,
  ALERT_STATUS_META,
  CONSOLE_ALERTS_QUERY_KEY,
  MAX_ALERTS,
} from '@/features/console-alerts/constants'
import { getAlertStatus } from '@/features/console-alerts/lib/alert-status'
import type { ConsoleAlert } from '@/features/console-alerts/types'
import dayjs from '@/lib/dayjs'

import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { AlertFormDialog } from './alert-form-dialog'
import type { AlertFormValues } from './alert-schema'

const SCHEDULE_FORMAT = 'YYYY-MM-DD HH:mm'

type AlertsSectionProps = {
  /** Stored `console_setting.alerts` JSON. */
  data: string
}

export function AlertsSection(props: AlertsSectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const updateOption = useUpdateOption()
  const [alerts, setAlerts] = useState<ConsoleAlert[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingAlert, setEditingAlert] = useState<ConsoleAlert | null>(null)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<number[]>([])

  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(props.data || '[]')
      setAlerts(Array.isArray(parsed) ? (parsed as ConsoleAlert[]) : [])
    } catch {
      setAlerts([])
    }
    setHasChanges(false)
    setSelectedIds([])
  }, [props.data])

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) => b.id - a.id),
    [alerts]
  )

  const openForm = (alert: ConsoleAlert | null) => {
    setEditingAlert(alert)
    setFormOpen(true)
  }

  const handleSubmit = (values: AlertFormValues) => {
    const id =
      editingAlert?.id ?? Math.max(0, ...alerts.map((alert) => alert.id)) + 1
    const next: ConsoleAlert = {
      id,
      ...(values.title ? { title: values.title } : {}),
      content: values.content,
      level: values.level,
      dismissible: values.dismissible,
      enabled: values.enabled,
      ...(values.startsAt ? { startsAt: values.startsAt } : {}),
      ...(values.endsAt ? { endsAt: values.endsAt } : {}),
    }
    setAlerts((prev) =>
      editingAlert
        ? prev.map((alert) => (alert.id === id ? next : alert))
        : [...prev, next]
    )
    setHasChanges(true)
    setFormOpen(false)
  }

  const confirmDelete = () => {
    setAlerts((prev) =>
      prev.filter((alert) => !pendingDeleteIds.includes(alert.id))
    )
    setSelectedIds((prev) =>
      prev.filter((id) => !pendingDeleteIds.includes(id))
    )
    setPendingDeleteIds([])
    setHasChanges(true)
  }

  const handleSave = () => {
    updateOption.mutate(
      { key: 'console_setting.alerts', value: JSON.stringify(alerts) },
      {
        onSuccess: () => {
          setHasChanges(false)
          queryClient.invalidateQueries({ queryKey: CONSOLE_ALERTS_QUERY_KEY })
        },
      }
    )
  }

  const toggleSelected = (id: number, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((selected) => selected !== id)
    )
  }

  const now = Date.now()

  return (
    <SettingsSection title={t('Alerts')}>
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            onClick={() => openForm(null)}
            disabled={alerts.length >= MAX_ALERTS}
          >
            <Plus className='mr-2 h-4 w-4' />
            {t('Add Alert')}
          </Button>
          <Button
            size='sm'
            variant='destructive'
            disabled={selectedIds.length === 0}
            onClick={() => setPendingDeleteIds(selectedIds)}
          >
            <Trash2 className='mr-2 h-4 w-4' />
            {t('Delete selected ({{count}})', { count: selectedIds.length })}
          </Button>
          <Button
            size='sm'
            variant='secondary'
            disabled={!hasChanges || updateOption.isPending}
            onClick={handleSave}
          >
            <Save className='mr-2 h-4 w-4' />
            {updateOption.isPending ? t('Saving...') : t('Save Settings')}
          </Button>
          {hasChanges ? (
            <span className='text-muted-foreground text-xs'>
              {t('You have unsaved changes')}
            </span>
          ) : null}
        </div>

        <StaticDataTable
          data={sortedAlerts}
          getRowKey={(alert) => alert.id}
          emptyContent={t('No alerts yet. Click "Add Alert" to create one.')}
          columns={[
            {
              id: 'select',
              className: 'w-12',
              header: (
                <Checkbox
                  checked={
                    alerts.length > 0 && selectedIds.length === alerts.length
                  }
                  onCheckedChange={(checked) =>
                    setSelectedIds(
                      checked ? alerts.map((alert) => alert.id) : []
                    )
                  }
                />
              ),
              cell: (alert) => (
                <Checkbox
                  checked={selectedIds.includes(alert.id)}
                  onCheckedChange={(checked) =>
                    toggleSelected(alert.id, checked === true)
                  }
                />
              ),
            },
            {
              id: 'alert',
              header: t('Alert'),
              cell: (alert) => (
                <div className='flex max-w-md flex-col gap-0.5'>
                  {alert.title ? (
                    <span className='truncate text-sm font-medium'>
                      {alert.title}
                    </span>
                  ) : null}
                  <span className='text-muted-foreground truncate text-xs'>
                    {alert.content}
                  </span>
                </div>
              ),
            },
            {
              id: 'level',
              header: t('Level'),
              cell: (alert) => (
                <StatusBadge
                  label={t(ALERT_LEVEL_META[alert.level].labelKey)}
                  variant={ALERT_LEVEL_META[alert.level].badgeVariant}
                  copyable={false}
                />
              ),
            },
            {
              id: 'status',
              header: t('Status'),
              cell: (alert) => {
                const status = ALERT_STATUS_META[getAlertStatus(alert, now)]
                return (
                  <StatusBadge
                    label={t(status.labelKey)}
                    variant={status.badgeVariant}
                    copyable={false}
                  />
                )
              },
            },
            {
              id: 'schedule',
              header: t('Schedule'),
              cell: (alert) => {
                if (!alert.startsAt && !alert.endsAt) {
                  return (
                    <span className='text-muted-foreground text-xs'>
                      {t('Always')}
                    </span>
                  )
                }
                return (
                  <div className='flex flex-col gap-0.5 text-xs'>
                    {alert.startsAt ? (
                      <span>
                        {t('Starts {{time}}', {
                          time: dayjs(alert.startsAt).format(SCHEDULE_FORMAT),
                        })}
                      </span>
                    ) : null}
                    {alert.endsAt ? (
                      <span>
                        {t('Ends {{time}}', {
                          time: dayjs(alert.endsAt).format(SCHEDULE_FORMAT),
                        })}
                      </span>
                    ) : null}
                  </div>
                )
              },
            },
            {
              id: 'dismissible',
              header: t('Dismissible'),
              cell: (alert) => (alert.dismissible ? t('Yes') : t('No')),
            },
            {
              id: 'actions',
              header: t('Actions'),
              cell: (alert) => (
                <StaticRowActions
                  editLabel={t('Edit')}
                  deleteLabel={t('Delete')}
                  menuLabel={t('Open menu')}
                  onEdit={() => openForm(alert)}
                  onDelete={() => setPendingDeleteIds([alert.id])}
                />
              ),
            },
          ]}
        />
      </div>

      <AlertFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        alert={editingAlert}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDeleteIds.length > 0}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteIds([])
        }}
        title={t('Delete alerts?')}
        desc={t(
          'This removes {{count}} alert(s) from the list. Click "Save Settings" to apply.',
          { count: pendingDeleteIds.length }
        )}
        confirmText={t('Delete')}
        destructive
        handleConfirm={confirmDelete}
      />
    </SettingsSection>
  )
}
