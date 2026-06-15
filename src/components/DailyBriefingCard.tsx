import { formatCurrency, formatPercent, formatSignedCurrency } from '../lib/format.ts'
import type { MatchViewModel } from '../lib/types.ts'

interface DailyBriefingCardProps {
  viewModels: MatchViewModel[]
  budget: number
  dateKey: string
  analysisYear: number
  autoRefresh: boolean
}

const REMOTE_AI_ENABLED = Boolean(import.meta.env.VITE_AI_ANALYSIS_ENDPOINT)

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function getBestBy<T>(items: T[], score: (item: T) => number) {
  return [...items].sort((left, right) => score(right) - score(left))[0]
}

export function DailyBriefingCard({
  viewModels,
  budget,
  dateKey,
  analysisYear,
  autoRefresh,
}: DailyBriefingCardProps) {
  const matchCount = viewModels.length
  const totalRisk = matchCount * budget
  const conservativeExpected = viewModels.reduce((sum, item) => sum + item.conservative.expectedNet, 0)
  const aggressiveExpected = viewModels.reduce((sum, item) => sum + item.aggressive.expectedNet, 0)
  const averageConservativeCoverage = average(viewModels.map((item) => item.conservative.predictedCoverage.mid))
  const highestCoverageMatch = getBestBy(viewModels, (item) => item.conservative.predictedCoverage.mid)
  const bestExpectedMatch = getBestBy(viewModels, (item) => item.conservative.expectedNet)
  const defaultMode =
    matchCount === 0
      ? '等待赛程'
      : averageConservativeCoverage >= 0.5 || conservativeExpected >= aggressiveExpected
        ? '优先保守版'
        : '保守为主，进取小注'
  const aiStatus = REMOTE_AI_ENABLED ? '远端 AI 代理已配置' : '本地 AI 规则已实装'

  return (
    <section className="daily-briefing-card" aria-label="每日预测总览">
      <header>
        <div>
          <p className="eyebrow">上线总览</p>
          <h2>{dateKey} 购买建议总览</h2>
        </div>
        <span>{defaultMode}</span>
      </header>

      <div className="briefing-grid">
        <div>
          <span>赛程范围</span>
          <strong>只看 {analysisYear}</strong>
          <small>{matchCount} 场比赛，单场预算 {formatCurrency(budget)}</small>
        </div>
        <div>
          <span>最大回撤</span>
          <strong>{formatCurrency(totalRisk)}</strong>
          <small>全部未覆盖比分出现时的合计亏损</small>
        </div>
        <div>
          <span>AI 状态</span>
          <strong>{aiStatus}</strong>
          <small>
            {REMOTE_AI_ENABLED
              ? '由服务端代理接入，前端不保存密钥'
              : '未配置远端模型，结论来自今年官方赛果和赔率样本'}
          </small>
        </div>
      </div>

      <div className="briefing-list">
        <p>
          <strong>默认打法：</strong>
          {defaultMode}；保守版合计期望 {formatSignedCurrency(conservativeExpected)}，进取版合计期望{' '}
          {formatSignedCurrency(aggressiveExpected)}。
        </p>
        <p>
          <strong>覆盖观察：</strong>
          保守版平均覆盖约 {formatPercent(averageConservativeCoverage)}
          {highestCoverageMatch
            ? `，覆盖最高为 ${highestCoverageMatch.match.homeTeam} vs ${highestCoverageMatch.match.awayTeam}。`
            : '。'}
        </p>
        <p>
          <strong>执行提醒：</strong>
          {bestExpectedMatch
            ? `先看 ${bestExpectedMatch.match.homeTeam} vs ${bestExpectedMatch.match.awayTeam} 的保守版组合；`
            : '暂无可执行比赛；'}
          自动刷新{autoRefresh ? '已开启，每 5 分钟刷新一次赔率。' : '已暂停，建议赛前手动刷新赔率。'}
        </p>
      </div>
    </section>
  )
}
