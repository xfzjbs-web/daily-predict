import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.dailypredict.app',
  appName: '每日预测',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_daily_predict',
      iconColor: '#143D79',
    },
  },
}

export default config
