# AI 圆桌 开发工作日志

## 项目概述

**项目名称**: AI 圆桌 - Multi-AI Roundtable
**项目类型**: Chrome Extension (Manifest V3)
**开发目的**: 创建一个统一界面，同时与多个 AI 助手（Claude、ChatGPT、Gemini）的 Web 界面进行交互
**版权所有**: © 2025 Axton Liu · AI 精英学院

---

## 一、需求分析

### 1.1 核心需求

用户希望像"会议主持人"一样，通过一个控制中心同时操控多个 AI 窗口：

- **统一输入**: 在一个地方输入消息，同时发送给多个 AI
- **实时查看**: 能够同时看到各个 AI 的回复
- **交叉引用**: 让一个 AI 评价另一个 AI 的回答（如：让 Claude 评价 ChatGPT 的回答）

### 1.2 技术约束

- **不使用 API**: 用户明确拒绝 API 方式，要求直接操作现有网页
- **Web 界面操作**: 通过 DOM 操作注入消息、获取回复

### 1.3 UI 设计决策

- **Side Panel**: 作为总控台（Chrome 侧边栏）
- **Split Tabs**: 2-3 个分屏标签页显示各 AI 界面

---

## 二、技术架构

### 2.1 文件结构

```
ai-panel/
├── manifest.json           # 扩展配置
├── background.js           # Service Worker
├── sidepanel/
│   ├── panel.html         # 侧边栏 UI
│   ├── panel.css          # 样式
│   └── panel.js           # 控制逻辑
├── content/
│   ├── claude.js          # Claude 内容脚本
│   ├── chatgpt.js         # ChatGPT 内容脚本
│   └── gemini.js          # Gemini 内容脚本
└── icons/                  # 扩展图标
```

### 2.2 核心技术点

| 技术 | 用途 |
|------|------|
| Chrome Side Panel API | 侧边栏控制界面 |
| Content Scripts | DOM 操作注入消息/获取回复 |
| chrome.storage.session | 跨 Service Worker 重启持久化存储 |
| MutationObserver | 监听 DOM 变化检测新回复 |
| IME Composition 处理 | 中文输入法兼容 |

### 2.3 消息流程

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  Side Panel │────▶│  Background  │────▶│ Content Script │
│   (控制台)   │     │   (中转站)    │     │   (各AI页面)    │
└─────────────┘     └──────────────┘     └────────────────┘
      ▲                    │                      │
      │                    ▼                      ▼
      │            chrome.storage         DOM 操作注入消息
      │              .session             获取 AI 回复
      │                    │                      │
      └────────────────────┴──────────────────────┘
                    响应回传
```

---

## 三、实现过程与问题修复

### 3.1 第一阶段：基础框架搭建

**实现内容**:
- 创建 manifest.json 配置文件
- 实现 Side Panel UI（目标选择、消息输入、发送按钮）
- 实现 Background Service Worker
- 实现三个 AI 的 Content Scripts

**初始 manifest.json 关键配置**:
```json
{
  "manifest_version": 3,
  "name": "AI Panel - Multi-AI Controller",
  "permissions": ["sidePanel", "activeTab", "tabs", "scripting", "storage"],
  "host_permissions": [
    "https://claude.ai/*",
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://gemini.google.com/*"
  ],
  "side_panel": { "default_path": "sidepanel/panel.html" },
  "background": { "service_worker": "background.js" }
}
```

---

### 3.2 Bug 修复记录

#### Bug #1: Content Scripts 无法连接

**现象**: 安装扩展后，无法与 AI 页面建立连接
**原因**: Content Scripts 在扩展安装前已加载的页面上不会自动注入
**解决**: 用户需要刷新 AI 页面

---

#### Bug #2: 交叉引用无法获取回复

**现象**: 使用交叉引用功能时，无法获取源 AI 的回复内容
**原因**: Service Worker 使用内存变量存储回复，但 Service Worker 会被浏览器终止，导致数据丢失
**解决**: 改用 `chrome.storage.session` 持久化存储

**修复代码**:
```javascript
// background.js
async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  return result.latestResponses || { claude: null, chatgpt: null, gemini: null };
}

