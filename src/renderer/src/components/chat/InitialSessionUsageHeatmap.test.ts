import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { DailyUsageState, DailyUsageSummary } from '../../hooks/use-daily-usage'
import type { ModelUsageState } from '../../hooks/use-model-usage'
import {
  InitialSessionUsageHeatmapView,
  USAGE_HEATMAP_CONTRAST_COLORS,
  usageHeatmapIntensityLevel
} from './InitialSessionUsageHeatmap'

function bucket(date: string, totalTokens: number, turns = 1) {
  return {
    date,
    inputTokens: totalTokens,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: totalTokens,
    totalTokens,
    costUsd: totalTokens / 1_000_000,
    costCny: (totalTokens / 1_000_000) * 7.2,
    tokenEconomySavingsTokens: 0,
    turns,
    threadCount: turns > 0 ? 1 : 0,
    cacheHitRate: totalTokens > 0 ? 0.25 : null
  }
}

function usage(buckets = [bucket('2026-05-01', 1200), bucket('2026-05-02', 10000)]): DailyUsageSummary {
  const totalTokens = buckets.reduce((sum, item) => sum + item.totalTokens, 0)
  const turns = buckets.reduce((sum, item) => sum + item.turns, 0)
  return {
    groupBy: 'day',
    from: buckets[0]?.date ?? '2026-05-01',
    to: buckets[buckets.length - 1]?.date ?? '2026-05-01',
    timezone: 'UTC',
    buckets,
    totals: {
      inputTokens: totalTokens,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: totalTokens,
      totalTokens,
      costUsd: totalTokens / 1_000_000,
      costCny: (totalTokens / 1_000_000) * 7.2,
      tokenEconomySavingsTokens: 0,
      turns,
      threadCount: buckets.filter((item) => item.turns > 0).length,
      cacheHitRate: totalTokens > 0 ? 0.25 : null,
      days: buckets.length,
      activeDays: buckets.filter((item) => item.totalTokens > 0 || item.turns > 0).length
    }
  }
}

function state(patch: Partial<DailyUsageState>): DailyUsageState {
  return {
    usage: null,
    loading: false,
    loaded: false,
    error: null,
    ...patch
  }
}

function modelState(patch: Partial<ModelUsageState>): ModelUsageState {
  return {
    usage: null,
    loading: false,
    loaded: false,
    error: null,
    ...patch
  }
}

function render(
  stateValue: DailyUsageState,
  props: Partial<Parameters<typeof InitialSessionUsageHeatmapView>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(InitialSessionUsageHeatmapView, {
      state: stateValue,
      ...props
    })
  )
}

