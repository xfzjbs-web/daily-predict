import { formatOdds, formatPercent, formatPercentRange, formatSignedCurrency } from '../lib/format.ts'
import { buildLocalAiInsight } from '../lib/aiAnalysis.ts'
import { getMatchActionState, matchActionLabel } from '../lib/schedule.ts'
import type { MatchRecord, MatchResultRecord, MatchViewModel } from '../lib/types.ts'
import { AiInsightPanel } from './AiInsightPanel.tsx'
import { StrategyPanel } from './StrategyPanel.tsx'

interface MatchCardProps {
  viewModel: MatchViewModel
  budget: number
  yearMatches: MatchRecord[]
  yearResults: MatchResultRecord[]
  analysisYear: number
}

function isNumericScore(score: string) {
  return /^\d+:\d+$/.test(score)
}

function outcomeLabel(outcome: string) {
  if (outcome === 'home') {
    return '主胜'
  }

  if (outcome === 'draw') {
    return '平局'
  }

  return '客胜'
}

export function MatchCard({ viewModel, budget, yearMatches, yearResults, analysisYear }: MatchCardProps) {
  const { match, conservative, aggressive } = viewModel
  const aiInsight = buildLocalAiInsight(viewModel, yearMatches, yearResults, analysisYear)
  const actionState = getMatchActionState(match)
  const exactEntries = match.oddsEntries.filter((entry) => isNumericScore(entry.score))
  const impliedDenominator = exactEntries.reduce((sum, entry) => sum + 1 / entry.odds, 0)
  const sortedOdds = [...match.oddsEntries].sort((left, right) => left.odds - right.odds)

  return (
    <article className="match-card" id={match.id}>
      <header className="match-card-header">
        <div>
          <div className="match-meta-row">
            <span className="match-code">{match.code}</span>
            <span>{match.leagueName}</span>
            <span className={`action-badge ${actionState}`}>{matchActionLabel(actionState)}</span>
            {match.featured ? <span className="featured-badge">HTML 分析</span> : null}
          </div>
          <h3>{match.homeTeam} vs {match.awayTeam}</h3>
          <p>
            {match.kickoff}，赔率更新 {match.oddsUpdatedAt || '待刷新'}
          </p>
        </div>
      </header>

      <div className="score-chip-row">
        {match.topScores.map((item) => (
          <span key={`${match.id}-${item.score}`} className="score-chip">
            {item.score} @{formatOdds(item.odds)}
          </span>
        ))}
      </div>

      <div className="quick-metrics">
        <span>保守覆盖 {formatPercentRange(conservative.predictedCoverage)}</span>
        <span>进取期望 {formatSignedCurrency(aggressive.expectedNet)}</span>
      </div>

      <details className="match-details">
        <summary>展开方案和完整赔率</summary>

        {match.analysis ? (
          <section className="analysis-panel">
            <p className="eyebrow">{match.analysis.structureTag}</p>
            <h4>{match.analysis.summary}</h4>
            {budget !== 100 ? (
              <p className="budget-note">下方表格已按 {budget} 元重算，原 HTML 文案中的 100 元仅作为策略背景。</p>
            ) : null}
          </section>
        ) : null}

        <div className="strategy-stack">
          <AiInsightPanel insight={aiInsight} />
          <StrategyPanel strategy={conservative} />
          <StrategyPanel strategy={aggressive} />
        </div>

        <div className="table-wrap">
          <table className="data-table odds-table">
            <thead>
              <tr>
                <th>比分</th>
                <th>方向</th>
                <th>赔率</th>
                <th>市场隐含</th>
              </tr>
            </thead>
            <tbody>
              {sortedOdds.map((entry) => {
                const implied =
                  isNumericScore(entry.score) && impliedDenominator > 0 ? (1 / entry.odds) / impliedDenominator : 0

                return (
                  <tr key={`${match.id}-${entry.score}-${entry.outcomeType}`}>
                    <td>
                      <strong>{entry.score}</strong>
                    </td>
                    <td>{outcomeLabel(entry.outcomeType)}</td>
                    <td>{formatOdds(entry.odds)}</td>
                    <td>{implied > 0 ? formatPercent(implied) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  )
}
