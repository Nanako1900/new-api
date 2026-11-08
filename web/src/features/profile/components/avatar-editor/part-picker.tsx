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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export type PartPickerOption = {
  id: string
  label: string
  /** A cat thumbnail with this option applied. */
  preview?: string
  /** A colour swatch, for colour parts. */
  color?: string
}

type PartPickerProps = {
  title: string
  options: readonly PartPickerOption[]
  value: string
  onChange: (id: string) => void
}

/** One row of the cat builder: a single-choice group of thumbnails or swatches. */
export function PartPicker(props: PartPickerProps) {
  return (
    <div className='flex flex-col gap-2'>
      <p
        aria-hidden='true'
        className='text-muted-foreground text-xs font-medium'
      >
        {props.title}
      </p>
      <ToggleGroup
        aria-label={props.title}
        value={[props.value]}
        onValueChange={(value) => {
          // Pressing the chosen option again would clear the group; keep it.
          if (value[0]) props.onChange(value[0])
        }}
        spacing={2}
        className='w-full flex-wrap'
      >
        {props.options.map((option) => (
          <ToggleGroupItem
            key={option.id}
            value={option.id}
            aria-label={option.label}
            title={option.label}
            variant='outline'
            className={cn(
              'aria-pressed:border-primary aria-pressed:ring-primary/40 p-0.5 aria-pressed:ring-2',
              option.preview ? 'size-12' : 'size-9'
            )}
          >
            {option.preview ? (
              <img
                src={option.preview}
                alt=''
                className='size-full rounded-md'
                draggable={false}
              />
            ) : (
              <span
                aria-hidden='true'
                className='ring-border size-6 rounded-full ring-1'
                style={{ backgroundColor: option.color }}
              />
            )}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
