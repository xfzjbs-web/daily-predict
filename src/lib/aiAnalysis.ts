import {
  CURRENT_YEAR_CONTEXT_NOTE,
  buildTeamCurrentYearContext,
  type TeamCurrentYearContext,
} from '../data/current-year-context.ts'
import { formatPercent } from './format.ts'
import type { MatchRecord, MatchResultRecord, MatchViewModel, OutcomeType } from './types.ts'

export interface ClaudeResult {
  verdict: string
  marketInsight: string
  strategyComment: string
  riskFlags: string[]
  adjustedConservative: string[] | null
  adjustedAggressive: { main: string; tail: string } | null
  confidence: 'low' | 'medium' | 'high'
  // Optional enrichment fields (added when lineup/player research is available)
  teamNews?: string                  // injuries, suspensions, lineup changes
  keyMatchup?: string | string[]     // tactical/player matchup points
}

export interface MatchAiInsight {
  mode: 'local' | 'claude'
  homeContext: TeamCurrentYearContext
  awayContext: TeamCurrentYearContext
  yearConclusion: string
  marketConclusion: string
  finalVerdict: string
  riskFlags: string[]
  claude?: ClaudeResult
}

export type BatchAnalysisState = 'idle' | 'analyzing' | 'done' | 'error'

const AI_ENDPOINT = (import.meta.env.VITE_AI_ANALYSIS_ENDPOINT as string | undefined)?.replace(/\/$/, '')

export const isClaudeEnabled = Boolean(AI_ENDPOINT)

// ── localStorage cache keyed by dateKey ──────────────────────────────────────
const CACHE_PREFIX = 'aiInsights:'
const ODDS_PREFIX = 'aiOdds:'

export function loadCachedInsights(dateKey: string): Record<string, ClaudeResult> {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + dateKey)
    return raw ? (JSON.parse(raw) as Record<string, ClaudeResult>) : {}
  } catch {
    return {}
  }
}

function saveCachedInsights(dateKey: string, insights: Record<string, ClaudeResult>) {
  try {
    localStorage.setItem(CACHE_PREFIX + dateKey, JSON.stringify(insights))
  } catch { /* ignore quota errors */ }
}

// Odds at analysis time: matchId → {score → odds}
export function loadOddsSnapshot(dateKey: string): Record<string, Record<string, number>> {
  try {
    const raw = localStorage.getItem(ODDS_PREFIX + dateKey)
    return raw ? (JSON.parse(raw) as Record<string, Record<string, number>>) : {}
  } catch {
    return {}
  }
}

function saveOddsSnapshot(dateKey: string, snap: Record<string, Record<string, number>>) {
  try {
    localStorage.setItem(ODDS_PREFIX + dateKey, JSON.stringify(snap))
  } catch { /* ignore */ }
}

// Detect if current odds have drifted >threshold from snapshot
export function detectOddsDrift(
  matchId: string,
  currentOdds: Record<string, number>,
  dateKey: string,
  threshold = 0.05,
): { drifted: boolean; changes: Array<{ score: string; from: number; to: number; pct: number }> } {
  const snap = loadOddsSnapshot(dateKey)
  const snapOdds = snap[matchId]
  if (!snapOdds) return { drifted: false, changes: [] }

  const changes = Object.entries(currentOdds)
    .filter(([score, cur]) => {
      const old = snapOdds[score]
      return old !== undefined && Math.abs(cur - old) / old > threshold
    })
    .map(([score, cur]) => ({
      score,
      from: snapOdds[score],
      to: cur,
      pct: (cur - snapOdds[score]) / snapOdds[score],
    }))

  return { drifted: changes.length > 0, changes }
}

// ── Local insight (always computed) ──────────────────────────────────────────
function impliedOutcomeTotals(match: MatchRecord) {
  const exact = match.oddsEntries.filter((e) => /^\d+:\d+$/.test(e.score))
  const denom = exact.reduce((s, e) => s + 1 / e.odds, 0)
  const totals: Record<OutcomeType, number> = { home: 0, draw: 0, away: 0 }
  if (denom <= 0) return totals
  for (const e of exact) totals[e.outcomeType] += (1 / e.odds) / denom
  return totals
}

function getMarketLeader(match: MatchRecord) {
  const totals = impliedOutcomeTotals(match)
  const [outcomeType, value] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] as [OutcomeType, number]
  return { outcomeType, value }
}

