// AI Panel - DeepSeek Content Script

(function() {
  'use strict';

  const AI_TYPE = 'deepseek';

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
          console.error('[AI Panel] DeepSeek injection error:', err);
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
      // DeepSeek uses textarea for input
      const inputSelectors = [
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="message"]',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="问DeepSeek"]',
        'textarea[class*="input"]',
        'textarea[class*="textarea"]',
        'div[contenteditable="true"]',
        'textarea'
      ];

      let inputEl = null;
      for (const selector of inputSelectors) {
        inputEl = document.querySelector(selector);
        if (inputEl && isVisible(inputEl)) {
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

      // Try Method 1: Press Enter in input field (most chat apps support this)
      const enterSuccess = await tryPressEnter(inputEl);
      if (!enterSuccess) {
        console.log('[AI Panel] DeepSeek: Enter key failed, trying click methods...');

        // Method 2: Find and click the send button
        const sendButton = findSendButton();
        if (sendButton) {
          const clickSuccess = await tryClickSendButton(sendButton);

          if (!clickSuccess) {
            // Fallback: Highlight the button to indicate user should click it
            sendButton.style.boxShadow = '0 0 10px 3px rgba(66, 153, 225, 0.6)';
            sendButton.style.transition = 'box-shadow 0.3s';

            setTimeout(() => {
              sendButton.style.boxShadow = '';
            }, 3000);
          }
        }
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

  function findSendButton() {
    // DeepSeek's send button selectors
    const selectors = [
      'div.ds-icon-button[role="button"]',  // DeepSeek specific
      'div[class*="ds-icon-button"][role="button"]',  // Partial class match
      'div[class*="ds-icon-button"]',  // Any ds-icon-button
      'button[aria-label="Send"]',
      'button[aria-label="send"]',
      'button[type="submit"]',
      'button[class*="send"]',
      'button[class*="submit"]',
      'div[role="button"][class*="send"]',
      'svg[class*="send"]',
      'button:has(svg)'  // Button containing SVG icon
    ];

    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn && isVisible(btn)) {
        return btn;
      }
    }

    // Fallback: try to find any button that looks like a send button
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase() || '';
      const className = btn.className?.toLowerCase() || '';

      if (text.includes('send') || text.includes('发送') ||
          text.includes('提交') || text === '' ||  // Icon button
          className.includes('send') || className.includes('submit') ||
          className.includes('icon') || className.includes('button') ||
          className.includes('ds-icon')) {
        if (isVisible(btn)) {
          return btn;
        }
      }
    }

    return null;
  }

  async function tryPressEnter(inputElement) {
    console.log('[AI Panel] DeepSeek: Trying Enter key in input field...');

    try {
      // Make sure input is focused
      inputElement.focus();
      await sleep(50);

      // Method 1: Simple Enter key press
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      });

      inputElement.dispatchEvent(enterEvent);
      await sleep(50);

      // Keyup
      inputElement.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
      await sleep(100);

      // Keypress (deprecated but might be needed)
      inputElement.dispatchEvent(new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
      await sleep(200);

      console.log('[AI Panel] DeepSeek: Enter key pressed in input field');
      return true;
    } catch (e) {
      console.error('[AI Panel] DeepSeek: Enter key error:', e);
      return false;
    }
  }

  async function tryClickSendButton(button) {
    // All click methods have been tested and failed
    // The working method is pressing Enter in the input field
    // This function is kept as a fallback but will return false
    return false;
  }

  function setupResponseObserver() {
    // DeepSeek response detection
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
    // DeepSeek chat container selectors
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
    // Find assistant messages (DeepSeek's responses)
    const messageSelectors = [
      'div[class*="message"][class*="assistant"]',
      'div[class*="chat"] div[class*="assistant"]',
      'div[data-message-role="assistant"]',
      'div[class*="markdown"]',  // DeepSeek uses markdown for responses
      'div[class*="markdown-prose"]',  // Common markdown class
      'article',  // Some sites use article tag
      '[data-testid*="assistant"]',  // Test ID based
      '[data-message-id]'  // Message ID based
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
    // Wait for response to complete (DeepSeek streams responses)
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
