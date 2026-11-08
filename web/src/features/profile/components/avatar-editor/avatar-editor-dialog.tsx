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
import { useMutation } from '@tanstack/react-query'
import { Dices, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { handleServerError } from '@/lib/handle-server-error'
import {
  defaultMeowChoice,
  getMeowAvatarUrl,
  meowChoiceFromConfig,
  meowChoiceToConfig,
  meowChoiceToUrl,
  randomMeowChoice,
  readUserAvatar,
  type MeowChoice,
  type UserAvatar,
} from '@/lib/meow-avatar'
import { createServerError } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { saveUserAvatar } from '../../api'
import { parseUserSettings } from '../../lib'
import { AvatarUploadPanel } from './avatar-upload-panel'
import { CatBuilder } from './cat-builder'

type AvatarDraft =
  | { mode: 'default' }
  | { mode: 'cat'; choice: MeowChoice }
  | { mode: 'upload'; image: string }

type AvatarEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: number
  setting?: string
  onSaved: () => void
}

function draftFromSetting(userId: number, setting?: string): AvatarDraft {
  const avatar = readUserAvatar(setting)
  if (avatar?.kind === 'upload') return { mode: 'upload', image: avatar.image }
  if (avatar?.kind === 'cat') {
    return {
      mode: 'cat',
      choice: meowChoiceFromConfig(avatar.cat, defaultMeowChoice(userId)),
    }
  }
  return { mode: 'default' }
}

function draftToAvatar(draft: AvatarDraft): UserAvatar | null {
  if (draft.mode === 'cat') {
    return { kind: 'cat', cat: meowChoiceToConfig(draft.choice) }
  }
  if (draft.mode === 'upload') return { kind: 'upload', image: draft.image }
  return null
}

function draftPreview(userId: number, draft: AvatarDraft): string | undefined {
  if (draft.mode === 'cat') return meowChoiceToUrl(draft.choice)
  if (draft.mode === 'upload') return draft.image
  return getMeowAvatarUrl(userId)
}

export function AvatarEditorDialog(props: AvatarEditorDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<AvatarDraft>(() =>
    draftFromSetting(props.userId, props.setting)
  )
  const [tab, setTab] = useState(draft.mode === 'upload' ? 'upload' : 'cat')
  const builderChoice =
    draft.mode === 'cat' ? draft.choice : defaultMeowChoice(props.userId)

  const save = useMutation({
    mutationFn: async (avatar: UserAvatar | null) => {
      const response = await saveUserAvatar(avatar)
      if (!response.success) {
        throw createServerError(response, t('Failed to save avatar'))
      }
      return avatar
    },
    onSuccess: (avatar) => {
      const auth = useAuthStore.getState().auth
      if (auth.user) {
        const setting =
          typeof auth.user.setting === 'string'
            ? parseUserSettings(auth.user.setting)
            : (auth.user.setting ?? {})
        auth.setUser({
          ...auth.user,
          setting: JSON.stringify({ ...setting, avatar: avatar ?? undefined }),
        })
      }
      toast.success(t('Avatar saved'))
      props.onSaved()
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error, t('Failed to save avatar')),
  })

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Change avatar')}
      description={t(
        'Build your cat, roll a random one, or upload your own picture.'
      )}
      contentClassName='sm:max-w-2xl'
      contentHeight='min(70vh, 640px)'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => save.mutate(draftToAvatar(draft))}
            disabled={save.isPending}
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6'>
        {/* Stays in view while the part lists scroll: a side column on wide
            screens, a bar pinned to the top on phones. */}
        <div
          data-avatar-preview
          className='bg-popover sticky top-0 z-10 -mx-1 flex items-center gap-3 border-b px-1 pb-3 sm:mx-0 sm:w-36 sm:shrink-0 sm:flex-col sm:items-stretch sm:border-0 sm:px-0 sm:pb-0'
        >
          <img
            src={draftPreview(props.userId, draft)}
            alt={t('Avatar preview')}
            className='ring-border size-20 shrink-0 rounded-2xl ring-1 sm:size-36'
          />
          <div className='flex flex-wrap gap-2 sm:flex-col'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                setTab('cat')
                setDraft({ mode: 'cat', choice: randomMeowChoice() })
              }}
            >
              <Dices aria-hidden='true' />
              {t('Shuffle')}
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setDraft({ mode: 'default' })}
            >
              <RotateCcw aria-hidden='true' />
              {t('My default cat')}
            </Button>
          </div>
        </div>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className='min-w-0 flex-1'
        >
          <TabsList>
            <TabsTrigger value='cat'>{t('Build a cat')}</TabsTrigger>
            <TabsTrigger value='upload'>{t('Upload')}</TabsTrigger>
          </TabsList>
          <TabsContent value='cat' className='pt-4'>
            <CatBuilder
              choice={builderChoice}
              onChange={(choice) => setDraft({ mode: 'cat', choice })}
            />
          </TabsContent>
          <TabsContent value='upload' className='pt-4'>
            <AvatarUploadPanel
              onImage={(image) => setDraft({ mode: 'upload', image })}
            />
          </TabsContent>
        </Tabs>
      </div>
    </Dialog>
  )
}
