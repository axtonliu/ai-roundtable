// AI Panel - Side Panel Controller

const AI_TYPES = ['claude', 'chatgpt', 'gemini'];

// Cross-reference action keywords (inserted into message)
const CROSS_REF_ACTIONS = {
  evaluate: { prompt: '评价一下' },
  learn: { prompt: '有什么值得借鉴的' },
  critique: { prompt: '批评一下，指出问题' },
  supplement: { prompt: '有什么遗漏需要补充' },
  compare: { prompt: '对比一下你的观点' }
};

// DOM Elements
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const logContainer = document.getElementById('log-container');
const fileInput = document.getElementById('file-input');
const addFileBtn = document.getElementById('add-file-btn');
const fileList = document.getElementById('file-list');

// Selected files storage
let selectedFiles = [];

// Track connected tabs
const connectedTabs = {
  claude: null,
  chatgpt: null,
  gemini: null
};

// Discussion Mode State
let discussionState = {
  active: false,
  topic: '',
  participants: [],  // [ai1, ai2]
  currentRound: 0,
  history: [],  // [{round, ai, type: 'initial'|'evaluation'|'response', content}]
  pendingResponses: new Set(),  // AIs we're waiting for
  roundType: null  // 'initial', 'cross-eval', 'counter'
};


// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkConnectedTabs();
  setupEventListeners();
  setupDiscussionMode();
  setupFileUpload();
});

function setupEventListeners() {
  sendBtn.addEventListener('click', handleSend);

  // Enter to send, Shift+Enter for new line (like ChatGPT)
  // But ignore Enter during IME composition (e.g., Chinese input)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSend();
    }
  });

  // Shortcut buttons (/cross, <-)
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const insertText = btn.dataset.insert;
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    });
  });

  // Action select - insert action prompt into textarea
  document.getElementById('action-select').addEventListener('change', (e) => {
    const action = e.target.value;
    if (!action) return;

    const actionConfig = CROSS_REF_ACTIONS[action];
    if (actionConfig) {
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      // Add space before if needed
      const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
      const insertText = (needsSpace ? ' ' : '') + actionConfig.prompt + ' ';

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    }

    // Reset select to placeholder
    e.target.value = '';
  });

  // Mention buttons - insert @AI into textarea
  document.querySelectorAll('.mention-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mention = btn.dataset.mention;
      const cursorPos = messageInput.selectionStart;
      const textBefore = messageInput.value.substring(0, cursorPos);
      const textAfter = messageInput.value.substring(cursorPos);

      // Add space before if needed
      const needsSpace = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
      const insertText = (needsSpace ? ' ' : '') + mention + ' ';

      messageInput.value = textBefore + insertText + textAfter;
      messageInput.focus();
      messageInput.selectionStart = messageInput.selectionEnd = cursorPos + insertText.length;
    });
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TAB_STATUS_UPDATE') {
      updateTabStatus(message.aiType, message.connected);
    } else if (message.type === 'RESPONSE_CAPTURED') {
      log(`${message.aiType}: Response captured`, 'success');
      // Handle discussion mode response
      if (discussionState.active && discussionState.pendingResponses.has(message.aiType)) {
        handleDiscussionResponse(message.aiType, message.content);
      }
    } else if (message.type === 'SEND_RESULT') {
      if (message.success) {
        log(`${message.aiType}: Message sent`, 'success');
      } else {
        log(`${message.aiType}: Failed - ${message.error}`, 'error');
      }
    }
  });
}

async function checkConnectedTabs() {
  try {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      const aiType = getAITypeFromUrl(tab.url);
      if (aiType) {
        connectedTabs[aiType] = tab.id;
        updateTabStatus(aiType, true);
      }
    }
  } catch (err) {
    log('Error checking tabs: ' + err.message, 'error');
  }
}

function getAITypeFromUrl(url) {
  if (!url) return null;
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('gemini.google.com')) return 'gemini';
  return null;
}

function updateTabStatus(aiType, connected) {
  const statusEl = document.getElementById(`status-${aiType}`);
  if (statusEl) {
    // Status is now a dot indicator, no text needed
    statusEl.className = 'status ' + (connected ? 'connected' : 'disconnected');
    statusEl.title = connected ? '已连接' : '未找到';
  }
  if (connected) {
    connectedTabs[aiType] = true;
  }
}

