# 每日预测 Android APP

基于现有静态 HTML 输出重构的安卓手机可用程序。当前版本已经接入 Capacitor Android，能够生成可安装的 APK；PWA 能力继续保留，方便快速预览和静态部署。

## 主要能力

- 首页直接进入“每日预测”，不是营销落地页
- 查看次日赛程、比赛列表、比分赔率、保守版方案、进取版方案
- 默认每场预算 `100` 元，支持改预算并自动重算投入、返还、净盈利和未覆盖亏损
- 保守版：多比分覆盖，目标是命中后尽量保本或小赚，并保留少量高赔率尾部
- 进取版：主路径比分 + 变量尾部高赔率比分，只买两个比分
- 赔率、预测概率、市场隐含概率、期望净收益分开展示
- 明确展示风险：未覆盖比分出现时，该场净亏当前预算
- 移动端优先，复杂表格仅在卡片内部横向滚动
- 官方体彩比分赔率接口自动刷新，失败时使用缓存或旧 HTML 导入数据兜底
- 已限制为只看今年比赛：赛程、赔率缓存和 AI 样本均按当前年份过滤
- 已实装本地 AI 规则分析：输出今年样本结论、盘面倾向、策略结论、最终判断和风险标签
- 已加入每日总览卡：集中展示默认打法、最大回撤、AI 状态、平均覆盖和优先查看场次
- 已加入执行清单：可切换保守/进取模式，集中查看每场比分、投入、赔率、返还和可复制文本
- 已接入体彩官方足球赛果接口：只读取今年最近 30 天世界杯完场比分，并纳入本地 AI 判断
- 预算、保守/进取模式和自动刷新设置会保存在手机本地，重开 APP 后继续沿用
- 已加入建议复盘：自动保存后续比赛的赛前方案，官方赛果发布后结算精确比分命中、模拟返还、净结果和回报率
- 首批历史回测使用旧 HTML 保存的赛前赔率，由当前规则按固定 `100` 元重算，并与真实赛前留档明确分开
- Android APK 支持赛前本地通知：可选择提前 `30`、`60` 或 `120` 分钟提醒，赛程和赔率刷新后自动重排
- 通知由用户主动开启，可随时关闭并撤销；提醒不申请精确闹钟权限，不会自动购买或代替出票

## AI 分析状态

当前 APK 内已实装的是“本地 AI 规则版”，使用今年体彩官方完场赛果、已加载赛程、比分赔率和同年分析文本，不接入往届世界杯历史；它不需要联网调用模型，也不会泄露密钥。界面会明确显示：

```text
本地 AI 规则已实装，只看今年比赛
```

如果后续接 OpenAI 或其他模型，建议走服务端代理接口，再通过 `VITE_AI_ANALYSIS_ENDPOINT` 配置给前端。不要把 OpenAI API Key 写进安卓包或前端环境变量里。

## 数据来源

- 原始静态文件：
  `D:\工程\tapnow-clone-backup-v13-theme-complete\worldcup_score_odds_view_2026-06-12.html`
- 中国体育彩票官方比分赔率接口：
  `https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=crs`
- 中国体育彩票官方足球赛果接口：
  `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry`

## 本地开发

```bash
npm install
npm run import:legacy
npm run dev
```

## Web/PWA 验证

```bash
npm run build
npm run verify:pwa
npm run preview
```

## 构建安卓 APK

```bash
npm run android:apk
```

生成位置：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 构建签名 Release APK

```bash
npm run android:release
```

首次执行会在本机生成唯一签名证书，正式安装包位置：

```text
android/app/build/outputs/apk/release/app-release.apk
```

必须将 `.signing/` 与 `android/signing.properties` 一起离线备份。后续版本必须沿用同一证书，才能在手机上覆盖升级；这两个路径已加入 `.gitignore`，不会提交到代码仓库。

连接已开启 USB 调试的安卓手机后，可直接构建并安装签名版：

```bash
npm run android:install-release
```

如果手机中已安装旧 Debug 签名包，Android 会拒绝直接覆盖。请先手动卸载旧包，再安装 Release 版；脚本不会自动卸载或清除手机数据。

首次构建会在项目内下载便携 JDK、Gradle 和 Android SDK 到 `.toolchains/`，不需要全局安装 Android Studio。`.toolchains/` 不纳入 git。

## 安装到手机

手机开启 USB 调试并连接电脑后运行：

```bash
npm run android:install
```

如果没有连接设备，脚本会提示打开 USB 调试、连接手机并确认 RSA 授权。

## 后续上线

当前签名 `app-release.apk` 可用于固定渠道内测和后续覆盖升级。应用商店上线前还需要补：

- 应用隐私说明和风险提示页
- 商店图标、截图、版本说明和备案所需材料
- 如接口在线上受 WAF 或跨域影响，再增加极小服务端代理

## 导入脚本

`npm run import:legacy` 会执行 `scripts/import-legacy-html.mjs`，把旧 HTML 中的比赛、赔率、重点分析和原始预算表导入到：

- `src/data/legacy-data.json`

默认读取路径就是当前那份旧 HTML，也可以手动传入别的文件路径。
