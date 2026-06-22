/**
 * 每日分析脚本 — 在浏览器控制台粘贴运行（需要能访问 sporttery API 的页面）
 *
 * 字段规范（不要改）：
 *   Gist 日期 key  = matchDate（实际踢球日，如 "2026-06-23"）
 *   Gist 场次 key  = matchNumStr（如 "周一041"）= match.code in App
 *
 * 为什么不用 businessDate？
 *   体彩业务日（businessDate）= 期次开售日，凌晨踢的球归前一天期次。
 *   App 用 match.kickoff.slice(0,10) 分组，kickoff 来自 matchDate + matchTime，
 *   所以必须用 matchDate 作为 Gist key 才能对上。
 *
 * 为什么不用 matchNum 或 matchId？
 *   matchNum 是整数（1041），matchNumStr 才是字符串（"周一041"）。
 *   App 里 match.code = matchNumStr，AI 分析查的是 claudeInsights[match.code]。
 */

const GIST_ID = '2ede41711a15eb746939df5ff10a42de'
const VERCEL_URL = 'https://daily-predict-coral.vercel.app'
const GITHUB_TOKEN = '请在此填入 GitHub Token（不要提交到代码库）'

const WC_PRIOR = {
  '0:0':0.059,'1:0':0.082,'0:1':0.082,'1:1':0.107,'2:0':0.076,'0:2':0.052,
  '2:1':0.116,'1:2':0.089,'2:2':0.057,'3:0':0.040,'0:3':0.021,'3:1':0.044,
  '1:3':0.024,'3:2':0.024,'2:3':0.017,'4:0':0.013,'0:4':0.006,'4:1':0.011,'1:4':0.007,
}

function outcomeType(score) {
  const [a, b] = score.split(':').map(Number)
  return a > b ? 'home' : a < b ? 'away' : 'draw'
}

function buildPayload(match) {
  const exact = match.oddsEntries.filter(e => /^\d+:\d+$/.test(e.score))
  const denom = exact.reduce((s, e) => s + 1 / e.odds, 0)
  const priorSum = exact.reduce((s, e) => s + (WC_PRIOR[e.score] || 0), 0)
  const pk = priorSum > 0 ? 1 / priorSum : 1
  const bm = new Map()
  for (const e of exact) {
    const impl = denom > 0 ? (1 / e.odds) / denom : 0
    bm.set(e.score, 0.75 * impl + 0.25 * (WC_PRIOR[e.score] || 0) * pk)
  }
  const bt = [...bm.values()].reduce((s, v) => s + v, 0)
  let eg = 0
  for (const e of exact) {
    const m = e.score.match(/^(\d+):(\d+)$/)
    if (m) eg += ((bm.get(e.score) || 0) / bt) * (+m[1] + +m[2])
  }
  const im = new Map(exact.map(e => [e.score, denom > 0 ? (1 / e.odds) / denom : 0]))
  const totals = { home: 0, draw: 0, away: 0 }
  for (const e of exact) totals[outcomeType(e.score)] += im.get(e.score) || 0
  const fp = v => (v * 100).toFixed(1) + '%'
  const odds = [...match.oddsEntries].sort((a, b) => a.odds - b.odds).slice(0, 16).map(e => ({
    score: e.score, odds: e.odds,
    impliedPct: /^\d+:\d+$/.test(e.score) ? fp(im.get(e.score) || 0) : '-',
    blendedPct: /^\d+:\d+$/.test(e.score) ? fp((bm.get(e.score) || 0) / bt) : '-',
    outcomeType: outcomeType(e.score),
  }))
  const ranked = [...bm.entries()].sort((a, b) => b[1] - a[1])
  return {
    match: { homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff, leagueName: match.leagueName, code: match.code },
    odds, expectedGoals: eg,
    outcomeTotals: { home: fp(totals.home), draw: fp(totals.draw), away: fp(totals.away) },
    conservativePicks: ranked.slice(0, 3).map(([s]) => s),
    aggressivePicks: { main: ranked[0]?.[0] || '', tail: ranked[3]?.[0] || '' },
  }
}

