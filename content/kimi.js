// AI Panel - Kimi Content Script

(function() {
  'use strict';

  const AI_TYPE = 'kimi';

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
          console.error('[AI Panel] Kimi injection error:', err);
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
      // Kimi uses contenteditable div for input
      const inputSelectors = [
        'div.chat-input-editor[contenteditable="true"]',  // Kimi specific
        'div[contenteditable="true"][data-lexical-editor="true"]',  // Lexical editor
        'div[role="textbox"][contenteditable="true"]',  // Generic textbox
        'div[class*="chat-input-editor"][contenteditable="true"]',  // Partial class match
        'div[contenteditable="true"].chat-input-editor',  // Alternative format
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="message"]',
        'textarea[placeholder*="问Kimi"]',
        'div[contenteditable="true"]'
      ];

      let inputEl = null;
      let foundSelector = null;

      console.log('[AI Panel] Kimi: Searching for input box...');

      for (const selector of inputSelectors) {
        const el = document.querySelector(selector);
        console.log(`[AI Panel] Kimi: Testing selector "${selector}":`, el ? 'Found' : 'Not found');
        if (el && isVisible(el)) {
          inputEl = el;
          foundSelector = selector;
          console.log('[AI Panel] Kimi: Input box found with selector:', foundSelector);
          break;
        }
      }

      if (!inputEl) {
        throw new Error('Could not find input field');
      }

      // Focus the input
      inputEl.focus();
      console.log('[AI Panel] Kimi: Input focused');

      // Handle different input types
      if (inputEl.tagName === 'TEXTAREA') {
        // For textarea, use value setter
        inputEl.value = text;
        console.log('[AI Panel] Kimi: Text set for textarea');

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
        // Contenteditable div - use Clipboard API for Lexical editor
        console.log('[AI Panel] Kimi: Using Clipboard API for Lexical editor');

        // Focus the input
        inputEl.focus();

        // Use Clipboard API to paste text
        if (navigator.clipboard && window.ClipboardItem) {
          try {
            // Copy text to clipboard
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/plain': new Blob([text], { type: 'text/plain' })
              })
            ]);

            console.log('[AI Panel] Kimi: Text copied to clipboard');

            // Trigger paste
            await sleep(100);

            // Execute paste command
            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              dataType: 'text/plain',
              data: text
            });

            inputEl.dispatchEvent(pasteEvent);

            // Also try document.execCommand as fallback
            document.execCommand('paste');

            console.log('[AI Panel] Kimi: Paste executed, content:', inputEl.innerHTML);
          } catch (err) {
            console.error('[AI Panel] Kimi: Clipboard error:', err);
            // Fallback to manual typing simulation
            await simulateTyping(inputEl, text);
          }
        } else {
          // Fallback: simulate typing
          await simulateTyping(inputEl, text);
        }
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
      console.error('[AI Panel] Kimi: Click error, may need manual click');
      // Highlight button if click fails
      button.style.boxShadow = '0 0 10px 3px rgba(66, 153, 225, 0.6)';
      setTimeout(() => {
        button.style.boxShadow = '';
      }, 3000);
    }
  }

  function findSendButton() {
    // Kimi send button selectors
    const selectors = [
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
        return btn;
      }
    }

    // Fallback: try to find any button that looks like a send button
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase() || '';
      const className = btn.className?.toLowerCase() || '';

      if (text.includes('send') || text.includes('发送') ||
          text.includes('提交') || text === '' ||
          className.includes('send') || className.includes('submit') ||
          className.includes('icon') || className.includes('button')) {
        if (isVisible(btn)) {
          return btn;
        }
      }
    }

    return null;
  }

  function setupResponseObserver() {
    // Kimi response detection
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
    // Kimi chat container selectors
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
    // Find assistant messages (Kimi's responses)
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
    // Wait for response to complete (Kimi streams responses)
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

  async function simulateTyping(element, text) {
    console.log('[AI Panel] Kimi: Simulating typing for text:', text);

    // Focus the element
    element.focus();
    await sleep(50);

    // Clear existing content
    element.innerHTML = '';
    await sleep(50);

    // Type each character
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Dispatch keydown event
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: char,
        code: 'Key' + char.toUpperCase(),
        keyCode: char.charCodeAt(0),
        which: char.charCodeAt(0),
        bubbles: true,
        cancelable: true
      }));

      // Insert character
      document.execCommand('insertText', false, char);

      // Dispatch keyup event
      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: char,
        code: 'Key' + char.toUpperCase(),
        keyCode: char.charCodeAt(0),
        which: char.charCodeAt(0),
        bubbles: true,
        cancelable: true
      }));

      // Small delay between characters
      await sleep(10);
    }

    // Dispatch input event after typing
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    console.log('[AI Panel] Kimi: Typing simulation complete, content:', element.innerHTML);
  }
})();
