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
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { Button } from '@/components/ui/button'
import {
  ALERT_LEVELS,
  CONSOLE_ALERTS_QUERY_KEY,
  MAX_ALERTS,
} from '@/features/console-alerts/constants'
import type { ConsoleAlert } from '@/features/console-alerts/types'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { AlertFormDialog } from './alert-form-dialog'
import type { AlertFormValues } from './alert-schema'
import { buildAlertColumns } from './alerts-table-columns'

/** Parses stored alerts, dropping entries the list cannot render. */
function parseStoredAlerts(data: string): ConsoleAlert[] {
  try {
    const parsed: unknown = JSON.parse(data || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ConsoleAlert =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'number' &&
        ALERT_LEVELS.includes(item.level)
    )
  } catch {
    return []
  }
}

type AlertsSectionProps = {
  /** Stored `console_setting.alerts` JSON. */
  data: string
}

export function AlertsSection(props: AlertsSectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const updateOption = useUpdateOption()
  const [alerts, setAlerts] = useState<ConsoleAlert[]>(() =>
    parseStoredAlerts(props.data)
  )
  const [hasChanges, setHasChanges] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingAlert, setEditingAlert] = useState<ConsoleAlert | null>(null)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<number[]>([])

  useEffect(() => {
    setAlerts(parseStoredAlerts(props.data))
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
    // Ids are never reused after a delete: dismissals are keyed by id plus
    // content, so a recycled id with the same text would stay dismissed.
    const id =
      editingAlert?.id ??
      Math.max(Date.now(), ...alerts.map((alert) => alert.id + 1))
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
      <FormNavigationGuard when={hasChanges} />
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            onClick={() => openForm(null)}
            disabled={alerts.length >= MAX_ALERTS || updateOption.isPending}
          >
            <Plus className='mr-2 h-4 w-4' />
            {t('Add Alert')}
          </Button>
          <Button
            size='sm'
            variant='destructive'
            disabled={selectedIds.length === 0 || updateOption.isPending}
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
          <FormDirtyIndicator isDirty={hasChanges} />
        </div>

        <StaticDataTable
          data={sortedAlerts}
          getRowKey={(alert) => alert.id}
          emptyContent={t('No alerts yet. Click "Add Alert" to create one.')}
          columns={buildAlertColumns({
            t,
            alerts,
            selectedIds,
            now,
            actionsDisabled: updateOption.isPending,
            onToggleAll: (checked) =>
              setSelectedIds(checked ? alerts.map((alert) => alert.id) : []),
            onToggleOne: toggleSelected,
            onEdit: openForm,
            onDelete: (alert) => setPendingDeleteIds([alert.id]),
          })}
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
