import type { LegacyDataset, MatchAnalysis, MatchRecord, OddsEntry, OutcomeType } from './types.ts'

export const SPORTTERY_CRS_API =
  'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=crs'

type SportteryResponse = {
  success?: boolean
  errorMessage?: string
  value?: {
    matchInfoList?: Array<{
      subMatchList?: SportteryMatch[]
    }>
  }
}

type SportteryMatch = {
  awayTeamAbbName?: string
  awayTeamAllName?: string
  businessDate?: string
  crs?: Record<string, string>
  homeTeamAbbName?: string
  homeTeamAllName?: string
  leagueAbbName?: string
  matchDate?: string
  matchId?: number
  matchNumStr?: string
  matchStatus?: string
  matchTime?: string
  sellStatus?: string
}

function parseOdds(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }

  const normalized = String(value).replace(/,/g, '').trim()
  const odds = Number(normalized)

  return Number.isFinite(odds) && odds > 0 ? Number(odds.toFixed(2)) : null
}

function outcomeForScore(homeGoals: number, awayGoals: number): OutcomeType {
  if (homeGoals > awayGoals) {
    return 'home'
  }

  if (homeGoals === awayGoals) {
    return 'draw'
  }

  return 'away'
}

function parseCrsOdds(crs: Record<string, string> | undefined): OddsEntry[] {
  if (!crs) {
    return []
  }

  const entries: OddsEntry[] = []

  for (const [key, value] of Object.entries(crs)) {
    if (key.endsWith('f') || key === 'goalLine' || key === 'goalLineValue' || key === 'updateDate' || key === 'updateTime') {
      continue
    }

    const odds = parseOdds(value)

    if (odds === null) {
      continue
    }

    const exactMatch = key.match(/^s(\d{2})s(\d{2})$/)

    if (exactMatch) {
      const homeGoals = Number(exactMatch[1])
      const awayGoals = Number(exactMatch[2])

      entries.push({
        score: `${homeGoals}:${awayGoals}`,
        odds,
        outcomeType: outcomeForScore(homeGoals, awayGoals),
        highlight: null,
      })

      continue
    }

    if (key === 's1sh') {
      entries.push({ score: '胜其他', odds, outcomeType: 'home', highlight: null })
    }

    if (key === 's1sd') {
      entries.push({ score: '平其他', odds, outcomeType: 'draw', highlight: null })
    }

    if (key === 's1sa') {
      entries.push({ score: '负其他', odds, outcomeType: 'away', highlight: null })
    }
  }

  return entries.sort((left, right) => left.odds - right.odds)
}

function getTopScores(entries: OddsEntry[]) {
  return entries
    .filter((entry) => /^\d+:\d+$/.test(entry.score))
    .sort((left, right) => left.odds - right.odds)
    .slice(0, 8)
    .map(({ score, odds }) => ({ score, odds }))
}

function createMergedMatch(raw: SportteryMatch, index: number, legacyByCode: Map<string, MatchRecord>): MatchRecord {
  const code = raw.matchNumStr ?? `比赛${index + 1}`
  const legacy = legacyByCode.get(code)
  const homeTeam = raw.homeTeamAbbName || raw.homeTeamAllName || legacy?.homeTeam || ''
  const awayTeam = raw.awayTeamAbbName || raw.awayTeamAllName || legacy?.awayTeam || ''
  const matchDate = raw.matchDate || legacy?.kickoff.slice(0, 10) || ''
  const matchTime = raw.matchTime?.slice(0, 5) || legacy?.kickoff.slice(11, 16) || ''
  const crsEntries = parseCrsOdds(raw.crs)
  const analysis: MatchAnalysis | null = legacy?.analysis ? structuredClone(legacy.analysis) : null

  if (analysis?.mainPick) {
    const mainEntry = crsEntries.find((entry) => entry.score === analysis.mainPick?.score)
    if (mainEntry) {
      mainEntry.highlight = 'main'
      analysis.mainPick.odds = mainEntry.odds
    }
  }

  if (analysis?.altPick) {
    const altEntry = crsEntries.find((entry) => entry.score === analysis.altPick?.score)
    if (altEntry) {
      altEntry.highlight = 'alt'
      analysis.altPick.odds = altEntry.odds
    }
  }

  return {
    id: `${code}-${raw.matchId ?? index + 1}`,
    code,
    leagueName: raw.leagueAbbName || legacy?.leagueName || '足球',
    homeTeam,
    awayTeam,
    title: `${code} ${homeTeam} vs ${awayTeam}`,
    kickoff: `${matchDate} ${matchTime}`,
    oddsUpdatedAt:
      raw.crs?.updateDate && raw.crs?.updateTime
        ? `${raw.crs.updateDate} ${raw.crs.updateTime}`
        : legacy?.oddsUpdatedAt ?? '',
    status: raw.matchStatus || raw.sellStatus || legacy?.status,
    source: 'sporttery',
    featured: Boolean(analysis),
    topScores: getTopScores(crsEntries.length > 0 ? crsEntries : legacy?.oddsEntries ?? []),
    oddsEntries: crsEntries.length > 0 ? crsEntries : legacy?.oddsEntries ?? [],
    analysis,
  }
}

export async function fetchSportteryMatches(legacyData: LegacyDataset, signal?: AbortSignal) {
  const response = await fetch(SPORTTERY_CRS_API, {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`体彩接口返回 ${response.status}`)
  }

  const payload = (await response.json()) as SportteryResponse

  if (!payload.success || !payload.value?.matchInfoList) {
    throw new Error(payload.errorMessage || '体彩接口没有返回赛程')
  }

  const legacyByCode = new Map(legacyData.matches.map((match) => [match.code, match]))
  const matches = payload.value.matchInfoList.flatMap((group) => group.subMatchList ?? [])

  return matches.map((match, index) => createMergedMatch(match, index, legacyByCode))
}
