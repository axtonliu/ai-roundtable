// AI Panel - Claude Content Script

(function() {
  'use strict';

  const AI_TYPE = 'claude';

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
    // Claude uses a contenteditable div with ProseMirror
    const inputSelectors = [
      'div[contenteditable="true"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      '[data-placeholder="How can Claude help you today?"]',
      'fieldset div[contenteditable="true"]'
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

    // Clear existing content and set new text
    // For ProseMirror, we need to simulate typing or use clipboard
    inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;

    // Dispatch input event to trigger React state update
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));

    // Small delay to let React process
    await sleep(100);

    // Find and click the send button
    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    sendButton.click();

    // Start capturing response after sending
    console.log('[AI Panel] Claude message sent, starting response capture...');
    waitForStreamingComplete();

    return true;
  }

  function findSendButton() {
    // Claude's send button is typically an SVG arrow or button with specific attributes
    const selectors = [
      'button[aria-label="Send message"]',
      'button[aria-label="Send Message"]',
      'button[type="submit"]',
      'fieldset button:last-of-type',
      'button svg[viewBox]' // Button containing an SVG
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        // If we found an SVG, get its parent button
        return el.closest('button') || el;
      }
    }

    // Fallback: find button near the input
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.querySelector('svg') && isVisible(btn)) {
        const rect = btn.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 200) {
          return btn;
        }
      }
    }

    return null;
  }

  function setupResponseObserver() {
    // Watch for new responses in the conversation
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

    // Start observing once the main content area is available
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
      '[data-is-streaming]',
      '.font-claude-message',
      '[class*="response"]'
    ];

    for (const selector of responseSelectors) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        console.log('[AI Panel] Claude detected new response...');
        waitForStreamingComplete();
        break;
      }
    }
  }

  async function waitForStreamingComplete() {
    if (isCapturing) {
      console.log('[AI Panel] Claude already capturing, skipping...');
      return;
    }
    isCapturing = true;

    let previousContent = '';
    let stableCount = 0;
    const maxWait = 600000;  // 10 minutes - AI responses can be very long
    const checkInterval = 500;
    const stableThreshold = 4;  // 2 seconds of stable content

    const startTime = Date.now();

    try {
      while (Date.now() - startTime < maxWait) {
        if (!isContextValid()) {
          console.log('[AI Panel] Context invalidated, stopping capture');
          return;
        }

        await sleep(checkInterval);

        const isStreaming = document.querySelector('[data-is-streaming="true"]') ||
                           document.querySelector('button[aria-label*="Stop"]');

        const currentContent = getLatestResponse() || '';

        if (!isStreaming && currentContent === previousContent && currentContent.length > 0) {
          stableCount++;
          if (stableCount >= stableThreshold) {
            if (currentContent !== lastCapturedContent) {
              lastCapturedContent = currentContent;
              safeSendMessage({
                type: 'RESPONSE_CAPTURED',
                aiType: AI_TYPE,
                content: currentContent
              });
              console.log('[AI Panel] Claude response captured, length:', currentContent.length);
            }
            return;
          }
        } else {
          stableCount = 0;
        }

        previousContent = currentContent;
      }
    } finally {
      isCapturing = false;
    }
  }

  function getLatestResponse() {
    // Find the latest response container
    const responseContainers = document.querySelectorAll('[data-is-streaming="false"]');

    if (responseContainers.length === 0) return null;

    const lastContainer = responseContainers[responseContainers.length - 1];

    // Find all .standard-markdown blocks within this response
    const allBlocks = lastContainer.querySelectorAll('.standard-markdown');

    // Filter out thinking blocks:
    // Thinking blocks are inside containers with overflow-hidden and max-h-[238px]
    // or inside elements with "Thought process" button
    const responseBlocks = Array.from(allBlocks).filter(block => {
      // Check if this block is inside a thinking container
      const thinkingContainer = block.closest('[class*="overflow-hidden"][class*="max-h-"]');
      if (thinkingContainer) return false;

      // Check if ancestor has "Thought process" text
      const parent = block.closest('.font-claude-response');
      if (parent) {
        const buttons = parent.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.includes('Thought process') ||
              btn.textContent.includes('思考过程')) {
            // Check if block is descendant of this button's container
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
      // Get the last non-thinking block
      const lastBlock = responseBlocks[responseBlocks.length - 1];
      return lastBlock.innerText.trim();
    }

    return null;
  }

  // Utility functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  console.log('[AI Panel] Claude content script loaded');
})();
