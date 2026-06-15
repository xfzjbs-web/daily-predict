import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { MatchRecord } from './types.ts'
import { isMatchActionable } from './schedule.ts'

const CHANNEL_ID = 'daily-predict-match-reminders'
const OWNER_KEY = 'daily-predict'
const MINIMUM_LEAD_MS = 60 * 1000

export type ReminderPermission = 'unavailable' | 'prompt' | 'granted' | 'denied'

function notificationId(match: MatchRecord) {
  const value = `${match.code}|${match.kickoff}`
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }

  return 1_300_000_000 + (Math.abs(hash) % 100_000_000)
}

function kickoffDate(match: MatchRecord) {
  const normalized = match.kickoff.includes('T') ? match.kickoff : match.kickoff.replace(' ', 'T')
  const date = new Date(normalized)

  return Number.isNaN(date.getTime()) ? null : date
}

export function supportsMatchReminders() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function checkMatchReminderPermission(): Promise<ReminderPermission> {
  if (!supportsMatchReminders()) {
    return 'unavailable'
  }

  const permission = await LocalNotifications.checkPermissions()

  if (permission.display === 'granted') {
    return 'granted'
  }

  if (permission.display === 'denied') {
    return 'denied'
  }

  return 'prompt'
}

export async function requestMatchReminderPermission(): Promise<ReminderPermission> {
  if (!supportsMatchReminders()) {
    return 'unavailable'
  }

  const permission = await LocalNotifications.requestPermissions()

  return permission.display === 'granted' ? 'granted' : 'denied'
}

export async function cancelMatchReminders() {
  if (!supportsMatchReminders()) {
    return
  }

  const pending = await LocalNotifications.getPending()
  const owned = pending.notifications
    .filter((notification) => notification.extra?.owner === OWNER_KEY)
    .map((notification) => ({ id: notification.id }))

  if (owned.length > 0) {
    await LocalNotifications.cancel({ notifications: owned })
  }
}

export async function scheduleMatchReminders(
  matches: MatchRecord[],
  reminderMinutes: number,
  now = new Date(),
) {
  if (!supportsMatchReminders()) {
    return 0
  }

  await cancelMatchReminders()
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: '世界杯赛前提醒',
    description: '提醒刷新赔率并复核每日预测方案',
    importance: 4,
    visibility: 0,
    vibration: true,
    lights: true,
    lightColor: '#143D79',
  })

  const notifications = matches
    .filter((match) => isMatchActionable(match, now))
    .map((match) => {
      const kickoff = kickoffDate(match)

      if (!kickoff) {
        return null
      }

      const remindAt = new Date(kickoff.getTime() - reminderMinutes * 60 * 1000)

      if (remindAt.getTime() <= now.getTime() + MINIMUM_LEAD_MS) {
        return null
      }

      return {
        id: notificationId(match),
        title: `${match.homeTeam} vs ${match.awayTeam} 即将开赛`,
        body: `${reminderMinutes} 分钟后开赛，请打开每日预测刷新官方赔率并复核方案。`,
        largeBody: `${match.code} ${match.homeTeam} vs ${match.awayTeam} 将在 ${match.kickoff.slice(11, 16)} 开赛。建议仅供参考，提醒不会自动购买。`,
        summaryText: '每日预测赛前提醒',
        schedule: {
          at: remindAt,
        },
        channelId: CHANNEL_ID,
        group: 'daily-predict-matches',
        autoCancel: true,
        extra: {
          owner: OWNER_KEY,
          matchId: match.id,
          code: match.code,
        },
      }
    })
    .filter((notification): notification is NonNullable<typeof notification> => notification !== null)

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications })
  }

  return notifications.length
}
