import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, s-maxage=60')
  return res.status(200).json({
    version: process.env.APP_VERSION ?? '1.3.0',
    buildDate: process.env.BUILD_DATE ?? '2026-06-17',
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? 'local',
  })
}