async function setStoredResponse(aiType, content) {
  const responses = await getStoredResponses();
  responses[aiType] = content;
  await chrome.storage.session.set({ latestResponses: responses });
}
```

---

#### Bug #3: ChatGPT 回复捕获不完整

**现象**: ChatGPT 的回复只捕获了一部分，流式输出中途就停止了
**原因**: 回复捕获逻辑在流式输出还未完成时就触发了
**解决**: 实现 `waitForStreamingComplete()` 函数，通过轮询检测内容稳定后再捕获

**修复代码**:
```javascript
async function waitForStreamingComplete() {
  let previousContent = '';
  let stableCount = 0;
  const stableThreshold = 3;  // 连续3次内容相同才认为完成

  while (Date.now() - startTime < maxWait) {
    await sleep(500);

    const isStreaming = document.querySelector('button[aria-label*="Stop"]');
    const currentContent = getLatestResponse() || '';

    if (!isStreaming && currentContent === previousContent && currentContent.length > 0) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        // 内容稳定，可以捕获
        safeSendMessage({ type: 'RESPONSE_CAPTURED', aiType, content: currentContent });
        return;
      }
    } else {
      stableCount = 0;
    }
    previousContent = currentContent;
  }
}
```

---

#### Bug #4: "Extension context invalidated" 错误

**现象**: 控制台出现 "Extension context invalidated" 错误
**原因**: 刷新页面后，旧的 Content Script 实例仍在运行，但扩展上下文已失效
**解决**: 添加上下文有效性检查

**修复代码**:
```javascript
function isContextValid() {
  return chrome.runtime && chrome.runtime.id;
}

function safeSendMessage(message, callback) {
  if (!isContextValid()) {
    console.log('[AI Panel] Extension context invalidated, skipping message');
    return;
  }
  try {
    chrome.runtime.sendMessage(message, callback);
  } catch (e) {
    console.log('[AI Panel] Failed to send message:', e.message);
  }
}
```

---

#### Bug #5: 多次捕获同时运行

**现象**: MutationObserver 和 injectMessage 同时触发 waitForStreamingComplete，导致重复捕获
**原因**: 缺少互斥锁
**解决**: 添加 `isCapturing` 标志位

**修复代码**:
```javascript
let isCapturing = false;

async function waitForStreamingComplete() {
  if (isCapturing) {
    console.log('[AI Panel] Already capturing, skipping...');
    return;
  }
  isCapturing = true;

  try {
    // ... 捕获逻辑
  } finally {
    isCapturing = false;
  }
}
```

---

#### Bug #6: 换行符丢失

**现象**: 交叉引用时，AI 回复的换行符丢失，文字挤在一起
**原因**: 使用 `textContent` 获取内容，不保留换行
**解决**: 改用 `innerText`

**修复代码**:
```javascript
// 修改前
return lastBlock.textContent.trim();

