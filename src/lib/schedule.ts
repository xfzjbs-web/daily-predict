import type { MatchRecord } from './types.ts'

export type MatchActionState = 'open' | 'closing' | 'started' | 'unavailable'

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function getMatchDateKey(match: MatchRecord) {
  return match.kickoff.slice(0, 10)
}

export function getTomorrowKey(now = new Date()) {
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return toDateKey(tomorrow)
}

export function getTodayKey(now = new Date()) {
  return toDateKey(now)
}

export function getPrimaryDateKey(matches: MatchRecord[], now = new Date()) {
  const tomorrowKey = getTomorrowKey(now)
  const todayKey = getTodayKey(now)

  if (matches.some((match) => getMatchDateKey(match) === tomorrowKey)) {
    return tomorrowKey
  }

  const futureDateKey = [...new Set(matches.map(getMatchDateKey).filter((dateKey) => dateKey > tomorrowKey))].sort()[0]

  if (futureDateKey) {
    return futureDateKey
  }

  // Fall back to the most recent date that actually has matches
  return (
    [...new Set(matches.map(getMatchDateKey))].sort().reverse().find((dateKey) => dateKey >= todayKey) ??
    [...new Set(matches.map(getMatchDateKey))].sort().reverse()[0] ??
    tomorrowKey
  )
}

function parseKickoff(match: MatchRecord) {
  const normalized = match.kickoff.includes('T') ? match.kickoff : match.kickoff.replace(' ', 'T')
  const kickoff = new Date(normalized)

  return Number.isNaN(kickoff.getTime()) ? null : kickoff
}

export function getMatchActionState(match: MatchRecord, now = new Date()): MatchActionState {
  const kickoff = parseKickoff(match)

  if (!kickoff || match.oddsEntries.length === 0) {
    return 'unavailable'
  }

  const status = match.status?.toLowerCase() ?? ''
  const stopped = ['end', 'finish', 'cancel', 'stop', 'close'].some((keyword) => status.includes(keyword))

  if (stopped || kickoff.getTime() <= now.getTime()) {
    return 'started'
  }

  const untilKickoff = kickoff.getTime() - now.getTime()

  return untilKickoff <= 2 * 60 * 60 * 1000 ? 'closing' : 'open'
}

export function isMatchActionable(match: MatchRecord, now = new Date()) {
  const state = getMatchActionState(match, now)

  return state === 'open' || state === 'closing'
}

export function matchActionLabel(state: MatchActionState) {
  switch (state) {
    case 'open':
      return '可执行'
    case 'closing':
      return '临场复核'
    case 'started':
      return '已开赛'
    case 'unavailable':
      return '等待赔率'
  }
}

export function groupMatchesByDate(matches: MatchRecord[]) {
  return matches.reduce<Record<string, MatchRecord[]>>((groups, match) => {
    const key = getMatchDateKey(match)

    if (!groups[key]) {
      groups[key] = []
    }

    groups[key].push(match)

    return groups
  }, {})
}

export function sortMatchesByKickoff(matches: MatchRecord[]) {
  return [...matches].sort((left, right) => left.kickoff.localeCompare(right.kickoff))
}
