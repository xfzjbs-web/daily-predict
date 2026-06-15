import type { MatchResultRecord } from '../lib/types.ts'

interface RecentResultsCardProps {
  results: MatchResultRecord[]
  updatedAt: string | null
  statusLabel: string
  analysisYear: number
}

function parseGoals(score: string) {
  const [homeGoals, awayGoals] = score.split(':').map(Number)

  return {
    homeGoals,
    awayGoals,
  }
}

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return '尚未刷新'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function RecentResultsCard({ results, updatedAt, statusLabel, analysisYear }: RecentResultsCardProps) {
  const recentResults = results.slice(0, 8)
  const homeWins = results.filter((result) => result.outcomeType === 'home').length
  const draws = results.filter((result) => result.outcomeType === 'draw').length
  const awayWins = results.filter((result) => result.outcomeType === 'away').length
  const totalGoals = results.reduce((sum, result) => {
    const { homeGoals, awayGoals } = parseGoals(result.finalScore)
    return sum + homeGoals + awayGoals
  }, 0)
  const averageGoals = results.length > 0 ? totalGoals / results.length : 0

  return (
    <section className="recent-results-card" aria-label="今年近期世界杯赛果">
      <header>
        <div>
          <p className="eyebrow">官方赛果</p>
          <h2>{analysisYear} 年近期世界杯完场</h2>
        </div>
        <span>{statusLabel}</span>
      </header>

      <div className="result-summary-grid">
        <div>
          <span>完场样本</span>
          <strong>{results.length} 场</strong>
        </div>
        <div>
          <span>胜平负</span>
          <strong>{homeWins} 主胜 · {draws} 平 · {awayWins} 客胜</strong>
        </div>
        <div>
          <span>场均进球</span>
          <strong>{averageGoals.toFixed(2)}</strong>
        </div>
        <div>
          <span>更新时间</span>
          <strong>{formatUpdatedAt(updatedAt)}</strong>
        </div>
      </div>

      {recentResults.length > 0 ? (
        <div className="result-list">
          {recentResults.map((result) => (
            <article key={result.id}>
              <div>
                <span>{result.matchDate} · {result.code}</span>
                <strong>{result.homeTeam} vs {result.awayTeam}</strong>
              </div>
              <div className="result-score">
                <strong>{result.finalScore}</strong>
                <small>{result.halfTimeScore ? `半场 ${result.halfTimeScore}` : '全场'}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="result-empty">当前尚未获取到今年世界杯官方完场赛果，AI 将继续使用今年赔率样本分析。</p>
      )}

      <small className="result-source">来源：中国体育彩票足球赛果开奖接口；只保留今年世界杯完场数据。</small>
    </section>
  )
}
