import type { MatchAiInsight } from '../lib/aiAnalysis.ts'
import { formatPercent } from '../lib/format.ts'

interface AiInsightPanelProps {
  insight: MatchAiInsight
}

function formatNullablePercent(value: number | null) {
  return value === null ? '暂无样本' : formatPercent(value)
}

function ContextBlock({ context }: { context: MatchAiInsight['homeContext'] }) {
  return (
    <div>
      <strong>{context.team}</strong>
      <span>
        赛果 {context.wins}胜{context.draws}平{context.losses}负
        {context.recentForm ? ` · ${context.recentForm}` : ''}
      </span>
      <span>赔率样本 {context.matchCount} 场 · 胜向 {formatNullablePercent(context.averageWinImplied)}</span>
      <small>{context.summary}</small>
    </div>
  )
}

function confidenceLabel(c: 'low' | 'medium' | 'high') {
  if (c === 'high') return '高置信'
  if (c === 'medium') return '中置信'
  return '低置信'
}

export function AiInsightPanel({ insight }: AiInsightPanelProps) {
  const isRemote = insight.mode === 'remote-claude'
  const isLoading = insight.claudeLoading

  return (
    <section className="ai-insight-panel">
      <header>
        <div>
          <p className="eyebrow">AI 分析</p>
          {isRemote && insight.claudeVerdict ? (
            <h4>{insight.claudeVerdict}</h4>
          ) : isLoading ? (
            <h4 className="ai-loading">Claude 分析中…</h4>
          ) : (
            <h4>{insight.finalVerdict}</h4>
          )}
        </div>
        <span className={isRemote && !isLoading ? 'ai-mode remote' : 'ai-mode'}>
          {isLoading ? '请求中' : insight.modeLabel}
          {insight.claudeConfidence ? ` · ${confidenceLabel(insight.claudeConfidence)}` : ''}
        </span>
      </header>

      {/* Claude remote analysis */}
      {isRemote && !isLoading && !insight.claudeError ? (
        <>
          {insight.claudeMarketInsight ? (
            <div className="ai-verdict-list">
              <p><strong>盘面：</strong>{insight.claudeMarketInsight}</p>
              {insight.claudeStrategyComment ? (
                <p><strong>策略：</strong>{insight.claudeStrategyComment}</p>
              ) : null}
            </div>
          ) : null}

          {(insight.claudeAdjustedConservative || insight.claudeAdjustedAggressive) ? (
            <div className="claude-adjustments">
              {insight.claudeAdjustedConservative ? (
                <div className="claude-adj-row">
                  <span>Claude 保守调整</span>
                  <div className="claude-adj-picks">
                    {insight.claudeAdjustedConservative.map((s) => (
                      <span key={s} className="claude-pick">{s}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {insight.claudeAdjustedAggressive ? (
                <div className="claude-adj-row">
                  <span>Claude 进取调整</span>
                  <div className="claude-adj-picks">
                    <span className="claude-pick main">{insight.claudeAdjustedAggressive.main}</span>
                    <span className="claude-pick tail">{insight.claudeAdjustedAggressive.tail}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="history-compare">
            <ContextBlock context={insight.homeContext} />
            <ContextBlock context={insight.awayContext} />
          </div>

          {insight.riskFlags.length > 0 ? (
            <div className="risk-tags">
              {insight.riskFlags.map((risk) => (
                <span key={risk}>{risk}</span>
              ))}
            </div>
          ) : null}
        </>
      ) : isRemote && insight.claudeError ? (
        <>
          <p className="ai-error">Claude 分析失败：{insight.claudeError}，以下为本地规则结果。</p>
          <LocalFallback insight={insight} />
        </>
      ) : (
        <LocalFallback insight={insight} />
      )}

      <small className="ai-scope">
        {insight.scope}
        {isRemote && !isLoading ? ' · Claude AI 辅助分析' : ' · 本地规则辅助判断'}
        ；不保证命中。
      </small>
    </section>
  )
}

function LocalFallback({ insight }: { insight: MatchAiInsight }) {
  return (
    <>
      <div className="history-compare">
        <ContextBlock context={insight.homeContext} />
        <ContextBlock context={insight.awayContext} />
      </div>
      <div className="ai-verdict-list">
        <p>{insight.yearConclusion}</p>
        <p>{insight.marketConclusion}</p>
        <p>{insight.strategyConclusion}</p>
      </div>
      {insight.riskFlags.length > 0 ? (
        <div className="risk-tags">
          {insight.riskFlags.map((risk) => (
            <span key={risk}>{risk}</span>
          ))}
        </div>
      ) : null}
    </>
  )
}
