import {
  CURRENT_YEAR_CONTEXT_NOTE,
  buildTeamCurrentYearContext,
  type TeamCurrentYearContext,
} from '../data/current-year-context.ts'
import { formatPercent, formatPercentRange, formatSignedCurrency } from './format.ts'
import type { MatchRecord, MatchResultRecord, MatchViewModel, OutcomeType } from './types.ts'

export interface MatchAiInsight {
  mode: 'local-current-year-rules' | 'remote-claude'
  modeLabel: string
  scope: string
  homeContext: TeamCurrentYearContext
  awayContext: TeamCurrentYearContext
  yearConclusion: string
  marketConclusion: string
  strategyConclusion: string
  finalVerdict: string
  riskFlags: string[]
  // Remote Claude fields (only set when mode === 'remote-claude')
  claudeVerdict?: string
  claudeMarketInsight?: string
  claudeStrategyComment?: string
  claudeConfidence?: 'low' | 'medium' | 'high'
  claudeAdjustedConservative?: string[] | null
  claudeAdjustedAggressive?: { main: string; tail: string } | null
  claudeLoading?: boolean
  claudeError?: string
}

const AI_ANALYSIS_ENDPOINT = import.meta.env.VITE_AI_ANALYSIS_ENDPOINT as string | undefined

// In-memory cache: matchId+oddsUpdatedAt → remote result
const remoteCache = new Map<string, Partial<MatchAiInsight>>()

function isNumericScore(score: string) {
  return /^\d+:\d+$/.test(score)
}

function outcomeLabel(outcomeType: OutcomeType) {
  if (outcomeType === 'home') return '主队方向'
  if (outcomeType === 'away') return '客队方向'
  return '平局方向'
}

function impliedOutcomeTotals(match: MatchRecord) {
  const exactEntries = match.oddsEntries.filter((entry) => isNumericScore(entry.score))
  const denominator = exactEntries.reduce((sum, entry) => sum + 1 / entry.odds, 0)
  const totals: Record<OutcomeType, number> = { home: 0, draw: 0, away: 0 }
  if (denominator <= 0) return totals
  for (const entry of exactEntries) {
    totals[entry.outcomeType] += (1 / entry.odds) / denominator
  }
  return totals
}

function getMarketLeader(match: MatchRecord) {
  const totals = impliedOutcomeTotals(match)
  const [outcomeType, value] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] as [OutcomeType, number]
  return { outcomeType, value }
}

function currentYearDirection(home: TeamCurrentYearContext, away: TeamCurrentYearContext) {
  if (home.pointsPerMatch !== null && away.pointsPerMatch !== null) {
    const resultGap = home.pointsPerMatch - away.pointsPerMatch
    if (Math.abs(resultGap) < 0.45) return 'balanced' as const
    return resultGap > 0 ? 'home' : 'away'
  }
  if (home.averageWinImplied === null || away.averageWinImplied === null) return 'insufficient' as const
  const gap = home.averageWinImplied - away.averageWinImplied
  if (Math.abs(gap) < 0.08) return 'balanced' as const
  return gap > 0 ? 'home' : 'away'
}

function directionTeamName(direction: ReturnType<typeof currentYearDirection>, match: MatchRecord) {
  if (direction === 'home') return match.homeTeam
  if (direction === 'away') return match.awayTeam
  if (direction === 'balanced') return '两队接近'
  return '样本不足'
}

function formatNullablePercent(value: number | null) {
  return value === null ? '暂无' : formatPercent(value)
}

function buildYearConclusion(home: TeamCurrentYearContext, away: TeamCurrentYearContext, match: MatchRecord) {
  const direction = currentYearDirection(home, away)
  if (home.resultCount > 0 || away.resultCount > 0) {
    const homeRecord = home.resultCount > 0 ? `${home.team} ${home.wins}胜${home.draws}平${home.losses}负` : `${home.team} 暂无完场`
    const awayRecord = away.resultCount > 0 ? `${away.team} ${away.wins}胜${away.draws}平${away.losses}负` : `${away.team} 暂无完场`
    if (direction === 'balanced') return `${home.year} 年官方完场样本接近：${homeRecord}，${awayRecord}；当前仍需结合本场赔率分布。`
    if (direction !== 'insufficient') return `${home.year} 年官方完场样本更偏 ${directionTeamName(direction, match)}：${homeRecord}，${awayRecord}；样本仍少，不代表必然赛果。`
  }
  if (direction === 'insufficient') return `${home.year} 年同队样本不足，判断以本场赔率和方案计算为主。`
  if (direction === 'balanced') return `${home.year} 年同队赔率样本接近：${home.team} 平均胜向 ${formatNullablePercent(home.averageWinImplied)}，${away.team} 平均胜向 ${formatNullablePercent(away.averageWinImplied)}。`
  return `${home.year} 年同队赔率样本更偏 ${directionTeamName(direction, match)}，但这只是今年已加载样本，不等于最终赛果。`
}

