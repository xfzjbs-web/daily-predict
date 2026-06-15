interface MatchReminderCardProps {
  nativeAvailable: boolean
  enabled: boolean
  reminderMinutes: number
  scheduledCount: number
  statusText: string
  onEnable: () => void
  onDisable: () => void
  onMinutesChange: (minutes: number) => void
}

const REMINDER_OPTIONS = [30, 60, 120]

export function MatchReminderCard({
  nativeAvailable,
  enabled,
  reminderMinutes,
  scheduledCount,
  statusText,
  onEnable,
  onDisable,
  onMinutesChange,
}: MatchReminderCardProps) {
  return (
    <section className="match-reminder-card" aria-label="赛前提醒">
      <header>
        <div>
          <p className="eyebrow">安卓通知</p>
          <h2>赛前提醒</h2>
        </div>
        <span className={enabled ? 'reminder-state active' : 'reminder-state'}>
          {enabled ? `已安排 ${scheduledCount} 场` : '未开启'}
        </span>
      </header>

      <div className="reminder-controls">
        <div>
          <span>提前时间</span>
          <div className="reminder-options" role="group" aria-label="提醒提前时间">
            {REMINDER_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                className={reminderMinutes === minutes ? 'active' : ''}
                type="button"
                disabled={!nativeAvailable}
                onClick={() => onMinutesChange(minutes)}
              >
                {minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`}
              </button>
            ))}
          </div>
        </div>

        <button
          className={enabled ? 'reminder-toggle danger' : 'reminder-toggle'}
          type="button"
          disabled={!nativeAvailable}
          onClick={enabled ? onDisable : onEnable}
        >
          {enabled ? '关闭提醒' : '开启提醒'}
        </button>
      </div>

      <p className="reminder-status">
        {nativeAvailable ? statusText : '浏览器预览不发送通知；安装 Android APK 后可开启。'}
      </p>

      <details className="usage-notice">
        <summary>使用说明与风险提示</summary>
        <p>提醒只用于赛前刷新赔率和复核方案，不会自动购买、代替出票或保证命中。</p>
        <p>系统省电策略可能让普通通知略有延迟；实际赛程、停售时间和出票结果以官方信息为准。</p>
        <p>本 APP 不提供支付或购彩功能，所有概率、期望和历史回测仅作信息参考。</p>
      </details>
    </section>
  )
}