async function handleSend() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Parse message for @ mentions
  const parsed = parseMessage(message);

  // Determine targets
  let targets;
  if (parsed.mentions.length > 0) {
    // If @ mentioned specific AIs, only send to those
    targets = parsed.mentions;
  } else {
    // Otherwise use checkbox selection
    targets = AI_TYPES.filter(ai => {
      const checkbox = document.getElementById(`target-${ai}`);
      return checkbox && checkbox.checked;
    });
  }

  if (targets.length === 0) {
    log('No targets selected', 'error');
    return;
  }

  sendBtn.disabled = true;

  // Clear input immediately after sending
  messageInput.value = '';

  // Send files first if any
  const filesToSend = [...selectedFiles];
  if (filesToSend.length > 0) {
    log(`正在上传 ${filesToSend.length} 个文件...`);
    for (const target of targets) {
      await sendFilesToAI(target, filesToSend);
    }
    clearFiles();
    // Wait a bit for files to be processed before sending message
    await new Promise(r => setTimeout(r, 500));
  }

  try {
    // If mutual review, handle specially
    if (parsed.mutual) {
      if (targets.length < 2) {
        log('Mutual review requires at least 2 AIs selected', 'error');
      } else {
        log(`Mutual review: ${targets.join(', ')}`);
        await handleMutualReview(targets, parsed.prompt);
      }
    }
    // If cross-reference, handle specially
    else if (parsed.crossRef) {
      log(`Cross-reference: ${parsed.targetAIs.join(', ')} <- ${parsed.sourceAIs.join(', ')}`);
      await handleCrossReference(parsed);
    } else {
      // Send to target(s)
      log(`Sending to: ${targets.join(', ')}`);
      for (const target of targets) {
        await sendToAI(target, message);
      }
    }
  } catch (err) {
    log('Error: ' + err.message, 'error');
  }

  sendBtn.disabled = false;
  messageInput.focus();
}

function parseMessage(message) {
  // Check for /mutual command: /mutual [optional prompt]
  // Triggers mutual review based on current responses (no new topic needed)
  const trimmedMessage = message.trim();
  if (trimmedMessage.toLowerCase() === '/mutual' || trimmedMessage.toLowerCase().startsWith('/mutual ')) {
    // Extract everything after "/mutual " as the prompt
    const prompt = trimmedMessage.length > 7 ? trimmedMessage.substring(7).trim() : '';
    return {
      mutual: true,
      prompt: prompt || '请评价以上观点。你同意什么？不同意什么？有什么补充？',
      crossRef: false,
      mentions: [],
      originalMessage: message
    };
  }

  // Check for /cross command first: /cross @targets <- @sources message
  // Use this for complex cases (3 AIs, or when you want to be explicit)
  if (message.trim().toLowerCase().startsWith('/cross ')) {
    const arrowIndex = message.indexOf('<-');
    if (arrowIndex === -1) {
      // No arrow found, treat as regular message
      return { crossRef: false, mentions: [], originalMessage: message };
    }

    const beforeArrow = message.substring(7, arrowIndex).trim(); // Skip "/cross "
    const afterArrow = message.substring(arrowIndex + 2).trim();  // Skip "<-"

    // Extract targets (before arrow)
    const mentionPattern = /@(claude|chatgpt|gemini)/gi;
    const targetMatches = [...beforeArrow.matchAll(mentionPattern)];
    const targetAIs = [...new Set(targetMatches.map(m => m[1].toLowerCase()))];

    // Extract sources and message (after arrow)
    // Find all @mentions in afterArrow, sources are all @mentions
    // Message is everything after the last @mention
    const sourceMatches = [...afterArrow.matchAll(mentionPattern)];
    const sourceAIs = [...new Set(sourceMatches.map(m => m[1].toLowerCase()))];

    // Find where the actual message starts (after the last @mention)
    let actualMessage = afterArrow;
    if (sourceMatches.length > 0) {
      const lastMatch = sourceMatches[sourceMatches.length - 1];
      const lastMentionEnd = lastMatch.index + lastMatch[0].length;
      actualMessage = afterArrow.substring(lastMentionEnd).trim();
    }

    if (targetAIs.length > 0 && sourceAIs.length > 0) {
      return {
        crossRef: true,
        mentions: [...targetAIs, ...sourceAIs],
        targetAIs,
        sourceAIs,
        originalMessage: actualMessage
      };
    }
  }

  // Pattern-based detection for @ mentions
  const mentionPattern = /@(claude|chatgpt|gemini)/gi;
  const matches = [...message.matchAll(mentionPattern)];
  const mentions = [...new Set(matches.map(m => m[1].toLowerCase()))];

  // For exactly 2 AIs: use keyword detection (simpler syntax)
  // Last mentioned = source (being evaluated), first = target (doing evaluation)
  if (mentions.length === 2) {
    const evalKeywords = /评价|看看|怎么样|怎么看|如何|讲的|说的|回答|赞同|同意|分析|认为|观点|看法|意见|借鉴|批评|补充|对比|evaluate|think of|opinion|review|agree|analysis|compare|learn from/i;

    if (evalKeywords.test(message)) {
      const sourceAI = matches[matches.length - 1][1].toLowerCase();
      const targetAI = matches[0][1].toLowerCase();

      return {
        crossRef: true,
        mentions,
        targetAIs: [targetAI],
        sourceAIs: [sourceAI],
        originalMessage: message
      };
    }
  }

  // For 3+ AIs without /cross command: just send to all (no cross-reference)
  // User should use /cross command for complex 3-AI scenarios
  return {
    crossRef: false,
    mentions,
    originalMessage: message
  };
}

