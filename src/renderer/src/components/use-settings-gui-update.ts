import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import type {
  GuiUpdateChannel,
  GuiUpdateInfo,
  GuiUpdateProgress,
  GuiUpdateState
} from '@shared/gui-update'
import { guiUpdateFailureMessage } from './settings-utils'

export function useSettingsGuiUpdate({
  category,
  channel,
  form,
  t
}: {
  category: 'general' | 'write' | 'agents' | 'claw'
  channel: GuiUpdateChannel | undefined
  form: AppSettingsV1 | null
  t: (key: string, values?: Record<string, unknown>) => string
}) {
  const [guiUpdateInfo, setGuiUpdateInfo] = useState<GuiUpdateInfo | null>(null)
  const [checkingGuiUpdate, setCheckingGuiUpdate] = useState(false)
  const [downloadingGuiUpdate, setDownloadingGuiUpdate] = useState(false)
  const [installingGuiUpdate, setInstallingGuiUpdate] = useState(false)
  const [guiUpdateDownloaded, setGuiUpdateDownloaded] = useState(false)
  const [guiUpdateProgress, setGuiUpdateProgress] = useState<GuiUpdateProgress | null>(null)
  const [guiUpdateError, setGuiUpdateError] = useState<string | null>(null)
  const checkedGuiUpdateChannel = useRef<GuiUpdateChannel | null>(null)

  const resetGuiUpdateState = useCallback((): void => {
    setGuiUpdateInfo(null)
    setGuiUpdateError(null)
    setGuiUpdateDownloaded(false)
    setGuiUpdateProgress(null)
  }, [])

  const applyGuiUpdateState = useCallback((state: GuiUpdateState): void => {
    if ('info' in state && state.info) {
      setGuiUpdateInfo(state.info)
    }
    if (state.status === 'checking') {
      setCheckingGuiUpdate(true)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'available' || state.status === 'not_available') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateDownloaded(Boolean(state.info.downloaded))
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'downloading') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(true)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(state.progress)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'downloaded') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateDownloaded(true)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'installing') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(true)
      setGuiUpdateProgress(null)
      setGuiUpdateError(null)
      return
    }
    if (state.status === 'error') {
      setCheckingGuiUpdate(false)
      setDownloadingGuiUpdate(false)
      setInstallingGuiUpdate(false)
      setGuiUpdateProgress(null)
      setGuiUpdateError(state.message)
    }
  }, [])

  const checkGuiUpdate = useCallback(async (): Promise<void> => {
    if (typeof window.dsGui?.checkGuiUpdate !== 'function') return
    setCheckingGuiUpdate(true)
    setGuiUpdateError(null)
    try {
      const info = await window.dsGui.checkGuiUpdate(channel)
      setGuiUpdateInfo(info)
      if (!info.ok) {
        setGuiUpdateError(info.code === 'not_configured' ? null : guiUpdateFailureMessage(info, t))
      }
    } catch (e) {
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCheckingGuiUpdate(false)
    }
  }, [channel, t])

  const downloadGuiUpdate = async (): Promise<void> => {
    if (typeof window.dsGui?.downloadGuiUpdate !== 'function') return
    setDownloadingGuiUpdate(true)
    setGuiUpdateProgress(null)
    setGuiUpdateError(null)
    try {
      const result = await window.dsGui.downloadGuiUpdate(form?.guiUpdate?.channel)
      if (!result.ok) {
        setGuiUpdateError(result.message)
        return
      }
      setGuiUpdateDownloaded(true)
    } catch (e) {
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloadingGuiUpdate(false)
    }
  }

  const installGuiUpdate = async (): Promise<void> => {
    if (typeof window.dsGui?.installGuiUpdate !== 'function') return
    setInstallingGuiUpdate(true)
    setGuiUpdateError(null)
    try {
      const result = await window.dsGui.installGuiUpdate()
      if (!result.ok) {
        setGuiUpdateError(result.message)
        setInstallingGuiUpdate(false)
      }
    } catch (e) {
      setGuiUpdateError(e instanceof Error ? e.message : String(e))
      setInstallingGuiUpdate(false)
    }
  }

  useEffect(() => {
    if (typeof window.dsGui?.onGuiUpdateState !== 'function') return
    const unsubscribe = window.dsGui.onGuiUpdateState(applyGuiUpdateState)
    if (typeof window.dsGui?.getGuiUpdateState === 'function') {
      void window.dsGui.getGuiUpdateState().then(applyGuiUpdateState).catch(() => undefined)
    }
    return unsubscribe
  }, [applyGuiUpdateState])

  useEffect(() => {
    if (!form || category !== 'general') return
    if (checkedGuiUpdateChannel.current === (channel ?? null)) return
    checkedGuiUpdateChannel.current = channel ?? null
    void checkGuiUpdate()
  }, [category, checkGuiUpdate, channel, form])

  return {
    checkingGuiUpdate,
    checkGuiUpdate,
    downloadingGuiUpdate,
    downloadGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateError,
    guiUpdateInfo,
    guiUpdateProgress,
    installingGuiUpdate,
    installGuiUpdate,
    resetGuiUpdateState
  }
}
