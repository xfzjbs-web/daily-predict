import fs from 'node:fs'
import path from 'node:path'
import { load } from 'cheerio'

const defaultSourcePath =
  'D:\\工程\\tapnow-clone-backup-v13-theme-complete\\worldcup_score_odds_view_2026-06-12.html'
const sourcePath = path.resolve(process.argv[2] ?? defaultSourcePath)
const outputPath = path.resolve('src/data/legacy-data.json')

const html = fs.readFileSync(sourcePath, 'utf8')
const $ = load(html)

function cleanText(value) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseNumber(value) {
  const normalized = cleanText(value).replace(/[^\d.+-]/g, '')
  return normalized ? Number(normalized) : null
}

function parsePercentRange(value) {
  const matches = cleanText(value).match(/(\d+(?:\.\d+)?)%\s*-\s*(\d+(?:\.\d+)?)%/)

  if (matches) {
    const low = Number(matches[1]) / 100
    const high = Number(matches[2]) / 100

    return {
      low,
      high,
      mid: Number(((low + high) / 2).toFixed(6)),
    }
  }

  const singleMatch = cleanText(value).match(/(\d+(?:\.\d+)?)%/)

  if (!singleMatch) {
    return null
  }

  const single = Number(singleMatch[1]) / 100

  return {
    low: single,
    high: single,
    mid: single,
  }
}

function parseMoney(value) {
  const parsed = parseNumber(value)

  return parsed === null ? null : Number(parsed.toFixed(2))
}

function parseOdds(value) {
  const parsed = parseNumber(value)

  return parsed === null ? null : Number(parsed.toFixed(2))
}

function parseTitle(value) {
  const text = cleanText(value)
  const match = text.match(/^(\S+\d{3})\s+(.+?)\s+vs\s+(.+)$/)

  if (!match) {
    return {
      code: text,
      homeTeam: '',
      awayTeam: '',
      title: text,
    }
  }

  return {
    code: match[1],
    homeTeam: match[2],
    awayTeam: match[3],
    title: text,
  }
}

function parseSubline(value) {
  const text = cleanText(value)
  const match = text.match(/^开赛:\s*(.+?)\s*\|\s*比分赔率更新时间:\s*(.+)$/)

  if (!match) {
    return {
      kickoff: '',
      oddsUpdatedAt: '',
    }
  }

  return {
    kickoff: match[1],
    oddsUpdatedAt: match[2],
  }
}

function parseChip(chipElement) {
  const chip = $(chipElement)
  const score = cleanText(chip.find('b').text())
  const oddsText = cleanText(chip.text().replace(score, ''))
  const odds = parseOdds(oddsText)

  if (!score || odds === null) {
    return null
  }

  return { score, odds }
}

function parseOddsEntries(card) {
  const outcomeTypes = ['home', 'draw', 'away']
  const table = card.children('table').first()
  const entries = []

  table.find('tbody tr').each((_, rowElement) => {
    const cells = $(rowElement).find('td').toArray()

    for (let columnIndex = 0; columnIndex < 3; columnIndex += 1) {
      const scoreCell = $(cells[columnIndex * 2])
      const oddsCell = $(cells[columnIndex * 2 + 1])
      const score = cleanText(scoreCell.text())
      const odds = parseOdds(oddsCell.text())

      if (!score || odds === null) {
        continue
      }

      const highlight = scoreCell.hasClass('pick-main') || oddsCell.hasClass('pick-main')
        ? 'main'
        : scoreCell.hasClass('pick-alt') || oddsCell.hasClass('pick-alt')
          ? 'alt'
          : null

      entries.push({
        score,
        odds,
        outcomeType: outcomeTypes[columnIndex],
        highlight,
      })
    }
  })

  return entries
}

function parsePortfolioRows(panel) {
  const rows = []

  panel.find('tbody tr').each((_, rowElement) => {
    const cells = $(rowElement).find('td').toArray().map((cell) => cleanText($(cell).text()))

    if (cells.length < 7) {
      return
    }

    const odds = parseOdds(cells[3])
    const stake = parseMoney(cells[2])
    const payout = parseMoney(cells[4])
    const netProfit = parseMoney(cells[5])
    const predictedProbability = parsePercentRange(cells[6])

    if (!cells[0] || odds === null || stake === null || payout === null || netProfit === null) {
      return
    }

    rows.push({
      score: cells[0],
      role: cells[1],
      stake,
      odds,
      payout,
      netProfit,
      predictedProbability,
    })
  })

  return rows
}

