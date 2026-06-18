import { useState, useMemo, useEffect } from 'react'
import { formatCurrency, formatOdds, formatPercent, formatSignedCurrency } from '../lib/format.ts'
import { buildLocalInsight, detectOddsDrift, type ClaudeResult, type MatchAiInsight } from '../lib/aiAnalysis.ts'
import { getMatchActionState, matchActionLabel } from '../lib/schedule.ts'
import {
  loadConfirmedBuys,
  saveConfirmedBuy,
  removeConfirmedBuy,
  type ConfirmedBuy,
  type ConfirmedPick,
} from '../lib/confirmedBuys.ts'
import type { MatchRecord, MatchResultRecord, MatchViewModel, StrategyRow } from '../lib/types.ts'

interface Props {
  viewModel: MatchViewModel
  budget: number
  onBudgetChange?: (v: number) => void
  yearMatches: MatchRecord[]
  yearResults: MatchResultRecord[]
  analysisYear: number
  claude?: ClaudeResult
  dateKey: string
}

// ── Odds override + recalculation ────────────────────────────────────────────
function recomputeRows(rows: StrategyRow[], overrides: Record<string, number>, budget: number) {
  const effective = rows.map((r) => ({ ...r, odds: overrides[r.score] ?? r.odds }))
  const totalInv = effective.reduce((s, r) => s + 1 / r.odds, 0)
  return effective.map((r) => {
    const share = totalInv > 0 ? (1 / r.odds) / totalInv : 1 / effective.length
    const stake = Math.round(budget * share)
    const payout = stake * r.odds
    return { ...r, stake, payout, netProfit: payout - budget }
  })
}