async function handleCrossReference(parsed) {
  // Get responses from all source AIs
  const sourceResponses = [];

  for (const sourceAI of parsed.sourceAIs) {
    const response = await getLatestResponse(sourceAI);
    if (!response) {
      log(`Could not get ${sourceAI}'s response`, 'error');
      return;
    }
    sourceResponses.push({ ai: sourceAI, content: response });
  }

  // Build the full message with XML tags for each source
  let fullMessage = parsed.originalMessage + '\n';

  for (const source of sourceResponses) {
    fullMessage += `
<${source.ai}_response>
${source.content}
</${source.ai}_response>`;
  }

  // Send to all target AIs
  for (const targetAI of parsed.targetAIs) {
    await sendToAI(targetAI, fullMessage);
  }
}

// ============================================
// Mutual Review Functions
// ============================================

async function handleMutualReview(participants, prompt) {
  // Get current responses from all participants
  const responses = {};

  log(`[Mutual] Fetching responses from ${participants.join(', ')}...`);

  for (const ai of participants) {
    const response = await getLatestResponse(ai);
    if (!response || response.trim().length === 0) {
      log(`[Mutual] Could not get ${ai}'s response - make sure ${ai} has replied first`, 'error');
      return;
    }
    responses[ai] = response;
    log(`[Mutual] Got ${ai}'s response (${response.length} chars)`);
  }

  log(`[Mutual] All responses collected. Sending cross-evaluations...`);

  // For each AI, send them the responses from all OTHER AIs
  for (const targetAI of participants) {
    const otherAIs = participants.filter(ai => ai !== targetAI);

    // Build message with all other AIs' responses
    let evalMessage = `以下是其他 AI 的观点：\n`;

    for (const sourceAI of otherAIs) {
      evalMessage += `
<${sourceAI}_response>
${responses[sourceAI]}
</${sourceAI}_response>
`;
    }

    evalMessage += `\n${prompt}`;

    log(`[Mutual] Sending to ${targetAI}: ${otherAIs.join('+')} responses + prompt`);
    await sendToAI(targetAI, evalMessage);
  }

  log(`[Mutual] Complete! All ${participants.length} AIs received cross-evaluations`, 'success');
}

async function getLatestResponse(aiType) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_RESPONSE', aiType },
      (response) => {
        resolve(response?.content || null);
      }
    );
  });
}

async function sendToAI(aiType, message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'SEND_MESSAGE', aiType, message },
      (response) => {
        if (response?.success) {
          log(`Sent to ${aiType}`, 'success');
        } else {
          log(`Failed to send to ${aiType}: ${response?.error || 'Unknown error'}`, 'error');
        }
        resolve(response);
      }
    );
  });
}

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (type !== 'info' ? ` ${type}` : '');

  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  entry.innerHTML = `<span class="time">${time}</span>${message}`;
  logContainer.insertBefore(entry, logContainer.firstChild);

  // Keep only last 50 entries
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

// ============================================
// Discussion Mode Functions
// ============================================

