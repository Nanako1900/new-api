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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getApiKey, updateApiKey } from '../../api'
import { ERROR_MESSAGES } from '../../constants'
import {
  keyGroupUpdate,
  MEOW_KEY_LIST_KEY,
  type MeowKeyList,
} from '../../lib/meow-keys'
import type { ApiKey } from '../../types'
import {
  ApiKeyGroupCombobox,
  type ApiKeyGroupOption,
} from '../api-key-group-combobox'

/** Switches a key's group right in its list row. */
export function MeowKeyGroupPicker(props: {
  apiKey: ApiKey
  groups: ApiKeyGroupOption[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (group: string): Promise<ApiKey> => {
      const latest = requireServerSuccess(await getApiKey(props.apiKey.id))
      if (!latest.data) {
        throw createServerError(latest, t(ERROR_MESSAGES.UPDATE_FAILED))
      }
      const result = await updateApiKey(keyGroupUpdate(latest.data, group))
      if (!result.success) {
        throw createServerError(result, t(ERROR_MESSAGES.UPDATE_FAILED))
      }
      return { ...latest.data, ...result.data, group }
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<MeowKeyList>(
        { queryKey: MEOW_KEY_LIST_KEY },
        (list) =>
          list && {
            ...list,
            items: list.items.map((item) =>
              item.id === updated.id ? { ...item, ...updated } : item
            ),
          }
      )
      toast.success(
        t('{{name}} now uses {{group}}', {
          name: updated.name,
          group: updated.group,
        })
      )
    },
  })

  const group = mutation.isPending
    ? mutation.variables
    : (props.apiKey.group ?? '')

  return (
    <ApiKeyGroupCombobox
      size='compact'
      options={props.groups}
      value={group}
      disabled={mutation.isPending}
      aria-label={t('Change group for {{name}}', { name: props.apiKey.name })}
      // A key without a group falls back to the user's own group, which
      // reaches no model on MeowAPI, so it asks to be picked.
      className={cn(
        !group && 'border-meow-orange/60 text-meow-orange',
        mutation.isPending && 'opacity-70'
      )}
      onValueChange={(next) => {
        if (next !== group) mutation.mutate(next)
      }}
    />
  )
}