function parseBudgetPanel(panelElement) {
  const panel = $(panelElement)
  const title = cleanText(panel.find('.budget-title').first().text())
  const notes = panel
    .find('.budget-note')
    .toArray()
    .map((note) => cleanText($(note).text()))
    .filter(Boolean)

  return {
    title,
    notes,
    rows: parsePortfolioRows(panel),
  }
}

function parseAnalysis(card) {
  const analysisBox = card.find('.analysis-box').first()

  if (!analysisBox.length) {
    return null
  }

  const mainScore = cleanText(analysisBox.find('.pick.main strong').first().text())
  const mainOdds = parseOdds(analysisBox.find('.pick.main span').last().text())
  const altScore = cleanText(analysisBox.find('.pick.alt strong').first().text())
  const altOdds = parseOdds(analysisBox.find('.pick.alt span').last().text())

  return {
    title: cleanText(analysisBox.find('.analysis-title').first().text()),
    summary: cleanText(analysisBox.find('.analysis-summary').first().text()),
    structureTag: cleanText(analysisBox.find('.structure-tag').first().text()),
    mainPick:
      mainScore && mainOdds !== null
        ? {
            score: mainScore,
            odds: mainOdds,
          }
        : null,
    altPick:
      altScore && altOdds !== null
        ? {
            score: altScore,
            odds: altOdds,
          }
        : null,
    coverageSummary: cleanText(analysisBox.find('.pick.stake').first().text()),
    factors: analysisBox
      .find('.factor-list li')
      .toArray()
      .map((item) => cleanText($(item).text()))
      .filter(Boolean),
    logic: analysisBox
      .find('.logic-card')
      .toArray()
      .map((logicCard) => ({
        title: cleanText($(logicCard).find('h4').first().text()),
        description: cleanText($(logicCard).find('p').first().text()),
      }))
      .filter((item) => item.title || item.description),
    sources: analysisBox
      .find('.sources a')
      .toArray()
      .map((anchor) => ({
        title: cleanText($(anchor).text()),
        href: $(anchor).attr('href') ?? '',
      }))
      .filter((item) => item.title && item.href),
    legacyStrategies: {
      conservative: parseBudgetPanel(analysisBox.find('.budget-panel').eq(0)),
      aggressive: parseBudgetPanel(analysisBox.find('.budget-panel').eq(1)),
    },
  }
}

function parseMeta() {
  const meta = $('.hero .meta').first()
  const metaText = cleanText(meta.text())
  const sourceApiUrl = meta.find('a').first().attr('href') ?? ''
  const officialUpdatedAt = metaText.match(/最后更新时间:\s*([0-9:\-\s]+)/)?.[1]?.trim() ?? ''
  const verifiedAt = metaText.match(/本次重新核验时间:\s*([0-9:\-（北京时间）\s]+)/)?.[1]?.trim() ?? ''

  return {
    appName: cleanText($('h1').first().text()) || '每日预测',
    sourceApiUrl,
    officialUpdatedAt,
    verifiedAt,
    sourceFile: sourcePath,
    importedAt: new Date().toISOString(),
  }
}

const matches = $('section.grid > article.card')
  .toArray()
  .map((cardElement, index) => {
    const card = $(cardElement)
    const titleData = parseTitle(card.find('.title').first().text())
    const sublineData = parseSubline(card.find('.sub').first().text())
    const analysis = parseAnalysis(card)
    const topScores = card
      .find('.chips .chip')
      .toArray()
      .map(parseChip)
      .filter(Boolean)

    return {
      id: `${titleData.code || 'match'}-${index + 1}`,
      ...titleData,
      ...sublineData,
      featured: Boolean(analysis),
      topScores,
      oddsEntries: parseOddsEntries(card),
      analysis,
    }
  })

const dataset = {
  meta: parseMeta(),
  matches,
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')

console.log(`Imported ${matches.length} matches from ${sourcePath}`)
console.log(`Wrote structured data to ${outputPath}`)
