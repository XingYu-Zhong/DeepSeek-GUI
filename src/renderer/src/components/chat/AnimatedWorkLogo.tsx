import type { ReactElement } from 'react'
import deepseekWhaleLogo from '../../../../asset/img/deepseek.svg'

export function AnimatedWorkLogo({
  active = false,
  className = '',
  phase = 'lead',
  size = 'sm'
}: {
  active?: boolean
  className?: string
  phase?: 'lead' | 'trail'
  size?: 'sm' | 'md'
}): ReactElement {
  return (
    <span
      className={[
        'ds-work-logo',
        `ds-work-logo-${size}`,
        `ds-work-logo-phase-${phase}`,
        active ? 'is-active' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <span className="ds-work-logo-gust" />
      <span className="ds-work-logo-current" />
      <span className="ds-work-logo-swell" />
      <span className="ds-work-logo-wave ds-work-logo-wave-back" />
      <span className="ds-work-logo-ripple" />
      <span className="ds-work-logo-wave ds-work-logo-wave-front" />
      <span className="ds-work-logo-breaker" />
      <span className="ds-work-logo-wake" />
      <span className="ds-work-logo-foam" />
      <span className="ds-work-logo-crest" />
      <span className="ds-work-logo-splash" />
      <span className="ds-work-logo-spray" />
      <span className="ds-work-logo-bubbles" />
      <img className="ds-work-logo-echo" src={deepseekWhaleLogo} alt="" draggable={false} decoding="async" />
      <span className="ds-work-logo-track">
        <span className="ds-work-logo-body">
          <img className="ds-work-logo-image" src={deepseekWhaleLogo} alt="" draggable={false} decoding="async" />
          <img className="ds-work-logo-tail" src={deepseekWhaleLogo} alt="" draggable={false} decoding="async" />
        </span>
      </span>
    </span>
  )
}
