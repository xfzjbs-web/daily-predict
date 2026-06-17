import type { VercelRequest, VercelResponse } from '@vercel/node'

interface AnalysisStore {
  [dateKey: string]: {
    insights: Record<string, unknown>
    analyzedAt: string
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { date } = req.query
  if (!date || typeof date !== 'string') return res.status(400).json({ error: 'Missing date' })

  const raw = process.env.ANALYSIS_DATA
  if (!raw) return res.status(200).json({ found: false })

  try {
    const store = JSON.parse(raw) as AnalysisStore
    const entry = store[date]
    if (!entry) return res.status(200).json({ found: false })
    return res.status(200).json({ found: true, insights: entry.insights, analyzedAt: entry.analyzedAt })
  } catch {
    return res.status(200).json({ found: false })
  }
}
