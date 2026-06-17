import type { MatchResultRecord } from './types.ts'

export interface ConfirmedPick {
  score: string
  odds: number
  stake: number
}

export interface ConfirmedBuy {
  matchId: string
  matchDate: string
  code: string
  homeTeam: string
  awayTeam: string
  picks: ConfirmedPick[]
  totalStake: number
  source: 'claude' | 'algorithm'
  strategy: 'conservative' | 'aggressive'
  confirmedAt: string
}

export interface ConfirmedSettlement {
  buy: ConfirmedBuy
  result: MatchResultRecord
  hitPick: ConfirmedPick | null
  payout: number
  netResult: number
}

const STORAGE_KEY = 'confirmedBuys'

export function loadConfirmedBuys(): ConfirmedBuy[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ConfirmedBuy[]) : []
  } catch {
    return []
  }
}

export function saveConfirmedBuy(buy: ConfirmedBuy): void {
  const existing = loadConfirmedBuys()
  const filtered = existing.filter((b) => b.matchId !== buy.matchId)
  const updated = [buy, ...filtered].slice(0, 200)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}

export function removeConfirmedBuy(matchId: string): void {
  const existing = loadConfirmedBuys()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.filter((b) => b.matchId !== matchId)))
}

export function settleConfirmedBuys(
  buys: ConfirmedBuy[],
  results: MatchResultRecord[],
): ConfirmedSettlement[] {
  const resultMap = new Map(results.map((r) => [`${r.matchDate}|${r.code}`, r]))

  return buys
    .map((buy) => {
      const result = resultMap.get(`${buy.matchDate}|${buy.code}`)
      if (!result) return null
      const hitPick = buy.picks.find((p) => p.score === result.finalScore) ?? null
      const payout = hitPick ? hitPick.stake * hitPick.odds : 0
      return { buy, result, hitPick, payout, netResult: payout - buy.totalStake }
    })
    .filter((s): s is ConfirmedSettlement => s !== null)
    .sort((a, b) => b.result.matchDate.localeCompare(a.result.matchDate))
}
