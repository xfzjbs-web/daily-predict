import { useCallback, useEffect, useState } from 'react'
import { ExecutionSlipCard } from './components/ExecutionSlipCard.tsx'
import { MatchCard } from './components/MatchCard.tsx'
import { PerformanceReviewCard } from './components/PerformanceReviewCard.tsx'
import { RecentResultsCard } from './components/RecentResultsCard.tsx'
import { RecommendationCard } from './components/RecommendationCard.tsx'
import { filterMatchesByYear } from './data/current-year-context.ts'
import { legacyData } from './data/index.ts'
import { formatCurrency, formatSignedCurrency } from './lib/format.ts'
import {
  getPrimaryDateKey,
  getTodayKey,
  getTomorrowKey,
  groupMatchesByDate,
  isMatchActionable,
  sortMatchesByKickoff,
} from './lib/schedule.ts'
import { fetchSportteryMatches } from './lib/sporttery.ts'
import { fetchSportteryResults } from './lib/sportteryResults.ts'
import {
  createRecommendationSnapshots,
  mergeRecommendationSnapshots,
  settleRecommendationSnapshots,
} from './lib/recommendationHistory.ts'
import {
  cancelMatchReminders,
  checkMatchReminderPermission,
  requestMatchReminderPermission,
  scheduleMatchReminders,
  supportsMatchReminders,
} from './lib/matchReminders.ts'
import {
  readCachedMatches,
  readCachedResults,
  readPreferences,
  readRecommendationSnapshots,
  writeCachedMatches,
  writeCachedResults,
  writePreferences,
  writeRecommendationSnapshots,
} from './lib/storage.ts'
import { buildMatchViewModels } from './lib/strategy.ts'
import type { MatchRecord, MatchResultRecord, StrategyKind } from './lib/types.ts'

const QUICK_BUDGETS = [50, 100, 200]
const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const RESULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const ANALYSIS_YEAR = new Date().getFullYear()

type DataStatus = 'fallback' | 'cached' | 'refreshing' | 'live' | 'error'
type TabKind = 'today' | 'schedule' | 'review' | 'settings'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function withLegacySource(matches: MatchRecord[]) {
  return matches.map((match) => ({
    ...match,
    leagueName: match.leagueName ?? '世界杯',
    source: match.source ?? 'legacy',
  }))
}

function getInitialMatches(cachedMatches: MatchRecord[] | undefined) {
  const cachedCurrentYearMatches = cachedMatches ? filterMatchesByYear(cachedMatches, ANALYSIS_YEAR) : []
  if (cachedCurrentYearMatches.length > 0) return cachedCurrentYearMatches
  return filterMatchesByYear(withLegacySource(legacyData.matches), ANALYSIS_YEAR)
}

function hasCurrentYearCache(cachedMatches: MatchRecord[] | undefined) {
  return cachedMatches ? filterMatchesByYear(cachedMatches, ANALYSIS_YEAR).length > 0 : false
}

function filterResultsByYear(results: MatchResultRecord[] | undefined) {
  return (results ?? []).filter((result) => Number(result.matchDate.slice(0, 4)) === ANALYSIS_YEAR)
}

function formatRefreshTime(value: string | null) {
  if (!value) return '未刷新'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat('zh-CN', { day: 'numeric', month: 'numeric', weekday: 'short' }).format(
    new Date(`${dateKey}T12:00:00`),
  )
}

function dateRoleLabel(dateKey: string, primaryDateKey: string) {
  const todayKey = getTodayKey()
  const tomorrowKey = getTomorrowKey()
  if (dateKey < todayKey) return '历史'
  if (dateKey === todayKey) return '今日'
  if (dateKey === tomorrowKey) return '明日'
  return dateKey === primaryDateKey ? '最近' : '未来'
}

