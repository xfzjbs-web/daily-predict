import type { MatchResultRecord } from '../lib/types.ts'

interface RecentResultsCardProps {
  results: MatchResultRecord[]
  updatedAt: string | null
  statusLabel: string
  analysisYear: number
}

function parseGoals(score: string) {
  const [homeGoals, awayGoals] = score.split(':').map(Number)
  return { homeGoals, awayGoals }
}

function formatUpdatedAt(value: string | null) {
  if (!value) return '未刷新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function RecentResultsCard({ results, updatedAt, statusLabel, analysisYear }: RecentResultsCardProps) {
  const recentResults = results.slice(0, 12)
  const homeWins = results.filter((r) => r.outcomeType === 'home').length
  const draws = results.filter((r) => r.outcomeType === 'draw').length
  const awayWins = results.filter((r) => r.outcomeType === 'away').length
  const totalGoals = results.reduce((sum, r) => {
    const { homeGoals, awayGoals } = parseGoals(r.finalScore)
    return sum + homeGoals + awayGoals
  }, 0)
  const avgGoals = results.length > 0 ? (totalGoals / results.length).toFixed(2) : '—'

  return (
    <section className="rrc">
      <div className="rrc-header">
        <span className="rrc-title">{analysisYear} 世界杯完场</span>
        <span className="rrc-meta">{statusLabel} · {formatUpdatedAt(updatedAt)}</span>
      </div>

      {results.length > 0 && (
        <div className="rrc-stats">
          <div className="rrc-stat"><strong>{results.length}</strong><small>完场</small></div>
          <div className="rrc-stat rrc-stat-wide"><strong>{homeWins}W {draws}D {awayWins}L</strong><small>胜平负</small></div>
          <div className="rrc-stat"><strong>{avgGoals}</strong><small>场均进球</small></div>
        </div>
      )}

      {recentResults.length > 0 ? (
        <div className="rrc-list">
          {recentResults.map((r) => (
            <div key={r.id} className="rrc-row">
              <div className="rrc-row-left">
                <span className="rrc-teams">{r.homeTeam} vs {r.awayTeam}</span>
                <span className="rrc-code">{r.matchDate.slice(5)} · {r.code}</span>
              </div>
              <div className="rrc-row-right">
                <span className={`rrc-score rrc-score-${r.outcomeType}`}>{r.finalScore}</span>
                {r.halfTimeScore && <span className="rrc-ht">{r.halfTimeScore}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rrc-empty">暂无今年完场数据，AI 将使用赔率样本分析。</p>
      )}
    </section>
  )
}