// 修改后
return lastBlock.innerText.trim();
```

---

#### Bug #7: Claude 思考过程被捕获

**现象**: Claude 的 Extended Thinking 内容也被当作回复捕获
**原因**: 思考内容和正式回复都在 `.standard-markdown` 容器中
**解决**: 通过 DOM 结构过滤思考内容

**用户提供的 DOM 结构分析**:
- 思考内容在包含 "Thought process" 按钮的容器内
- 思考容器有 `overflow-hidden` 和 `max-h-[238px]` 类名

**修复代码**:
```javascript
function getLatestResponse() {
  const responseContainers = document.querySelectorAll('[data-is-streaming="false"]');
  if (responseContainers.length === 0) return null;

  const lastContainer = responseContainers[responseContainers.length - 1];
  const allBlocks = lastContainer.querySelectorAll('.standard-markdown');

  // 过滤掉思考内容
  const responseBlocks = Array.from(allBlocks).filter(block => {
    // 检查是否在思考容器内
    const thinkingContainer = block.closest('[class*="overflow-hidden"][class*="max-h-"]');
    if (thinkingContainer) return false;

    // 检查是否有 "Thought process" 按钮
    const parent = block.closest('.font-claude-response');
    if (parent) {
      const buttons = parent.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('Thought process') ||
            btn.textContent.includes('思考过程')) {
          const btnContainer = btn.closest('[class*="border-border-300"]');
          if (btnContainer && btnContainer.contains(block)) {
            return false;
          }
        }
      }
    }
    return true;
  });

  if (responseBlocks.length > 0) {
    return responseBlocks[responseBlocks.length - 1].innerText.trim();
  }
  return null;
}
```

---

#### Bug #8: 中文输入法回车问题

**现象**: 使用中文输入法时，按回车确认候选词会直接发送消息
**原因**: 未处理 IME 组合输入状态
**解决**: 检查 `e.isComposing` 状态

**修复代码**:
```javascript
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    handleSend();
  }
});
```

---

#### Bug #9: 交叉引用多目标逻辑错误

**现象**: "@Claude, @ChatGPT, 你们两个评价一下 @Gemini" 错误地把 ChatGPT 作为源，而不是 Gemini
**原因**: 原逻辑固定取第二个提及作为源
**解决**: 使用最后一个提及作为源，其他作为目标

**修复代码**:
```javascript
function parseMessage(message) {
  const mentionPattern = /@(claude|chatgpt|gemini)/gi;
  const matches = [...message.matchAll(mentionPattern)];
  const mentions = [...new Set(matches.map(m => m[1].toLowerCase()))];

  if (mentions.length >= 2) {
    const evalKeywords = /评价|看看|怎么样|怎么看|如何|讲的|说的|回答|evaluate|think of|opinion|review/i;

    if (evalKeywords.test(message)) {
      // 最后提及的 AI 是被评价的源
      const sourceAI = matches[matches.length - 1][1].toLowerCase();
      // 其他都是评价者（目标）
      const targetAIs = mentions.filter(ai => ai !== sourceAI);

      return {
        crossRef: true,
        mentions,
        targetAIs,  // 数组，支持多个目标
        sourceAI,
        originalMessage: message
      };
    }
  }

  return { crossRef: false, mentions, originalMessage: message };
}

async function handleCrossReference(parsed) {
  const sourceResponse = await getLatestResponse(parsed.sourceAI);

  if (!sourceResponse) {
    log(`Could not get ${parsed.sourceAI}'s response`, 'error');
    return;
  }

  const fullMessage = `${parsed.originalMessage}

<${parsed.sourceAI}_response>
${sourceResponse}
</${parsed.sourceAI}_response>`;

  // 发送给所有目标 AI
  for (const targetAI of parsed.targetAIs) {
    await sendToAI(targetAI, fullMessage);
  }
}
```

---

### 3.3 功能增强

#### 增强 #1: @ 提及按钮

**用户需求**: 手动输入 @Claude 等太麻烦
**实现**: 添加快捷按钮，点击自动插入 @mention

**HTML**:
```html
<div class="mention-buttons">
  <span class="mention-label">@</span>
  <button class="mention-btn claude" data-mention="@Claude">Claude</button>
  <button class="mention-btn chatgpt" data-mention="@ChatGPT">ChatGPT</button>
  <button class="mention-btn gemini" data-mention="@Gemini">Gemini</button>
