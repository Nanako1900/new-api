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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { TagInput } from '@/components/tag-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { getEditableQuotaStep } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { createCampaign, updateCampaign } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  cacheSubsidyQueryKeys,
  canEditCampaignRules,
  getCampaignFormDefaults,
  getCampaignFormSchema,
  transformCampaignToFormValues,
  transformFormToPayload,
  type CampaignFormValues,
} from '../lib'
import type { Campaign } from '../types'

const FORM_ID = 'cache-subsidy-campaign-form'

/** An emptied number field holds NaN, which the schema reports as invalid. */
function numberFromInput(value: string): number {
  return value === '' ? Number.NaN : Number(value)
}

function numberInputValue(value: number): number | '' {
  return Number.isNaN(value) ? '' : value
}

type CampaignMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: Campaign
}

export function CampaignMutateDrawer(props: CampaignMutateDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const campaign = props.currentRow
  const isUpdate = campaign !== undefined
  const rulesEditable = !campaign || canEditCampaignRules(campaign.status)

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(getCampaignFormSchema(t)),
    defaultValues: getCampaignFormDefaults(),
  })

  useEffect(() => {
    if (!props.open) return
    form.reset(
      campaign
        ? transformCampaignToFormValues(campaign)
        : getCampaignFormDefaults()
    )
  }, [props.open, campaign, form])

  const saveMutation = useMutation({
    mutationFn: async (values: CampaignFormValues) => {
      const payload = transformFormToPayload(values)
      if (!campaign) {
        const result = await createCampaign(payload)
        if (!result.success) throw createServerError(result)
        return result
      }
      // Unchanged amounts keep their exact quota instead of a rounded
      // display amount.
      const result = await updateCampaign(campaign.id, {
        ...payload,
        per_user_cap_quota: form.getFieldState('per_user_cap_amount').isDirty
          ? payload.per_user_cap_quota
          : campaign.per_user_cap_quota,
        min_subsidy_quota: form.getFieldState('min_subsidy_amount').isDirty
          ? payload.min_subsidy_quota
          : campaign.min_subsidy_quota,
      })
      if (!result.success) throw createServerError(result)
      return result
    },
    onSuccess: () => {
      toast.success(
        t(
          isUpdate
            ? SUCCESS_MESSAGES.CAMPAIGN_UPDATED
            : SUCCESS_MESSAGES.CAMPAIGN_CREATED
        )
      )
      void queryClient.invalidateQueries({
        queryKey: cacheSubsidyQueryKeys.admin(),
      })
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error, t(ERROR_MESSAGES.SAVE_FAILED)),
  })

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const quotaStep = getEditableQuotaStep()
  const isSaving = saveMutation.isPending

  let lockedNotice: string | null = null
  if (campaign?.status === 'open') {
    lockedNotice = t(
      'Claims are open. Only the name, description and claim deadline can change.'
    )
  } else if (!rulesEditable) {
    lockedNotice = t(
      'Rules are locked after calculation. Reset the campaign to draft to change them.'
    )
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[620px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Edit campaign') : t('Create campaign')}
          </SheetTitle>
          <SheetDescription>
            {t(
              'Refund part of the cache read and write cost that users paid from their wallets.'
            )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          {/* The schema reports range errors in the user's language instead
              of the browser's native bubble. */}
          <form
            id={FORM_ID}
            noValidate
            onSubmit={form.handleSubmit((values) =>
              saveMutation.mutate(values)
            )}
            className={sideDrawerFormClassName()}
          >
            <fieldset disabled={isSaving} className='contents'>
              <SideDrawerSection>
                <FormField
                  control={form.control}
                  name='name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Name')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t('Cache price change subsidy')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='description'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Description')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder={t('Shown to users on their dashboard')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SideDrawerSection>

              <SideDrawerSection>
                <SideDrawerSectionHeader
                  title={t('Subsidy rules')}
                  description={t(
                    'Only cache cost paid from the wallet counts. Subscription and per-request usage is skipped.'
                  )}
                />
                {lockedNotice && (
                  <Alert>
                    <Lock aria-hidden='true' />
                    <AlertDescription>{lockedNotice}</AlertDescription>
                  </Alert>
                )}
                <fieldset
                  disabled={!rulesEditable}
                  className='flex min-w-0 flex-col gap-4'
                >
                  <div className='grid gap-4 sm:grid-cols-2'>
                    <FormField
                      control={form.control}
                      name='window_start'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Window start')}</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              value={field.value ?? undefined}
                              onChange={(date) => field.onChange(date ?? null)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='window_end'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Window end')}</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              value={field.value ?? undefined}
                              onChange={(date) => field.onChange(date ?? null)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name='model_rules'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Model rules')}</FormLabel>
                        <FormControl>
                          <TagInput
                            value={field.value}
                            onChange={field.onChange}
                            disabled={!rulesEditable}
                            placeholder={t('Type a pattern and press Enter')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Model names matching any pattern count, such as claude* or gpt*. * matches any characters.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='include_cache_writes'
                    render={({ field }) => (
                      <FormItem className={sideDrawerSwitchItemClassName()}>
                        <div className='flex flex-col gap-1'>
                          <FormLabel className='!mt-0'>
                            {t('Include cache writes')}
                          </FormLabel>
                          <FormDescription>
                            {t(
                              'When off, only cache reads count toward the subsidy.'
                            )}
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={!rulesEditable}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='subsidy_percent'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Subsidy percentage')}</FormLabel>
                        <InputGroup>
                          <FormControl>
                            <InputGroupInput
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              type='number'
                              inputMode='decimal'
                              min={0}
                              max={100}
                              step='any'
                              value={numberInputValue(field.value)}
                              onChange={(event) =>
                                field.onChange(
                                  numberFromInput(event.target.value)
                                )
                              }
                            />
                          </FormControl>
                          <InputGroupAddon align='inline-end'>
                            %
                          </InputGroupAddon>
                        </InputGroup>
                        <FormDescription>
                          {t(
                            'Share of each user’s cache cost that is refunded.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className='grid gap-4 sm:grid-cols-2'>
                    <FormField
                      control={form.control}
                      name='per_user_cap_amount'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t('Per-user cap ({{currency}})', {
                              currency: currencyLabel,
                            })}
                          </FormLabel>
                          <FormControl>
                            <Input
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              type='number'
                              inputMode='decimal'
                              min={0}
                              step={quotaStep}
                              value={numberInputValue(field.value)}
                              onChange={(event) =>
                                field.onChange(
                                  numberFromInput(event.target.value)
                                )
                              }
                            />
                          </FormControl>
                          <FormDescription>
                            {t('0 means no cap.')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='min_subsidy_amount'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t('Minimum subsidy ({{currency}})', {
                              currency: currencyLabel,
                            })}
                          </FormLabel>
                          <FormControl>
                            <Input
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              type='number'
                              inputMode='decimal'
                              min={0}
                              step={quotaStep}
                              value={numberInputValue(field.value)}
                              onChange={(event) =>
                                field.onChange(
                                  numberFromInput(event.target.value)
                                )
                              }
                            />
                          </FormControl>
                          <FormDescription>
                            {t(
                              'Smaller subsidies are not granted. 0 means no minimum.'
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {currencyMeta.kind === 'tokens' && (
                    <p className='text-muted-foreground text-xs'>
                      {t('Amounts are entered in quota units.')}
                    </p>
                  )}
                </fieldset>
              </SideDrawerSection>

              <SideDrawerSection>
                <FormField
                  control={form.control}
                  name='claim_deadline'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Claim deadline')}</FormLabel>
                      <FormControl>
                        <DateTimePicker
                          value={field.value ?? undefined}
                          onChange={(date) => field.onChange(date ?? null)}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Users can claim until this time once claims open.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SideDrawerSection>
            </fieldset>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button form={FORM_ID} type='submit' disabled={isSaving}>
            {isSaving ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
