# AI 圆桌 - Multi-AI Roundtable

> 让多个 AI 助手围桌讨论，交叉评价，深度协作

一个 Chrome 扩展，让你像"会议主持人"一样，同时操控多个 AI（Claude、ChatGPT、Gemini），实现真正的 AI 圆桌会议。

## 核心特性

- **统一控制台** - 通过 Chrome 侧边栏同时管理多个 AI
- **多目标发送** - 一条消息同时发给多个 AI，对比回答
- **交叉引用** - 让 Claude 评价 ChatGPT 的回答，或反过来
- **Discussion Mode** - 两个 AI 就同一主题进行多轮深度讨论
- **无需 API** - 直接操作网页界面，使用你现有的 AI 订阅

## 安装

### 方式一：开发者模式安装

1. 下载或克隆本仓库
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目文件夹

### 方式二：从 Release 安装

*（暂未发布）*

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
```

**动作下拉菜单**：快速插入预设动作词（评价/借鉴/批评/补充/对比），可继续添加自己的文字

### Discussion Mode（讨论模式）

让两个 AI 就同一主题进行深度辩论：

1. 点击顶部「Discussion」切换到讨论模式
2. 选择 2 个参与讨论的 AI
3. 输入讨论主题，例如：
   - "微服务 vs 单体架构的优缺点"
   - "AI 会取代程序员吗？"
4. 点击「Start Discussion」

**讨论流程**

```
Round 1: 两个 AI 各自阐述观点
Round 2: 互相评价对方的观点
Round 3: 回应对方的评价，深化讨论
...
Summary: 生成讨论总结
```

- **Next Round** - 进入下一轮互评
- **Generate Summary** - 由第一个 AI 生成讨论总结
- **End** - 结束当前讨论

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

### 消息流程

```
Side Panel (控制台)
    ↓
Background (Service Worker)
    ↓
Content Script (AI 页面)
    ↓
DOM 操作 → 注入消息 / 获取回复
    ↓
chrome.storage.session → 持久化存储
    ↓
Side Panel (更新状态)
```

### 关键技术

| 技术 | 用途 |
|------|------|
| Chrome Side Panel API | 侧边栏控制界面 |
| Content Scripts | DOM 操作注入消息 / 获取回复 |
| chrome.storage.session | 跨 Service Worker 重启持久化 |
| MutationObserver | 监听 DOM 变化检测新回复 |
| 内容稳定检测 | 连续 2 秒内容不变才判定完成 |
| IME Composition | 中文输入法兼容处理 |

## 常见问题

### Q: 安装后无法连接 AI 页面？

**A:** 安装或更新扩展后，需要刷新已打开的 AI 页面。

### Q: 交叉引用时提示"无法获取回复"？

**A:** 确保源 AI 已经有回复。系统会获取该 AI 的最新一条回复。

### Q: ChatGPT 回复很长时会超时吗？

**A:** 不会。系统支持最长 10 分钟的回复捕获，足够处理任何长度的回答。

### Q: 支持 Dia 浏览器吗？

**A:** 部分支持。Dia 的 3-way Split View 可能因 Tab ID 管理差异导致部分功能异常。建议使用 Chrome + 系统分屏实现 3 窗口布局。

### Q: 会读取我的 AI 对话内容吗？

**A:** 扩展仅在本地运行，不会向任何服务器发送数据。所有交互都发生在你的浏览器中。

## 已知限制

- 依赖各 AI 平台的 DOM 结构，平台更新可能导致功能失效
- Discussion Mode 固定 2 个参与者
- 不支持 Claude Artifacts、ChatGPT Canvas 等特殊功能

## 开发日志

详细的开发过程、Bug 修复记录和技术决策，请参阅 [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md)

## 未来计划

- [ ] 讨论历史导出（Markdown 格式）
- [ ] 自动轮次模式（设定轮数后自动执行）
- [ ] 更多 AI 支持（Perplexity、Grok 等）
- [ ] 讨论主题模板
- [ ] 回复对比视图

## 许可证

MIT License

---

**© 2025 Axton Liu · AI 精英学院**
