import type { MatchResultRecord, OutcomeType } from './types.ts'

export const SPORTTERY_RESULT_API =
  'https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry'

interface SportteryResultResponse {
  errorCode?: string | number
  errorMessage?: string
  success?: boolean
  value?: {
    matchResult?: SportteryResultMatch[]
  }
}

interface SportteryResultMatch {
  allAwayTeam?: string
  allHomeTeam?: string
  awayTeam?: string
  homeTeam?: string
  leagueName?: string
  leagueNameAbbr?: string
  matchDate?: string
  matchId?: number
  matchNumStr?: string
  matchResultStatus?: string
  resultStatus?: string
  sectionsNo1?: string
  sectionsNo999?: string
  winFlag?: string
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getResultWindow(year: number, now = new Date()) {
  const yearStart = new Date(year, 0, 1)
  const endDate = new Date(now)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 29)

  if (startDate < yearStart) {
    startDate.setTime(yearStart.getTime())
  }

  return {
    startDate: toDateKey(startDate),
    endDate: toDateKey(endDate),
  }
}

function parseOutcome(winFlag: string | undefined, finalScore: string): OutcomeType {
  if (winFlag === 'H') {
    return 'home'
  }

  if (winFlag === 'A') {
    return 'away'
  }

  if (winFlag === 'D') {
    return 'draw'
  }

  const [homeGoals, awayGoals] = finalScore.split(':').map(Number)

  if (homeGoals > awayGoals) {
    return 'home'
  }

  if (homeGoals < awayGoals) {
    return 'away'
  }

  return 'draw'
}

function isWorldCup(match: SportteryResultMatch) {
  return match.leagueName === '世界杯' || match.leagueNameAbbr === '世界杯'
}

function toResultRecord(match: SportteryResultMatch): MatchResultRecord | null {
  const finalScore = match.sectionsNo999?.trim() ?? ''
  const matchDate = match.matchDate?.trim() ?? ''
  const matchId = match.matchId ?? 0

  if (!matchId || !matchDate || !/^\d+:\d+$/.test(finalScore)) {
    return null
  }

  return {
    id: `result-${matchId}`,
    matchId,
    code: match.matchNumStr ?? '',
    leagueName: match.leagueNameAbbr || match.leagueName || '世界杯',
    matchDate,
    homeTeam: match.homeTeam || match.allHomeTeam || '',
    awayTeam: match.awayTeam || match.allAwayTeam || '',
    halfTimeScore: match.sectionsNo1?.trim() ?? '',
    finalScore,
    outcomeType: parseOutcome(match.winFlag, finalScore),
    resultStatus: match.matchResultStatus || match.resultStatus || '',
  }
}

export async function fetchSportteryResults(year: number, signal?: AbortSignal) {
  const { startDate, endDate } = getResultWindow(year)
  const query = new URLSearchParams({
    matchBeginDate: startDate,
    matchEndDate: endDate,
    leagueId: '',
    pageSize: '100',
    pageNo: '1',
    isFix: '0',
    matchPage: '1',
    pcOrWap: '1',
  })
  const response = await fetch(`${SPORTTERY_RESULT_API}?${query}`, {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`体彩赛果接口返回 ${response.status}`)
  }

  const payload = (await response.json()) as SportteryResultResponse

  if (String(payload.errorCode) !== '0' || !payload.success || !payload.value?.matchResult) {
    throw new Error(payload.errorMessage || '体彩赛果接口没有返回比赛结果')
  }

  return payload.value.matchResult
    .filter(isWorldCup)
    .map(toResultRecord)
    .filter((result): result is MatchResultRecord => result !== null)
    .filter((result) => Number(result.matchDate.slice(0, 4)) === year)
    .sort((left, right) => right.matchDate.localeCompare(left.matchDate) || right.code.localeCompare(left.code))
}
