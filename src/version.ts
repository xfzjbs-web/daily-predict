export const APP_VERSION = '1.3.0'
export const BUILD_DATE = '2026-06-17'

export interface ChangelogEntry {
  version: string
  date: string
  changes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.0',
    date: '2026-06-17',
    changes: [
      '分析结果由管理员在对话中触发，自动推送到所有用户',
      '新增分析时间展示',
      '新增买入确认 + 真实盈亏复盘',
      '赔率变动预警（分析后赔率偏移 >5% 提示重新分析）',
      '去除 APP 内所有管理员入口',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-06-16',
    changes: [
      '接入 Claude AI 中转站分析',
      '比赛卡片折叠展开，分析+买法合一面板',
      '买法计算支持手动调整赔率实时重算',
      '保守/进取方案切换，Claude 调整版标注',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-06-15',
    changes: [
      '重构为移动端 Tab 导航结构',
      '贝叶斯混合概率算法（75% 市场 + 25% 历史先验）',
      'EV 最优尾部比分选择',
      '赛程、复盘、设置 Tab',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-10',
    changes: [
      '初始版本，体彩官方赔率接入',
      '保守/进取策略计算',
      '本地 AI 规则分析',
    ],
  },
]