async function fetchTodayMatches(targetBusinessDate) {
  // targetBusinessDate 格式: "2026-06-23"（体彩期次日，非踢球日）
  const api = await fetch('https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=crs').then(r => r.json())
  const all = api.value?.matchInfoList ?? []
  const bd = targetBusinessDate.replace(/-/g, '')  // "20260623"
  const group = all.find(g => g.businessDate === targetBusinessDate || g.businessDate === bd)
  const subs = all.filter(g => g.businessDate === targetBusinessDate || g.businessDate === bd).flatMap(g => g.subMatchList ?? [])

  return subs.map(m => {
    const crs = m.crs || {}
    const oddsEntries = []
    for (const [k, v] of Object.entries(crs)) {
      if (/^s\d+s\d+$/.test(k) && !k.endsWith('f')) {
        const val = parseFloat(v)
        if (val > 0) {
          const p = k.match(/s(\d+)s(\d+)/)
          oddsEntries.push({ score: `${p[1]}:${p[2]}`, odds: val })
        }
      }
    }
    // ★ matchDate = 实际踢球日（用于 Gist key 和 kickoff）
    // ★ matchNumStr = 场次代码（用于 Gist insights key 和 match.code）
    return {
      code: m.matchNumStr,           // → Gist insights key，等于 App 的 match.code
      matchDate: m.matchDate,        // → Gist 日期 key（不是 businessDate！）
      homeTeam: m.homeTeamAbbName,
      awayTeam: m.awayTeamAbbName,
      kickoff: `${m.matchDate}T${m.matchTime}`,
      leagueName: '世界杯2026',
      oddsEntries,
    }
  })
}

async function analyzeAndPush(targetBusinessDate) {
  console.log(`开始分析 businessDate=${targetBusinessDate} 的比赛...`)
  const matches = await fetchTodayMatches(targetBusinessDate)
  if (matches.length === 0) {
    console.error('未找到比赛，检查 businessDate 是否正确（格式: "2026-06-23"）')
    return
  }

  // ★ Gist 日期 key 用第一场的 matchDate（实际踢球日）
  const gistDateKey = matches[0].matchDate
  console.log(`Gist 将存入 key="${gistDateKey}"，共 ${matches.length} 场:`)
  matches.forEach(m => console.log(`  ${m.code} ${m.homeTeam} vs ${m.awayTeam} (kickoff: ${m.kickoff})`))

  const insights = {}
  for (const match of matches) {
    console.log(`  分析 ${match.code} ${match.homeTeam} vs ${match.awayTeam}...`)
    const result = await fetch(`${VERCEL_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(match)),
    }).then(r => r.json())
    if (result.error) {
      console.error(`  ✗ ${match.code} 分析失败:`, result.error)
      continue
    }
    insights[match.code] = result  // ★ key = matchNumStr = match.code
    console.log(`  ✓ ${match.code}: ${result.verdict?.slice(0, 50)}`)
  }

  // 读取现有 Gist，合并写入
  const gist = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  }).then(r => r.json())
  const content = JSON.parse(gist.files['analysis.json'].content)
  content[gistDateKey] = { insights, analyzedAt: new Date().toISOString(), matchCount: matches.length }

  const resp = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { 'analysis.json': { content: JSON.stringify(content, null, 2) } } }),
  }).then(r => r.json())

  if (resp.updated_at) {
    console.log(`✅ 推送成功! Gist key="${gistDateKey}", 场次 keys: ${Object.keys(insights).join(', ')}`)
  } else {
    console.error('推送失败:', JSON.stringify(resp).slice(0, 200))
  }
}

// ── 使用方法 ──────────────────────────────────────────────────────────────────
// 在浏览器控制台粘贴整个文件后，调用：
//   analyzeAndPush("2026-06-23")   ← 填体彩期次日（businessDate），不是踢球日
//
// 如何找到正确的 businessDate：
//   在控制台运行以下代码查看当前所有期次日：
//   fetch('https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=crs')
//     .then(r=>r.json()).then(d=>d.value.matchInfoList.map(g=>({bd:g.businessDate,count:g.subMatchList?.length})))
//     .then(console.log)