function currentYearDirection(home: TeamCurrentYearContext, away: TeamCurrentYearContext) {
  if (home.pointsPerMatch !== null && away.pointsPerMatch !== null) {
    const gap = home.pointsPerMatch - away.pointsPerMatch
    if (Math.abs(gap) < 0.45) return 'balanced' as const
    return gap > 0 ? 'home' : 'away'
  }
  if (home.averageWinImplied === null || away.averageWinImplied === null) return 'insufficient' as const
  const gap = home.averageWinImplied - away.averageWinImplied
  if (Math.abs(gap) < 0.08) return 'balanced' as const
  return gap > 0 ? 'home' : 'away'
}

export function buildLocalInsight(
  viewModel: MatchViewModel,
  yearMatches: MatchRecord[],
  yearResults: MatchResultRecord[],
  year: number,
): MatchAiInsight {
  const { match } = viewModel
  const homeContext = buildTeamCurrentYearContext(match.homeTeam, yearMatches, yearResults, year)
  const awayContext = buildTeamCurrentYearContext(match.awayTeam, yearMatches, yearResults, year)
  const direction = currentYearDirection(homeContext, awayContext)
  const marketLeader = getMarketLeader(match)

  const marketDir =
    marketLeader.outcomeType === 'home' ? match.homeTeam
    : marketLeader.outcomeType === 'away' ? match.awayTeam
    : '平局'

  const aligned =
    (direction === 'home' && marketLeader.outcomeType === 'home') ||
    (direction === 'away' && marketLeader.outcomeType === 'away')

  const dirName = direction === 'home' ? match.homeTeam
    : direction === 'away' ? match.awayTeam
    : direction === 'balanced' ? '两队接近' : '样本不足'

  const riskFlags = [
    homeContext.resultCount + awayContext.resultCount < 2 ? '今年官方完场样本偏少' : '',
    homeContext.matchCount + awayContext.matchCount < 4 ? '今年同队赔率样本偏少' : '',
    direction === 'balanced' ? '今年样本强弱差距不明显' : '',
    direction !== 'balanced' && direction !== 'insufficient' && !aligned ? '今年样本方向与本场盘面分歧' : '',
  ].filter(Boolean)

  const yearConclusion =
    homeContext.resultCount + awayContext.resultCount > 0
      ? `${year} 年完场：${homeContext.team} ${homeContext.wins}W${homeContext.draws}D${homeContext.losses}L，${awayContext.team} ${awayContext.wins}W${awayContext.draws}D${awayContext.losses}L`
      : `${year} 年完场数据暂无，参考赔率分布。`

  const marketConclusion = `盘面偏 ${marketDir}（${formatPercent(marketLeader.value)}），${CURRENT_YEAR_CONTEXT_NOTE}`

  const finalVerdict = aligned
    ? `今年样本与盘面同向偏 ${marketDir}，建议保守覆盖该方向。`
    : direction === 'balanced' || direction === 'insufficient'
      ? `今年样本不足，以本场赔率分布为主要依据。`
      : `今年样本偏 ${dirName}，但盘面偏 ${marketDir}，存在分歧，降低单路径仓位。`

  return {
    mode: 'local',
    homeContext,
    awayContext,
    yearConclusion,
    marketConclusion,
    finalVerdict,
    riskFlags,
  }
}

// ── Remote Claude request payload ─────────────────────────────────────────────
const WC_PRIOR: Record<string, number> = {
  '1:0': 0.148, '0:1': 0.130, '1:1': 0.118, '2:1': 0.087, '2:0': 0.085,
  '0:2': 0.065, '0:0': 0.062, '1:2': 0.044, '3:0': 0.038, '3:1': 0.036,
  '2:2': 0.030, '0:3': 0.026,
}