function setupDiscussionMode() {
  // Mode switcher buttons
  document.getElementById('mode-normal').addEventListener('click', () => switchMode('normal'));
  document.getElementById('mode-discussion').addEventListener('click', () => switchMode('discussion'));

  // Discussion controls
  document.getElementById('start-discussion-btn').addEventListener('click', startDiscussion);
  document.getElementById('next-round-btn').addEventListener('click', nextRound);
  document.getElementById('end-discussion-btn').addEventListener('click', endDiscussion);
  document.getElementById('generate-summary-btn').addEventListener('click', generateSummary);
  document.getElementById('new-discussion-btn').addEventListener('click', resetDiscussion);
  document.getElementById('interject-btn').addEventListener('click', handleInterject);

  // Participant selection validation
  document.querySelectorAll('input[name="participant"]').forEach(checkbox => {
    checkbox.addEventListener('change', validateParticipants);
  });
}

function switchMode(mode) {
  const normalMode = document.getElementById('normal-mode');
  const discussionMode = document.getElementById('discussion-mode');
  const normalBtn = document.getElementById('mode-normal');
  const discussionBtn = document.getElementById('mode-discussion');

  if (mode === 'normal') {
    normalMode.classList.remove('hidden');
    discussionMode.classList.add('hidden');
    normalBtn.classList.add('active');
    discussionBtn.classList.remove('active');
  } else {
    normalMode.classList.add('hidden');
    discussionMode.classList.remove('hidden');
    normalBtn.classList.remove('active');
    discussionBtn.classList.add('active');
  }
}

function validateParticipants() {
  const selected = document.querySelectorAll('input[name="participant"]:checked');
  const startBtn = document.getElementById('start-discussion-btn');
  startBtn.disabled = selected.length !== 2;
}

async function startDiscussion() {
  const topic = document.getElementById('discussion-topic').value.trim();
  if (!topic) {
    log('请输入讨论主题', 'error');
    return;
  }

  const selected = Array.from(document.querySelectorAll('input[name="participant"]:checked'))
    .map(cb => cb.value);

  if (selected.length !== 2) {
    log('请选择 2 位参与者', 'error');
    return;
  }

  // Initialize discussion state
  discussionState = {
    active: true,
    topic: topic,
    participants: selected,
    currentRound: 1,
    history: [],
    pendingResponses: new Set(selected),
    roundType: 'initial'
  };

  // Update UI
  document.getElementById('discussion-setup').classList.add('hidden');
  document.getElementById('discussion-active').classList.remove('hidden');
  document.getElementById('round-badge').textContent = '第 1 轮';
  document.getElementById('participants-badge').textContent =
    `${capitalize(selected[0])} vs ${capitalize(selected[1])}`;
  document.getElementById('topic-display').textContent = topic;
  updateDiscussionStatus('waiting', `等待 ${selected.join(' 和 ')} 的初始回复...`);

  // Disable buttons during round
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  log(`讨论开始: ${selected.join(' vs ')}`, 'success');

  // Send topic to both AIs
  for (const ai of selected) {
    await sendToAI(ai, `Please share your thoughts on the following topic:\n\n${topic}`);
  }
}

function handleDiscussionResponse(aiType, content) {
  if (!discussionState.active) return;

  // Record this response in history
  discussionState.history.push({
    round: discussionState.currentRound,
    ai: aiType,
    type: discussionState.roundType,
    content: content
  });

  // Remove from pending
  discussionState.pendingResponses.delete(aiType);

  log(`讨论: ${aiType} 已回复 (第 ${discussionState.currentRound} 轮)`, 'success');

  // Check if all pending responses received
  if (discussionState.pendingResponses.size === 0) {
    onRoundComplete();
  } else {
    const remaining = Array.from(discussionState.pendingResponses).join(', ');
    updateDiscussionStatus('waiting', `等待 ${remaining}...`);
  }
}

function onRoundComplete() {
  log(`第 ${discussionState.currentRound} 轮完成`, 'success');
  updateDiscussionStatus('ready', `第 ${discussionState.currentRound} 轮完成，可以进入下一轮`);

  // Enable next round button
  document.getElementById('next-round-btn').disabled = false;
  document.getElementById('generate-summary-btn').disabled = false;
}

