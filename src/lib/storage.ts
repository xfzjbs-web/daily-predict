import type {
  MatchRecord,
  MatchResultRecord,
  RecommendationSnapshot,
  StrategyKind,
} from './types.ts'

const CACHE_KEY = 'daily-predict:sporttery-matches'
const CACHE_TIME_KEY = 'daily-predict:sporttery-updated-at'
const RESULT_CACHE_KEY = 'daily-predict:sporttery-results'
const RESULT_CACHE_TIME_KEY = 'daily-predict:sporttery-results-updated-at'
const PREFERENCES_KEY = 'daily-predict:preferences'
const RECOMMENDATION_SNAPSHOTS_KEY = 'daily-predict:recommendation-snapshots'

export interface AppPreferences {
  budget: number
  autoRefresh: boolean
  executionMode: StrategyKind
  remindersEnabled: boolean
  reminderMinutes: number
}

const DEFAULT_PREFERENCES: AppPreferences = {
  budget: 100,
  autoRefresh: true,
  executionMode: 'conservative',
  remindersEnabled: false,
  reminderMinutes: 60,
}

export function readCachedMatches() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const updatedAt = localStorage.getItem(CACHE_TIME_KEY)

    if (!raw) {
      return null
    }

    return {
      matches: JSON.parse(raw) as MatchRecord[],
      updatedAt,
    }
  } catch {
    return null
  }
}

export function writeCachedMatches(matches: MatchRecord[]) {
  const updatedAt = new Date().toISOString()

  localStorage.setItem(CACHE_KEY, JSON.stringify(matches))
  localStorage.setItem(CACHE_TIME_KEY, updatedAt)

  return updatedAt
}

export function readCachedResults() {
  try {
    const raw = localStorage.getItem(RESULT_CACHE_KEY)
    const updatedAt = localStorage.getItem(RESULT_CACHE_TIME_KEY)

    if (!raw) {
      return null
    }

    return {
      results: JSON.parse(raw) as MatchResultRecord[],
      updatedAt,
    }
  } catch {
    return null
  }
}

export function writeCachedResults(results: MatchResultRecord[]) {
  const updatedAt = new Date().toISOString()

  localStorage.setItem(RESULT_CACHE_KEY, JSON.stringify(results))
  localStorage.setItem(RESULT_CACHE_TIME_KEY, updatedAt)

  return updatedAt
}

export function readPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY)

    if (!raw) {
      return DEFAULT_PREFERENCES
    }

    const value = JSON.parse(raw) as Partial<AppPreferences>
    const budget = typeof value.budget === 'number' && value.budget > 0 ? Math.round(value.budget) : 100
    const autoRefresh = typeof value.autoRefresh === 'boolean' ? value.autoRefresh : true
    const executionMode = value.executionMode === 'aggressive' ? 'aggressive' : 'conservative'
    const remindersEnabled = typeof value.remindersEnabled === 'boolean' ? value.remindersEnabled : false
    const reminderMinutes = [30, 60, 120].includes(value.reminderMinutes ?? 0)
      ? Number(value.reminderMinutes)
      : 60

    return {
      budget,
      autoRefresh,
      executionMode,
      remindersEnabled,
      reminderMinutes,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function writePreferences(preferences: AppPreferences) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // Settings persistence is optional; the app remains usable with in-memory state.
  }
}

export function readRecommendationSnapshots(): RecommendationSnapshot[] {
  try {
    const raw = localStorage.getItem(RECOMMENDATION_SNAPSHOTS_KEY)

    return raw ? (JSON.parse(raw) as RecommendationSnapshot[]) : []
  } catch {
    return []
  }
}

export function writeRecommendationSnapshots(snapshots: RecommendationSnapshot[]) {
  try {
    localStorage.setItem(RECOMMENDATION_SNAPSHOTS_KEY, JSON.stringify(snapshots))
  } catch {
    // Review history is helpful but must never block the live recommendation flow.
  }
}
