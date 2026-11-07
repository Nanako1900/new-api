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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { MeowHeroVisual } from '@/features/home/components/meow'
import {
  HOME_HERO_VISUALS,
  parseHomeHeroVisual,
  type HomeHeroVisual,
} from '@/features/home/lib/hero-visual'
import { cn } from '@/lib/utils'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const VISUAL_OPTIONS: Record<
  HomeHeroVisual,
  { titleKey: string; descriptionKey: string }
> = {
  'key-card': {
    titleKey: 'Key card and call log',
    descriptionKey:
      'An API key card in front of a call log where example calls arrive one by one.',
  },
  gateway: {
    titleKey: 'Gateway routing map',
    descriptionKey:
      'Your tools on the left, Claude and GPT on the right, joined through one key.',
  },
  'base-url': {
    titleKey: 'Base URL swap and chat',
    descriptionKey:
      'A .env diff pointing the base URLs at this site, above a streaming chat.',
  },
  'code-card': {
    titleKey: 'API request examples',
    descriptionKey:
      'The earlier code card with copyable curl requests for Claude, Chat and Responses.',
  },
}

const homeHeroSchema = z.object({
  HomeHeroVisual: z.enum(HOME_HERO_VISUALS),
})

type HomeHeroFormValues = z.infer<typeof homeHeroSchema>

type HomeHeroSectionProps = {
  /** The saved option; empty or unknown values mean the default visual. */
  defaultValue: string
}

/** Pick the visual beside the headline on the built-in home page. */
export function HomeHeroSection(props: HomeHeroSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const savedVisual = parseHomeHeroVisual(props.defaultValue)
  const form = useForm<HomeHeroFormValues>({
    resolver: zodResolver(homeHeroSchema),
    defaultValues: { HomeHeroVisual: savedVisual },
  })
  const selected = useWatch({ control: form.control, name: 'HomeHeroVisual' })

  useEffect(() => {
    form.reset({ HomeHeroVisual: savedVisual })
  }, [savedVisual, form])

  const onSubmit = async (values: HomeHeroFormValues) => {
    if (values.HomeHeroVisual === props.defaultValue) return
    await updateOption.mutateAsync({
      key: 'HomeHeroVisual',
      value: values.HomeHeroVisual,
    })
  }

  return (
    <SettingsSection title={t('Home page visual')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='HomeHeroVisual'
            render={({ field }) => (
              <FormItem className='lg:col-span-2'>
                <FormLabel>{t('Visual beside the headline')}</FormLabel>
                <FormDescription>
                  {t(
                    'Shown on the built-in home page. A custom home page set in System Information replaces it.'
                  )}
                </FormDescription>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={(value) =>
                      field.onChange(parseHomeHeroVisual(value))
                    }
                    className='grid gap-3 sm:grid-cols-2'
                  >
                    {HOME_HERO_VISUALS.map((visual) => {
                      const option = VISUAL_OPTIONS[visual]
                      const id = `home-hero-visual-${visual}`
                      return (
                        <Label
                          key={visual}
                          htmlFor={id}
                          className={cn(
                            'hover:border-primary/40 focus-within:border-primary/50 has-data-[checked]:border-primary has-data-[checked]:ring-primary/20 bg-card flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal transition-all has-data-[checked]:ring-2'
                          )}
                        >
                          <RadioGroupItem
                            id={id}
                            value={visual}
                            className='mt-0.5'
                          />
                          <span className='flex flex-col gap-1.5'>
                            <span className='text-sm leading-none font-semibold'>
                              {t(option.titleKey)}
                            </span>
                            <span className='text-muted-foreground text-sm'>
                              {t(option.descriptionKey)}
                            </span>
                          </span>
                        </Label>
                      )
                    })}
                  </RadioGroup>
                </FormControl>
              </FormItem>
            )}
          />

          <div className='flex flex-col gap-2 lg:col-span-2'>
            <span className='text-sm font-medium'>{t('Preview')}</span>
            <div className='bg-background relative overflow-hidden rounded-2xl border px-5 py-10 sm:px-12'>
              <MeowHeroVisual
                key={selected}
                visual={selected}
                className='mx-auto w-full max-w-[34rem]'
              />
            </div>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
