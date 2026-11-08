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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const GEETEST_CHECK_MODES = ['always', 'risk'] as const

const botProtectionSchema = z.object({
  GeetestCheckEnabled: z.boolean(),
  GeetestCheckMode: z.enum(GEETEST_CHECK_MODES),
  GeetestCaptchaId: z.string().optional(),
  GeetestCaptchaKey: z.string().optional(),
})

type BotProtectionFormValues = z.infer<typeof botProtectionSchema>

type BotProtectionSectionProps = {
  defaultValues: BotProtectionFormValues
}

export function BotProtectionSection({
  defaultValues,
}: BotProtectionSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const modeOptions: Record<
    (typeof GEETEST_CHECK_MODES)[number],
    { title: string; description: string }
  > = {
    always: {
      title: t('Every time'),
      description: t(
        'Every sign-in, sign-up or password reset email, and check-in asks for verification first.'
      ),
    },
    risk: {
      title: t('Only when risky'),
      description: t(
        'Asks only after repeated failed sign-ins, many emails or check-ins from one network, or a site-wide surge. Use a slide or icon captcha in GeeTest, not one-click.'
      ),
    },
  }

  const form = useForm<BotProtectionFormValues>({
    resolver: zodResolver(botProtectionSchema),
    defaultValues,
  })

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const onSubmit = async (data: BotProtectionFormValues) => {
    const updates = Object.entries(data).filter(
      ([key, value]) =>
        value !== defaultValues[key as keyof BotProtectionFormValues]
    )
    // The server refuses to enable GeeTest before both keys are saved.
    const enableUpdate = updates.find(
      ([key, value]) => key === 'GeetestCheckEnabled' && value === true
    )
    const orderedUpdates = enableUpdate
      ? [
          ...updates.filter(([key]) => key !== 'GeetestCheckEnabled'),
          enableUpdate,
        ]
      : updates

    for (const [key, value] of orderedUpdates) {
      await updateOption.mutateAsync({ key, value: value ?? '' })
    }
  }

  return (
    <SettingsSection title={t('Bot Protection')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='GeetestCheckEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable GeeTest')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Use GeeTest CAPTCHA v4 to protect sign-in, sign-up and password reset emails, and check-in'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='GeetestCheckMode'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('When to ask for verification')}</FormLabel>
                <FormControl>
                  <RadioGroup
                    aria-label={t('When to ask for verification')}
                    value={field.value}
                    onValueChange={field.onChange}
                    className='grid gap-3 sm:grid-cols-2'
                  >
                    {GEETEST_CHECK_MODES.map((mode) => {
                      const id = `geetest-check-mode-${mode}`
                      return (
                        <Label
                          key={mode}
                          htmlFor={id}
                          className='hover:border-primary/40 focus-within:border-primary/50 has-data-[checked]:border-primary has-data-[checked]:ring-primary/20 bg-card flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal transition-all has-data-[checked]:ring-2'
                        >
                          <RadioGroupItem
                            id={id}
                            value={mode}
                            className='mt-0.5'
                          />
                          <span className='flex flex-col gap-1.5'>
                            <span className='text-sm leading-none font-semibold'>
                              {modeOptions[mode].title}
                            </span>
                            <span className='text-muted-foreground text-sm'>
                              {modeOptions[mode].description}
                            </span>
                          </span>
                        </Label>
                      )
                    })}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='GeetestCaptchaId'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Captcha ID')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('Your GeeTest captcha ID')}
                    autoComplete='off'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='GeetestCaptchaKey'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Captcha Key')}</FormLabel>
                <FormControl>
                  <Input
                    type='password'
                    placeholder={t('Your GeeTest captcha key')}
                    autoComplete='new-password'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