async function nextRound() {
  discussionState.currentRound++;
  const [ai1, ai2] = discussionState.participants;

  // Update UI
  document.getElementById('round-badge').textContent = `第 ${discussionState.currentRound} 轮`;
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  // Get previous round responses
  const prevRound = discussionState.currentRound - 1;
  const ai1Response = discussionState.history.find(
    h => h.round === prevRound && h.ai === ai1
  )?.content;
  const ai2Response = discussionState.history.find(
    h => h.round === prevRound && h.ai === ai2
  )?.content;

  if (!ai1Response || !ai2Response) {
    log('缺少上一轮的回复', 'error');
    return;
  }

  // Set pending responses
  discussionState.pendingResponses = new Set([ai1, ai2]);
  discussionState.roundType = 'cross-eval';

  updateDiscussionStatus('waiting', `交叉评价: ${ai1} 评价 ${ai2}，${ai2} 评价 ${ai1}...`);

  log(`第 ${discussionState.currentRound} 轮: 交叉评价开始`);

  // Send cross-evaluation requests
  // AI1 evaluates AI2's response
  const msg1 = `Here is ${capitalize(ai2)}'s response to the topic "${discussionState.topic}":

<${ai2}_response>
${ai2Response}
</${ai2}_response>

Please evaluate this response. What do you agree with? What do you disagree with? What would you add or change?`;

  // AI2 evaluates AI1's response
  const msg2 = `Here is ${capitalize(ai1)}'s response to the topic "${discussionState.topic}":

<${ai1}_response>
${ai1Response}
</${ai1}_response>

Please evaluate this response. What do you agree with? What do you disagree with? What would you add or change?`;

  await sendToAI(ai1, msg1);
  await sendToAI(ai2, msg2);
}

async function handleInterject() {
  const input = document.getElementById('interject-input');
  const message = input.value.trim();

  if (!message) {
    log('请输入要发送的消息', 'error');
    return;
  }

  if (!discussionState.active || discussionState.participants.length === 0) {
    log('当前没有进行中的讨论', 'error');
    return;
  }

  const btn = document.getElementById('interject-btn');
  btn.disabled = true;

  const [ai1, ai2] = discussionState.participants;

  log(`[插话] 正在获取双方最新回复...`);

  // Get latest responses from both participants
  const ai1Response = await getLatestResponse(ai1);
  const ai2Response = await getLatestResponse(ai2);

  if (!ai1Response || !ai2Response) {
    log(`[插话] 无法获取回复，请确保双方都已回复`, 'error');
    btn.disabled = false;
    return;
  }

  log(`[插话] 已获取双方回复，正在发送...`);

  // Send to AI1: user message + AI2's response
  const msg1 = `${message}

以下是 ${capitalize(ai2)} 的最新回复：

<${ai2}_response>
${ai2Response}
</${ai2}_response>`;

  // Send to AI2: user message + AI1's response
  const msg2 = `${message}

以下是 ${capitalize(ai1)} 的最新回复：

<${ai1}_response>
${ai1Response}
</${ai1}_response>`;

  await sendToAI(ai1, msg1);
  await sendToAI(ai2, msg2);

  log(`[插话] 已发送给双方（含对方回复）`, 'success');

  // Clear input
  input.value = '';
  btn.disabled = false;
}

async function generateSummary() {
  document.getElementById('generate-summary-btn').disabled = true;
  updateDiscussionStatus('waiting', '正在请求双方生成总结...');

  const [ai1, ai2] = discussionState.participants;

  // Build conversation history for summary
  let historyText = `主题: ${discussionState.topic}\n\n`;

  for (let round = 1; round <= discussionState.currentRound; round++) {
    historyText += `=== 第 ${round} 轮 ===\n\n`;
    const roundEntries = discussionState.history.filter(h => h.round === round);
    for (const entry of roundEntries) {
      historyText += `[${capitalize(entry.ai)}]:\n${entry.content}\n\n`;
    }
  }

  const summaryPrompt = `请对以下 AI 之间的讨论进行总结。请包含：
1. 主要共识点
2. 主要分歧点
3. 各方的核心观点
4. 总体结论

讨论历史：
${historyText}`;

  // Send to both AIs
  discussionState.roundType = 'summary';
  discussionState.pendingResponses = new Set([ai1, ai2]);

  log(`[Summary] 正在请求双方生成总结...`);
  await sendToAI(ai1, summaryPrompt);
  await sendToAI(ai2, summaryPrompt);

  // Wait for both responses, then show summary
  const checkForSummary = setInterval(async () => {
    if (discussionState.pendingResponses.size === 0) {
      clearInterval(checkForSummary);

      // Get both summaries
      const summaries = discussionState.history.filter(h => h.type === 'summary');
      const ai1Summary = summaries.find(s => s.ai === ai1)?.content || '';
      const ai2Summary = summaries.find(s => s.ai === ai2)?.content || '';

      log(`[Summary] 双方总结已生成`, 'success');
      showSummary(ai1Summary, ai2Summary);
    }
  }, 500);
}

