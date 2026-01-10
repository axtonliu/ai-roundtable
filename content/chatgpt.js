// AI Panel - ChatGPT Content Script

(function() {
  'use strict';

  const AI_TYPE = 'chatgpt';

  // Check if extension context is still valid
  function isContextValid() {
    return chrome.runtime && chrome.runtime.id;
  }

  // Safe message sender that checks context first
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

  // Notify background that content script is ready
  safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INJECT_MESSAGE') {
      injectMessage(message.message)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      const response = getLatestResponse();
      sendResponse({ content: response });
      return true;
    }
  });

  // Setup response observer for cross-reference feature
  setupResponseObserver();

  async function injectMessage(text) {
    // ChatGPT uses a textarea or contenteditable div
    const inputSelectors = [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'div[contenteditable="true"][data-placeholder]',
      'textarea[placeholder*="Message"]',
      'textarea'
    ];

    let inputEl = null;
    for (const selector of inputSelectors) {
      inputEl = document.querySelector(selector);
      if (inputEl) break;
    }

    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    // Focus the input
    inputEl.focus();

    // Handle different input types
    if (inputEl.tagName === 'TEXTAREA') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Contenteditable div
      inputEl.textContent = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Small delay to let React process
    await sleep(100);

    // Find and click the send button
    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    // Wait for button to be enabled
    await waitForButtonEnabled(sendButton);

    sendButton.click();

    // Start capturing response after sending
    console.log('[AI Panel] ChatGPT message sent, starting response capture...');
    waitForStreamingComplete();

    return true;
  }

  function findSendButton() {
    // ChatGPT's send button
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'form button[type="submit"]',
      'button svg path[d*="M15.192"]' // Arrow icon path
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        return el.closest('button') || el;
      }
    }

    // Fallback: find button near the input
    const form = document.querySelector('form');
    if (form) {
      const buttons = form.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.querySelector('svg') && isVisible(btn)) {
          return btn;
        }
      }
    }

    return null;
  }

  async function waitForButtonEnabled(button, maxWait = 2000) {
    const start = Date.now();
    while (button.disabled && Date.now() - start < maxWait) {
      await sleep(50);
    }
  }

  function setupResponseObserver() {
    const observer = new MutationObserver((mutations) => {
      // Check context validity in observer callback
      if (!isContextValid()) {
        observer.disconnect();
        return;
      }
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              checkForResponse(node);
            }
          }
        }
      }
    });

    const startObserving = () => {
      if (!isContextValid()) return;
      const mainContent = document.querySelector('main') || document.body;
      observer.observe(mainContent, {
        childList: true,
        subtree: true
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  let lastCapturedContent = '';
  let isCapturing = false;

  function checkForResponse(node) {
    if (isCapturing) return;

    const responseSelectors = [
      '[data-message-author-role="assistant"]',
      '.agent-turn',
      '[class*="assistant"]'
    ];

    for (const selector of responseSelectors) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        console.log('[AI Panel] ChatGPT detected new response...');
        waitForStreamingComplete();
        break;
      }
    }
  }

  async function waitForStreamingComplete() {
    console.log('[AI Panel] ChatGPT waitForStreamingComplete called, isCapturing:', isCapturing);

    if (isCapturing) {
      console.log('[AI Panel] ChatGPT already capturing, skipping...');
      return;
    }
    isCapturing = true;
    console.log('[AI Panel] ChatGPT starting capture loop...');

    let previousContent = '';
    let stableCount = 0;
    const maxWait = 600000;  // 10 minutes - AI responses can be very long
    const checkInterval = 500;
    const stableThreshold = 4;  // 2 seconds of stable content

    const startTime = Date.now();
    let firstContentTime = null;  // Track when we first see content

    try {
      while (Date.now() - startTime < maxWait) {
        if (!isContextValid()) {
          console.log('[AI Panel] Context invalidated, stopping capture');
          return;
        }

        await sleep(checkInterval);

        const currentContent = getLatestResponse() || '';

        // Track when content first appears
        if (currentContent.length > 0 && firstContentTime === null) {
          firstContentTime = Date.now();
          console.log('[AI Panel] ChatGPT first content detected, length:', currentContent.length);
        }

        // Debug: log every 10 seconds
        const elapsed = Date.now() - startTime;
        if (elapsed % 10000 < checkInterval) {
          console.log(`[AI Panel] ChatGPT check: contentLen=${currentContent.length}, stableCount=${stableCount}, elapsed=${Math.round(elapsed/1000)}s`);
        }

        // Content is stable when content unchanged and has content
        const contentStable = currentContent === previousContent && currentContent.length > 0;

        if (contentStable) {
          stableCount++;
          // Capture after 4 stable checks (2 seconds of stable content)
          if (stableCount >= stableThreshold) {
            if (currentContent !== lastCapturedContent) {
              lastCapturedContent = currentContent;
              console.log('[AI Panel] ChatGPT capturing response, length:', currentContent.length);
              safeSendMessage({
                type: 'RESPONSE_CAPTURED',
                aiType: AI_TYPE,
                content: currentContent
              });
              console.log('[AI Panel] ChatGPT response captured and sent!');
            } else {
              console.log('[AI Panel] ChatGPT content same as last capture, skipping');
            }
            return;
          }
        } else {
          stableCount = 0;
        }

        previousContent = currentContent;
      }
      console.log('[AI Panel] ChatGPT capture timeout after', maxWait/1000, 'seconds');
    } finally {
      isCapturing = false;
      console.log('[AI Panel] ChatGPT capture loop ended');
    }
  }

  function getLatestResponse() {
    // Find all assistant messages and get the last one
    // ChatGPT UI changes frequently, so we try multiple selectors
    const messageSelectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"] [class*="markdown"]',
      '[data-message-author-role="assistant"]',
      '.agent-turn .markdown',
      '[class*="agent-turn"] .markdown',
      '[data-testid*="conversation-turn"]:has([data-message-author-role="assistant"]) .markdown',
      '[data-testid*="conversation-turn"] .markdown',
      'article[data-testid*="conversation"] .markdown'
    ];

    let messages = [];
    for (const selector of messageSelectors) {
      messages = document.querySelectorAll(selector);
      if (messages.length > 0) break;
    }

    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      // Use innerText to preserve line breaks
      return lastMessage.innerText.trim();
    }

    return null;
  }

  // Utility functions
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  console.log('[AI Panel] ChatGPT content script loaded');
})();