export function buildLocalAiInsight(
  viewModel: MatchViewModel,
  yearMatches: MatchRecord[],
  yearResults: MatchResultRecord[],
  year: number,
): MatchAiInsight {
  const { match, conservative, aggressive } = viewModel
  const homeContext = buildTeamCurrentYearContext(match.homeTeam, yearMatches, yearResults, year)
  const awayContext = buildTeamCurrentYearContext(match.awayTeam, yearMatches, yearResults, year)
  const yearDirection = currentYearDirection(homeContext, awayContext)
  const marketLeader = getMarketLeader(match)
  const marketDirection =
    marketLeader.outcomeType === 'home' ? match.homeTeam
    : marketLeader.outcomeType === 'away' ? match.awayTeam
    : '平局'
  const aligned =
    (yearDirection === 'home' && marketLeader.outcomeType === 'home') ||
    (yearDirection === 'away' && marketLeader.outcomeType === 'away')
  const riskFlags = [
    homeContext.resultCount + awayContext.resultCount < 2 ? '今年官方完场样本偏少' : '',
    homeContext.matchCount + awayContext.matchCount < 4 ? '今年同队赔率样本偏少' : '',
    yearDirection === 'balanced' ? '今年样本强弱差距不明显' : '',
    yearDirection !== 'balanced' && yearDirection !== 'insufficient' && !aligned ? '今年样本方向与本场盘面分歧' : '',
    conservative.expectedNet < 0 ? '保守版期望仍为负，覆盖不等于保本' : '',
    aggressive.predictedCoverage.mid < conservative.predictedCoverage.mid ? '进取版覆盖率更低，回撤更尖锐' : '',
  ].filter(Boolean)
  const finalVerdict = aligned
    ? `${year} 年样本与本场盘面同向，${marketDirection} 路径优先；仍建议用保守版覆盖比分尾部。`
    : yearDirection === 'balanced' || yearDirection === 'insufficient'
      ? `${year} 年样本不足以单独定方向，最终以本场赔率分布和预算方案为准。`
      : `${year} 年样本偏 ${directionTeamName(yearDirection, match)}，但本场盘面偏 ${marketDirection}；建议降低单一路径仓位。`

  return {
    mode: AI_ANALYSIS_ENDPOINT ? 'remote-claude' : 'local-current-year-rules',
    modeLabel: AI_ANALYSIS_ENDPOINT ? 'Claude AI 分析中…' : '本地规则 · 仅今年数据',
    scope: `${year} 年；${CURRENT_YEAR_CONTEXT_NOTE}`,
    homeContext,
    awayContext,
    yearConclusion: buildYearConclusion(homeContext, awayContext, match),
    marketConclusion: `本场盘面更偏 ${marketDirection}（${outcomeLabel(marketLeader.outcomeType)}，约 ${formatPercent(marketLeader.value)}），保守覆盖 ${formatPercentRange(conservative.predictedCoverage)}。`,
    strategyConclusion: `保守版期望 ${formatSignedCurrency(conservative.expectedNet)}，进取版期望 ${formatSignedCurrency(aggressive.expectedNet)}。`,
    finalVerdict,
    riskFlags,
    claudeLoading: Boolean(AI_ANALYSIS_ENDPOINT),
  }
}

