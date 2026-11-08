import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  ALERT_LEVEL_META,
  ALERT_LEVELS,
} from '@/features/console-alerts/constants'
import type { ConsoleAlert } from '@/features/console-alerts/types'

import {
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import {
  alertFormSchema,
  EMPTY_ALERT_FORM,
  type AlertFormValues,
} from './alert-schema'

const ALERT_FORM_ID = 'console-alert-form'

type AlertFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The alert being edited, or null to create one. */
  alert: ConsoleAlert | null
  onSubmit: (values: AlertFormValues) => void
}

export function AlertFormDialog(props: AlertFormDialogProps) {
  const { t } = useTranslation()
  const form = useForm<AlertFormValues>({
    resolver: zodResolver(alertFormSchema),
    defaultValues: EMPTY_ALERT_FORM,
  })

  useEffect(() => {
    if (!props.open) return
    if (!props.alert) {
      form.reset(EMPTY_ALERT_FORM)
      return
    }
    form.reset({
      title: props.alert.title ?? '',
      content: props.alert.content,
      level: props.alert.level,
      dismissible: props.alert.dismissible,
      enabled: props.alert.enabled,
      startsAt: props.alert.startsAt ?? '',
      endsAt: props.alert.endsAt ?? '',
    })
  }, [props.open, props.alert, form])

  const levelItems = ALERT_LEVELS.map((level) => ({
    value: level,
    label: t(ALERT_LEVEL_META[level].labelKey),
  }))

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.alert ? t('Edit Alert') : t('Add Alert')}
      description={t(
        'Alerts appear at the top of every console page for signed-in users.'
      )}
      contentClassName='max-w-2xl'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={ALERT_FORM_ID}>
            {props.alert ? t('Update') : t('Add')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={ALERT_FORM_ID}
          onSubmit={form.handleSubmit(props.onSubmit)}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Title (Optional)')}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Content')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder={t('Write the alert in Markdown')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('Maximum 500 characters. Supports Markdown.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='level'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Level')}</FormLabel>
                <Select
                  items={levelItems}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('Select alert level')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {levelItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='dismissible'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Users can dismiss')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Turn this off for alerts that must stay visible, such as outages.'
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
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enabled')}</FormLabel>
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
          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='startsAt'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Start Time')}</FormLabel>
                  <FormControl>
                    <DateTimePicker
                      value={field.value ? new Date(field.value) : undefined}
                      onChange={(date) =>
                        field.onChange(date ? date.toISOString() : '')
                      }
                      placeholder={t('Select start time')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Leave empty to show it right away.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='endsAt'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('End Time')}</FormLabel>
                  <FormControl>
                    <DateTimePicker
                      value={field.value ? new Date(field.value) : undefined}
                      onChange={(date) =>
                        field.onChange(date ? date.toISOString() : '')
                      }
                      placeholder={t('Select end time')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Leave empty to keep it until you disable or delete it.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </form>
      </Form>
    </Dialog>
  )
}
