import { useCallback, useEffect, useMemo, useState } from 'react'
import { APP_VERSION, BUILD_DATE, CHANGELOG } from './version.ts'
import { MatchAnalysisCard } from './components/MatchAnalysisCard.tsx'
import { RecentResultsCard } from './components/RecentResultsCard.tsx'
import { filterMatchesByYear } from './data/current-year-context.ts'
import { legacyData } from './data/index.ts'
import {
  fetchServerAnalysis,
  saveOddsHistory,
  type BatchAnalysisState,
  type ClaudeResult,
} from './lib/aiAnalysis.ts'
import {
  getPrimaryDateKey,
  getTodayKey,
  getTomorrowKey,
  getYesterdayKey,
  groupMatchesByDate,
  sortMatchesByKickoff,
} from './lib/schedule.ts'
import { fetchSportteryMatches } from './lib/sporttery.ts'
import { fetchSportteryResults } from './lib/sportteryResults.ts'
import {
  readCachedMatches,
  readCachedResults,
  readPreferences,
  writeCachedMatches,
  writeCachedResults,
  writePreferences,
} from './lib/storage.ts'
import { loadConfirmedBuys, removeConfirmedBuy, settleConfirmedBuys } from './lib/confirmedBuys.ts'
import { buildMatchViewModels } from './lib/strategy.ts'
import type { MatchRecord, MatchResultRecord } from './lib/types.ts'

import { formatSignedCurrency } from './lib/format.ts'
import type { ConfirmedSettlement } from './lib/confirmedBuys.ts'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const RESULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const ANALYSIS_YEAR = new Date().getFullYear()

type DataStatus = 'fallback' | 'cached' | 'refreshing' | 'live' | 'error'
type TabKind = 'matches' | 'review' | 'settings'

function isWorldCup(m: MatchRecord) {
  const n = m.leagueName ?? ''
  return !n || n.includes('世界杯') || n.toLowerCase().includes('world cup')
}