// ── AI Section ────────────────────────────────────────────────────────────────
function AiSection({
  insight,
  claude,
  topOdds,
}: {
  insight: MatchAiInsight
  claude?: ClaudeResult
  topOdds: Array<{ score: string; odds: number; outcomeType: string }>
}) {
  if (claude) {
    const confMap = { high: ['高置信', 'badge-high'], medium: ['中置信', 'badge-mid'], low: ['低置信', 'badge-low'] } as const
    const [confLabel, confCls] = confMap[claude.confidence]
    return (
      <div className="ai-section">
        <div className="ai-header">
          <span className="ai-label">Claude AI 分析</span>
          <span className={`confidence-badge ${confCls}`}>{confLabel}</span>
        </div>

        <p className="ai-verdict">{claude.verdict}</p>

        {topOdds.length > 0 && (
          <div className="ai-odds-block">
            <div className="ai-block-label">赔率隐含概率</div>
            <div className="ai-odds-rows">
              {topOdds.map((e) => {
                const impl = (1 / e.odds) * 100
                return (
                  <div key={e.score} className={`ai-odds-row ai-odds-${e.outcomeType}`}>
                    <span className="ai-odds-score">{e.score}</span>
                    <span className="ai-odds-val">@{formatOdds(e.odds)}</span>
                    <div className="ai-odds-bar-wrap">
                      <div className="ai-odds-bar" style={{ width: `${Math.min(impl * 2.5, 100)}%` }} />
                    </div>
                    <span className="ai-odds-pct">{impl.toFixed(1)}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {claude.marketInsight && (
          <div className="ai-dim-block">
            <div className="ai-block-label">盘面解读</div>
            <p className="ai-dim-text">{claude.marketInsight}</p>
          </div>
        )}

        {claude.strategyComment && (
          <div className="ai-dim-block">
            <div className="ai-block-label">投注建议</div>
            <p className="ai-dim-text">{claude.strategyComment}</p>
          </div>
        )}

        {claude.teamNews && (
          <div className="ai-dim-block">
            <div className="ai-block-label">球队动态 / 阵容</div>
            <p className="ai-dim-text">{claude.teamNews}</p>
          </div>
        )}

        {claude.keyMatchup && (
          <div className="ai-dim-block">
            <div className="ai-block-label">关键对位</div>
            {Array.isArray(claude.keyMatchup) ? (
              <ul className="ai-matchup-list">
                {claude.keyMatchup.map((pt, i) => <li key={i}>{pt}</li>)}
              </ul>
            ) : (
              <p className="ai-dim-text">{claude.keyMatchup}</p>
            )}
          </div>
        )}

        {claude.riskFlags.length > 0 && (
          <div className="ai-dim-block">
            <div className="ai-block-label">风险提示</div>
            <div className="risk-tags">
              {claude.riskFlags.map((r) => <span key={r}>{r}</span>)}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ai-section local">
      <div className="ai-header">
        <span className="ai-label">本地规则分析</span>
        <span className="ai-label-sub">基于今年赔率样本</span>
      </div>

      <p className="ai-verdict">{insight.finalVerdict}</p>

      {topOdds.length > 0 && (
        <div className="ai-odds-block">
          <div className="ai-block-label">赔率隐含概率</div>
          <div className="ai-odds-rows">
            {topOdds.map((e) => {
              const impl = (1 / e.odds) * 100
              return (
                <div key={e.score} className={`ai-odds-row ai-odds-${e.outcomeType}`}>
                  <span className="ai-odds-score">{e.score}</span>
                  <span className="ai-odds-val">@{formatOdds(e.odds)}</span>
                  <div className="ai-odds-bar-wrap">
                    <div className="ai-odds-bar" style={{ width: `${Math.min(impl * 2.5, 100)}%` }} />
                  </div>
                  <span className="ai-odds-pct">{impl.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="ai-dim-block">
        <div className="ai-block-label">历史基准</div>
        <p className="ai-dim-text">{insight.yearConclusion}</p>
      </div>
      <div className="ai-dim-block">
        <div className="ai-block-label">市场分析</div>
        <p className="ai-dim-text">{insight.marketConclusion}</p>
      </div>

      {insight.riskFlags.length > 0 && (
        <div className="ai-dim-block">
          <div className="ai-block-label">风险提示</div>
          <div className="risk-tags">
            {insight.riskFlags.map((r) => <span key={r}>{r}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Drift Warning ─────────────────────────────────────────────────────────────
function DriftWarning({ matchId, currentOdds, dateKey }: { matchId: string; currentOdds: Record<string, number>; dateKey: string }) {
  const drift = useMemo(
    () => detectOddsDrift(matchId, currentOdds, dateKey),
    [matchId, currentOdds, dateKey],
  )
  if (!drift.drifted) return null
  return (
    <div className="drift-warning">
      ⚠ 赔率已变动（{drift.changes.slice(0, 3).map((c) => `${c.score}: ${formatOdds(c.from)}→${formatOdds(c.to)}`).join('，')}），建议重新分析
    </div>
  )
}

// ── Buy Section ───────────────────────────────────────────────────────────────
function BuySection({
  viewModel,
  budget,
  onBudgetChange,
  claude,
  onConfirm,
  confirmedBuy,
}: {
  viewModel: MatchViewModel
  budget: number
  onBudgetChange?: (v: number) => void
  claude?: ClaudeResult
  onConfirm: (buy: ConfirmedBuy) => void
  confirmedBuy: ConfirmedBuy | null
}) {
  const { match, conservative, aggressive } = viewModel
  const [mode, setMode] = useState<'conservative' | 'aggressive'>('conservative')
  const [editingOdds, setEditingOdds] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [confirmed, setConfirmed] = useState(!!confirmedBuy)
  const [budgetInput, setBudgetInput] = useState(String(budget))

  useEffect(() => {
    setConfirmed(!!confirmedBuy)
  }, [confirmedBuy])

  const claudeAdjusted = mode === 'conservative'
    ? claude?.adjustedConservative
    : claude?.adjustedAggressive
      ? [claude.adjustedAggressive.main, claude.adjustedAggressive.tail]
      : null

  const baseRows = mode === 'conservative' ? conservative.rows : aggressive.rows

  const activeRows = useMemo((): StrategyRow[] => {
    if (!claudeAdjusted) return baseRows
    const scoreMap = new Map(baseRows.map((r) => [r.score, r]))
    return claudeAdjusted.map((score) => {
      const base = scoreMap.get(score)
      if (base) return base
      const entry = match.oddsEntries.find((e) => e.score === score)
      const odds = entry?.odds ?? 8
      return {
        score, odds, stake: 0, payout: 0, netProfit: 0,
        role: 'claude', emphasis: 'main' as const,
        predictedProbability: { low: 0, mid: 0, high: 0 },
        impliedProbability: 1 / odds,
        outcomeType: entry?.outcomeType ?? 'home',
      }
    })
  }, [baseRows, claudeAdjusted, match.oddsEntries])

  const rows = useMemo(() => recomputeRows(activeRows, overrides, budget), [activeRows, overrides, budget])

  const totalStake = rows.reduce((s, r) => s + r.stake, 0)
  const maxPayout = rows.reduce((max, r) => Math.max(max, r.payout), 0)
  const expNet = rows.reduce((s, r) => {
    const impl = 1 / (overrides[r.score] ?? r.odds)
    return s + impl * r.payout - r.stake
  }, 0)
  const coveragePct = rows.reduce((s, r) => s + r.impliedProbability, 0)

  const handleConfirm = () => {
    const picks: ConfirmedPick[] = rows.map((r) => ({
      score: r.score,
      odds: overrides[r.score] ?? r.odds,
      stake: r.stake,
    }))
    const buy: ConfirmedBuy = {
      matchId: match.id,
      matchDate: match.kickoff.slice(0, 10),
      code: match.code,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      picks,
      totalStake,
      source: claudeAdjusted ? 'claude' : 'algorithm',
      strategy: mode,
      confirmedAt: new Date().toISOString(),
    }
    saveConfirmedBuy(buy)
    setConfirmed(true)
    onConfirm(buy)
  }

  const handleUnconfirm = () => {
    removeConfirmedBuy(match.id)
    setConfirmed(false)
    onConfirm({ ...confirmedBuy! } as ConfirmedBuy)
  }

  if (confirmed && confirmedBuy) {
    return (
      <div className="buy-section">
        <div className="confirmed-banner">
          <div>
            <strong>✓ 已买入</strong>
            <span>{confirmedBuy.strategy === 'conservative' ? '保守' : '进取'} · {confirmedBuy.source === 'claude' ? 'Claude调整' : '算法'}</span>
          </div>
          <div className="confirmed-picks">
            {confirmedBuy.picks.map((p) => (
              <span key={p.score} className="confirmed-pick">
                {p.score} <em>@{formatOdds(p.odds)}</em> ¥{p.stake}
              </span>
            ))}
          </div>
          <div className="confirmed-meta">
            总投入 {formatCurrency(confirmedBuy.totalStake)} · {new Date(confirmedBuy.confirmedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 确认
            <button type="button" className="unconfirm-btn" onClick={handleUnconfirm}>撤销</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="buy-section">
      <div className="budget-row-inline">
        <span>单场预算</span>
        <div className="budget-inputs">
          {[50, 100, 200].map((v) => (
            <button key={v} type="button"
              className={budget === v ? 'quick-budget active' : 'quick-budget'}
              onClick={() => { onBudgetChange?.(v); setBudgetInput(String(v)) }}
            >{v}</button>
          ))}
          <input type="number" className="budget-input" min="1" value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            onBlur={() => {
              const n = parseInt(budgetInput, 10)
              if (n > 0) onBudgetChange?.(n)
              else setBudgetInput(String(budget))
            }}
          />
        </div>
      </div>
      <div className="buy-header">
        <div className="mode-tabs">
          <button type="button" className={mode === 'conservative' ? 'mode-tab active' : 'mode-tab'} onClick={() => setMode('conservative')}>保守</button>
          <button type="button" className={mode === 'aggressive' ? 'mode-tab active' : 'mode-tab'} onClick={() => setMode('aggressive')}>进取</button>
        </div>
        {claudeAdjusted && <span className="claude-adjusted-badge">Claude 调整版</span>}
        <button
          type="button"
          className={editingOdds ? 'edit-odds-btn active' : 'edit-odds-btn'}
          onClick={() => { setEditingOdds(!editingOdds); setOverrides({}) }}
        >
          {editingOdds ? '重置赔率' : '调整赔率'}
        </button>
      </div>

      <table className="pick-table">
        <thead>
          <tr><th>比分</th><th>赔率</th><th>投注</th><th>回报</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.score}>
              <td><strong>{row.score}</strong></td>
              <td>
                {editingOdds ? (
                  <input
                    type="number"
                    className="odds-input"
                    min="1.01"
                    step="0.1"
                    defaultValue={overrides[row.score] ?? row.odds}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (v >= 1.01) setOverrides((p) => ({ ...p, [row.score]: v }))
                    }}
                  />
                ) : (
                  <span>{formatOdds(overrides[row.score] ?? row.odds)}</span>
                )}
              </td>
              <td>{formatCurrency(row.stake)}</td>
              <td className={row.payout > budget ? 'text-green' : 'text-muted'}>{formatCurrency(row.payout)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="buy-summary">
        <div className="buy-metric">
          <span>总投入</span>
          <strong>{formatCurrency(totalStake)}</strong>
        </div>
        <div className="buy-metric">
          <span>最高回报</span>
          <strong className="text-green">{formatCurrency(maxPayout)}</strong>
        </div>
        <div className="buy-metric">
          <span>期望净值</span>
          <strong className={expNet >= 0 ? 'text-green' : 'text-red'}>{formatSignedCurrency(expNet)}</strong>
        </div>
        <div className="buy-metric">
          <span>盘口覆盖</span>
          <strong>{formatPercent(Math.min(coveragePct, 1))}</strong>
        </div>
      </div>

      <button type="button" className="confirm-buy-btn" onClick={handleConfirm}>
        确认买入 · {formatCurrency(totalStake)}
      </button>
    </div>
  )
}

// ── Main card ─────────────────────────────────────────────────────────────────
export function MatchAnalysisCard({ viewModel, budget, onBudgetChange, yearMatches, yearResults, analysisYear, claude, dateKey }: Props) {
  const { match } = viewModel
  const [expanded, setExpanded] = useState(false)
  const [confirmedBuy, setConfirmedBuy] = useState<ConfirmedBuy | null>(
    () => loadConfirmedBuys().find((b) => b.matchId === match.id) ?? null,
  )
  const actionState = getMatchActionState(match)

  const insight = useMemo(
    () => buildLocalInsight(viewModel, yearMatches, yearResults, analysisYear),
    [viewModel, yearMatches, yearResults, analysisYear],
  )

  const topOdds = [...match.oddsEntries]
    .filter((e) => /^\d+:\d+$/.test(e.score))
    .sort((a, b) => a.odds - b.odds)
    .slice(0, 5)

  const currentOddsMap = Object.fromEntries(
    match.oddsEntries.filter((e) => /^\d+:\d+$/.test(e.score)).map((e) => [e.score, e.odds])
  )

  return (
    <article className={`match-card ${expanded ? 'expanded' : ''} ${confirmedBuy ? 'bought' : ''}`}>
      <button
        type="button"
        className="match-card-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="match-info">
          <div className="match-meta">
            <span className="match-code">{match.code}</span>
            <span className="match-time">{match.kickoff.slice(5, 16).replace('T', ' ')}</span>
            <span className={`action-badge ${actionState}`}>{matchActionLabel(actionState)}</span>
            {claude && !confirmedBuy && <span className="analyzed-badge">已分析</span>}
            {confirmedBuy && <span className="bought-badge">已买入</span>}
          </div>
          <div className="match-teams">
            <span className="team home">{match.homeTeam}</span>
            <span className="vs">vs</span>
            <span className="team away">{match.awayTeam}</span>
          </div>
          <div className="odds-chips">
            {topOdds.map((e) => (
              <span key={e.score} className={`odds-chip ${e.outcomeType}`}>
                {e.score} <em>@{formatOdds(e.odds)}</em>
              </span>
            ))}
          </div>
        </div>
        <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="match-card-body">
          {claude && (
            <DriftWarning matchId={match.id} currentOdds={currentOddsMap} dateKey={dateKey} />
          )}
          <AiSection insight={insight} claude={claude} topOdds={topOdds} />
          <div className="section-divider" />
          <BuySection
            viewModel={viewModel}
            budget={budget}
            onBudgetChange={onBudgetChange}
            claude={claude}
            onConfirm={setConfirmedBuy}
            confirmedBuy={confirmedBuy}
          />
        </div>
      )}
    </article>
  )
}