function App() {
  const [cached] = useState(readCachedMatches)
  const [cachedResults] = useState(readCachedResults)
  const [initialPreferences] = useState(readPreferences)
  const [initialRecommendationSnapshots] = useState(readRecommendationSnapshots)
  const hasUsableCache = hasCurrentYearCache(cached?.matches)
  const initialMatches = getInitialMatches(cached?.matches)
  const initialResults = filterResultsByYear(cachedResults?.results)
  const [matches, setMatches] = useState<MatchRecord[]>(initialMatches)
  const [results, setResults] = useState<MatchResultRecord[]>(initialResults)
  const [recommendationSnapshots, setRecommendationSnapshots] = useState(initialRecommendationSnapshots)
  const [budgetInput, setBudgetInput] = useState(String(initialPreferences.budget))
  const [autoRefresh, setAutoRefresh] = useState(initialPreferences.autoRefresh)
  const [remindersEnabled, setRemindersEnabled] = useState(initialPreferences.remindersEnabled)
  const [reminderMinutes, setReminderMinutes] = useState(initialPreferences.reminderMinutes)
  const [scheduledReminderCount, setScheduledReminderCount] = useState(0)
  const [reminderStatus, setReminderStatus] = useState('开启后会为尚未开赛的比赛安排提醒。')
  const [executionMode, setExecutionMode] = useState<StrategyKind>(initialPreferences.executionMode)
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKind>('today')
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [status, setStatus] = useState<DataStatus>(hasUsableCache ? 'cached' : 'fallback')
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(hasUsableCache ? cached?.updatedAt ?? null : null)
  const [resultStatus, setResultStatus] = useState<DataStatus>(initialResults.length > 0 ? 'cached' : 'fallback')
  const [resultsUpdatedAt, setResultsUpdatedAt] = useState<string | null>(
    initialResults.length > 0 ? cachedResults?.updatedAt ?? null : null,
  )
  const [errorMessage, setErrorMessage] = useState('')

  const parsedBudget = Number.parseInt(budgetInput, 10)
  const budget = Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : 100
  const matchesByDate = groupMatchesByDate(sortMatchesByKickoff(matches))
  const dateKeys = Object.keys(matchesByDate).sort()
  const primaryDateKey = getPrimaryDateKey(matches)
  const targetDateKey = selectedDateKey && matchesByDate[selectedDateKey] ? selectedDateKey : primaryDateKey
  const targetMatches = sortMatchesByKickoff(matchesByDate[targetDateKey] ?? [])
  const targetRecommendationMatches = targetMatches.filter((match) => isMatchActionable(match))
  const nextDayViewModels = buildMatchViewModels(targetRecommendationMatches, budget)
  const visibleViewModels = buildMatchViewModels(sortMatchesByKickoff(matches), budget)
  const isRefreshing = status === 'refreshing' || resultStatus === 'refreshing'
  const nativeReminderAvailable = supportsMatchReminders()
  const conservativeExpected = nextDayViewModels.reduce((sum, vm) => sum + vm.conservative.expectedNet, 0)
  const aggressiveExpected = nextDayViewModels.reduce((sum, vm) => sum + vm.aggressive.expectedNet, 0)
  const settledRecommendations = settleRecommendationSnapshots(recommendationSnapshots, results)
  const excludedTargetCount = targetMatches.length - targetRecommendationMatches.length

  const refreshOdds = useCallback(async (signal?: AbortSignal) => {
    setStatus('refreshing')
    setErrorMessage('')
    try {
      const liveMatches = await fetchSportteryMatches(legacyData, signal)
      const currentYearMatches = filterMatchesByYear(liveMatches, ANALYSIS_YEAR)
      if (currentYearMatches.length === 0) throw new Error(`${ANALYSIS_YEAR} 年暂无可用赛程，已保留本地数据`)
      const updatedAt = writeCachedMatches(currentYearMatches)
      setMatches(currentYearMatches)
      setLastRefreshAt(updatedAt)
      setStatus('live')
    } catch (error) {
      if (signal?.aborted) return
      setStatus((current) => (current === 'refreshing' ? 'error' : current))
      setErrorMessage(error instanceof Error ? error.message : '赔率刷新失败')
    }
  }, [])

  const refreshResults = useCallback(async (signal?: AbortSignal) => {
    setResultStatus('refreshing')
    try {
      const liveResults = await fetchSportteryResults(ANALYSIS_YEAR, signal)
      const updatedAt = writeCachedResults(liveResults)
      setResults(liveResults)
      setResultsUpdatedAt(updatedAt)
      setResultStatus('live')
    } catch (error) {
      if (signal?.aborted) return
      setResultStatus('error')
      setErrorMessage((current) => current || (error instanceof Error ? error.message : '赛果刷新失败'))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      void refreshOdds(controller.signal)
      void refreshResults(controller.signal)
    }, 0)
    return () => { window.clearTimeout(timeoutId); controller.abort() }
  }, [refreshOdds, refreshResults])

  useEffect(() => {
    if (!autoRefresh) return
    const intervalId = window.setInterval(() => void refreshOdds(), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [autoRefresh, refreshOdds])

  useEffect(() => {
    if (!autoRefresh) return
    const intervalId = window.setInterval(() => void refreshResults(), RESULT_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [autoRefresh, refreshResults])

  useEffect(() => {
    const refreshOnResume = () => {
      if (document.visibilityState === 'visible' && autoRefresh && navigator.onLine) {
        void refreshOdds()
        void refreshResults()
      }
    }
    document.addEventListener('visibilitychange', refreshOnResume)
    return () => document.removeEventListener('visibilitychange', refreshOnResume)
  }, [autoRefresh, refreshOdds, refreshResults])

  useEffect(() => {
    writePreferences({ budget, autoRefresh, executionMode, remindersEnabled, reminderMinutes })
  }, [autoRefresh, budget, executionMode, reminderMinutes, remindersEnabled])

  useEffect(() => {
    if (!nativeReminderAvailable || !remindersEnabled) return
    let active = true
    const syncReminders = async () => {
      try {
        const permission = await checkMatchReminderPermission()
        if (permission !== 'granted') {
          if (active) { setRemindersEnabled(false); setScheduledReminderCount(0); setReminderStatus('通知权限未开启。') }
          return
        }
        const count = await scheduleMatchReminders(matches, reminderMinutes)
        if (active) {
          setScheduledReminderCount(count)
          setReminderStatus(count > 0 ? `已安排 ${count} 场提醒（提前 ${reminderMinutes} 分钟）。` : '当前没有满足时间的未开赛比赛。')
        }
      } catch {
        if (active) { setScheduledReminderCount(0); setReminderStatus('提醒同步失败，请稍后重新开启。') }
      }
    }
    void syncReminders()
    return () => { active = false }
  }, [matches, nativeReminderAvailable, reminderMinutes, remindersEnabled])

  useEffect(() => {
    const resultKeys = new Set(results.map((result) => `${result.matchDate}|${result.code}`))
    const historicalMatches = withLegacySource(legacyData.matches).filter((match) =>
      resultKeys.has(`${match.kickoff.slice(0, 10)}|${match.code}`),
    )
    const snapshots = createRecommendationSnapshots(
      buildMatchViewModels(historicalMatches, 100), 100, 'legacy-backtest', legacyData.meta.importedAt,
    )
    setRecommendationSnapshots((current) => {
      const merged = mergeRecommendationSnapshots(current, snapshots)
      if (JSON.stringify(merged) === JSON.stringify(current)) return current
      writeRecommendationSnapshots(merged)
      return merged
    })
  }, [results])

  useEffect(() => {
    const actionableMatches = matches.filter((match) => isMatchActionable(match))
    const snapshots = createRecommendationSnapshots(buildMatchViewModels(actionableMatches, budget), budget, 'live-capture')
    setRecommendationSnapshots((current) => {
      const merged = mergeRecommendationSnapshots(current, snapshots)
      if (JSON.stringify(merged) === JSON.stringify(current)) return current
      writeRecommendationSnapshots(merged)
      return merged
    })
  }, [budget, matches])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent) }
    const handleInstalled = () => { setInstallPrompt(null); setIsStandalone(true) }
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const installApp = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice.catch(() => null)
    setInstallPrompt(null)
  }

  const enableReminders = async () => {
    try {
      const permission = await requestMatchReminderPermission()
      if (permission !== 'granted') {
        setRemindersEnabled(false); setScheduledReminderCount(0)
        setReminderStatus('系统未授予通知权限，可在应用设置中手动开启。')
        return
      }
      const count = await scheduleMatchReminders(matches, reminderMinutes)
      setRemindersEnabled(true); setScheduledReminderCount(count)
      setReminderStatus(count > 0 ? `已安排 ${count} 场比赛的赛前提醒。` : '权限已开启，当前没有满足时间的未开赛比赛。')
    } catch {
      setRemindersEnabled(false); setScheduledReminderCount(0)
      setReminderStatus('提醒开启失败，请稍后再试。')
    }
  }

  const disableReminders = async () => {
    try {
      await cancelMatchReminders()
      setReminderStatus('已关闭并撤销赛前提醒。')
    } catch {
      setReminderStatus('状态已保存，系统通知撤销可能稍有延迟。')
    } finally {
      setRemindersEnabled(false); setScheduledReminderCount(0)
    }
  }

  // ── Shared: status bar + date rail
  const statusDotClass = `status-dot ${status}`
  const statusBar = (
    <div className="status-bar">
      <span className={statusDotClass} />
      <span className="status-time">{isOnline ? '在线' : '离线'} · {formatRefreshTime(lastRefreshAt)}</span>
      <button
        className="refresh-btn"
        type="button"
        disabled={isRefreshing}
        onClick={() => { void refreshOdds(); void refreshResults() }}
      >
        {isRefreshing ? '同步中…' : '刷新'}
      </button>
    </div>
  )

  const dateRail = (
    <div className="date-rail" aria-label="赛程日期">
      {dateKeys.map((dateKey) => {
        const dayMatches = matchesByDate[dateKey] ?? []
        const isActive = dateKey === targetDateKey
        return (
          <button
            key={dateKey}
            className={isActive ? 'date-chip active' : 'date-chip'}
            type="button"
            onClick={() => setSelectedDateKey(dateKey)}
          >
            <strong>{formatDateLabel(dateKey)}</strong>
            <small>{dateRoleLabel(dateKey, primaryDateKey)} · {dayMatches.length} 场</small>
          </button>
        )
      })}
    </div>
  )

  // ── Tab: 今日
  const todayTab = (
    <div className="tab-content">
      {statusBar}
      {errorMessage ? <div className="inline-warning">{errorMessage}</div> : null}
      {dateRail}

      <div className="budget-bar">
        <label className="budget-field">
          <span>单场预算</span>
          <input
            type="number" min="1" step="1" inputMode="numeric"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            onBlur={() => { if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) setBudgetInput('100') }}
          />
        </label>
        <div className="quick-budget-row">
          {QUICK_BUDGETS.map((value) => (
            <button
              key={value}
              className={budget === value ? 'quick-budget active' : 'quick-budget'}
              type="button"
              onClick={() => setBudgetInput(String(value))}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="summary-grid">
        <div className="metric-card risk">
          <span>最大风险</span>
          <strong>{formatCurrency(targetRecommendationMatches.length * budget)}</strong>
          <small>{targetRecommendationMatches.length} 场全未中时亏损</small>
        </div>
        <div className={conservativeExpected >= 0 ? 'metric-card positive' : 'metric-card negative'}>
          <span>保守期望</span>
          <strong>{formatSignedCurrency(conservativeExpected)}</strong>
        </div>
        <div className={aggressiveExpected >= 0 ? 'metric-card positive' : 'metric-card negative'}>
          <span>进取期望</span>
          <strong>{formatSignedCurrency(aggressiveExpected)}</strong>
        </div>
      </div>

      {excludedTargetCount > 0 ? (
        <p className="exclusion-note">已排除 {excludedTargetCount} 场已开赛或缺少赔率的比赛</p>
      ) : null}

      <ExecutionSlipCard
        viewModels={nextDayViewModels}
        dateKey={targetDateKey}
        budget={budget}
        mode={executionMode}
        onModeChange={setExecutionMode}
      />

      <div className="section-title">重点方案 · {nextDayViewModels.length} 场</div>
      <div className="card-list">
        {nextDayViewModels.length > 0 ? (
          nextDayViewModels.map((vm) => (
            <RecommendationCard
              key={vm.match.id}
              viewModel={vm}
              budget={budget}
              yearMatches={matches}
              yearResults={results}
              analysisYear={ANALYSIS_YEAR}
            />
          ))
        ) : (
          <div className="empty-state">当前日期暂无可计算的购买建议，请切换赛程日或刷新赔率。</div>
        )}
      </div>
    </div>
  )

  // ── Tab: 赛程
  const scheduleTab = (
    <div className="tab-content">
      {statusBar}
      {dateRail}
      <div className="section-title">全部赛程 · {sortMatchesByKickoff(matches).length} 场</div>
      <div className="card-list">
        {visibleViewModels.length > 0 ? (
          visibleViewModels.map((vm) => (
            <MatchCard
              key={vm.match.id}
              viewModel={vm}
              budget={budget}
              yearMatches={matches}
              yearResults={results}
              analysisYear={ANALYSIS_YEAR}
            />
          ))
        ) : (
          <div className="empty-state">暂无赛程数据，请刷新赔率。</div>
        )}
      </div>
    </div>
  )

  // ── Tab: 复盘
  const reviewTab = (
    <div className="tab-content">
      <RecentResultsCard
        results={results}
        updatedAt={resultsUpdatedAt}
        statusLabel={resultStatus === 'live' ? '已刷新' : resultStatus === 'refreshing' ? '刷新中' : resultStatus === 'cached' ? '缓存' : resultStatus === 'error' ? '失败' : '本地'}
        analysisYear={ANALYSIS_YEAR}
      />
      <PerformanceReviewCard settlements={settledRecommendations} initialMode={executionMode} />
    </div>
  )

  // ── Tab: 设置
  const settingsTab = (
    <div className="tab-content">
      <div className="settings-section">
        <div className="settings-title">数据与刷新</div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <strong>自动刷新</strong>
              <small>每 5 分钟自动同步赔率</small>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              <span className="toggle-track" />
            </label>
          </div>
          <div className="settings-divider" />
          <div className="settings-row">
            <div>
              <strong>网络状态</strong>
              <small>{isOnline ? '在线' : '离线'} · 最近刷新 {formatRefreshTime(lastRefreshAt)}</small>
            </div>
            <button
              className="settings-action-btn"
              type="button"
              disabled={isRefreshing}
              onClick={() => { void refreshOdds(); void refreshResults() }}
            >
              {isRefreshing ? '同步中' : '立即刷新'}
            </button>
          </div>
        </div>
      </div>

      {nativeReminderAvailable ? (
        <div className="settings-section">
          <div className="settings-title">赛前提醒</div>
          <div className="settings-card">
            <div className="settings-row">
              <div>
                <strong>赛前通知</strong>
                <small>{remindersEnabled ? `已开启，${scheduledReminderCount} 场提醒中` : '已关闭'}</small>
              </div>
              <button
                className={remindersEnabled ? 'settings-action-btn danger' : 'settings-action-btn'}
                type="button"
                onClick={() => remindersEnabled ? void disableReminders() : void enableReminders()}
              >
                {remindersEnabled ? '关闭' : '开启'}
              </button>
            </div>
            {remindersEnabled ? (
              <>
                <div className="settings-divider" />
                <div className="settings-row">
                  <span>提前时间</span>
                  <div className="reminder-options">
                    {[30, 60, 120].map((mins) => (
                      <button
                        key={mins}
                        className={reminderMinutes === mins ? 'reminder-opt active' : 'reminder-opt'}
                        type="button"
                        onClick={() => setReminderMinutes(mins)}
                      >
                        {mins} 分钟
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            {reminderStatus ? <p className="settings-note">{reminderStatus}</p> : null}
          </div>
        </div>
      ) : null}

      {!isStandalone ? (
        <div className="settings-section">
          <div className="settings-title">安装</div>
          <div className="settings-card">
            <div className="settings-row">
              <div>
                <strong>安装到桌面</strong>
                <small>{installPrompt ? '点击安装为手机应用' : '用浏览器菜单选择"添加到主屏幕"'}</small>
              </div>
              <button
                className="settings-action-btn"
                type="button"
                disabled={!installPrompt}
                onClick={() => void installApp()}
              >
                {installPrompt ? '安装' : '等待'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="settings-section">
        <div className="settings-title">关于</div>
        <div className="settings-card settings-about">
          <strong>{legacyData.meta.appName}</strong>
          <small>本地 AI 规则版 · 只看 {ANALYSIS_YEAR} 年赛事</small>
          <small>数据来源：中国体育彩票官方接口</small>
        </div>
      </div>
    </div>
  )

  const tabContent: Record<TabKind, React.ReactNode> = {
    today: todayTab,
    schedule: scheduleTab,
    review: reviewTab,
    settings: settingsTab,
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{legacyData.meta.appName}</h1>
        <span className="header-date">{targetDateKey}</span>
      </header>

      <main className="app-main">
        {tabContent[activeTab]}
      </main>

      <nav className="tab-bar" aria-label="主导航">
        <button
          className={activeTab === 'today' ? 'tab-btn active' : 'tab-btn'}
          type="button"
          onClick={() => setActiveTab('today')}
        >
          <span className="tab-icon">🎯</span>
          <span>今日</span>
        </button>
        <button
          className={activeTab === 'schedule' ? 'tab-btn active' : 'tab-btn'}
          type="button"
          onClick={() => setActiveTab('schedule')}
        >
          <span className="tab-icon">📋</span>
          <span>赛程</span>
        </button>
        <button
          className={activeTab === 'review' ? 'tab-btn active' : 'tab-btn'}
          type="button"
          onClick={() => setActiveTab('review')}
        >
          <span className="tab-icon">📊</span>
          <span>复盘</span>
        </button>
        <button
          className={activeTab === 'settings' ? 'tab-btn active' : 'tab-btn'}
          type="button"
          onClick={() => setActiveTab('settings')}
        >
          <span className="tab-icon">⚙️</span>
          <span>设置</span>
        </button>
      </nav>
    </div>
  )
}

export default App