function buildPayload(viewModel: MatchViewModel) {
  const { match, conservative, aggressive } = viewModel
  const exact = match.oddsEntries.filter((e) => /^\d+:\d+$/.test(e.score))
  const denom = exact.reduce((s, e) => s + 1 / e.odds, 0)
  const priorSum = exact.reduce((s, e) => s + (WC_PRIOR[e.score] ?? 0), 0)
  const priorScale = priorSum > 0 ? 1 / priorSum : 1

  const blendedMap = new Map<string, number>()
  for (const e of exact) {
    const impl = denom > 0 ? (1 / e.odds) / denom : 0
    const prior = (WC_PRIOR[e.score] ?? 0) * priorScale
    blendedMap.set(e.score, 0.75 * impl + 0.25 * prior)
  }
  const blendTotal = [...blendedMap.values()].reduce((s, v) => s + v, 0)

  let expectedGoals = 0
  for (const e of exact) {
    const m = e.score.match(/^(\d+):(\d+)$/)
    if (m) expectedGoals += ((blendedMap.get(e.score) ?? 0) / blendTotal) * (+m[1] + +m[2])
  }

  const impliedMap = new Map(exact.map((e) => [e.score, denom > 0 ? (1 / e.odds) / denom : 0]))
  const totals: Record<OutcomeType, number> = { home: 0, draw: 0, away: 0 }
  for (const e of exact) totals[e.outcomeType] += impliedMap.get(e.score) ?? 0

  const odds = [...match.oddsEntries]
    .sort((a, b) => a.odds - b.odds)
    .slice(0, 16)
    .map((e) => ({
      score: e.score,
      odds: e.odds,
      impliedPct: /^\d+:\d+$/.test(e.score) ? formatPercent(impliedMap.get(e.score) ?? 0) : '-',
      blendedPct: /^\d+:\d+$/.test(e.score) ? formatPercent((blendedMap.get(e.score) ?? 0) / blendTotal) : '-',
      outcomeType: e.outcomeType,
    }))

  return {
    match: {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
      leagueName: match.leagueName ?? '世界杯',
      code: match.code,
    },
    odds,
    expectedGoals,
    outcomeTotals: {
      home: formatPercent(totals.home),
      draw: formatPercent(totals.draw),
      away: formatPercent(totals.away),
    },
    conservativePicks: conservative.rows.map((r) => r.score),
    aggressivePicks: { main: aggressive.rows[0]?.score ?? '', tail: aggressive.rows[1]?.score ?? '' },
  }
}

// ── Server sync ──────────────────────────────────────────────────────────────
export interface ServerAnalysis {
  found: boolean
  insights?: Record<string, ClaudeResult>
  analyzedAt?: string
}

const GIST_URL = 'https://gist.githubusercontent.com/xfzjbs-web/2ede41711a15eb746939df5ff10a42de/raw/analysis.json'

export async function fetchServerAnalysis(dateKey: string): Promise<ServerAnalysis> {
  try {
    const resp = await fetch(`${GIST_URL}?_=${Date.now()}`)
    if (!resp.ok) return { found: false }
    const all = await resp.json() as Record<string, ServerAnalysis>
    const entry = all[dateKey]
    if (!entry) return { found: false }
    return entry
  } catch {
    return { found: false }
  }
}

export async function pushServerAnalysis(
  dateKey: string,
  insights: Record<string, ClaudeResult>,
  adminToken: string,
): Promise<void> {
  if (!AI_ENDPOINT) return
  await fetch(`${AI_ENDPOINT}/api/save-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ dateKey, insights, analyzedAt: new Date().toISOString() }),
  })
}

// ── Batch analysis ────────────────────────────────────────────────────────────
export async function batchAnalyzeMatches(
  viewModels: MatchViewModel[],
  dateKey: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Record<string, ClaudeResult>> {
  if (!AI_ENDPOINT) throw new Error('未配置 AI 端点')

  const cached = loadCachedInsights(dateKey)
  const oddsSnap = loadOddsSnapshot(dateKey)
  const results: Record<string, ClaudeResult> = { ...cached }
  let done = 0

  for (const vm of viewModels) {
    if (signal?.aborted) break
    if (results[vm.match.id]) { done++; onProgress(done, viewModels.length); continue }

    try {
      const resp = await fetch(`${AI_ENDPOINT}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(vm)),
        signal,
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json() as ClaudeResult
      results[vm.match.id] = data
      // Save odds at analysis time for drift detection
      oddsSnap[vm.match.id] = Object.fromEntries(
        vm.match.oddsEntries.filter((e) => /^\d+:\d+$/.test(e.score)).map((e) => [e.score, e.odds])
      )
      saveOddsSnapshot(dateKey, oddsSnap)
    } catch (err) {
      if (signal?.aborted) break
      // Store error placeholder so we don't retry in same session
      results[vm.match.id] = {
        verdict: `分析失败：${err instanceof Error ? err.message : '未知错误'}`,
        marketInsight: '',
        strategyComment: '',
        riskFlags: ['API 调用失败，显示本地规则结果'],
        adjustedConservative: null,
        adjustedAggressive: null,
        confidence: 'low',
      }
    }

    done++
    onProgress(done, viewModels.length)
    saveCachedInsights(dateKey, results)

    // Small delay to avoid hammering
    if (done < viewModels.length && !signal?.aborted) {
      await new Promise((res) => setTimeout(res, 300))
    }
  }

  saveCachedInsights(dateKey, results)
  return results
}
