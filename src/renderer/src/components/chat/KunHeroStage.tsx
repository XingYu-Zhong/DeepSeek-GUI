import type { ReactElement } from 'react'
import { PanelTop } from 'lucide-react'
import { KunStateFigure } from './AnimatedWorkLogo'

/**
 * 迷你工作台舞台:标题栏 + 骨架画布 + 居中熟睡的小 Kun。
 *
 * `waking` 打开「唤醒中」加载特效:Zzz 睡息、声纳涟漪、气泡上浮、
 * 草稿打字光标和偶尔翻身。仅在运行时连接页(确实还在重连)启用;
 * 就绪后的空状态与报错态沿用安静版舞台,避免误读成仍在加载(#78)。
 */
export function KunHeroStage({ waking = false }: { waking?: boolean }): ReactElement {
  return (
    <div
      className={waking ? 'ds-runtime-wake-stage is-waking' : 'ds-runtime-wake-stage'}
      aria-hidden="true"
    >
      <div className="ds-runtime-wake-shell">
        <div className="ds-runtime-wake-titlebar">
          <span className="ds-runtime-wake-dot is-red" />
          <span className="ds-runtime-wake-dot is-yellow" />
          <span className="ds-runtime-wake-dot is-green" />
          <PanelTop className="ml-auto h-3.5 w-3.5 text-ds-faint" strokeWidth={1.7} />
        </div>
        <div className="ds-runtime-wake-body">
          <div className="ds-runtime-wake-nav">
            <span className="is-active" />
            <span />
            <span />
            <span />
          </div>
          <div className="ds-runtime-wake-canvas">
            <span className="ds-runtime-wake-thread is-one" />
            <span className="ds-runtime-wake-thread is-two" />
            <span className="ds-runtime-wake-thread is-three" />
            {waking ? (
              <span className="ds-runtime-wake-bubbles">
                <i />
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
        </div>
        <span className="ds-runtime-wake-flow is-left" />
        <span className="ds-runtime-wake-flow is-right" />
        <div className="ds-runtime-wake-composer">
          <span />
          {waking ? <i className="ds-runtime-wake-caret" /> : null}
          <span />
        </div>
        <div className="ds-runtime-wake-core">
          {waking ? (
            <>
              <span className="ds-runtime-wake-sonar is-one" />
              <span className="ds-runtime-wake-sonar is-two" />
            </>
          ) : null}
          <span className="ds-runtime-wake-ring" />
          <span className="ds-runtime-wake-kun-bob">
            <KunStateFigure kind="sleep" className="ds-runtime-wake-kun" />
            {waking ? (
              <span className="ds-runtime-wake-zzz">
                <i>z</i>
                <i>z</i>
                <i>z</i>
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  )
}
