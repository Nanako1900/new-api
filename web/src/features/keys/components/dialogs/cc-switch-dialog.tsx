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
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { getPricing } from '@/features/pricing/api'
import { getUserModels } from '@/lib/api'
import { resolveApiRoot } from '@/lib/api-root'
import { requireServerSuccess } from '@/lib/server-error-message'
import { readCachedStatus } from '@/lib/status-query'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useOnboardingStore } from '@/stores/onboarding-store'

import { getTokenAutoGroups } from '../../api'
import {
  CC_SWITCH_APPS,
  ccSwitchModelChoices,
  defaultCCSwitchApp,
  defaultCCSwitchModels,
  keyModels,
  keyRequestGroups,
  type CCSwitchApp,
  type CCSwitchKey,
  type CCSwitchModels,
} from '../../lib/cc-switch-defaults'

const APP_CONFIGS = {
  claude: {
    label: 'Claude',
    defaultName: 'MeowAPI Claude',
    modelFields: [
      { key: 'model', labelKey: 'Primary Model', required: true },
      { key: 'haikuModel', labelKey: 'Haiku Model', required: false },
      { key: 'sonnetModel', labelKey: 'Sonnet Model', required: false },
      { key: 'opusModel', labelKey: 'Opus Model', required: false },
    ],
  },
  codex: {
    label: 'Codex',
    defaultName: 'MeowAPI Codex',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  // Gemini CLI appends `/v1beta/...` to the site root itself.
  gemini: {
    label: 'Gemini',
    defaultName: 'MeowAPI Gemini',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
} as const satisfies Record<CCSwitchApp, unknown>

type AppType = CCSwitchApp

function buildCCSwitchURL(
  app: string,
  name: string,
  models: Record<string, string>,
  apiKey: string
): string {
  const apiRoot = resolveApiRoot(readCachedStatus(), window.location.origin)
  const endpoint = app === 'codex' ? `${apiRoot}/v1` : apiRoot
  const params = new URLSearchParams()
  params.set('resource', 'provider')
  params.set('app', app)
  params.set('name', name)
  params.set('endpoint', endpoint)
  params.set('apiKey', apiKey)
  for (const [k, v] of Object.entries(models)) {
    if (v) params.set(k, v)
  }
  params.set('homepage', window.location.origin)
  params.set('enabled', 'true')
  return `ccswitch://v1/import?${params.toString()}`
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenKey: string
  /** The key being imported; its group decides the models on offer. */
  apiKey: CCSwitchKey | null
}

export function CCSwitchDialog(props: Props) {
  const { t } = useTranslation()
  // What the user picked; null follows the defaults for the key and client.
  const [appChoice, setAppChoice] = useState<AppType | null>(null)
  const [nameEdit, setNameEdit] = useState<string | null>(null)
  const [modelEdits, setModelEdits] = useState<CCSwitchModels>({})
  const userId = useAuthStore((state) => state.auth.user?.id)
  const userGroup = useAuthStore((state) => state.auth.user?.group ?? '')
  const recordImport = useOnboardingStore((state) => state.recordImport)

  // A key in `auto` without its own list follows the user's global Auto list.
  const needsGlobalAuto =
    props.apiKey?.group === 'auto' && !props.apiKey.auto_groups?.length
  const pricing = useQuery({
    queryKey: ['pricing'],
    queryFn: async () => requireServerSuccess(await getPricing()),
    enabled: props.open && props.apiKey !== null,
    staleTime: 5 * 60 * 1000,
  })
  const autoGroups = useQuery({
    queryKey: ['token-auto-groups'],
    queryFn: async () => requireServerSuccess(await getTokenAutoGroups()),
    enabled: props.open && needsGlobalAuto,
  })
  // Without the price list the key's groups cannot be checked, so the
  // user's own models stand in for the key's.
  const fallback =
    props.apiKey === null || pricing.isError || autoGroups.isError
  const userModels = useQuery({
    queryKey: ['user-models-ccswitch'],
    queryFn: async () => requireServerSuccess(await getUserModels()),
    enabled: props.open && fallback,
    staleTime: 5 * 60 * 1000,
  })

  // The models this key can call; null while they load.
  const available = useMemo(() => {
    if (fallback || props.apiKey === null) return userModels.data?.data ?? null
    if (!pricing.data || (needsGlobalAuto && !autoGroups.data)) return null
    const groups = keyRequestGroups(
      props.apiKey,
      userGroup,
      autoGroups.data?.data?.groups ?? []
    )
    return keyModels(props.apiKey, groups, pricing.data.data ?? [])
  }, [
    fallback,
    props.apiKey,
    userModels.data,
    pricing.data,
    needsGlobalAuto,
    autoGroups.data,
    userGroup,
  ])

  // Clients with no model this key can call are grayed out.
  const unusableApps = useMemo(
    () =>
      available === null
        ? []
        : CC_SWITCH_APPS.filter(
            (key) => ccSwitchModelChoices(key, available).length === 0
          ),
    [available]
  )
  const noUsableApp = unusableApps.length === CC_SWITCH_APPS.length

  const app =
    appChoice ?? (available && defaultCCSwitchApp(available)) ?? 'claude'
  const name = nameEdit ?? APP_CONFIGS[app].defaultName

  // Only models of the chosen client's family, so Codex cannot be pointed
  // at a Claude model or the other way round.
  const choices = useMemo(
    () => ccSwitchModelChoices(app, available ?? []),
    [app, available]
  )

  const modelOptions = useMemo(
    () => choices.map((m) => ({ value: m, label: m })),
    [choices]
  )

  const models = useMemo(
    () => ({ ...defaultCCSwitchModels(app, choices), ...modelEdits }),
    [app, choices, modelEdits]
  )

  useEffect(() => {
    if (props.open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModelEdits({})

      setAppChoice(null)

      setNameEdit(null)
    }
  }, [props.open])

  const currentConfig = APP_CONFIGS[app]

  const handleAppChange = (val: string) => {
    setAppChoice(val as AppType)
    setNameEdit(null)
    setModelEdits({})
  }

  const handleSubmit = () => {
    if (!models.model) {
      toast.warning(t('Please select a primary model'))
      return
    }
    const key = props.tokenKey.startsWith('sk-')
      ? props.tokenKey
      : `sk-${props.tokenKey}`
    const url = buildCCSwitchURL(app, name, models, key)
    window.open(url, '_blank')
    if (userId !== undefined) recordImport(userId)
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Import to CC Switch')}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            data-tour='cc-switch-open'
            disabled={noUsableApp}
            onClick={handleSubmit}
          >
            {t('Open CC Switch')}
          </Button>
        </>
      }
    >
      <div data-tour='cc-switch-form' className='space-y-4'>
        <div className='space-y-2'>
          <Label>{t('Application')}</Label>
          <RadioGroup
            value={app}
            onValueChange={handleAppChange}
            className='flex gap-4'
            aria-describedby={
              unusableApps.length > 0 ? 'cc-switch-app-note' : undefined
            }
          >
            {CC_SWITCH_APPS.map((key) => {
              const unusable = unusableApps.includes(key)
              return (
                <div key={key} className='flex items-center gap-2'>
                  <RadioGroupItem
                    value={key}
                    id={`app-${key}`}
                    disabled={unusable}
                  />
                  <Label
                    htmlFor={`app-${key}`}
                    className={cn(
                      unusable
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer'
                    )}
                  >
                    {APP_CONFIGS[key].label}
                  </Label>
                </div>
              )
            })}
          </RadioGroup>
          {unusableApps.length > 0 && (
            <p
              id='cc-switch-app-note'
              className='text-muted-foreground text-xs'
            >
              {noUsableApp
                ? t(
                    "This key's group has no Claude, GPT or Gemini models. Change its group in the key list first."
                  )
                : t(
                    'Not available with this key: {{apps}}. Its group has no models for them.',
                    {
                      apps: unusableApps
                        .map((key) => APP_CONFIGS[key].label)
                        .join(', '),
                    }
                  )}
            </p>
          )}
        </div>

        <div className='space-y-2'>
          <Label htmlFor='cc-switch-name'>{t('Name')}</Label>
          <Input
            id='cc-switch-name'
            value={name}
            onChange={(event) => setNameEdit(event.target.value)}
            placeholder={currentConfig.defaultName}
          />
        </div>

        {currentConfig.modelFields.map((field) => (
          <div key={field.key} className='space-y-2'>
            <Label htmlFor={`cc-switch-${field.key}`} required={field.required}>
              {t(field.labelKey)}
            </Label>
            <Combobox
              id={`cc-switch-${field.key}`}
              aria-label={t(field.labelKey)}
              options={modelOptions}
              value={models[field.key] || ''}
              onValueChange={(v) =>
                setModelEdits((prev) => ({ ...prev, [field.key]: v ?? '' }))
              }
              placeholder={t('Select or enter model name')}
              emptyText={t('No models found')}
            />
          </div>
        ))}
      </div>
    </Dialog>
  )
}
