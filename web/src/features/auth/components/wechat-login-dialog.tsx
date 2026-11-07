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
import { Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'

import { wechatLoginByCode } from '../api'
import { useAuthRedirect } from '../hooks/use-auth-redirect'
import type { SystemStatus } from '../types'

type WeChatLoginDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: SystemStatus | null
  redirectTo?: string
}

/**
 * WeChat sign-in: the user scans the official account's QR code, receives a
 * code by message, and enters it here. Success goes through the normal login
 * result handling (2FA challenge, session, redirect).
 */
export function WeChatLoginDialog(props: WeChatLoginDialogProps) {
  const { t } = useTranslation()
  const { handleLoginResult } = useAuthRedirect()
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const codeInputId = useId()
  // The official-account QR code, under whichever field the server sends.
  const qrCodeUrl =
    props.status?.wechat_qrcode ||
    props.status?.wechat_qr_code ||
    props.status?.wechat_qrcode_image_url ||
    props.status?.wechat_qr_code_image_url ||
    props.status?.wechat_account_qrcode_image_url ||
    props.status?.WeChatAccountQRCodeImageURL ||
    props.status?.data?.wechat_qrcode ||
    props.status?.data?.WeChatAccountQRCodeImageURL ||
    ''
  const loginFailedMessage = t('Login failed')

  function handleOpenChange(open: boolean) {
    props.onOpenChange(open)
    if (!open) {
      setCode('')
      setIsSubmitting(false)
    }
  }

  async function handleSubmit() {
    if (!code.trim()) {
      toast.error(t('Please enter the verification code'))
      return
    }

    setIsSubmitting(true)
    try {
      const res = await wechatLoginByCode(code)
      if (!res?.success) {
        handleServerError(createServerError(res, loginFailedMessage))
        return
      }
      handleOpenChange(false)
      if (await handleLoginResult(res.data, props.redirectTo)) {
        toast.success(t('Signed in via WeChat'))
      }
    } catch (error: unknown) {
      handleServerError(
        new AuthOperationError(loginFailedMessage, undefined, { cause: error })
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={t('WeChat sign in')}
      description={t(
        'Scan the QR code to follow the official account and reply with “验证码” to receive your verification code.'
      )}
      contentClassName='max-w-sm'
      headerClassName='text-left'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            onClick={handleSubmit}
            disabled={isSubmitting || !code.trim()}
            className='gap-2'
          >
            {isSubmitting && (
              <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' />
            )}
            {t('Confirm')}
          </Button>
        </>
      }
    >
      {qrCodeUrl ? (
        <div className='flex justify-center'>
          <img
            src={qrCodeUrl}
            alt={t('WeChat login QR code')}
            className='h-40 w-40 rounded-md border object-contain'
          />
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>
          {t('QR code is not configured. Please contact support.')}
        </p>
      )}
      <div className='grid gap-2'>
        <Label htmlFor={codeInputId}>{t('Verification code')}</Label>
        <Input
          id={codeInputId}
          placeholder={t('Enter the verification code')}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete='one-time-code'
        />
      </div>
    </Dialog>
  )
}