function luminance(hex: string): number {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map((part) => {
      const channel = Number.parseInt(part, 16) / 255
      return channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const left = luminance(a)
  const right = luminance(b)
  const lighter = Math.max(left, right)
  const darker = Math.min(left, right)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('InitialSessionUsageHeatmap', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders populated usage with accessible day summaries without starter actions', () => {
    const html = render(state({ usage: usage(), loaded: true }))

    expect(html).toContain('ds-runtime-wake-stage')
    expect(html).toContain('Overview')
    expect(html).toContain('Models')
    expect(html).toContain('All')
    expect(html).toContain('90d')
    expect(html).toContain('Daily Kun usage calendar')
    expect(html).toContain('Sessions')
    expect(html).toContain('Messages')
    expect(html).toContain('Current streak')
    expect(html).toContain('Collapse calendar')
    expect(html).toContain('2026-05-01')
    expect(html).toContain('10.0k')
    expect(html).toContain('You&#x27;ve used 11.2k tokens across 2 active days.')
    expect(html).toContain('aria-label="2026-05-02')
    expect(html).not.toContain('Explain this project&#x27;s structure')
  })

  it('renders the usage panel without the animated hero in focus mode', () => {
    const html = render(state({ usage: usage(), loaded: true }), { hideHero: true })

    expect(html).toContain('Daily Kun usage calendar')
    expect(html).toContain('aria-label="2026-05-02')
    expect(html).toContain('Overview')
    expect(html).toContain('Models')
    expect(html).toContain('Sessions')
    expect(html).toContain('Messages')
    expect(html).toContain('Collapse calendar')
    expect(html).toContain('You&#x27;ve used 11.2k tokens across 2 active days.')
    expect(html).not.toContain('ds-runtime-wake-stage')
  })

  it('renders stacked model usage bars with a hover breakdown tooltip', () => {
    const detailedDay = {
      date: '2026-06-04',
      inputTokens: 2365343,
      outputTokens: 44702,
      reasoningTokens: 0,
      cachedTokens: 1906304,
      cacheMissTokens: 459039,
      totalTokens: 2410045,
      costUsd: 2.41,
      costCny: 17.35,
      tokenEconomySavingsTokens: 0,
      turns: 3,
      threadCount: 1,
      cacheHitRate: 1906304 / (1906304 + 459039)
    }
    const html = render(state({ usage: usage(), loaded: true }), {
      initialActiveTab: 'models',
      initialModelHoverIndex: 0,
      modelState: modelState({
        usage: {
          groupBy: 'model',
          from: '2026-06-04',
          to: '2026-06-04',
          timezone: 'UTC',
          buckets: [
            {
              model: 'deepseek-v4-pro',
              ...detailedDay
            }
          ],
          days: [detailedDay],
          totals: {
            ...detailedDay,
            days: 1,
            activeDays: 1
          }
        },
        loaded: true
      })
    })

    expect(html).toContain('Tokens')
    expect(html).toContain('2,410,045')
    expect(html).toContain('2026-06-04')
    expect(html).toContain('Input (cache hit)')
    expect(html).toContain('1,906,304 tokens')
    expect(html).toContain('Input (cache miss)')
    expect(html).toContain('459,039 tokens')
    expect(html).toContain('Output')
    expect(html).toContain('44,702 tokens')
  })

  it('changes only metric totals when a shorter range is selected', () => {
    const buckets = [
      bucket('2026-05-01', 1200),
      bucket('2026-05-02', 0, 0),
      bucket('2026-05-03', 0, 0),
      bucket('2026-05-04', 0, 0),
      bucket('2026-05-05', 0, 0),
      bucket('2026-05-06', 0, 0),
      bucket('2026-05-07', 0, 0),
      bucket('2026-05-08', 0, 0),
      bucket('2026-05-09', 0, 0),
      bucket('2026-05-10', 10000)
    ]
    const html = render(state({ usage: usage(buckets), loaded: true }), { rangeKey: '7d' })

    expect(html).toContain('2026-05-01')
    expect(html).toContain('aria-label="2026-05-10')
    expect(html).toContain('You&#x27;ve used 10.0k tokens across 1 active days.')
    expect(html).not.toContain('You&#x27;ve used 11.2k tokens across 2 active days.')
  })

  it('renders loading, empty, and error states as calendar-only warmup states', () => {
    const loadingHtml = render(state({ loading: true }))
    expect(loadingHtml).toContain('Preparing your usage calendar')
    expect(loadingHtml).toContain('Checking history')
    expect(loadingHtml).toContain('Collapse calendar')
    expect(loadingHtml).not.toContain('Daily Kun usage calendar')
    expect(loadingHtml).not.toContain('Explain this project&#x27;s structure')

    const emptyHtml = render(state({ usage: usage([bucket('2026-05-01', 0, 0)]), loaded: true }))
    expect(emptyHtml).toContain('Start your agent rhythm')
    expect(emptyHtml).toContain('No usage has been recorded yet')
    expect(emptyHtml).not.toContain('aria-label="2026-05-01')
    expect(emptyHtml).not.toContain('Explain this project&#x27;s structure')

    const errorHtml = render(state({ loaded: true, error: 'boom' }))
    expect(errorHtml).toContain('Start now, sync usage later')
    expect(errorHtml).toContain('Usage can be retried later')
    expect(errorHtml).not.toContain('Explain this project&#x27;s structure')
  })

  it('renders the Kun hero with a collapsed calendar card', () => {
    const html = render(state({ usage: usage(), loaded: true }), { initialCollapsed: true })

    expect(html).toContain('Expand calendar')
    expect(html).toContain('ds-runtime-wake-stage')
    expect(html).toContain('ds-kun-state-sleep')
    expect(html).not.toContain('Keep the canvas clear')
    expect(html).not.toContain('Daily Kun usage calendar')
  })

  it('uses turns as the intensity fallback when token totals are unavailable', () => {
    expect(usageHeatmapIntensityLevel({ totalTokens: 0, turns: 3 }, 0, 6)).toBe(2)
    expect(usageHeatmapIntensityLevel({ totalTokens: 0, turns: 0 }, 0, 6)).toBe(0)
  })

  it('keeps visible non-zero intensity colors in light and dark themes', () => {
    for (const item of USAGE_HEATMAP_CONTRAST_COLORS.filter((entry) => entry.level > 0)) {
      expect(contrast(item.light, '#ffffff')).toBeGreaterThan(1.5)
      expect(contrast(item.dark, '#181818')).toBeGreaterThan(1.5)
    }
  })
})
