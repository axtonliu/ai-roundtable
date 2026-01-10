# AI 圆桌 v0.1 (MVP)

> 让多个 AI 助手围桌讨论，交叉评价，深度协作

**This is an MVP. Features may change. No guaranteed support.**

一个 Chrome 扩展，让你像"会议主持人"一样，同时操控多个 AI（Claude、ChatGPT、Gemini），实现真正的 AI 圆桌会议。

## 核心特性

- **统一控制台** - 通过 Chrome 侧边栏同时管理多个 AI
- **多目标发送** - 一条消息同时发给多个 AI，对比回答
- **交叉引用** - 让 Claude 评价 ChatGPT 的回答，或反过来
- **Discussion Mode** - 两个 AI 就同一主题进行多轮深度讨论
- **无需 API** - 直接操作网页界面，使用你现有的 AI 订阅

## 安装

### 开发者模式安装

1. 下载或克隆本仓库
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目文件夹

## 使用方法

### 准备工作

1. 打开 Chrome，登录以下 AI 平台（根据需要）：
   - [Claude](https://claude.ai)
   - [ChatGPT](https://chatgpt.com)
   - [Gemini](https://gemini.google.com)

2. 推荐使用 Chrome 的 Split Tab 功能，将 2 个 AI 页面并排显示

3. 点击扩展图标，打开侧边栏控制台

### Normal Mode（普通模式）

**基本发送**
1. 勾选要发送的目标 AI（Claude / ChatGPT / Gemini）
2. 输入消息
3. 按 Enter 或点击 Send 按钮

**@ 提及语法**
- 点击 @ 按钮快速插入 AI 名称
- 或手动输入：`@Claude 你怎么看这个问题？`

**交叉引用**

两个 AI（自动检测）：
```
@Claude 评价一下 @ChatGPT
```
最后 @ 的是来源（被评价），前面的是目标（评价者）

三个 AI（使用 /cross 命令）：
```
/cross @Claude @Gemini <- @ChatGPT 评价一下
/cross @ChatGPT <- @Claude @Gemini 对比一下
```

**动作下拉菜单**：快速插入预设动作词（评价/借鉴/批评/补充/对比）

### Discussion Mode（讨论模式）

让两个 AI 就同一主题进行深度辩论：

1. 点击顶部「Discussion」切换到讨论模式
2. 选择 2 个参与讨论的 AI
3. 输入讨论主题
4. 点击「Start Discussion」

**讨论流程**

```
Round 1: 两个 AI 各自阐述观点
Round 2: 互相评价对方的观点
Round 3: 回应对方的评价，深化讨论
...
Summary: 生成讨论总结
```

## 技术架构

```
ai-roundtable/
├── manifest.json           # Chrome 扩展配置 (Manifest V3)
├── background.js           # Service Worker 消息中转
├── sidepanel/
│   ├── panel.html         # 侧边栏 UI
│   ├── panel.css          # 样式
│   └── panel.js           # 控制逻辑
├── content/
│   ├── claude.js          # Claude 页面注入脚本
│   ├── chatgpt.js         # ChatGPT 页面注入脚本
│   └── gemini.js          # Gemini 页面注入脚本
└── icons/                  # 扩展图标
```

## 常见问题

### Q: 安装后无法连接 AI 页面？
**A:** 安装或更新扩展后，需要刷新已打开的 AI 页面。

### Q: 交叉引用时提示"无法获取回复"？
**A:** 确保源 AI 已经有回复。系统会获取该 AI 的最新一条回复。

### Q: ChatGPT 回复很长时会超时吗？
**A:** 不会。系统支持最长 10 分钟的回复捕获。

### Q: 会读取我的 AI 对话内容吗？
**A:** 扩展仅在本地运行，不会向任何服务器发送数据。

## 已知限制

- 依赖各 AI 平台的 DOM 结构，平台更新可能导致功能失效
- Discussion Mode 固定 2 个参与者
- 不支持 Claude Artifacts、ChatGPT Canvas 等特殊功能

## 许可证

MIT License

---

**© 2025 Axton Liu · AI 精英学院**
