// AI Panel - Qwen (通义千问) Content Script

(function() {
  'use strict';

  const AI_TYPE = 'qwen';

  // State tracking
  let isSending = false;
  let latestResponse = '';

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
        .then(() => {
          sendResponse({ success: true });
        })
        .catch(err => {
          console.error('[AI Panel] Qwen injection error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      const response = getLatestResponse();
      sendResponse({ content: response });
      return true;
    }

    return false;
  });

  // Setup response observer for cross-reference feature
  setupResponseObserver();

  // Ensure content script is ready even if page loads dynamically
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });
    });
  } else {
    safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });
  }

  async function injectMessage(text) {
    // Prevent duplicate sending
    if (isSending) {
      return false;
    }
    isSending = true;

    try {
      // Qwen uses textarea for input
      const inputSelectors = [
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="message"]',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="问通义"]',
        'textarea[placeholder*="和千问"]',
        'textarea[placeholder*="向通义提问"]',
        'textarea[placeholder*="发给通义千问"]',
        'textarea[class*="input"]',
        'textarea[class*="textarea"]',
        'div[contenteditable="true"]',
        'textarea'
      ];

      let inputEl = null;

      for (const selector of inputSelectors) {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          inputEl = el;
          break;
        }
      }

      if (!inputEl) {
        throw new Error('Could not find input field');
      }

      // Focus the input
      inputEl.focus();

      // Handle different input types
      if (inputEl.tagName === 'TEXTAREA') {
        // For textarea, use value setter
        inputEl.value = text;

        // Trigger React/Vue change events
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(inputEl, text);
        }

        // Dispatch events to trigger UI updates
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      } else {
        // Contenteditable div
        inputEl.textContent = text;
        inputEl.innerText = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('keyup', { bubbles: true }));
      }

      // Small delay to let the UI process
      await sleep(300);

      // Find the send button
      const sendButton = findSendButton();
      if (sendButton) {
        // Try to click send button
        await clickSendButton(sendButton);
      }

      // Start capturing response
      setTimeout(() => {
        waitForStreamingComplete();
      }, 2000);

      return true;
    } finally {
      // Reset sending state after a delay
      setTimeout(() => {
        isSending = false;
      }, 1000);
    }
  }

  async function clickSendButton(button) {
    // Try multiple methods to click the button
    try {
      // Method 1: Standard click
      button.click();
      await sleep(100);

      // Method 2: Mouse events
      const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
      const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });

      button.dispatchEvent(mouseDown);
      await sleep(50);
      button.dispatchEvent(mouseUp);
      await sleep(50);
      button.dispatchEvent(clickEvent);
    } catch (err) {
      console.error('[AI Panel] Qwen: Click error, may need manual click');
      // Highlight button if click fails
      button.style.boxShadow = '0 0 10px 3px rgba(66, 153, 225, 0.6)';
      setTimeout(() => {
        button.style.boxShadow = '';
      }, 3000);
    }
  }

  function findSendButton() {
    // Qwen send button selectors
    const selectors = [
      'span[data-icon-type="qwpcicon-sendChat"]',  // Qwen specific
      'div[class*="operateBtn"] span[data-icon-type="qwpcicon-sendChat"]',  // With container
      'svg use[xlink:href="#qwpcicon-sendChat"]',  // SVG use element
      'div[class*="operateBtn"]',  // Container itself
      'button[aria-label="Send"]',
      'button[aria-label="send"]',
      'button[aria-label="发送"]',
      'button[type="submit"]',
      'button[class*="send"]',
      'button[class*="submit"]',
      'div[role="button"][class*="send"]',
      'button:has(svg)'
    ];

    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn && isVisible(btn)) {
        // If it's use or svg element, return its container
        if (btn.tagName === 'USE' || btn.tagName === 'svg' || btn.tagName === 'SPAN') {
          const container = btn.closest('.operateBtn-JsB9e2') || btn.closest('div[class*="operateBtn"]') || btn.parentElement;
          if (container) {
            return container;
          }
        }
        return btn;
      }
    }

    // Fallback: try to find any button that looks like a send button
    const buttons = Array.from(document.querySelectorAll('button, div[class*="operateBtn"], span[data-icon-type], svg, use'));

    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase() || '';
      const className = btn.className?.toLowerCase() || '';
      const dataset = btn.dataset || {};

      if (text.includes('send') || text.includes('发送') ||
          text.includes('提交') || text === '' ||
          className.includes('operatebtn') || className.includes('send') ||
          className.includes('submit') || dataset?.iconType?.includes('sendChat')) {
        if (isVisible(btn)) {
          // If it's SVG/USE/SPAN, return container
          if (btn.tagName === 'USE' || btn.tagName === 'svg' || btn.tagName === 'SPAN') {
            const container = btn.closest('div[class*="operateBtn"]') || btn.parentElement;
            if (container) {
              return container;
            }
          }
          return btn;
        }
      }
    }

    console.error('[AI Panel] Qwen: No send button found!');
    return null;
  }

  function setupResponseObserver() {
    // Qwen response detection
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          checkForNewMessages();
        }
      }
    });

    // Start observing when DOM is ready
    const startObserving = () => {
      const chatContainer = findChatContainer();
      if (chatContainer) {
        observer.observe(chatContainer, {
          childList: true,
          subtree: true
        });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  function findChatContainer() {
    // Qwen chat container selectors
    const selectors = [
      'div[class*="chat"]',
      'div[class*="message"]',
      'div[class*="conversation"]',
      'main',
      '[role="main"]',
      'div[id*="chat"]',
      'div[id*="message"]'
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) {
        return container;
      }
    }

    return document.body;
  }

  function checkForNewMessages() {
    // Find assistant messages (Qwen's responses)
    const messageSelectors = [
      'div[class*="message"][class*="assistant"]',
      'div[class*="chat"] div[class*="assistant"]',
      'div[data-message-role="assistant"]',
      'div[class*="markdown"]',
      'div[class*="markdown-prose"]',
      'article',
      '[data-testid*="assistant"]',
      '[data-message-id]'
    ];

    for (const selector of messageSelectors) {
      const messages = document.querySelectorAll(selector);
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const text = extractText(lastMessage);

        if (text && text.length > 0) {
          latestResponse = text;
        }
      }
    }
  }

  function extractText(element) {
    // Extract text content, handling potential nested structures
    let text = element.textContent || element.innerText || '';
    return text.trim();
  }

  function getLatestResponse() {
    return latestResponse;
  }

  function waitForStreamingComplete() {
    // Wait for response to complete (Qwen streams responses)
    let lastLength = 0;
    let stableCount = 0;

    const checkInterval = setInterval(() => {
      checkForNewMessages();

      const currentLength = latestResponse.length;

      if (currentLength === lastLength) {
        stableCount++;
        // If content hasn't changed for 10 checks (2 seconds), consider complete
        if (stableCount >= 10) {
          clearInterval(checkInterval);
        }
      } else {
        stableCount = 0;
        lastLength = currentLength;
      }
    }, 200);

    // Timeout after 2 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 120000);
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           element.offsetParent !== null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