function ConfirmedBuyReview({
  settlements,
  onBuyRemoved,
}: {
  settlements: ConfirmedSettlement[]
  onBuyRemoved: () => void
}) {
  const totalNet = settlements.reduce((s, r) => s + r.netResult, 0)
  const totalStake = settlements.reduce((s, r) => s + r.buy.totalStake, 0)
  const hitCount = settlements.filter((r) => r.hitPick).length
  const roi = totalStake > 0 ? totalNet / totalStake : 0

  return (
    <div className="review-section">
      <div className="review-title">真实买入复盘</div>
      {settlements.length === 0 ? (
        <div className="review-empty">
          还没有已结算的买入记录。在今日 tab 点击「确认买入」，比赛结束后自动结算。
        </div>
      ) : (
        <>
          <div className="review-stats">
            <div className="review-stat">
              <span>已结算</span>
              <strong>{settlements.length} 场</strong>
            </div>
            <div className="review-stat">
              <span>命中率</span>
              <strong>{hitCount}/{settlements.length}</strong>
            </div>
            <div className="review-stat">
              <span>净盈亏</span>
              <strong className={totalNet >= 0 ? 'text-green' : 'text-red'}>{formatSignedCurrency(totalNet)}</strong>
            </div>
            <div className="review-stat">
              <span>ROI</span>
              <strong className={roi >= 0 ? 'text-green' : 'text-red'}>{(roi * 100).toFixed(1)}%</strong>
            </div>
          </div>
          <div className="review-list">
            {settlements.map(({ buy, result, hitPick, netResult }) => (
              <div key={buy.matchId} className={`review-item ${hitPick ? 'hit' : 'miss'}`}>
                <div className="review-item-main">
                  <span className="review-item-teams">{buy.homeTeam} vs {buy.awayTeam}</span>
                  <span className={`review-item-result ${hitPick ? 'text-green' : 'text-red'}`}>
                    {result.finalScore} {hitPick ? '✓ 命中' : '✗ 未中'}
                  </span>
                </div>
                <div className="review-item-picks">
                  {buy.picks.map((p) => (
                    <span
                      key={p.score}
                      className={`review-pick-chip ${p.score === result.finalScore ? 'hit-chip' : ''}`}
                    >
                      {p.score}
                    </span>
                  ))}
                  <span className={`review-net ${netResult >= 0 ? 'text-green' : 'text-red'}`}>
                    {formatSignedCurrency(netResult)}
                  </span>
                </div>
                <div className="review-item-meta">
                  {buy.source === 'claude' ? 'Claude调整' : '算法'} · {buy.strategy === 'conservative' ? '保守' : '进取'} · {buy.matchDate}
                  <button
                    type="button"
                    className="review-remove-btn"
                    onClick={() => { removeConfirmedBuy(buy.matchId); onBuyRemoved() }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function withLegacySource(matches: MatchRecord[]) {
  return matches.map((m) => ({ ...m, leagueName: m.leagueName ?? '世界杯', source: m.source ?? 'legacy' as const }))
}

function getInitialMatches(cached: MatchRecord[] | undefined) {
  const cy = cached ? filterMatchesByYear(cached, ANALYSIS_YEAR).filter(isWorldCup) : []
  return cy.length > 0 ? cy : filterMatchesByYear(withLegacySource(legacyData.matches), ANALYSIS_YEAR).filter(isWorldCup)
}

function hasCurrentYearCache(cached: MatchRecord[] | undefined) {
  return cached ? filterMatchesByYear(cached, ANALYSIS_YEAR).length > 0 : false
}

function filterResultsByYear(results: MatchResultRecord[] | undefined) {
  return (results ?? []).filter((r) => Number(r.matchDate.slice(0, 4)) === ANALYSIS_YEAR)
}

function formatRefreshTime(value: string | null) {
  if (!value) return '未刷新'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(
    new Date(`${dateKey}T12:00:00`),
  )
}

function dateRoleLabel(dateKey: string) {
  const today = getTodayKey()
  const yesterday = getYesterdayKey()
  const tomorrow = getTomorrowKey()
  if (dateKey === yesterday) return '昨日'
  if (dateKey < yesterday) return '历史'
  if (dateKey === today) return '今日'
  if (dateKey === tomorrow) return '明日'
  return '未来'
}

function App() {
  const [cached] = useState(readCachedMatches)
  const [cachedResults] = useState(readCachedResults)
  const [prefs] = useState(readPreferences)
  const [matches, setMatches] = useState<MatchRecord[]>(() => getInitialMatches(cached?.matches))
  const [results, setResults] = useState<MatchResultRecord[]>(() => filterResultsByYear(cachedResults?.results))
  const [budget, setBudget] = useState(prefs.budget)
  const [autoRefresh, setAutoRefresh] = useState(prefs.autoRefresh)
  const [activeTab, setActiveTab] = useState<TabKind>('matches')
  const [status, setStatus] = useState<DataStatus>(hasCurrentYearCache(cached?.matches) ? 'cached' : 'fallback')
  const [resultStatus, setResultStatus] = useState<DataStatus>(filterResultsByYear(cachedResults?.results).length > 0 ? 'cached' : 'fallback')
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(cached?.updatedAt ?? null)
  const [resultsUpdatedAt, setResultsUpdatedAt] = useState<string | null>(cachedResults?.updatedAt ?? null)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)

  // AI analysis state (read-only from server)
  const [analysisState, setAnalysisState] = useState<BatchAnalysisState>('idle')
  const [claudeInsights, setClaudeInsights] = useState<Record<string, ClaudeResult>>({})
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null)

  const matchesByDate = groupMatchesByDate(sortMatchesByKickoff(matches))
  const dateKeys = Object.keys(matchesByDate).sort()
  const primaryDateKey = getPrimaryDateKey(matches)
  const targetDateKey = selectedDateKey && matchesByDate[selectedDateKey] ? selectedDateKey : primaryDateKey
  const targetMatches = sortMatchesByKickoff(matchesByDate[targetDateKey] ?? [])
  const viewModels = buildMatchViewModels(targetMatches, budget)
  const [confirmedBuysTick, setConfirmedBuysTick] = useState(0)
  const confirmedSettlements = useMemo(
    () => settleConfirmedBuys(loadConfirmedBuys(), results),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, confirmedBuysTick],
  )
  const isRefreshing = status === 'refreshing' || resultStatus === 'refreshing'

  // Load analysis from server when date changes
  useEffect(() => {
    setClaudeInsights({})
    setAnalyzedAt(null)
    setAnalysisState('idle')

    void fetchServerAnalysis(targetDateKey).then((server) => {
      if (server.found && server.insights) {
        setClaudeInsights(server.insights as Record<string, ClaudeResult>)
        setAnalyzedAt(server.analyzedAt ?? null)
        setAnalysisState('done')
      }
    })
  }, [targetDateKey])

  const refreshOdds = useCallback(async (signal?: AbortSignal) => {
    setStatus('refreshing')
    setErrorMessage('')
    try {
      const live = await fetchSportteryMatches(legacyData, signal)
      const cy = filterMatchesByYear(live, ANALYSIS_YEAR).filter(isWorldCup)
      if (cy.length === 0) throw new Error(`${ANALYSIS_YEAR} 年暂无可用世界杯赛程`)
      const updatedAt = writeCachedMatches(cy)
      setMatches(cy)
      setLastRefreshAt(updatedAt)
      setStatus('live')
      // Save odds snapshot per date for trend tracking
      const byDate = new Map<string, Record<string, Record<string, number>>>()
      for (const m of cy) {
        const dk = m.kickoff.slice(2, 10).replace(/-/g, '')
        if (!byDate.has(dk)) byDate.set(dk, {})
        byDate.get(dk)![m.id] = Object.fromEntries(
          m.oddsEntries.filter((e) => /^\d+:\d+$/.test(e.score)).map((e) => [e.score, e.odds])
        )
      }
      for (const [dk, snaps] of byDate) saveOddsHistory(dk, snaps)
    } catch (err) {
      if (signal?.aborted) return
      setStatus((s) => s === 'refreshing' ? 'error' : s)
      setErrorMessage(err instanceof Error ? err.message : '赔率刷新失败')
    }
  }, [])

  const refreshResults = useCallback(async (signal?: AbortSignal) => {
    setResultStatus('refreshing')
    try {
      const live = await fetchSportteryResults(ANALYSIS_YEAR, signal)
      const updatedAt = writeCachedResults(live)
      setResults(live)
      setResultsUpdatedAt(updatedAt)
      setResultStatus('live')
    } catch (err) {
      if (signal?.aborted) return
      setResultStatus('error')
    }
  }, [])

  // Initial load
  useEffect(() => {
    const ac = new AbortController()
    void refreshOdds(ac.signal)
    void refreshResults(ac.signal)
    return () => ac.abort()
  }, [refreshOdds, refreshResults])

  // Auto refresh
  useEffect(() => {
    if (!autoRefresh) return
    const t1 = setInterval(() => void refreshOdds(), REFRESH_INTERVAL_MS)
    const t2 = setInterval(() => void refreshResults(), RESULT_REFRESH_INTERVAL_MS)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [autoRefresh, refreshOdds, refreshResults])

  // Visibility refresh
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && autoRefresh && navigator.onLine) {
        void refreshOdds(); void refreshResults()
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [autoRefresh, refreshOdds, refreshResults])

  // Online/offline
  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // SW update detection
  useEffect(() => {
    const handler = (e: Event) => {
      const { version } = (e as CustomEvent<{ version: string }>).detail
      setUpdateAvailable(version)
    }
    window.addEventListener('app-updated', handler)
    return () => window.removeEventListener('app-updated', handler)
  }, [])

  // Preferences
  useEffect(() => {
    writePreferences({ budget, autoRefresh, executionMode: 'conservative', remindersEnabled: false, reminderMinutes: 30 })
  }, [budget, autoRefresh])



  // ── Shared UI ───────────────────────────────────────────────────────────────
  const statusBar = (
    <div className="status-bar">
      <span className={`status-dot ${status}`} />
      <span className="status-time">
        {isOnline ? '在线' : '离线'} · {formatRefreshTime(lastRefreshAt)}
      </span>
      <button
        type="button"
        className="refresh-btn"
        disabled={isRefreshing}
        onClick={() => { void refreshOdds(); void refreshResults() }}
      >
        {isRefreshing ? '同步中…' : '刷新'}
      </button>
    </div>
  )

  const dateRail = (
    <div className="date-rail">
      {dateKeys.map((dk) => {
        const cnt = matchesByDate[dk]?.length ?? 0
        const role = dateRoleLabel(dk)
        return (
          <button
            key={dk}
            type="button"
            className={dk === targetDateKey ? 'date-chip active' : 'date-chip'}
            onClick={() => setSelectedDateKey(dk)}
          >
            <strong>{formatDateLabel(dk)}</strong>
            <small>{role} · {cnt}场</small>
          </button>
        )
      })}
    </div>
  )

  const analyzeStatusBar = (
    <div className="analysis-status-bar">
      {analysisState === 'done' ? (
        <span className="analysis-done-label">
          ✓ 已分析 · {analyzedAt
            ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(analyzedAt))
            : ''}
        </span>
      ) : (
        <span className="analysis-pending-label">暂未分析</span>
      )}
    </div>
  )

  // ── Tabs ────────────────────────────────────────────────────────────────────
  const matchesTab = (
    <div className="tab-content">
      {statusBar}
      {errorMessage ? <div className="inline-warning">{errorMessage}</div> : null}
      {dateRail}
      {analyzeStatusBar}
      <div className="card-list">
        {viewModels.length > 0 ? (
          viewModels.map((vm) => (
            <MatchAnalysisCard
              key={vm.match.id}
              viewModel={vm}
              budget={budget}
              onBudgetChange={(v) => { setBudget(v) }}
              yearMatches={matches}
              yearResults={results}
              analysisYear={ANALYSIS_YEAR}
              claude={claudeInsights[vm.match.code] ?? claudeInsights[vm.match.id]}
              dateKey={targetDateKey}
            />
          ))
        ) : (
          <div className="empty-state">暂无世界杯赛程，请切换日期或刷新。</div>
        )}
      </div>
    </div>
  )

  const reviewTab = (
    <div className="tab-content">
      <ConfirmedBuyReview
        settlements={confirmedSettlements}
        onBuyRemoved={() => setConfirmedBuysTick((n) => n + 1)}
      />
      <RecentResultsCard
        results={results}
        updatedAt={resultsUpdatedAt}
        statusLabel={resultStatus === 'live' ? '已刷新' : resultStatus === 'refreshing' ? '刷新中' : resultStatus === 'cached' ? '缓存' : '本地'}
        analysisYear={ANALYSIS_YEAR}
      />
    </div>
  )

  const settingsTab = (
    <div className="tab-content">
      <div className="settings-section">
        <div className="settings-title">数据刷新</div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <strong>自动刷新</strong>
              <small>每 5 分钟同步赔率</small>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              <span className="toggle-track" />
            </label>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <div>
              <strong>网络</strong>
              <small>{isOnline ? '在线' : '离线'} · 最近刷新 {formatRefreshTime(lastRefreshAt)}</small>
            </div>
            <button
              type="button"
              className="settings-action-btn"
              disabled={isRefreshing}
              onClick={() => { void refreshOdds(); void refreshResults() }}
            >
              {isRefreshing ? '同步中' : '立即刷新'}
            </button>
          </div>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-title">版本</div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <strong>当前版本</strong>
              <small>v{APP_VERSION} · {BUILD_DATE}</small>
            </div>
            <button type="button" className="settings-action-btn" onClick={() => window.location.reload()}>
              检查更新
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-title">更新日志</div>
        <div className="settings-card changelog-card">
          {CHANGELOG.map((entry) => (
            <div key={entry.version} className="changelog-entry">
              <div className="changelog-header">
                <span className="changelog-version">v{entry.version}</span>
                <span className="changelog-date">{entry.date}</span>
              </div>
              <ul className="changelog-list">
                {entry.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-title">关于</div>
        <div className="settings-card settings-about">
          <strong>{legacyData.meta.appName}</strong>
          <small>体彩数据 + Claude AI 中转 · 不保证命中</small>
          <small>数据来源：中国体育彩票官方接口</small>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app-shell">
      {updateAvailable && (
        <div className="update-banner">
          <span>🎉 新版本 {updateAvailable} 已就绪</span>
          <button type="button" className="update-btn" onClick={() => window.location.reload()}>
            立即更新
          </button>
        </div>
      )}
      <header className="app-header">
        <h1>{legacyData.meta.appName}</h1>
        <span className="header-date">{targetDateKey}</span>
      </header>

      <main className="app-main">
        {activeTab === 'matches' && matchesTab}
        {activeTab === 'review' && reviewTab}
        {activeTab === 'settings' && settingsTab}
      </main>

      <nav className="tab-bar">
        {(['matches', 'review', 'settings'] as TabKind[]).map((tab) => {
          const labels: Record<TabKind, [string, string]> = {
            matches: ['📋', '赛程'],
            review: ['📊', '复盘'],
            settings: ['⚙️', '设置'],
          }
          const [icon, label] = labels[tab]
          return (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? 'tab-btn active' : 'tab-btn'}
              onClick={() => setActiveTab(tab)}
            >
              <span className="tab-icon">{icon}</span>
              <span>{label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default App
