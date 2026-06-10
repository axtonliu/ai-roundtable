// AI Panel - Background Service Worker

// URL patterns for each AI
const AI_URL_PATTERNS = {
  claude: ['claude.ai'],
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com']
};

const CONTENT_SCRIPT_FILES = {
  claude: ['content/dom-utils.js', 'content/claude.js'],
  chatgpt: ['content/chatgpt.js'],
  gemini: ['content/dom-utils.js', 'content/gemini.js']
};

// Store latest responses using chrome.storage.session (persists across service worker restarts)
async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  return result.latestResponses || { claude: null, chatgpt: null, gemini: null };
}

async function setStoredResponse(aiType, content) {
  const responses = await getStoredResponses();
  responses[aiType] = content;
  await chrome.storage.session.set({ latestResponses: responses });
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Listen for messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'SEND_MESSAGE':
      return await sendMessageToAI(message.aiType, message.message);

    case 'SEND_FILES':
      return await sendFilesToAI(message.aiType, message.files);

    case 'GET_RESPONSE':
      // Query content script directly for real-time response (not from storage)
      return await getResponseFromContentScript(message.aiType);

    case 'RESPONSE_CAPTURED':
      // Content script captured a response
      await setStoredResponse(message.aiType, message.content);
      // Forward to side panel (include content for discussion mode)
      notifySidePanel('RESPONSE_CAPTURED', { aiType: message.aiType, content: message.content });
      return { success: true };

    case 'CONTENT_SCRIPT_READY':
      // Content script loaded and ready
      const aiType = getAITypeFromUrl(sender.tab?.url);
      if (aiType) {
        notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: true });
      }
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

async function getResponseFromContentScript(aiType) {
  try {
    const tab = await findAITab(aiType);
    if (!tab) {
      // Fallback to stored response if tab not found
      const responses = await getStoredResponses();
      return { content: responses[aiType] };
    }

    // Query content script for real-time DOM content
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_LATEST_RESPONSE'
    });

    return { content: response?.content || null };
  } catch (err) {
    // Fallback to stored response on error
    console.log('[AI Panel] Failed to get response from content script:', err.message);
    const responses = await getStoredResponses();
    return { content: responses[aiType] };
  }
}

async function sendMessageToAI(aiType, message) {
  try {
    // Find the tab for this AI
    const tab = await findAITab(aiType);

    if (!tab) {
      return { success: false, error: `No ${aiType} tab found` };
    }

    console.log('[AI Panel] Sending message to', aiType, 'tab:', tab.url);

    const response = await sendMessageToContentScript(tab, aiType, {
      type: 'INJECT_MESSAGE',
      message
    });

    // Notify side panel
    notifySidePanel('SEND_RESULT', {
      aiType,
      success: response?.success,
      error: response?.error
    });

    return response;
  } catch (err) {
    notifySidePanel('SEND_RESULT', {
      aiType,
      success: false,
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

async function sendMessageToContentScript(tab, aiType, payload) {
  try {
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (err) {
    if (!shouldRetryContentScriptError(err)) throw err;

    console.log('[AI Panel] Content script missing/stale for', aiType, 'injecting into tab:', tab.url);
    await injectContentScripts(tab.id, aiType);
    await sleep(250);
    return await chrome.tabs.sendMessage(tab.id, payload);
  }
}

function shouldRetryContentScriptError(err) {
  const message = err?.message || '';
  return message.includes('Receiving end does not exist') ||
         message.includes('Extension context invalidated') ||
         message.includes('Could not establish connection');
}

async function injectContentScripts(tabId, aiType) {
  const files = CONTENT_SCRIPT_FILES[aiType];
  if (!files) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendFilesToAI(aiType, files) {
  console.log('[AI Panel] Background: sendFilesToAI called for', aiType, 'files:', files?.length);
  try {
    const tab = await findAITab(aiType);

    if (!tab) {
      console.log('[AI Panel] Background: No tab found for', aiType);
      return { success: false, error: `No ${aiType} tab found` };
    }

    console.log('[AI Panel] Background: Sending INJECT_FILES to tab', tab.id);
    // Send files to content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'INJECT_FILES',
      files
    });

    console.log('[AI Panel] Background: Response from content script:', response);
    return response;
  } catch (err) {
    console.log('[AI Panel] Background: sendFilesToAI error:', err.message);
    return { success: false, error: err.message };
  }
}

async function findAITab(aiType) {
  const patterns = AI_URL_PATTERNS[aiType];
  if (!patterns) return null;

  const tabs = await chrome.tabs.query({});
  const scoredTabs = [];

  for (const tab of tabs) {
    const score = scoreAITab(aiType, tab);
    if (score > -Infinity) {
      scoredTabs.push({ tab, score });
    }
  }

  scoredTabs.sort((a, b) => b.score - a.score);
  return scoredTabs[0]?.tab || null;
}

function scoreAITab(aiType, tab) {
  if (!tab.url) return -Infinity;

  let url;
  try {
    url = new URL(tab.url);
  } catch (err) {
    return -Infinity;
  }

  const patterns = AI_URL_PATTERNS[aiType];
  if (!patterns?.some(p => url.hostname.includes(p))) return -Infinity;

  let score = 0;
  if (tab.active) score += 30;
  if (!tab.discarded) score += 10;
  if (typeof tab.lastAccessed === 'number') {
    score += Math.min(20, Math.max(0, tab.lastAccessed / Date.now()) * 20);
  }

  if (aiType === 'claude') {
    if (url.hostname !== 'claude.ai') return -Infinity;

    // Claude Design and static/documentation surfaces also live under
    // claude.ai but do not expose the normal chat composer.
    if (url.pathname.startsWith('/design/')) return -Infinity;
    if (url.pathname.startsWith('/settings')) return -Infinity;

    if (url.pathname.startsWith('/chat/')) score += 120;
    else if (url.pathname === '/new' || url.pathname === '/') score += 100;
    else score += 20;
  }

  if (aiType === 'chatgpt') {
    if (url.pathname.startsWith('/c/')) score += 100;
    else score += 30;
  }

  if (aiType === 'gemini') {
    if (url.pathname.includes('/app/')) score += 100;
    else score += 30;
  }

  return score;
}

function getAITypeFromUrl(url) {
  if (!url) return null;
  for (const [aiType, patterns] of Object.entries(AI_URL_PATTERNS)) {
    if (patterns.some(p => url.includes(p))) {
      return aiType;
    }
  }
  return null;
}

async function notifySidePanel(type, data) {
  try {
    await chrome.runtime.sendMessage({ type, ...data });
  } catch (err) {
    // Side panel might not be open, ignore
  }
}

// Track tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const aiType = getAITypeFromUrl(tab.url);
    if (aiType) {
      notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: true });
    }
  }
});

// Track tab closures
chrome.tabs.onRemoved.addListener((tabId) => {
  // We'd need to track which tabs were AI tabs to notify properly
  // For now, side panel will re-check on next action
});
