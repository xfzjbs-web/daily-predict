import { useState } from 'react'
import { formatCurrency, formatOdds, formatPercent, formatSignedCurrency } from '../lib/format.ts'
import type { MatchViewModel, StrategyComputation, StrategyKind } from '../lib/types.ts'

interface ExecutionSlipCardProps {
  viewModels: MatchViewModel[]
  dateKey: string
  budget: number
  mode: StrategyKind
  onModeChange: (mode: StrategyKind) => void
}

function getStrategy(viewModel: MatchViewModel, mode: StrategyKind) {
  return mode === 'conservative' ? viewModel.conservative : viewModel.aggressive
}

function modeLabel(mode: StrategyKind) {
  return mode === 'conservative' ? '保守版' : '进取版'
}

function buildSlipText(viewModels: MatchViewModel[], dateKey: string, budget: number, mode: StrategyKind) {
  const lines = [
    `每日预测 ${dateKey} ${modeLabel(mode)}`,
    `单场预算：${formatCurrency(budget)}`,
    `场次：${viewModels.length} 场`,
    '',
  ]

  for (const viewModel of viewModels) {
    const strategy = getStrategy(viewModel, mode)
    lines.push(`${viewModel.match.code} ${viewModel.match.kickoff.slice(11, 16)} ${viewModel.match.homeTeam} vs ${viewModel.match.awayTeam}`)

    for (const row of strategy.rows) {
      lines.push(
        `${row.score} ${row.role}：投 ${formatCurrency(row.stake)}，赔率 ${formatOdds(row.odds)}，命中返还 ${formatCurrency(row.payout)}，净 ${formatSignedCurrency(row.netProfit)}`,
      )
    }

    lines.push(`覆盖：${formatPercent(strategy.predictedCoverage.mid)}，期望：${formatSignedCurrency(strategy.expectedNet)}`)
    lines.push(`风险：未覆盖比分出现时，该场净亏 ${formatCurrency(strategy.riskLoss)}`)
    lines.push('')
  }

  return lines.join('\n').trim()
}

function StrategyLine({ strategy }: { strategy: StrategyComputation }) {
  return (
    <div className="execution-strategy-line">
      <span>覆盖 {formatPercent(strategy.predictedCoverage.mid)}</span>
      <span>期望 {formatSignedCurrency(strategy.expectedNet)}</span>
      <span>
        收益 {formatSignedCurrency(strategy.profitRange.min)} 至 {formatSignedCurrency(strategy.profitRange.max)}
      </span>
    </div>
  )
}

export function ExecutionSlipCard({ viewModels, dateKey, budget, mode, onModeChange }: ExecutionSlipCardProps) {
  const [copyStatus, setCopyStatus] = useState('')
  const totalStake = viewModels.length * budget
  const totalExpected = viewModels.reduce((sum, viewModel) => sum + getStrategy(viewModel, mode).expectedNet, 0)
  const averageCoverage =
    viewModels.length === 0
      ? 0
      : viewModels.reduce((sum, viewModel) => sum + getStrategy(viewModel, mode).predictedCoverage.mid, 0) /
        viewModels.length
  const selectedText = buildSlipText(viewModels, dateKey, budget, mode)

  const copySlip = async () => {
    try {
      await navigator.clipboard.writeText(selectedText)
      setCopyStatus('已复制清单，可粘贴到备忘录或聊天里。')
    } catch {
      setCopyStatus('复制失败，可长按下方文本手动复制。')
    }
  }

  return (
    <section className="execution-slip-card" aria-label="执行清单">
      <header>
        <div>
          <p className="eyebrow">执行清单</p>
          <h2>{dateKey} 可直接照单检查</h2>
        </div>
        <div className="mode-switch" role="group" aria-label="购买模式">
          <button
            className={mode === 'conservative' ? 'active' : ''}
            type="button"
            onClick={() => onModeChange('conservative')}
          >
            保守
          </button>
          <button
            className={mode === 'aggressive' ? 'active' : ''}
            type="button"
            onClick={() => onModeChange('aggressive')}
          >
            进取
          </button>
        </div>
      </header>

      <div className="execution-summary">
        <div>
          <span>当前模式</span>
          <strong>{modeLabel(mode)}</strong>
        </div>
        <div>
          <span>总投入</span>
          <strong>{formatCurrency(totalStake)}</strong>
        </div>
        <div>
          <span>平均覆盖</span>
          <strong>{formatPercent(averageCoverage)}</strong>
        </div>
        <div>
          <span>合计期望</span>
          <strong className={totalExpected >= 0 ? 'profit-positive' : 'profit-negative'}>
            {formatSignedCurrency(totalExpected)}
          </strong>
        </div>
      </div>

      <div className="execution-list">
        {viewModels.map((viewModel) => {
          const strategy = getStrategy(viewModel, mode)

          return (
            <article key={`${viewModel.match.id}-${mode}`} className="execution-match">
              <header>
                <div>
                  <span className="match-code">{viewModel.match.code}</span>
                  <strong>
                    {viewModel.match.kickoff.slice(11, 16)} {viewModel.match.homeTeam} vs {viewModel.match.awayTeam}
                  </strong>
                </div>
                <small>风险 {formatCurrency(strategy.riskLoss)}</small>
              </header>
              <div className="execution-picks">
                {strategy.rows.map((row) => (
                  <span key={`${viewModel.match.id}-${mode}-${row.score}`}>
                    <strong>{row.score}</strong>
                    {formatCurrency(row.stake)} @{formatOdds(row.odds)}
                  </span>
                ))}
              </div>
              <StrategyLine strategy={strategy} />
            </article>
          )
        })}
      </div>

      <div className="execution-copy-row">
        <button type="button" onClick={() => void copySlip()}>
          复制清单
        </button>
        <span>{copyStatus || '复制前请赛前刷新赔率；实际购买以体彩最终出票为准。'}</span>
      </div>

      <textarea className="execution-textarea" readOnly value={selectedText} aria-label="可复制执行清单" />
    </section>
  )
}