// Build the request payload for the remote endpoint
function buildRemoteRequest(viewModel: MatchViewModel) {
  const { match, conservative, aggressive } = viewModel
  const exactEntries = match.oddsEntries.filter((e) => isNumericScore(e.score))
  const denominator = exactEntries.reduce((s, e) => s + 1 / e.odds, 0)

  // Blended probability (same weights as strategy.ts)
  const WC_PRIOR: Record<string, number> = {
    '1:0': 0.148, '0:1': 0.130, '1:1': 0.118, '2:1': 0.087, '2:0': 0.085,
    '0:2': 0.065, '0:0': 0.062, '1:2': 0.044, '3:0': 0.038, '3:1': 0.036,
    '2:2': 0.030, '0:3': 0.026,
  }
  const priorSum = exactEntries.reduce((s, e) => s + (WC_PRIOR[e.score] ?? 0), 0)
  const priorScale = priorSum > 0 ? 1 / priorSum : 1
  const rawBlended = new Map<string, number>()
  for (const e of exactEntries) {
    const impl = denominator > 0 ? (1 / e.odds) / denominator : 0
    const prior = (WC_PRIOR[e.score] ?? 0) * priorScale
    rawBlended.set(e.score, 0.75 * impl + 0.25 * prior)
  }
  const blendedTotal = [...rawBlended.values()].reduce((s, v) => s + v, 0)

  // Expected goals
  let expectedGoals = 0
  for (const e of exactEntries) {
    const m = e.score.match(/^(\d+):(\d+)$/)
    if (m) expectedGoals += ((rawBlended.get(e.score) ?? 0) / blendedTotal) * (+m[1] + +m[2])
  }

  const implied = new Map(exactEntries.map((e) => [e.score, denominator > 0 ? (1 / e.odds) / denominator : 0]))
  const totals: Record<OutcomeType, number> = { home: 0, draw: 0, away: 0 }
  for (const e of exactEntries) totals[e.outcomeType] += implied.get(e.score) ?? 0

  const sortedOdds = [...match.oddsEntries]
    .sort((a, b) => a.odds - b.odds)
    .map((e) => ({
      score: e.score,
      odds: e.odds,
      impliedPct: isNumericScore(e.score) ? formatPercent(implied.get(e.score) ?? 0) : '-',
      blendedPct: isNumericScore(e.score)
        ? formatPercent((rawBlended.get(e.score) ?? 0) / blendedTotal)
        : '-',
      outcomeType: e.outcomeType,
    }))

  const conservativePicks = conservative.rows.map((r) => r.score)
  const aggressiveMain = aggressive.rows[0]?.score ?? ''
  const aggressiveTail = aggressive.rows[1]?.score ?? ''

  return {
    match: {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
      leagueName: match.leagueName ?? '世界杯',
      code: match.code,
    },
    odds: sortedOdds,
    expectedGoals,
    outcomeTotals: {
      home: formatPercent(totals.home),
      draw: formatPercent(totals.draw),
      away: formatPercent(totals.away),
    },
    conservativePicks,
    aggressivePicks: { main: aggressiveMain, tail: aggressiveTail },
  }
}

// Fetch Claude analysis and return partial insight fields
export async function fetchClaudeInsight(
  viewModel: MatchViewModel,
  signal?: AbortSignal,
): Promise<Partial<MatchAiInsight>> {
  if (!AI_ANALYSIS_ENDPOINT) return {}

  const { match } = viewModel
  const cacheKey = `${match.id}|${match.oddsUpdatedAt}`
  if (remoteCache.has(cacheKey)) return remoteCache.get(cacheKey)!

  const endpoint = AI_ANALYSIS_ENDPOINT.replace(/\/$/, '') + '/api/analyze'

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRemoteRequest(viewModel)),
    signal,
  })

  if (!response.ok) {
    const err = await response.text().catch(() => String(response.status))
    throw new Error(`Claude 分析接口返回 ${response.status}：${err.slice(0, 120)}`)
  }

  const data = await response.json() as {
    verdict: string
    marketInsight: string
    strategyComment: string
    riskFlags: string[]
    adjustedConservative: string[] | null
    adjustedAggressive: { main: string; tail: string } | null
    confidence: 'low' | 'medium' | 'high'
  }

  const result: Partial<MatchAiInsight> = {
    claudeLoading: false,
    claudeVerdict: data.verdict,
    claudeMarketInsight: data.marketInsight,
    claudeStrategyComment: data.strategyComment,
    claudeConfidence: data.confidence,
    claudeAdjustedConservative: data.adjustedConservative,
    claudeAdjustedAggressive: data.adjustedAggressive,
    riskFlags: data.riskFlags,
    modeLabel: 'Claude AI 已分析',
    mode: 'remote-claude',
  }

  remoteCache.set(cacheKey, result)
  return result
}

export const isRemoteEnabled = Boolean(AI_ANALYSIS_ENDPOINT)