</div>
```

**JavaScript**:
```javascript
document.querySelectorAll('.mention-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mention = btn.dataset.mention;
    const cursorPos = messageInput.selectionStart;
    const textBefore = messageInput.value.substring(0, cursorPos);
    const textAfter = messageInput.value.substring(cursorPos);

    const needsSpace = textBefore.length > 0 &&
                       !textBefore.endsWith(' ') &&
                       !textBefore.endsWith('\n');
    const insertText = (needsSpace ? ' ' : '') + mention + ' ';

    messageInput.value = textBefore + insertText + textAfter;
    messageInput.focus();
    messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
  });
});
```

---

#### 增强 #2: XML 格式分隔符

**用户需求**: 交叉引用时用 XML 标签代替 `---` 分隔，更清晰
**实现**:

```javascript
const fullMessage = `${parsed.originalMessage}

<${parsed.sourceAI}_response>
${sourceResponse}
</${parsed.sourceAI}_response>`;
```

---

#### 增强 #3: Discussion Mode（讨论模式）

**用户需求**:
用户希望让两个 AI 就同一主题进行深度讨论：
1. 两个 AI 分别给出初始观点
2. 让 A 评价 B 的观点，B 评价 A 的观点
3. 将评价反馈给原 AI 进行进一步探讨
4. 最后生成讨论总结

这是一种经过验证的有效方法，结合了：
- **辩证法**: 正题(A观点) → 反题(B评价) → 合题(进一步探讨)
- **红蓝对抗**: 让不同视角互相压力测试
- **对抗性协作**: 学术界用于减少偏见的方法

**实现架构**:

```
┌─────────────────────────────────────────────────────────┐
│  Discussion Mode                              [Round 2] │
├─────────────────────────────────────────────────────────┤
│  Topic: [讨论主题]                                       │
│  ┌─────────────┐              ┌─────────────┐          │
│  │   Claude    │◄────────────►│   ChatGPT   │          │
│  │  初始观点    │   互相评价    │   初始观点   │          │
│  └─────────────┘              └─────────────┘          │
│  [▶ Next Round]  [■ End]  [📋 Summary]                 │
└─────────────────────────────────────────────────────────┘
```

**讨论流程**:
```
Round 1: 发送主题 → A、B 各自回答
Round 2: A 评价 B 的回答，B 评价 A 的回答（并行）
Round 3: A 回应 B 的评价，B 回应 A 的评价（并行）
Round N: 继续深入...
Summary: 生成讨论总结
```

**核心状态管理**:
```javascript
let discussionState = {
  active: false,
  topic: '',
  participants: [],  // [ai1, ai2]
  currentRound: 0,
  history: [],  // [{round, ai, type, content}]
  pendingResponses: new Set(),
  roundType: null  // 'initial', 'cross-eval', 'summary'
};
```

**关键函数**:
- `startDiscussion()` - 初始化讨论，发送主题给两个 AI
- `handleDiscussionResponse()` - 处理 AI 回复，更新状态
- `nextRound()` - 进入下一轮交叉评价
- `generateSummary()` - 生成讨论总结
- `resetDiscussion()` - 重置讨论状态

**UI 组件**:
- Mode Switcher: Normal / Discussion 模式切换
- Participant Select: 选择参与讨论的两个 AI
- Topic Input: 输入讨论主题
- Round Badge: 显示当前轮次
- Status Display: 显示等待状态
- Control Buttons: Next Round / Generate Summary / End

---

## 四、各 AI 平台 DOM 选择器

### 4.1 Claude (claude.ai)

| 元素 | 选择器 |
|------|--------|
| 输入框 | `div[contenteditable="true"].ProseMirror` |
| 发送按钮 | `button[aria-label="Send message"]` |
| 回复容器 | `[data-is-streaming="false"]` |
| 回复内容 | `.standard-markdown` |
| 流式状态 | `[data-is-streaming="true"]` |
| 停止按钮 | `button[aria-label*="Stop"]` |

### 4.2 ChatGPT (chatgpt.com)

| 元素 | 选择器 |
|------|--------|
| 输入框 | `#prompt-textarea` |
| 发送按钮 | `button[data-testid="send-button"]` |
| 回复容器 | `[data-message-author-role="assistant"]` |
| 回复内容 | `.markdown` |
| 停止按钮 | `button[data-testid="stop-button"]` |

### 4.3 Gemini (gemini.google.com)

| 元素 | 选择器 |
|------|--------|
| 输入框 | `div[contenteditable="true"].ql-editor` |
| 发送按钮 | `button[aria-label="Send message"]` |
| 回复容器 | `.model-response-text` |

---

## 五、当前状态

### 5.1 已完成功能

