export type OutcomeType = 'home' | 'draw' | 'away'
export type HighlightType = 'main' | 'alt' | null
export type StrategyKind = 'conservative' | 'aggressive'
export type StrategyEmphasis = 'main' | 'support' | 'draw' | 'tail'

export interface ProbabilityRange {
  low: number
  high: number
  mid: number
}

export interface MetaRecord {
  appName: string
  sourceApiUrl: string
  officialUpdatedAt: string
  verifiedAt: string
  sourceFile: string
  importedAt: string
}

export interface ScoreOddsRecord {
  score: string
  odds: number
}

export interface OddsEntry extends ScoreOddsRecord {
  outcomeType: OutcomeType
  highlight: HighlightType
}

export interface LegacyPortfolioRow {
  score: string
  role: string
  stake: number
  odds: number
  payout: number
  netProfit: number
  predictedProbability: ProbabilityRange | null
}

export interface LegacyStrategyBlock {
  title: string
  notes: string[]
  rows: LegacyPortfolioRow[]
}

export interface AnalysisLogicCard {
  title: string
  description: string
}

export interface SourceLink {
  title: string
  href: string
}

export interface MatchAnalysis {
  title: string
  summary: string
  structureTag: string
  mainPick: ScoreOddsRecord | null
  altPick: ScoreOddsRecord | null
  coverageSummary: string
  factors: string[]
  logic: AnalysisLogicCard[]
  sources: SourceLink[]
  legacyStrategies: {
    conservative: LegacyStrategyBlock
    aggressive: LegacyStrategyBlock
  }
}

export interface MatchRecord {
  id: string
  code: string
  leagueName?: string
  homeTeam: string
  awayTeam: string
  title: string
  kickoff: string
  oddsUpdatedAt: string
  status?: string
  source?: 'legacy' | 'sporttery' | 'cache'
  featured: boolean
  topScores: ScoreOddsRecord[]
  oddsEntries: OddsEntry[]
  analysis: MatchAnalysis | null
}

export interface MatchResultRecord {
  id: string
  matchId: number
  code: string
  leagueName: string
  matchDate: string
  homeTeam: string
  awayTeam: string
  halfTimeScore: string
  finalScore: string
  outcomeType: OutcomeType
  resultStatus: string
}

export interface LegacyDataset {
  meta: MetaRecord
  matches: MatchRecord[]
}

export interface StrategySeedRow {
  score: string
  role: string
  emphasis: StrategyEmphasis
  predictedProbability: ProbabilityRange | null
}

export interface StrategySeed {
  rows: StrategySeedRow[]
  notes: string[]
  label: string
}

export interface StrategyRow extends StrategySeedRow {
  predictedProbability: ProbabilityRange
  odds: number
  stake: number
  payout: number
  netProfit: number
  impliedProbability: number
  outcomeType: OutcomeType
}

export interface StrategyComputation {
  kind: StrategyKind
  title: string
  summary: string
  rows: StrategyRow[]
  predictedCoverage: ProbabilityRange
  impliedCoverage: number
  expectedNet: number
  profitRange: {
    min: number
    max: number
  }
  riskLoss: number
  notes: string[]
}

export interface MatchViewModel {
  match: MatchRecord
  conservative: StrategyComputation
  aggressive: StrategyComputation
}

export type RecommendationSnapshotSource = 'live-capture' | 'legacy-backtest'

export interface RecommendationSnapshotRow {
  score: string
  role: string
  stake: number
  odds: number
  payout: number
  netProfit: number
}

export interface RecommendationStrategySnapshot {
  kind: StrategyKind
  rows: RecommendationSnapshotRow[]
  predictedCoverage: ProbabilityRange
  expectedNet: number
  riskLoss: number
}

export interface RecommendationSnapshot {
  id: string
  code: string
  matchDate: string
  kickoff: string
  homeTeam: string
  awayTeam: string
  budget: number
  oddsUpdatedAt: string
  capturedAt: string
  source: RecommendationSnapshotSource
  conservative: RecommendationStrategySnapshot
  aggressive: RecommendationStrategySnapshot
}

export interface StrategySettlement {
  hit: boolean
  matchedScore: string | null
  payout: number
  netResult: number
}

export interface RecommendationSettlement {
  snapshot: RecommendationSnapshot
  result: MatchResultRecord
  conservative: StrategySettlement
  aggressive: StrategySettlement
}
