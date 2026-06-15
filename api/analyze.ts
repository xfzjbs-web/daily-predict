import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface AnalyzeRequest {
  match: {
    homeTeam: string
    awayTeam: string
    kickoff: string
    leagueName: string
    code: string
  }
  odds: Array<{
    score: string
    odds: number
    impliedPct: string
    blendedPct: string
    outcomeType: string
  }>
  expectedGoals: number
  outcomeTotals: { home: string; draw: string; away: string }
  conservativePicks: string[]
  aggressivePicks: { main: string; tail: string }
}

function buildPrompt(req: AnalyzeRequest): string {
  const { match, odds, expectedGoals, outcomeTotals, conservativePicks, aggressivePicks } = req

  const oddsTable = odds
    .slice(0, 16)
    .map(
      (o) =>
        `  ${o.score.padEnd(5)} @${String(o.odds).padEnd(6)} 隐含${o.impliedPct.padEnd(7)} 混合${o.blendedPct.padEnd(7)} (${o.outcomeType === 'home' ? '主胜' : o.outcomeType === 'draw' ? '平局' : '客胜'})`,
    )
    .join('\n')

  return `你是一位专业的竞彩足球精确比分分析师，擅长识别赔率中的价值点和市场低估的比分。

## 比赛信息
- 主队：${match.homeTeam}
- 客队：${match.awayTeam}
- 时间：${match.kickoff}（北京时间）
- 赛事：${match.leagueName}（编号 ${match.code}）

## 当前体彩官方比分赔率
（混合概率 = 75% 市场隐含 + 25% 世界杯历史先验，已去水归一化）
${oddsTable}

## 盘面统计
- 预期总进球（加权均值）：${expectedGoals.toFixed(2)} 球
- 主胜方向合计：${outcomeTotals.home}
- 平局方向合计：${outcomeTotals.draw}
- 客胜方向合计：${outcomeTotals.away}

## 当前算法推荐
- 保守版（5 个比分）：${conservativePicks.join('、')}
- 进取版：主路径 ${aggressivePicks.main}，尾部 ${aggressivePicks.tail}

## 分析要求
请重点关注：
1. 赔率分布是否存在明显错误定价（某比分混合概率远高于隐含概率）
2. 进球数分布——预期进球 ${expectedGoals.toFixed(2)} 球，哪个进球数区间被市场低估
3. 对当前算法推荐的评价：是否认同保守版选分，有无遗漏的高价值比分
4. 进取版尾部是否是最优选择，还是有更好的替代

## 回复格式（严格 JSON，不要加 markdown 代码块）
{
  "verdict": "一句话最终判断（20-40字）",
  "marketInsight": "盘面关键信息，包括赔率分布特征和价值点识别（2-4句）",
  "strategyComment": "对算法推荐比分的评价，是否调整并说明理由（2-3句）",
  "riskFlags": ["风险因素1", "风险因素2"],
  "adjustedConservative": ["比分1", "比分2", "比分3", "比分4", "比分5"] 或 null（认同当前则 null）,
  "adjustedAggressive": {"main": "比分", "tail": "比分"} 或 null（认同则 null）,
  "confidence": "low 或 medium 或 high"
}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' })
  }

  try {
    const body = req.body as AnalyzeRequest

    if (!body?.match?.homeTeam || !body?.odds?.length) {
      return res.status(400).json({ error: 'Invalid request body' })
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(body) }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return res.status(500).json({ error: 'Claude 返回了无法解析的格式', raw: text.slice(0, 400) })
    }

    return res.status(200).json({ ...(parsed as object), rawModel: message.model })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
