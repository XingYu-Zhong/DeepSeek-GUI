import { useState, type ReactElement } from 'react'
import type { AppSettingsV1, SshConnectionV1 } from '@shared/app-settings'
import { FolderOpen, Loader2, Plus, Server, Terminal, Trash2 } from 'lucide-react'
import { buildSshWorkspaceUri } from '@shared/ssh-workspace'
import {
  InlineNoticeView,
  SettingsCard,
  SettingRow,
  Toggle,
  type InlineNotice
} from './settings-controls'

type ConnectionsTab = 'local' | 'ssh'

function newConnection(index: number): SshConnectionV1 {
  const now = new Date().toISOString()
  return {
    id: `ssh-${Date.now().toString(36)}-${index + 1}`,
    name: `SSH ${index + 1}`,
    host: '',
    user: '',
    port: 22,
    authMethod: 'agent',
    password: '',
    identityFile: '',
    passphrase: '',
    remotePath: '~',
    enabled: true,
    createdAt: now,
    updatedAt: now
  }
}

function inputClass(extra = ''): string {
  return `w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 ${extra}`
}

function connectionSubtitle(connection: SshConnectionV1): string {
  const host = connection.host.trim() || 'host'
  const user = connection.user.trim()
  return `${user ? `${user}@` : ''}${host}:${connection.port}`
}

