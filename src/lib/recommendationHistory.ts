import type {
  MatchResultRecord,
  MatchViewModel,
  RecommendationSettlement,
  RecommendationSnapshot,
  RecommendationSnapshotSource,
  RecommendationStrategySnapshot,
  StrategyComputation,
  StrategySettlement,
} from './types.ts'

const MAX_SNAPSHOTS = 200

function snapshotKey(matchDate: string, code: string) {
  return `${matchDate}|${code}`
}

function snapshotStrategy(strategy: StrategyComputation): RecommendationStrategySnapshot {
  return {
    kind: strategy.kind,
    rows: strategy.rows.map((row) => ({
      score: row.score,
      role: row.role,
      stake: row.stake,
      odds: row.odds,
      payout: row.payout,
      netProfit: row.netProfit,
    })),
    predictedCoverage: strategy.predictedCoverage,
    expectedNet: strategy.expectedNet,
    riskLoss: strategy.riskLoss,
  }
}

export function createRecommendationSnapshots(
  viewModels: MatchViewModel[],
  budget: number,
  source: RecommendationSnapshotSource,
  capturedAt = new Date().toISOString(),
): RecommendationSnapshot[] {
  return viewModels
    .filter((viewModel) => viewModel.conservative.rows.length > 0 && viewModel.aggressive.rows.length > 0)
    .map((viewModel) => {
      const { match } = viewModel
      const matchDate = match.kickoff.slice(0, 10)

      return {
        id: snapshotKey(matchDate, match.code),
        code: match.code,
        matchDate,
        kickoff: match.kickoff,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        budget,
        oddsUpdatedAt: match.oddsUpdatedAt,
        capturedAt,
        source,
        conservative: snapshotStrategy(viewModel.conservative),
        aggressive: snapshotStrategy(viewModel.aggressive),
      }
    })
}

export function mergeRecommendationSnapshots(
  current: RecommendationSnapshot[],
  incoming: RecommendationSnapshot[],
): RecommendationSnapshot[] {
  const merged = new Map(current.map((snapshot) => [snapshot.id, snapshot]))

  for (const snapshot of incoming) {
    const existing = merged.get(snapshot.id)

    if (!existing || snapshot.source === 'live-capture' || existing.source !== 'live-capture') {
      merged.set(snapshot.id, snapshot)
    }
  }

  return [...merged.values()]
    .sort((left, right) => right.kickoff.localeCompare(left.kickoff))
    .slice(0, MAX_SNAPSHOTS)
}

function settleStrategy(
  strategy: RecommendationStrategySnapshot,
  finalScore: string,
): StrategySettlement {
  const matchedRow = strategy.rows.find((row) => row.score === finalScore)

  return {
    hit: Boolean(matchedRow),
    matchedScore: matchedRow?.score ?? null,
    payout: matchedRow?.payout ?? 0,
    netResult: matchedRow?.netProfit ?? -strategy.riskLoss,
  }
}

export function settleRecommendationSnapshots(
  snapshots: RecommendationSnapshot[],
  results: MatchResultRecord[],
): RecommendationSettlement[] {
  const resultLookup = new Map(
    results.map((result) => [snapshotKey(result.matchDate, result.code), result]),
  )

  return snapshots
    .map((snapshot) => {
      const result = resultLookup.get(snapshot.id)

      if (!result) {
        return null
      }

      return {
        snapshot,
        result,
        conservative: settleStrategy(snapshot.conservative, result.finalScore),
        aggressive: settleStrategy(snapshot.aggressive, result.finalScore),
      }
    })
    .filter((settlement): settlement is RecommendationSettlement => settlement !== null)
    .sort((left, right) => right.result.matchDate.localeCompare(left.result.matchDate))
}
