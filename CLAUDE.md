# AI 圆桌 - 项目开发规范

## 项目概述

- **名称**: AI 圆桌 - Multi-AI Roundtable
- **类型**: Chrome Extension (Manifest V3)
- **语言**: 界面使用中文，AI 名称保留英文 (Claude/ChatGPT/Gemini)

## 文档更新规范

每次发布新版本时，**必须同步更新**以下文档：

### 1. manifest.json
- 更新 `version` 字段

### 2. DEVELOPMENT_LOG.md (私有)
- 更新"当前版本"
- 如有 Bug 修复，添加到"Bug 修复记录"部分
- 如有新功能，添加到"功能增强"部分
- 更新"版本历史"表格
- 更新"当前工作进度总结"中的功能状态表
- 更新文档末尾的时间戳

### 3. SOFTWARE_DESIGN.md (私有)
- 更新头部的版本号和日期
- 如有架构变更，更新相关章节
- 如文件行数有较大变化，更新文件结构中的行数标注
- 更新文档末尾的版本和时间

## UI 文字规范

### 中文化原则
- 所有按钮、标签、提示使用中文
- AI 名称保留英文：Claude、ChatGPT、Gemini
- 技术命令保留原样：/mutual、/cross、@

### 已中文化的界面元素
| 位置 | 中文文字 |
|------|----------|
| 模式切换 | 普通 / 讨论 |
| 发送按钮 | 发送 |
| 讨论设置 | 开始讨论、参与者、请选择 2 位参与者 |
| 讨论控制 | 下一轮、生成总结、结束、新讨论 |
| 轮次显示 | 第 X 轮 |
| 状态显示 | 等待...、交叉评价...、正在生成... |
| 日志区域 | 活动日志 |

## 代码规范

### 文件结构
```
ai-panel/
├── manifest.json          # 扩展配置
├── background.js          # Service Worker
├── sidepanel/
│   ├── panel.html        # UI 结构
│   ├── panel.css         # 样式 (830+ 行)
│   └── panel.js          # 逻辑 (800+ 行)
├── content/
│   ├── claude.js         # Claude 内容脚本
│   ├── chatgpt.js        # ChatGPT 内容脚本
│   └── gemini.js         # Gemini 内容脚本
├── icons/                 # 扩展图标
├── CLAUDE.md             # 本文件 (项目规范)
├── DEVELOPMENT_LOG.md    # 开发日志 (私有)
├── SOFTWARE_DESIGN.md    # 设计文档 (私有)
└── README.md             # 公开说明
```

### CSS 布局要点
- Discussion 模式使用 flexbox 布局
- 所有可切换显示的 section 都需要有 flex 样式
- `min-height: 0` 确保 flex 子项正确收缩

### JS 状态管理
- `discussionState` 对象管理讨论模式状态
- 使用 `chrome.storage.session` 存储 AI 回复
- Content Script 通过 message passing 与 Background 通信

## Git 提交规范

```
type: 简短描述

详细说明（可选）

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

type 类型：
- feat: 新功能
- fix: Bug 修复
- docs: 文档更新
- style: 样式/格式调整
- refactor: 重构
- chore: 构建/工具变更

## 版本发布检查清单

- [ ] 更新 manifest.json 版本号
- [ ] 更新 DEVELOPMENT_LOG.md
- [ ] 更新 SOFTWARE_DESIGN.md
- [ ] Git commit 并 push
- [ ] 创建 GitHub Release
- [ ] 测试扩展功能正常

## 私有文件 (.gitignore)

以下文件不公开：
- DEVELOPMENT_LOG.md
- SOFTWARE_DESIGN.md
- .env (如有)
