import { useState } from 'react'
import { formatCurrency, formatPercent, formatSignedCurrency } from '../lib/format.ts'
import type {
  RecommendationSettlement,
  StrategyKind,
  StrategySettlement,
} from '../lib/types.ts'

interface PerformanceReviewCardProps {
  settlements: RecommendationSettlement[]
  initialMode: StrategyKind
}

function modeLabel(mode: StrategyKind) {
  return mode === 'conservative' ? '保守版' : '进取版'
}

function sourceLabel(source: RecommendationSettlement['snapshot']['source']) {
  return source === 'live-capture' ? '赛前留档' : '历史回测'
}

function strategySettlement(settlement: RecommendationSettlement, mode: StrategyKind): StrategySettlement {
  return mode === 'conservative' ? settlement.conservative : settlement.aggressive
}

export function PerformanceReviewCard({ settlements, initialMode }: PerformanceReviewCardProps) {
  const [mode, setMode] = useState<StrategyKind>(initialMode)
  const selectedSettlements = settlements.map((settlement) => ({
    settlement,
    strategy: strategySettlement(settlement, mode),
  }))
  const hitCount = selectedSettlements.filter((item) => item.strategy.hit).length
  const totalStake = selectedSettlements.reduce((sum, item) => sum + item.settlement.snapshot.budget, 0)
  const totalNet = selectedSettlements.reduce((sum, item) => sum + item.strategy.netResult, 0)
  const hitRate = settlements.length > 0 ? hitCount / settlements.length : 0
  const roi = totalStake > 0 ? totalNet / totalStake : 0
  const liveCount = settlements.filter((settlement) => settlement.snapshot.source === 'live-capture').length
  const backtestCount = settlements.length - liveCount

  return (
    <section className="performance-review-card" aria-label="建议复盘">
      <header>
        <div>
          <p className="eyebrow">结果闭环</p>
          <h2>建议复盘</h2>
        </div>
        <div className="mode-switch" role="group" aria-label="复盘方案">
          <button
            className={mode === 'conservative' ? 'active' : ''}
            type="button"
            onClick={() => setMode('conservative')}
          >
            保守
          </button>
          <button
            className={mode === 'aggressive' ? 'active' : ''}
            type="button"
            onClick={() => setMode('aggressive')}
          >
            进取
          </button>
        </div>
      </header>

      <div className="review-summary-grid">
        <div>
          <span>已结算</span>
          <strong>{settlements.length} 场</strong>
          <small>{liveCount} 赛前留档 · {backtestCount} 历史回测</small>
        </div>
        <div>
          <span>{modeLabel(mode)}命中</span>
          <strong>{hitCount} 场 · {formatPercent(hitRate)}</strong>
          <small>仅统计精确比分覆盖</small>
        </div>
        <div>
          <span>模拟净结果</span>
          <strong className={totalNet >= 0 ? 'profit-positive' : 'profit-negative'}>
            {formatSignedCurrency(totalNet)}
          </strong>
          <small>累计投入 {formatCurrency(totalStake)}</small>
        </div>
        <div>
          <span>模拟回报率</span>
          <strong className={roi >= 0 ? 'profit-positive' : 'profit-negative'}>{formatPercent(roi)}</strong>
          <small>净结果 ÷ 快照预算</small>
        </div>
      </div>

      {selectedSettlements.length > 0 ? (
        <div className="review-list">
          {selectedSettlements.slice(0, 8).map(({ settlement, strategy }) => (
            <article key={`${settlement.snapshot.id}-${mode}`}>
              <div>
                <span>
                  {settlement.result.matchDate} · {settlement.snapshot.code} · {sourceLabel(settlement.snapshot.source)}
                </span>
                <strong>{settlement.snapshot.homeTeam} vs {settlement.snapshot.awayTeam}</strong>
                <small>
                  推荐 {settlement.snapshot[mode].rows.map((row) => row.score).join(' / ')}
                </small>
              </div>
              <div className={strategy.hit ? 'review-outcome hit' : 'review-outcome miss'}>
                <strong>{settlement.result.finalScore}</strong>
                <span>{strategy.hit ? '命中' : '未覆盖'}</span>
                <small>{formatSignedCurrency(strategy.netResult)}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="result-empty">暂无可结算建议。APP 会保存后续比赛的赛前方案，并在官方赛果发布后自动复盘。</p>
      )}

      <small className="review-disclaimer">
        历史回测使用旧 HTML 保存的赛前赔率，由当前规则按固定 100 元重算；赛前留档来自 APP 自动保存。所有返还均为快照模拟，不代表实际出票或真实收益。
      </small>
    </section>
  )
}