- [x] Side Panel 控制界面
- [x] 多目标同时发送消息
- [x] 连接状态检测与显示
- [x] 回复自动捕获（支持流式输出）
- [x] 交叉引用功能（支持多目标）
- [x] @ 提及快捷按钮
- [x] 中文输入法兼容
- [x] Claude 思考内容过滤
- [x] 活动日志显示
- [x] **Discussion Mode（讨论模式）** - 让两个 AI 进行多轮深度讨论

### 5.2 使用方法

**Normal Mode（普通模式）**:
1. **基本发送**: 勾选目标 AI → 输入消息 → 点击发送
2. **@ 提及**: 使用 @Claude/@ChatGPT/@Gemini 指定发送目标
3. **交叉引用**: "@Claude 评价一下 @Gemini 的回答"（Gemini 是源，Claude 是目标）

**Discussion Mode（讨论模式）**:
1. 点击顶部 "Discussion" 按钮切换到讨论模式
2. 选择两个参与讨论的 AI（必须恰好选 2 个）
3. 输入讨论主题，点击 "Start Discussion"
4. 等待两个 AI 给出初始回答
5. 点击 "Next Round" 让他们互相评价
6. 可以继续多轮，或点击 "Generate Summary" 生成总结
7. 点击 "New Discussion" 开始新的讨论

### 5.3 已知限制

- 安装/更新扩展后需刷新 AI 页面
- 依赖各 AI 平台的 DOM 结构，平台更新可能导致失效
- 交叉引用需要源 AI 已有回复

---

## 六、版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 0.1.0 | - | 基础框架，支持多目标发送 |
| 0.2.0 | - | 添加交叉引用功能 |
| 0.3.0 | - | 修复 Service Worker 存储问题 |
| 0.4.0 | - | 修复流式输出捕获问题 |
| 0.5.0 | - | 添加 @ 提及按钮，修复 IME 问题 |
| 0.6.0 | - | 过滤 Claude 思考内容 |
| 0.7.0 | - | 支持多目标交叉引用 |
| 0.8.0 | - | **Discussion Mode** - 两个 AI 多轮深度讨论 |
| 0.9.0 | - | 修复超时问题（60s→10分钟），优化 ChatGPT 捕获 |
| 1.0.0 | 2026-01-09 | **正式版** - 品牌更名「AI 圆桌」，添加版权信息 |

---

## 七、当前工作进度总结

### 7.1 已完成的核心功能

| 功能 | 状态 | 说明 |
|------|------|------|
| Normal Mode | ✅ 完成 | 多目标发送、@提及、交叉引用 |
| Discussion Mode | ✅ 完成 | 两 AI 多轮讨论、互评、生成总结 |
| 回复捕获 | ✅ 完成 | 支持长时间流式输出（10分钟超时） |
| Claude 思考过滤 | ✅ 完成 | 排除 Extended Thinking 内容 |
| 中文 IME 兼容 | ✅ 完成 | 回车不会误触发发送 |
| 品牌 UI | ✅ 完成 | 「AI 圆桌」+ 版权信息 |

### 7.2 技术实现亮点

1. **内容稳定检测算法**: 连续 2 秒内容不变才判定为完成
2. **10 分钟超时**: 支持 ChatGPT 等超长回复场景
3. **Discussion 状态机**: 追踪轮次、待回复、历史记录
4. **DOM 选择器容错**: 多选择器回退，适应平台 UI 变化

### 7.3 待优化项目（Future）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P1 | 讨论历史导出 | 导出完整讨论记录为 Markdown |
| P1 | 自动轮次模式 | 设定轮数后自动执行 |
| P2 | 更多 AI 支持 | 添加 Perplexity、Grok 等 |
| P2 | 主题模板 | 预设讨论主题模板 |
| P3 | 讨论可视化 | 图形化展示观点对比 |
| P3 | 回复对比视图 | 并排显示多 AI 回复 |

### 7.4 已知限制

1. 安装/更新扩展后需刷新 AI 页面
2. 依赖各 AI 平台 DOM 结构，平台更新可能导致失效
3. Discussion Mode 固定 2 个参与者
4. 总结功能依赖第一个 AI 生成

---

*文档更新时间: 2026-01-09*
