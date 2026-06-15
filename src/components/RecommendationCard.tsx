import { useEffect, useRef, useState } from 'react'
import { formatCurrency, formatOdds, formatPercentRange, formatSignedCurrency } from '../lib/format.ts'
import { buildLocalAiInsight, fetchClaudeInsight, isRemoteEnabled, type MatchAiInsight } from '../lib/aiAnalysis.ts'
import { getMatchActionState, matchActionLabel } from '../lib/schedule.ts'
import type { StrategyComputation } from '../lib/types.ts'
import type { MatchRecord, MatchResultRecord, MatchViewModel } from '../lib/types.ts'
import { AiInsightPanel } from './AiInsightPanel.tsx'

interface RecommendationCardProps {
  viewModel: MatchViewModel
  budget: number
  yearMatches: MatchRecord[]
  yearResults: MatchResultRecord[]
  analysisYear: number
}

function PickList({ strategy }: { strategy: StrategyComputation }) {
  return (
    <div className="pick-list">
      {strategy.rows.map((row) => (
        <div key={`${strategy.kind}-${row.score}`} className="pick-item">
          <strong>{row.score}</strong>
          <span>{formatCurrency(row.stake)}</span>
          <small>@{formatOdds(row.odds)}</small>
        </div>
      ))}
    </div>
  )
}

export function RecommendationCard({
  viewModel,
  budget,
  yearMatches,
  yearResults,
  analysisYear,
}: RecommendationCardProps) {
  const { match, conservative, aggressive } = viewModel
  const actionState = getMatchActionState(match)

  // Base insight (local rules, instant)
  const baseInsight = buildLocalAiInsight(viewModel, yearMatches, yearResults, analysisYear)
  const [insight, setInsight] = useState<MatchAiInsight>(baseInsight)
  const fetchedRef = useRef(false)

  // Fetch Claude analysis once per card (keyed by match id + odds update time)
  useEffect(() => {
    if (!isRemoteEnabled || fetchedRef.current) return
    fetchedRef.current = true

    const controller = new AbortController()

    fetchClaudeInsight(viewModel, controller.signal)
      .then((remote) => {
        setInsight((prev) => ({ ...prev, ...remote }))
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        setInsight((prev) => ({
          ...prev,
          claudeLoading: false,
          claudeError: err instanceof Error ? err.message : '未知错误',
        }))
      })

    return () => controller.abort()
  }, [viewModel])

  return (
    <article className={match.featured ? 'recommendation-card featured' : 'recommendation-card'}>
      <header>
        <div>
          <div className="match-meta-row">
            <span className="match-code">{match.code}</span>
            <span>{match.kickoff.slice(11, 16)}</span>
            <span className={`action-badge ${actionState}`}>{matchActionLabel(actionState)}</span>
            {match.featured ? <span className="featured-badge">含原始分析</span> : null}
          </div>
          <h3>{match.homeTeam} vs {match.awayTeam}</h3>
        </div>
        <span className="budget-pill">{formatCurrency(budget)}</span>
      </header>

      {match.analysis ? <p className="analysis-summary">{match.analysis.summary}</p> : null}

      <AiInsightPanel insight={insight} />

      <section className="advice-block conservative">
        <div className="advice-title">
          <strong>保守版</strong>
          <span>{formatPercentRange(conservative.predictedCoverage)}</span>
        </div>
        <PickList strategy={conservative} />
        <p>命中覆盖比分时尽量保本或小赚，另留尾部高EV口子。</p>
      </section>

      <section className="advice-block aggressive">
        <div className="advice-title">
          <strong>进取版</strong>
          <span>{formatSignedCurrency(aggressive.expectedNet)}</span>
        </div>
        <PickList strategy={aggressive} />
        <p>两注集中押注，主路径加跨方向最优EV尾部。</p>
      </section>

      <div className="risk-line">未覆盖比分出现时，该场净亏 {formatCurrency(budget)}。</div>
    </article>
  )
}
