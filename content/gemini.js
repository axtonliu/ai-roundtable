// AI Panel - Gemini Content Script

(function() {
  'use strict';

  const AI_TYPE = 'gemini';

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

    if (message.type === 'INJECT_FILES') {
      console.log('[AI Panel] Gemini received INJECT_FILES message, files:', message.files?.length);
      injectFiles(message.files)
        .then(() => {
          console.log('[AI Panel] Gemini injectFiles completed successfully');
          sendResponse({ success: true });
        })
        .catch(err => {
          console.log('[AI Panel] Gemini injectFiles failed:', err.message);
          sendResponse({ success: false, error: err.message });
        });
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
    // Gemini uses a rich text editor (contenteditable or textarea)
    const inputSelectors = [
      '.ql-editor',
      'div[contenteditable="true"]',
      'rich-textarea textarea',
      'textarea[aria-label*="prompt"]',
      'textarea[placeholder*="Enter"]',
      '.input-area textarea',
      'textarea'
    ];

    let inputEl = null;
    for (const selector of inputSelectors) {
      inputEl = document.querySelector(selector);
      if (inputEl && isVisible(inputEl)) break;
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
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Contenteditable div (Quill editor or similar)
      inputEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Small delay to let the UI process
    await sleep(150);

    // Find and click the send button
    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button');
    }

    // Wait for button to be enabled
    await waitForButtonEnabled(sendButton);

    sendButton.click();

    // Start capturing response after sending
    console.log('[AI Panel] Gemini message sent, starting response capture...');
    waitForStreamingComplete();

    return true;
  }

  function findSendButton() {
    // Gemini's send button
    const selectors = [
      'button[aria-label*="Send"]',
      'button[aria-label*="submit"]',
      'button.send-button',
      'button[data-test-id="send-button"]',
      '.input-area button',
      'button mat-icon[data-mat-icon-name="send"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        return el.closest('button') || el;
      }
    }

    // Fallback: find button with send-related icon or near input
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      // Check for send icon or arrow
      if (btn.querySelector('mat-icon, svg') && isVisible(btn)) {
        const text = btn.textContent.toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('send') || ariaLabel.includes('send') ||
            text.includes('submit') || ariaLabel.includes('submit')) {
          return btn;
        }
      }
    }

    // Last resort: find button at bottom of page
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 150 && isVisible(btn)) {
        if (btn.querySelector('svg, mat-icon')) {
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
      const mainContent = document.querySelector('main, .conversation-container') || document.body;
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
  let isCapturing = false;  // Prevent multiple captures

  function checkForResponse(node) {
    // Skip if already capturing
    if (isCapturing) return;

    // Check if this node or its children contain a model response
    const isResponse = node.matches?.('.model-response-text, message-content') ||
                      node.querySelector?.('.model-response-text, message-content') ||
                      node.classList?.contains('model-response-text');

    if (isResponse) {
      console.log('[AI Panel] Gemini detected new response, waiting for completion...');
      waitForStreamingComplete();
    }
  }

  async function waitForStreamingComplete() {
    // Prevent multiple simultaneous captures
    if (isCapturing) {
      console.log('[AI Panel] Gemini already capturing, skipping...');
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

        const currentContent = getLatestResponse() || '';

        if (currentContent === previousContent && currentContent.length > 0) {
          stableCount++;
          if (stableCount >= stableThreshold) {
            if (currentContent !== lastCapturedContent) {
              lastCapturedContent = currentContent;
              safeSendMessage({
                type: 'RESPONSE_CAPTURED',
                aiType: AI_TYPE,
                content: currentContent
              });
              console.log('[AI Panel] Gemini response captured, length:', currentContent.length);
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
    // Gemini uses .model-response-text for AI responses
    const messages = document.querySelectorAll('.model-response-text');

    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      // Use innerText to preserve line breaks
      const content = lastMessage.innerText.trim();
      console.log('[AI Panel] Gemini response found, length:', content.length);
      return content;
    }

    // Fallback to message-content
    const fallback = document.querySelectorAll('message-content');
    if (fallback.length > 0) {
      const lastMessage = fallback[fallback.length - 1];
      const content = lastMessage.innerText.trim();
      console.log('[AI Panel] Gemini response (fallback), length:', content.length);
      return content;
    }

    console.log('[AI Panel] Gemini: no response found');
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
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  // File injection for Gemini
  // Note: Gemini has strict security measures and may not support programmatic file upload
  async function injectFiles(filesData) {
    console.log('[AI Panel] Gemini injecting files:', filesData.length);

    // Convert base64 to File objects
    const files = filesData.map(fileData => {
      const byteCharacters = atob(fileData.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: fileData.type });
      return new File([blob], fileData.name, { type: fileData.type });
    });

    // Find all file inputs
    const fileInputs = document.querySelectorAll('input[type="file"]');
    console.log('[AI Panel] Gemini found', fileInputs.length, 'file inputs');

    if (fileInputs.length === 0) {
      // Try to find and click the upload button to reveal file input
      const uploadButtonSelectors = [
        'button[aria-label*="Upload"]',
        'button[aria-label*="upload"]',
        'button[aria-label*="Add"]',
        'button[aria-label*="Attach"]',
        'button[aria-label*="image"]',
        'button[aria-label*="file"]'
      ];

      for (const selector of uploadButtonSelectors) {
        const btn = document.querySelector(selector);
        if (btn && isVisible(btn)) {
          console.log('[AI Panel] Gemini found upload button:', selector);
          btn.click();
          await sleep(500);
          break;
        }
      }
    }

    // Try again after clicking button
    const allInputs = document.querySelectorAll('input[type="file"]');
    console.log('[AI Panel] Gemini file inputs after button click:', allInputs.length);

    for (const fileInput of allInputs) {
      try {
        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        fileInput.files = dataTransfer.files;

        // Dispatch events
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

        console.log('[AI Panel] Gemini files set on input');
        await sleep(1000);

        // Check if upload was successful by looking for any new UI elements
        return true;
      } catch (e) {
        console.log('[AI Panel] Gemini input injection error:', e.message);
      }
    }

    // Gemini doesn't support programmatic file upload well
    // Return error with helpful message
    throw new Error('Gemini 暂不支持自动文件上传，请手动上传文件');
  }

  console.log('[AI Panel] Gemini content script loaded');
})();
