import type {
  MatchRecord,
  MatchViewModel,
  OddsEntry,
  OutcomeType,
  ProbabilityRange,
  StrategyComputation,
  StrategyEmphasis,
  StrategyKind,
  StrategyRow,
  StrategySeed,
  StrategySeedRow,
} from './types.ts'

// ── World Cup historical score frequency prior ────────────────────────────────
// Source: all World Cup final results 1930-2022 (~900 matches)
// Covers ~93% of all exact outcomes; remainder falls into "other" scores
const WC_SCORE_PRIOR: Record<string, number> = {
  '1:0': 0.148, '0:1': 0.130, '1:1': 0.118,
  '2:1': 0.087, '2:0': 0.085, '0:2': 0.065,
  '0:0': 0.062, '1:2': 0.044, '3:0': 0.038,
  '3:1': 0.036, '2:2': 0.030, '0:3': 0.026,
  '4:0': 0.015, '3:2': 0.013, '1:3': 0.012,
  '4:1': 0.008, '2:3': 0.008, '0:4': 0.007,
  '4:2': 0.004, '3:3': 0.003, '5:0': 0.003,
  '0:5': 0.003, '5:1': 0.002, '1:5': 0.001,
}

// Blend weight: 25% historical prior, 75% market-implied
const PRIOR_BLEND = 0.25

const TAIL_ROLE_PATTERN = /尾部|反转|变量|爆冷|高赔|高賠|高收益/

