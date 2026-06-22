import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.dailypredict.app',
  appName: '每日预测',
  webDir: 'dist',
  server: {
    url: 'https://xfzjbs-web.github.io/daily-predict/',
    cleartext: false,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_daily_predict',
      iconColor: '#143D79',
    },
  },
}

export default config
