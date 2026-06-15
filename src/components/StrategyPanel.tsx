import { formatCurrency, formatOdds, formatPercent, formatPercentRange, formatSignedCurrency } from '../lib/format.ts'
import type { StrategyComputation } from '../lib/types.ts'

interface StrategyPanelProps {
  strategy: StrategyComputation
}

export function StrategyPanel({ strategy }: StrategyPanelProps) {
  return (
    <section className={`strategy-panel ${strategy.kind}`}>
      <header className="strategy-header">
        <div>
          <p className="eyebrow">{strategy.title}</p>
          <h3>{strategy.summary}</h3>
        </div>
        <div className={strategy.expectedNet >= 0 ? 'expected positive' : 'expected negative'}>
          <span>期望</span>
          <strong>{formatSignedCurrency(strategy.expectedNet)}</strong>
        </div>
      </header>

      <div className="strategy-stats">
        <span>预测 {formatPercentRange(strategy.predictedCoverage)}</span>
        <span>隐含 {formatPercent(strategy.impliedCoverage)}</span>
        <span>
          盈利 {formatSignedCurrency(strategy.profitRange.min)} 至 {formatSignedCurrency(strategy.profitRange.max)}
        </span>
      </div>

      {strategy.rows.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>比分</th>
                  <th>投入</th>
                  <th>赔率</th>
                  <th>返还</th>
                  <th>净盈利</th>
                  <th>预测概率</th>
                </tr>
              </thead>
              <tbody>
                {strategy.rows.map((row) => (
                  <tr key={`${strategy.kind}-${row.score}`}>
                    <td>
                      <strong>{row.score}</strong>
                      <small>{row.role}</small>
                    </td>
                    <td>{formatCurrency(row.stake)}</td>
                    <td>{formatOdds(row.odds)}</td>
                    <td>{formatCurrency(row.payout)}</td>
                    <td className={row.netProfit >= 0 ? 'profit-positive' : 'profit-negative'}>
                      {formatSignedCurrency(row.netProfit)}
                    </td>
                    <td>{formatPercentRange(row.predictedProbability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="risk-line">未覆盖比分出现时，该场净亏 {formatCurrency(strategy.riskLoss)}。</p>
        </>
      ) : (
        <p className="strategy-unavailable">暂无可执行方案，请刷新官方赔率后再查看。</p>
      )}
    </section>
  )
}