export function ConnectionsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, form, update } = ctx
  const [tab, setTab] = useState<ConnectionsTab>('ssh')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [notices, setNotices] = useState<Record<string, InlineNotice>>({})
  const settings = form as AppSettingsV1
  const sshConnections = settings.connections.ssh

  const saveConnections = (next: SshConnectionV1[]): void => {
    update({ connections: { ssh: next } })
  }

  const patchConnection = (id: string, patch: Partial<SshConnectionV1>): void => {
    const now = new Date().toISOString()
    saveConnections(
      sshConnections.map((connection) =>
        connection.id === id ? { ...connection, ...patch, updatedAt: now } : connection
      )
    )
  }

  const addConnection = (): void => {
    saveConnections([...sshConnections, newConnection(sshConnections.length)])
  }

  const removeConnection = (id: string): void => {
    saveConnections(sshConnections.filter((connection) => connection.id !== id))
    setNotices((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const testConnection = async (connection: SshConnectionV1): Promise<void> => {
    if (!connection.host.trim()) {
      setNotices((current) => ({
        ...current,
        [connection.id]: { tone: 'error', message: t('sshConnectionHostRequired') }
      }))
      return
    }
    if (typeof window.dsGui?.testSshConnection !== 'function') {
      setNotices((current) => ({
        ...current,
        [connection.id]: { tone: 'error', message: t('sshConnectionTestUnavailable') }
      }))
      return
    }
    setTestingId(connection.id)
    try {
      const result = await window.dsGui.testSshConnection(connection)
      setNotices((current) => ({
        ...current,
        [connection.id]: {
          tone: result.ok ? 'success' : 'error',
          message: result.message || (result.ok ? t('sshConnectionTestOk') : t('sshConnectionTestFailed'))
        }
      }))
    } catch (error) {
      setNotices((current) => ({
        ...current,
        [connection.id]: {
          tone: 'error',
          message: error instanceof Error ? error.message : String(error)
        }
      }))
    } finally {
      setTestingId(null)
    }
  }

  const openRemoteProject = (connection: SshConnectionV1): void => {
    if (!connection.host.trim()) {
      setNotices((current) => ({
        ...current,
        [connection.id]: { tone: 'error', message: t('sshConnectionHostRequired') }
      }))
      return
    }
    const remotePath = connection.remotePath.trim() || '~'
    update({ workspaceRoot: buildSshWorkspaceUri(connection.id, remotePath) })
    setNotices((current) => ({
      ...current,
      [connection.id]: {
        tone: 'success',
        message: t('sshConnectionOpenProjectApplied')
      }
    }))
  }

  const tabButtonClass = (target: ConnectionsTab): string =>
    `border-b px-0 pb-3 text-[14px] font-semibold transition ${
      tab === target
        ? 'border-ds-ink text-ds-ink'
        : 'border-transparent text-ds-muted hover:text-ds-ink'
    }`

  return (
    <>
      <div className="mb-6 flex gap-8 border-b border-ds-border-muted">
        <button type="button" className={tabButtonClass('local')} onClick={() => setTab('local')}>
          {t('connectionsLocalComputer')}
        </button>
        <button type="button" className={tabButtonClass('ssh')} onClick={() => setTab('ssh')}>
          {t('connectionsSsh')}
        </button>
      </div>

      {tab === 'local' ? (
        <SettingsCard title={t('connectionsLocalTitle')}>
          <SettingRow
            title={t('connectionsLocalComputer')}
            description={t('connectionsLocalDesc')}
            control={
              <div className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                <Server className="h-4 w-4" strokeWidth={1.75} />
                {t('connectionsLocalCurrent')}
              </div>
            }
          />
        </SettingsCard>
      ) : (
        <SettingsCard title={t('sshConnectionsTitle')}>
          <SettingRow
            title={t('sshConnections')}
            description={t('sshConnectionsDesc')}
            wideControl
            control={
              <div className="flex w-full min-w-0 flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13px] leading-5 text-ds-muted">
                    {t('sshConnectionsSecretNote')}
                  </div>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    onClick={addConnection}
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.75} />
                    {t('sshConnectionAdd')}
                  </button>
                </div>

                {sshConnections.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-ds-border bg-ds-main/40 px-4 py-5 text-[13px] text-ds-muted">
                    {t('sshConnectionsEmpty')}
                  </div>
                ) : (
                  sshConnections.map((connection) => (
                    <div
                      key={connection.id}
                      className="rounded-xl border border-ds-border-muted bg-ds-main/40 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ds-subtle text-ds-muted">
                          <Terminal className="h-4 w-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <input
                                className={inputClass('font-medium')}
                                value={connection.name}
                                placeholder={t('sshConnectionNamePlaceholder')}
                                onChange={(event) =>
                                  patchConnection(connection.id, { name: event.target.value })
                                }
                              />
                              <div className="mt-1 truncate text-[12px] text-ds-faint">
                                {connectionSubtitle(connection)}
                              </div>
                            </div>
                            <Toggle
                              checked={connection.enabled}
                              onChange={(enabled) => patchConnection(connection.id, { enabled })}
                            />
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-[1.3fr_0.9fr_0.5fr]">
                            <label className="min-w-0 text-[12px] font-medium text-ds-muted">
                              {t('sshConnectionHost')}
                              <input
                                className={inputClass('mt-1')}
                                value={connection.host}
                                placeholder={t('sshConnectionHostPlaceholder')}
                                onChange={(event) =>
                                  patchConnection(connection.id, { host: event.target.value })
                                }
                              />
                            </label>
                            <label className="min-w-0 text-[12px] font-medium text-ds-muted">
                              {t('sshConnectionUser')}
                              <input
                                className={inputClass('mt-1')}
                                value={connection.user}
                                placeholder={t('sshConnectionUserPlaceholder')}
                                onChange={(event) =>
                                  patchConnection(connection.id, { user: event.target.value })
                                }
                              />
                            </label>
                            <label className="min-w-0 text-[12px] font-medium text-ds-muted">
                              {t('sshConnectionPort')}
                              <input
                                type="number"
                                min={1}
                                max={65535}
                                className={inputClass('mt-1')}
                                value={connection.port}
                                onChange={(event) =>
                                  patchConnection(connection.id, {
                                    port: Number(event.target.value) || 22
                                  })
                                }
                              />
                            </label>
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                            <label className="min-w-0 text-[12px] font-medium text-ds-muted">
                              {t('sshConnectionAuthMethod')}
                              <select
                                className={inputClass('mt-1')}
                                value={connection.authMethod}
                                onChange={(event) =>
                                  patchConnection(connection.id, {
                                    authMethod: event.target.value as SshConnectionV1['authMethod']
                                  })
                                }
                              >
                                <option value="agent">{t('sshConnectionAuthAgent')}</option>
                                <option value="password">{t('sshConnectionAuthPassword')}</option>
                                <option value="identityFile">{t('sshConnectionAuthIdentityFile')}</option>
                              </select>
                            </label>
                            {connection.authMethod === 'password' ? (
                              <label className="min-w-0 text-[12px] font-medium text-ds-muted">
                                {t('sshConnectionPassword')}
                                <input
                                  type="password"
                                  className={inputClass('mt-1')}
                                  value={connection.password}
                                  placeholder={t('sshConnectionPasswordPlaceholder')}
                                  onChange={(event) =>
                                    patchConnection(connection.id, { password: event.target.value })
                                  }
                                />
                              </label>
                            ) : connection.authMethod === 'identityFile' ? (
                              <label className="min-w-0 text-[12px] font-medium text-ds-muted">
                                {t('sshConnectionIdentityFile')}
                                <input
                                  className={inputClass('mt-1')}
                                  value={connection.identityFile}
                                  placeholder={t('sshConnectionIdentityFilePlaceholder')}
                                  onChange={(event) =>
                                    patchConnection(connection.id, { identityFile: event.target.value })
                                  }
                                />
                              </label>
                            ) : (
                              <div className="rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2 text-[12px] leading-5 text-ds-muted">
                                {t('sshConnectionAuthAgentDesc')}
                              </div>
                            )}
                          </div>

                          {connection.authMethod === 'identityFile' ? (
                            <label className="mt-3 block min-w-0 text-[12px] font-medium text-ds-muted">
                              {t('sshConnectionPassphrase')}
                              <input
                                type="password"
                                className={inputClass('mt-1')}
                                value={connection.passphrase}
                                placeholder={t('sshConnectionPassphrasePlaceholder')}
                                onChange={(event) =>
                                  patchConnection(connection.id, { passphrase: event.target.value })
                                }
                              />
                            </label>
                          ) : null}

                          <label className="mt-3 block min-w-0 text-[12px] font-medium text-ds-muted">
                            {t('sshConnectionRemotePath')}
                            <input
                              className={inputClass('mt-1')}
                              value={connection.remotePath}
                              placeholder={t('sshConnectionRemotePathPlaceholder')}
                              onChange={(event) =>
                                patchConnection(connection.id, { remotePath: event.target.value })
                              }
                            />
                          </label>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={testingId === connection.id}
                              onClick={() => void testConnection(connection)}
                            >
                              {testingId === connection.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                              ) : (
                                <Terminal className="h-4 w-4" strokeWidth={1.75} />
                              )}
                              {t('sshConnectionTest')}
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={!connection.enabled}
                              onClick={() => openRemoteProject(connection)}
                            >
                              <FolderOpen className="h-4 w-4" strokeWidth={1.75} />
                              {t('sshConnectionOpenProject')}
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-red-600"
                              onClick={() => removeConnection(connection.id)}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                              {t('sshConnectionDelete')}
                            </button>
                          </div>
                          {notices[connection.id] ? (
                            <div className="mt-3">
                              <InlineNoticeView notice={notices[connection.id]} />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            }
          />
        </SettingsCard>
      )}
    </>
  )
}
