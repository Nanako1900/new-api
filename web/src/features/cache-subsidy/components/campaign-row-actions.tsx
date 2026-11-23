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
import {
  Calculator,
  CircleStop,
  Eye,
  ListChecks,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { getCampaignActions } from '../lib'
import type { Campaign, CampaignAction } from '../types'
import { useCacheSubsidy } from './cache-subsidy-provider'

const MENU_ITEMS: Record<
  Exclude<CampaignAction, 'edit'>,
  { labelKey: string; icon: ComponentType<{ size?: number }> }
> = {
  details: { labelKey: 'View details', icon: Eye },
  grants: { labelKey: 'View grants', icon: ListChecks },
  calculate: { labelKey: 'Start calculation', icon: Calculator },
  open: { labelKey: 'Open claims', icon: Send },
  reset: { labelKey: 'Reset to draft', icon: RotateCcw },
  close: { labelKey: 'Close claims', icon: CircleStop },
  delete: { labelKey: 'Delete', icon: Trash2 },
}

const VIEW_ACTIONS = new Set<CampaignAction>(['details', 'grants'])

export function CampaignRowActions(props: { campaign: Campaign }) {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow, setPendingAction } = useCacheSubsidy()
  const actions = getCampaignActions(props.campaign)
  const canEdit = actions.includes('edit')
  const viewItems = actions.filter((action) => VIEW_ACTIONS.has(action))
  const changeItems = actions.filter(
    (action) => action !== 'edit' && !VIEW_ACTIONS.has(action)
  )

  function runAction(action: CampaignAction) {
    if (action === 'edit' || action === 'details' || action === 'grants') {
      setCurrentRow(props.campaign)
      setOpen(action === 'edit' ? 'update' : action)
      return
    }
    setPendingAction({ campaign: props.campaign, action })
  }

  function renderItem(action: CampaignAction) {
    if (action === 'edit') return null
    const item = MENU_ITEMS[action]
    const Icon = item.icon
    return (
      <DropdownMenuItem
        key={action}
        onClick={() => runAction(action)}
        className={
          action === 'delete'
            ? 'text-destructive focus:text-destructive'
            : undefined
        }
      >
        {t(item.labelKey)}
        <DropdownMenuShortcut>
          <Icon size={16} />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
    )
  }

  return (
    <div className='-ml-1.5 flex items-center gap-1'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => runAction('edit')}
              disabled={!canEdit}
              aria-label={t('Edit')}
            />
          }
        >
          <Pencil />
        </TooltipTrigger>
        <TooltipContent>{t('Edit')}</TooltipContent>
      </Tooltip>

      <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
        {viewItems.map(renderItem)}
        {changeItems.length > 0 && <DropdownMenuSeparator />}
        {changeItems.map(renderItem)}
      </DataTableRowActionMenu>
    </div>
  )
}
