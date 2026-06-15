import type { MatchRecord, MatchResultRecord, OutcomeType } from '../lib/types.ts'

export interface TeamCurrentYearContext {
  team: string
  year: number
  matchCount: number
  oddsCount: number
  analysisCount: number
  resultCount: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  pointsPerMatch: number | null
  recentForm: string
  averageWinImplied: number | null
  averageDrawImplied: number | null
  summary: string
  tags: string[]
}

export const CURRENT_YEAR_CONTEXT_NOTE = '仅使用今年官方完场赛果、已加载赛程、比分赔率和同年分析文本'

function isNumericScore(score: string) {
  return /^\d+:\d+$/.test(score)
}

function getMatchYear(match: MatchRecord) {
  return Number(match.kickoff.slice(0, 4))
}

function impliedOutcomeTotals(match: MatchRecord) {
  const exactEntries = match.oddsEntries.filter((entry) => isNumericScore(entry.score))
  const denominator = exactEntries.reduce((sum, entry) => sum + 1 / entry.odds, 0)
  const totals: Record<OutcomeType, number> = {
    home: 0,
    draw: 0,
    away: 0,
  }

  if (denominator <= 0) {
    return totals
  }

  for (const entry of exactEntries) {
    totals[entry.outcomeType] += (1 / entry.odds) / denominator
  }

  return totals
}

export function filterMatchesByYear(matches: MatchRecord[], year: number) {
  return matches.filter((match) => getMatchYear(match) === year)
}

export function buildTeamCurrentYearContext(
  team: string,
  matches: MatchRecord[],
  results: MatchResultRecord[],
  year: number,
): TeamCurrentYearContext {
  const yearMatches = filterMatchesByYear(matches, year).filter(
    (match) => match.homeTeam === team || match.awayTeam === team,
  )
  const oddsCount = yearMatches.reduce((sum, match) => sum + match.oddsEntries.length, 0)
  const analysisCount = yearMatches.filter((match) => match.analysis).length
  const teamResults = results.filter(
    (result) =>
      Number(result.matchDate.slice(0, 4)) === year && (result.homeTeam === team || result.awayTeam === team),
  )
  let wins = 0
  let draws = 0
  let losses = 0
  let goalsFor = 0
  let goalsAgainst = 0
  const resultForms = teamResults.map((result) => {
    const isHome = result.homeTeam === team
    const [homeGoals, awayGoals] = result.finalScore.split(':').map(Number)
    const teamGoals = isHome ? homeGoals : awayGoals
    const opponentGoals = isHome ? awayGoals : homeGoals

    goalsFor += teamGoals
    goalsAgainst += opponentGoals

    if (teamGoals > opponentGoals) {
      wins += 1
      return '胜'
    }

    if (teamGoals === opponentGoals) {
      draws += 1
      return '平'
    }

    losses += 1
    return '负'
  })
  const recentForm = resultForms.slice(0, 5).join(' ')
  const pointsPerMatch = teamResults.length > 0 ? (wins * 3 + draws) / teamResults.length : null
  const impliedSamples = yearMatches.map((match) => {
    const totals = impliedOutcomeTotals(match)
    const isHome = match.homeTeam === team

    return {
      win: isHome ? totals.home : totals.away,
      draw: totals.draw,
    }
  })
  const averageWinImplied =
    impliedSamples.length > 0
      ? impliedSamples.reduce((sum, sample) => sum + sample.win, 0) / impliedSamples.length
      : null
  const averageDrawImplied =
    impliedSamples.length > 0
      ? impliedSamples.reduce((sum, sample) => sum + sample.draw, 0) / impliedSamples.length
      : null
  const tags = [
    teamResults.length > 0 ? `今年赛果 ${wins}胜${draws}平${losses}负` : '今年暂无官方完场样本',
    yearMatches.length >= 3 ? '今年样本较多' : '今年样本较少',
    analysisCount > 0 ? '含同年人工分析' : '仅赔率样本',
    averageWinImplied !== null && averageWinImplied >= 0.45 ? '今年盘面偏强' : '',
    averageWinImplied !== null && averageWinImplied <= 0.28 ? '今年盘面偏弱' : '',
  ].filter(Boolean)
  const summary =
    teamResults.length > 0
      ? `${year} 年官方完场样本 ${team} 为 ${wins}胜${draws}平${losses}负，进 ${goalsFor} 球失 ${goalsAgainst} 球；另有 ${yearMatches.length} 场本地赔率样本。`
      : averageWinImplied === null
        ? `${year} 年当前数据中暂无 ${team} 的官方完场或同队赔率样本，判断会更依赖当前场赔率。`
        : `${year} 年暂无 ${team} 的官方完场样本；已加载 ${yearMatches.length} 场同队赔率样本，平均胜向隐含约 ${(averageWinImplied * 100).toFixed(1)}%。`

  return {
    team,
    year,
    matchCount: yearMatches.length,
    oddsCount,
    analysisCount,
    resultCount: teamResults.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    pointsPerMatch,
    recentForm,
    averageWinImplied,
    averageDrawImplied,
    summary,
    tags,
  }
}
