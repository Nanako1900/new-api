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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  MEOW_CATALOG,
  PLAIN_EYE,
  meowChoiceToUrl,
  type MeowChoice,
} from '@/lib/meow-avatar'

import { getPartLabels } from './part-labels'
import { PartPicker, type PartPickerOption } from './part-picker'

type CatBuilderProps = {
  choice: MeowChoice
  onChange: (choice: MeowChoice) => void
}

type ThumbnailPart = 'coat' | 'pattern' | 'ear' | 'eye' | 'mouth' | 'accessory'

const PLAIN_EYE_SWATCH = '#1E1B17'

/** Switching coats resets the patch layout to the new coat's first one. */
function withCoat(choice: MeowChoice, coatId: string): MeowChoice {
  const coat = MEOW_CATALOG.coats.find((option) => option.id === coatId)
  return { ...choice, coat: coatId, pattern: coat?.patterns?.[0].id ?? null }
}

export function CatBuilder(props: CatBuilderProps) {
  const { t } = useTranslation()
  const labels = useMemo(() => getPartLabels(t), [t])
  const choice = props.choice
  const coat = MEOW_CATALOG.coats.find((option) => option.id === choice.coat)

  const thumbnails = useMemo(() => {
    const draw = (
      part: ThumbnailPart,
      ids: readonly string[]
    ): PartPickerOption[] =>
      ids.map((id) => ({
        id,
        label: labels[part][id] ?? id,
        preview: meowChoiceToUrl(
          part === 'coat' ? withCoat(choice, id) : { ...choice, [part]: id }
        ),
      }))
    const ids = (options: readonly { id: string }[]): string[] =>
      options.map((option) => option.id)
    return {
      coat: draw('coat', ids(MEOW_CATALOG.coats)),
      pattern: draw('pattern', ids(coat?.patterns ?? [])),
      ear: draw('ear', ids(MEOW_CATALOG.ears)),
      eye: draw('eye', ids(MEOW_CATALOG.eyes)),
      mouth: draw('mouth', ids(MEOW_CATALOG.mouths)),
      accessory: draw('accessory', ids(MEOW_CATALOG.accessories)),
    }
  }, [choice, coat, labels])

  const eyeColors: PartPickerOption[] = [
    { id: PLAIN_EYE, label: labels.eyeColor.plain, color: PLAIN_EYE_SWATCH },
    ...MEOW_CATALOG.eyeColors.map((option) => ({
      id: option.id,
      label: labels.eyeColor[option.id] ?? option.id,
      color: option.color,
    })),
  ]
  const swatches = (
    part: 'accessoryColor' | 'background',
    options: readonly { id: string; color: string }[]
  ): PartPickerOption[] =>
    options.map((option) => ({
      id: option.id,
      label: labels[part][option.id] ?? option.id,
      color: option.color,
    }))
  const set = (part: keyof MeowChoice) => (id: string) =>
    props.onChange({ ...choice, [part]: id })

  return (
    <div className='flex flex-col gap-4'>
      <PartPicker
        title={t('Coat')}
        options={thumbnails.coat}
        value={choice.coat}
        onChange={(id) => props.onChange(withCoat(choice, id))}
      />
      {thumbnails.pattern.length > 0 && (
        <PartPicker
          title={t('Pattern')}
          options={thumbnails.pattern}
          value={choice.pattern ?? ''}
          onChange={set('pattern')}
        />
      )}
      <PartPicker
        title={t('Ears')}
        options={thumbnails.ear}
        value={choice.ear}
        onChange={set('ear')}
      />
      <PartPicker
        title={t('Eyes')}
        options={thumbnails.eye}
        value={choice.eye}
        onChange={set('eye')}
      />
      <div className='grid gap-4 sm:grid-cols-2'>
        <PartPicker
          title={t('Left eye')}
          options={eyeColors}
          value={choice.eyeLeft}
          onChange={set('eyeLeft')}
        />
        <PartPicker
          title={t('Right eye')}
          options={eyeColors}
          value={choice.eyeRight}
          onChange={set('eyeRight')}
        />
      </div>
      <PartPicker
        title={t('Mouth')}
        options={thumbnails.mouth}
        value={choice.mouth}
        onChange={set('mouth')}
      />
      <div className='flex items-center gap-2'>
        <Switch
          id='meow-avatar-cheeks'
          checked={choice.cheeks}
          onCheckedChange={(checked) =>
            props.onChange({ ...choice, cheeks: checked })
          }
        />
        <Label htmlFor='meow-avatar-cheeks'>{t('Blush')}</Label>
      </div>
      <PartPicker
        title={t('Accessory')}
        options={thumbnails.accessory}
        value={choice.accessory}
        onChange={set('accessory')}
      />
      <PartPicker
        title={t('Accessory color')}
        options={swatches('accessoryColor', MEOW_CATALOG.accessoryColors)}
        value={choice.accessoryColor}
        onChange={set('accessoryColor')}
      />
      <PartPicker
        title={t('Background color')}
        options={swatches('background', MEOW_CATALOG.backgrounds)}
        value={choice.background}
        onChange={set('background')}
      />
    </div>
  )
}