function isNumericScore(score: string) {
  return /^\d+:\d+$/.test(score)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

function parseScore(score: string) {
  const match = score.match(/^(\d+):(\d+)$/)
  if (!match) return null
  return { homeGoals: Number(match[1]), awayGoals: Number(match[2]) }
}

function goalTotal(score: string): number {
  const parsed = parseScore(score)
  return parsed ? parsed.homeGoals + parsed.awayGoals : 0
}

function labelForOutcome(outcomeType: OutcomeType) {
  switch (outcomeType) {
    case 'home': return '主胜'
    case 'draw': return '平局'
    case 'away': return '客胜'
  }
}

function buildOddsLookup(match: MatchRecord) {
  return new Map(match.oddsEntries.map((entry) => [entry.score, entry]))
}

// ── Market implied probability (raw, before blending) ────────────────────────

function buildImpliedProbabilityLookup(match: MatchRecord) {
  const exactEntries = match.oddsEntries.filter((entry) => isNumericScore(entry.score))
  const denominator = exactEntries.reduce((total, entry) => total + 1 / entry.odds, 0)
  return new Map(
    exactEntries.map((entry) => [
      entry.score,
      denominator === 0 ? 0 : (1 / entry.odds) / denominator,
    ]),
  )
}

// ── Blended probability: market × 75% + WC historical prior × 25% ───────────

function buildBlendedProbabilities(
  exactEntries: OddsEntry[],
  impliedLookup: Map<string, number>,
): Map<string, number> {
  // Normalize WC prior over the scores we actually have
  const priorSum = exactEntries.reduce((s, e) => s + (WC_SCORE_PRIOR[e.score] ?? 0), 0)
  const priorScale = priorSum > 0 ? 1 / priorSum : 1

  const raw = new Map<string, number>()
  for (const entry of exactEntries) {
    const implied = impliedLookup.get(entry.score) ?? 0
    const prior = (WC_SCORE_PRIOR[entry.score] ?? 0) * priorScale
    raw.set(entry.score, (1 - PRIOR_BLEND) * implied + PRIOR_BLEND * prior)
  }

  // Renormalize so blended probs sum to 1
  const total = [...raw.values()].reduce((s, v) => s + v, 0)
  if (total <= 0) return raw
  for (const [score, prob] of raw) {
    raw.set(score, prob / total)
  }
  return raw
}

// ── Expected total goals from blended probabilities ───────────────────────────

function expectedGoalTotal(exactEntries: OddsEntry[], blendedLookup: Map<string, number>): number {
  let sum = 0
  for (const entry of exactEntries) {
    sum += (blendedLookup.get(entry.score) ?? 0) * goalTotal(entry.score)
  }
  return sum
}

// ── Outcome totals from blended probabilities ─────────────────────────────────

function computeBlendedOutcomeTotals(
  exactEntries: OddsEntry[],
  blendedLookup: Map<string, number>,
): Record<OutcomeType, number> {
  const totals: Record<OutcomeType, number> = { home: 0, draw: 0, away: 0 }
  for (const entry of exactEntries) {
    totals[entry.outcomeType] += blendedLookup.get(entry.score) ?? 0
  }
  return totals
}

// ── Tail EV: expected profit per unit stake (net of loss) ─────────────────────
// EV = p × (odds - 1) - (1 - p) = p × odds - 1

function tailEV(blendedProb: number, odds: number): number {
  return blendedProb * odds - 1
}

// ── Legacy seed extraction ─────────────────────────────────────────────────────

function emphasisFromRole(role: string, index: number): StrategyEmphasis {
  if (TAIL_ROLE_PATTERN.test(role)) return 'tail'
  if (role.includes('平')) return 'draw'
  if (index === 0) return 'main'
  return 'support'
}

function seedFromLegacy(match: MatchRecord, kind: StrategyKind): StrategySeed | null {
  const legacyBlock = match.analysis?.legacyStrategies[kind]
  if (!legacyBlock || legacyBlock.rows.length === 0) return null
  return {
    label: legacyBlock.title,
    notes: legacyBlock.notes,
    rows: legacyBlock.rows.map((row, index) => ({
      score: row.score,
      role: row.role,
      emphasis: emphasisFromRole(row.role, index),
      predictedProbability: row.predictedProbability,
    })),
  }
}

// ── Auto seed (no legacy analysis) ───────────────────────────────────────────

function autoSeed(
  _match: MatchRecord,
  kind: StrategyKind,
  exactEntries: OddsEntry[],
  blendedLookup: Map<string, number>,
): StrategySeed {
  const outcomeTotals = computeBlendedOutcomeTotals(exactEntries, blendedLookup)

  // Sort all exact scores by blended probability descending
  const byBlended = [...exactEntries].sort(
    (a, b) => (blendedLookup.get(b.score) ?? 0) - (blendedLookup.get(a.score) ?? 0),
  )

  const favoriteOutcome = (
    Object.entries(outcomeTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'home'
  ) as OutcomeType
  const underdogOutcome = favoriteOutcome === 'home' ? 'away' : 'home'

  // Main anchor: highest blended prob score in favorite direction, or highlighted
  const favEntries = byBlended.filter((e) => e.outcomeType === favoriteOutcome)
  const mainEntry =
    favEntries.find((e) => e.highlight === 'main') ??
    favEntries[0] ??
    byBlended[0]

  if (kind === 'aggressive') {
    // Aggressive: main path + best-EV tail from a different cluster or direction
    // Tail candidates: not main, prefer different outcome direction for diversification
    const tailCandidates = byBlended.filter((e) => e.score !== mainEntry.score)

    // Score clusters by goal total proximity to main
    const mainTotal = goalTotal(mainEntry.score)
    const tailByEV = tailCandidates
      .map((e) => ({
        entry: e,
        ev: tailEV(blendedLookup.get(e.score) ?? 0, e.odds),
        diffCluster: Math.abs(goalTotal(e.score) - mainTotal) >= 1,
        diffDirection: e.outcomeType !== mainEntry.outcomeType,
      }))
      .sort((a, b) => {
        // Prefer different direction or different cluster, then rank by EV
        const aScore = (a.diffDirection ? 2 : 0) + (a.diffCluster ? 1 : 0)
        const bScore = (b.diffDirection ? 2 : 0) + (b.diffCluster ? 1 : 0)
        if (bScore !== aScore) return bScore - aScore
        return b.ev - a.ev
      })

    // Among top-tier (same preference score), pick best EV
    const topTierScore = tailByEV[0]
      ? (tailByEV[0].diffDirection ? 2 : 0) + (tailByEV[0].diffCluster ? 1 : 0)
      : 0
    const topTier = tailByEV.filter(
      (t) => (t.diffDirection ? 2 : 0) + (t.diffCluster ? 1 : 0) === topTierScore,
    )
    topTier.sort((a, b) => b.ev - a.ev)
    const tailEntry = topTier[0]?.entry ?? tailByEV[0]?.entry ?? byBlended[1] ?? mainEntry

    const altHighlightEntry = exactEntries.find((e) => e.highlight === 'alt' && e.score !== mainEntry.score)
    const finalTail = altHighlightEntry ?? tailEntry

    return {
      label: '进取版：两比分高利润',
      notes: [
        '主路径比分命中追求稳定返还；尾部选取 EV 最优、方向分散的高赔率比分。',
        '未覆盖比分出现时，该场净亏全部预算。',
      ],
      rows: [
        {
          score: mainEntry.score,
          role: `${labelForOutcome(mainEntry.outcomeType)}主路径`,
          emphasis: 'main',
          predictedProbability: null,
        },
        {
          score: finalTail.score,
          role: finalTail.outcomeType !== mainEntry.outcomeType ? '反向高EV尾部' : '同向高赔尾部',
          emphasis: 'tail',
          predictedProbability: null,
        },
      ],
    }
  }

  // ── Conservative: multi-score coverage ─────────────────────────────────────
  const expectedGoals = expectedGoalTotal(exactEntries, blendedLookup)
  const rows: StrategySeedRow[] = []
  const usedScores = new Set<string>()

  const addRow = (entry: OddsEntry, role: string, emphasis: StrategyEmphasis) => {
    if (usedScores.has(entry.score)) return
    rows.push({ score: entry.score, role, emphasis, predictedProbability: null })
    usedScores.add(entry.score)
  }

  // 1. Main anchor (highest blended prob in favorite direction)
  addRow(mainEntry, `${labelForOutcome(favoriteOutcome)}锚点`, 'main')

  // 2. Second coverage in favorite direction (different goal total preferred)
  const mainGoalTotal = goalTotal(mainEntry.score)
  const favSupport = favEntries.find(
    (e) => !usedScores.has(e.score) && goalTotal(e.score) !== mainGoalTotal,
  ) ?? favEntries.find((e) => !usedScores.has(e.score))

  if (favSupport) {
    addRow(favSupport, `${labelForOutcome(favoriteOutcome)}扩展`, 'support')
  }

  // 3. Draw protection: add if draw probability is meaningful
  if (outcomeTotals.draw > 0.16) {
    const drawEntries = byBlended.filter((e) => e.outcomeType === 'draw')
    const bestDraw = drawEntries[0]
    if (bestDraw) {
      addRow(bestDraw, '平局保护', 'draw')
    }
  }

  // 4. Score near expected goal total (if not already covered)
  // Scores whose goal total is the nearest integer to expectedGoals
  const targetGoalTotal = Math.round(expectedGoals)
  const nearTarget = byBlended.find(
    (e) => !usedScores.has(e.score) && goalTotal(e.score) === targetGoalTotal,
  )
  if (nearTarget && rows.length < 4) {
    const outcome = nearTarget.outcomeType
    addRow(
      nearTarget,
      outcome === 'draw' ? '目标进球平局' : `${labelForOutcome(outcome)}目标区间`,
      outcome === 'draw' ? 'draw' : 'support',
    )
  }

  // 5. Best-EV tail: highest EV among unused scores, prefer underdog direction
  const unusedByEV = byBlended
    .filter((e) => !usedScores.has(e.score))
    .map((e) => ({ entry: e, ev: tailEV(blendedLookup.get(e.score) ?? 0, e.odds) }))
    .sort((a, b) => {
      // Give priority to underdog direction, then rank by EV
      const aUnder = a.entry.outcomeType === underdogOutcome ? 1 : 0
      const bUnder = b.entry.outcomeType === underdogOutcome ? 1 : 0
      if (bUnder !== aUnder) return bUnder - aUnder
      return b.ev - a.ev
    })
  const tailEntry = unusedByEV[0]?.entry

  if (tailEntry) {
    addRow(
      tailEntry,
      tailEntry.outcomeType === underdogOutcome ? '反向高EV尾部' : '高EV尾部',
      'tail',
    )
  }

  // 6. Fill to 5 with next best blended scores
  for (const entry of byBlended) {
    if (rows.length >= 5) break
    if (!usedScores.has(entry.score)) {
      const outcome = entry.outcomeType
      addRow(
        entry,
        outcome === 'draw' ? '平局补充' : `${labelForOutcome(outcome)}补充`,
        outcome === 'draw' ? 'draw' : 'support',
      )
    }
  }

  return {
    label: '保守版：多比分覆盖',
    notes: [
      '锚点比分守成本，预测概率结合世界杯历史频率与当场赔率混合计算。',
      '命中覆盖比分时以保本或小赚为优先，未覆盖比分出现时净亏全部预算。',
    ],
    rows,
  }
}

// ── Stake allocation ──────────────────────────────────────────────────────────

function allocateProportionalIntegers(total: number, weights: number[]) {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightSum <= 0) return weights.map(() => 0)

  const rawAllocations = weights.map((weight) => (weight / weightSum) * total)
  const floorAllocations = rawAllocations.map((value) => Math.floor(value))
  let remainder = total - floorAllocations.reduce((sum, value) => sum + value, 0)

  const byRemainder = rawAllocations
    .map((value, index) => ({ index, remainder: value - floorAllocations[index] }))
    .sort((a, b) => b.remainder - a.remainder)

  for (const entry of byRemainder) {
    if (remainder <= 0) break
    floorAllocations[entry.index] += 1
    remainder -= 1
  }

  return floorAllocations
}

function allocateAggressive(rows: Array<{ odds: number }>, budget: number) {
  return allocateProportionalIntegers(budget, rows.map((row) => 1 / row.odds))
}

function conservativeStakePlan(rows: Array<{ odds: number; emphasis: StrategyEmphasis }>, budget: number) {
  if (rows.length === 0) return []

  const tailIndexes = rows
    .map((row, index) => ({ emphasis: row.emphasis, index }))
    .filter((row) => row.emphasis === 'tail')
    .map((row) => row.index)
  const effectiveTailIndexes = tailIndexes.length > 0 ? tailIndexes : [rows.length - 1]
  const coverageIndexes = rows.map((_, index) => index).filter((i) => !effectiveTailIndexes.includes(i))
  const minimumTailBudget = Math.max(effectiveTailIndexes.length * 4, Math.round(budget * 0.12))
  let targetMultiplier = 1.02
  let coverageAllocations = coverageIndexes.map(() => 0)

  while (targetMultiplier >= 0.92) {
    coverageAllocations = coverageIndexes.map((index) =>
      Math.max(1, Math.round((budget * targetMultiplier) / rows[index].odds)),
    )
    const coverageTotal = coverageAllocations.reduce((sum, value) => sum + value, 0)
    if (coverageTotal <= budget - minimumTailBudget) break
    targetMultiplier -= 0.01
  }

  const stakes = rows.map(() => 0)
  coverageIndexes.forEach((index, arrayIndex) => {
    stakes[index] = coverageAllocations[arrayIndex]
  })

  const usedBudget = stakes.reduce((sum, stake) => sum + stake, 0)
  const tailBudget = Math.max(0, budget - usedBudget)

  if (effectiveTailIndexes.length > 0) {
    const tailAllocations = allocateProportionalIntegers(
      tailBudget,
      effectiveTailIndexes.map((index) => 1 / rows[index].odds),
    )
    effectiveTailIndexes.forEach((index, arrayIndex) => {
      stakes[index] += tailAllocations[arrayIndex]
    })
  }

  let difference = budget - stakes.reduce((sum, stake) => sum + stake, 0)
  const fixOrder = [...coverageIndexes, ...effectiveTailIndexes]
  let safetyLimit = fixOrder.length * Math.abs(difference) + fixOrder.length + 1

  while (difference !== 0 && fixOrder.length > 0 && safetyLimit-- > 0) {
    for (const index of fixOrder) {
      if (difference === 0) break
      if (difference > 0) {
        stakes[index] += 1
        difference -= 1
      } else if (stakes[index] > 1) {
        stakes[index] -= 1
        difference += 1
      }
    }
    if (difference < 0 && fixOrder.every((index) => stakes[index] <= 1)) break
  }

  return stakes
}

// ── Probability range from blended probability ────────────────────────────────
// Low/high bounds reflect estimation uncertainty (±15-22% around point estimate)

function probabilityRangeFromBlended(
  blendedProb: number,
  emphasis: StrategyEmphasis,
): ProbabilityRange {
  // Uncertainty is wider for tail picks (less reliable), tighter for main picks
  const halfWidth = emphasis === 'tail' ? 0.22 : emphasis === 'main' ? 0.15 : 0.18
  const low = clamp(blendedProb * (1 - halfWidth), 0, 0.97)
  const high = clamp(blendedProb * (1 + halfWidth), low, 0.99)
  return { low, high, mid: Number(((low + high) / 2).toFixed(6)) }
}

// ── Build strategy ────────────────────────────────────────────────────────────

function buildStrategy(match: MatchRecord, kind: StrategyKind, budget: number): StrategyComputation {
  const oddsLookup = buildOddsLookup(match)
  const impliedLookup = buildImpliedProbabilityLookup(match)
  const exactEntries = match.oddsEntries.filter((entry) => isNumericScore(entry.score))

  if (exactEntries.length === 0) {
    return {
      kind,
      title: kind === 'conservative' ? '保守版' : '进取版',
      summary: '当前没有可用的官方比分赔率，暂不生成购买方案。',
      rows: [],
      predictedCoverage: { low: 0, high: 0, mid: 0 },
      impliedCoverage: 0,
      expectedNet: 0,
      profitRange: { min: 0, max: 0 },
      riskLoss: budget,
      notes: ['等待官方比分赔率恢复后再计算，避免用空数据或旧赔率执行。'],
    }
  }

  // Blended probability: market + WC prior
  const blendedLookup = buildBlendedProbabilities(exactEntries, impliedLookup)

  const legacySeed = seedFromLegacy(match, kind)
  let seed = legacySeed ?? autoSeed(match, kind, exactEntries, blendedLookup)
  let baseRows = seed.rows
    .map((row) => {
      const oddsEntry = oddsLookup.get(row.score)
      if (!oddsEntry) return null
      return {
        ...row,
        odds: oddsEntry.odds,
        impliedProbability: impliedLookup.get(row.score) ?? 0,
        blendedProbability: blendedLookup.get(row.score) ?? 0,
        outcomeType: oddsEntry.outcomeType,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const requiredRows = kind === 'aggressive' ? 2 : 1

  if (legacySeed && baseRows.length < requiredRows) {
    seed = autoSeed(match, kind, exactEntries, blendedLookup)
    baseRows = seed.rows
      .map((row) => {
        const oddsEntry = oddsLookup.get(row.score)
        if (!oddsEntry) return null
        return {
          ...row,
          odds: oddsEntry.odds,
          impliedProbability: impliedLookup.get(row.score) ?? 0,
          blendedProbability: blendedLookup.get(row.score) ?? 0,
          outcomeType: oddsEntry.outcomeType,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
  }

  if (baseRows.length === 0) {
    return {
      kind,
      title: kind === 'conservative' ? '保守版' : '进取版',
      summary: '当前没有可用的官方比分赔率，暂不生成购买方案。',
      rows: [],
      predictedCoverage: { low: 0, high: 0, mid: 0 },
      impliedCoverage: 0,
      expectedNet: 0,
      profitRange: { min: 0, max: 0 },
      riskLoss: budget,
      notes: ['等待官方比分赔率恢复后再计算，避免用空数据或旧赔率执行。'],
    }
  }

  const stakes =
    kind === 'aggressive'
      ? allocateAggressive(baseRows, budget)
      : conservativeStakePlan(baseRows, budget)

  const rows: StrategyRow[] = baseRows.map((row, index) => {
    // Use legacy-provided probability if available; otherwise use blended
    const predictedProbability: ProbabilityRange =
      row.predictedProbability ??
      probabilityRangeFromBlended(row.blendedProbability, row.emphasis)

    const stake = stakes[index] ?? 0
    const payout = roundMoney(stake * row.odds)
    const netProfit = roundMoney(payout - budget)

    return {
      score: row.score,
      role: row.role,
      emphasis: row.emphasis,
      predictedProbability,
      odds: row.odds,
      stake,
      payout,
      netProfit,
      impliedProbability: row.impliedProbability,
      outcomeType: row.outcomeType,
    }
  })

  const predictedCoverage = rows.reduce<ProbabilityRange>(
    (total, row) => ({
      low: total.low + row.predictedProbability.low,
      high: total.high + row.predictedProbability.high,
      mid: total.mid + row.predictedProbability.mid,
    }),
    { low: 0, high: 0, mid: 0 },
  )
  const impliedCoverage = rows.reduce((sum, row) => sum + row.impliedProbability, 0)
  const uncoveredProbability = clamp(1 - predictedCoverage.mid, 0, 1)
  const expectedNet = roundMoney(
    rows.reduce((sum, row) => sum + row.predictedProbability.mid * row.netProfit, 0) +
      uncoveredProbability * -budget,
  )
  const netProfits = rows.map((row) => row.netProfit)
  const title = kind === 'conservative' ? '保守版' : '进取版'
  const summary =
    kind === 'conservative'
      ? '多比分覆盖：混合世界杯历史频率与本场赔率，锚点守成本，尾部选取期望收益最高的比分。'
      : '两注高利润：主路径比分 + 跨方向/跨进球区间最优 EV 尾部。'

  return {
    kind,
    title,
    summary,
    rows,
    predictedCoverage: {
      low: clamp(predictedCoverage.low, 0, 1),
      high: clamp(predictedCoverage.high, 0, 1),
      mid: clamp(predictedCoverage.mid, 0, 1),
    },
    impliedCoverage: clamp(impliedCoverage, 0, 1),
    expectedNet,
    profitRange: {
      min: Math.min(...netProfits),
      max: Math.max(...netProfits),
    },
    riskLoss: budget,
    notes: seed.notes,
  }
}

export function buildMatchViewModels(matches: MatchRecord[], budget: number): MatchViewModel[] {
  return matches.map((match) => ({
    match,
    conservative: buildStrategy(match, 'conservative', budget),
    aggressive: buildStrategy(match, 'aggressive', budget),
  }))
}