function showSummary(ai1Summary, ai2Summary) {
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.remove('hidden');

  const [ai1, ai2] = discussionState.participants;

  // Handle empty summaries
  if (!ai1Summary && !ai2Summary) {
    log('警告: 未收到 AI 的总结内容', 'error');
  }

  // Build summary HTML - show both summaries side by side conceptually
  let html = `<div class="round-summary">
    <h4>双方总结对比</h4>
    <div class="summary-comparison">
      <div class="ai-response">
        <div class="ai-name ${ai1}">${capitalize(ai1)} 的总结：</div>
        <div>${escapeHtml(ai1Summary).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="ai-response">
        <div class="ai-name ${ai2}">${capitalize(ai2)} 的总结：</div>
        <div>${escapeHtml(ai2Summary).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
  </div>`;

  // Add round-by-round history
  html += `<div class="round-summary"><h4>完整讨论历史</h4>`;
  for (let round = 1; round <= discussionState.currentRound; round++) {
    const roundEntries = discussionState.history.filter(h => h.round === round && h.type !== 'summary');
    if (roundEntries.length > 0) {
      html += `<div style="margin-top:12px"><strong>第 ${round} 轮</strong></div>`;
      for (const entry of roundEntries) {
        const preview = entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : '');
        html += `<div class="ai-response">
          <div class="ai-name ${entry.ai}">${capitalize(entry.ai)}:</div>
          <div>${escapeHtml(preview).replace(/\n/g, '<br>')}</div>
        </div>`;
      }
    }
  }
  html += `</div>`;

  document.getElementById('summary-content').innerHTML = html;
  discussionState.active = false;
  log('讨论总结已生成', 'success');
}

function endDiscussion() {
  if (confirm('确定结束讨论吗？建议先生成总结。')) {
    resetDiscussion();
  }
}

function resetDiscussion() {
  discussionState = {
    active: false,
    topic: '',
    participants: [],
    currentRound: 0,
    history: [],
    pendingResponses: new Set(),
    roundType: null
  };

  // Reset UI
  document.getElementById('discussion-setup').classList.remove('hidden');
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.add('hidden');
  document.getElementById('discussion-topic').value = '';
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  log('讨论已结束');
}

function updateDiscussionStatus(state, text) {
  const statusEl = document.getElementById('discussion-status');
  statusEl.textContent = text;
  statusEl.className = 'discussion-status ' + state;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// File Upload Functions
// ============================================

function setupFileUpload() {
  addFileBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => addFile(file));
    fileInput.value = ''; // Reset for next selection
  });
}

function addFile(file) {
  // Check file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    log(`文件 ${file.name} 超过 10MB 限制`, 'error');
    return;
  }

  // Check for duplicates
  if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
    return;
  }

  selectedFiles.push(file);
  renderFileList();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = '';

  selectedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-name" title="${file.name}">${file.name}</span>
      <button class="remove-file" title="移除">&times;</button>
    `;
    item.querySelector('.remove-file').addEventListener('click', () => removeFile(index));
    fileList.appendChild(item);
  });
}

function clearFiles() {
  selectedFiles = [];
  renderFileList();
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        base64
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sendFilesToAI(aiType, files) {
  log(`${aiType}: 准备上传 ${files.length} 个文件...`);
  const fileDataArray = await Promise.all(files.map(readFileAsBase64));
  log(`${aiType}: 文件已编码，正在发送...`);

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'SEND_FILES', aiType, files: fileDataArray },
      (response) => {
        if (response?.success) {
          log(`${aiType}: 文件上传成功 (${files.length} 个)`, 'success');
        } else {
          log(`${aiType}: 文件上传失败 - ${response?.error || 'Unknown'}`, 'error');
        }
        resolve(response);
      }
    );
  });
}
