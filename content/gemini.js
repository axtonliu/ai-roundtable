// AI Panel - Gemini Content Script

(function() {
  'use strict';

  const AI_TYPE = 'gemini';
  const LOAD_FLAG = '__AIPanelContentLoaded_gemini';
  const LOAD_VERSION = chrome.runtime?.getManifest?.().version || 'unknown';
  if (window[LOAD_FLAG] === LOAD_VERSION) return;
  window[LOAD_FLAG] = LOAD_VERSION;

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
      '.ql-editor[contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="message" i]',
      'div[contenteditable="true"][aria-label*="Ask" i]',
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea textarea',
      'textarea[aria-label*="Type something" i]',
      'textarea[aria-label*="prompt"]',
      'textarea[placeholder*="Enter"]',
      '.input-area textarea',
      'div[contenteditable="true"]',
      'textarea'
    ];

    const inputEl = window.AIPanelDom?.findInputField(inputSelectors, { preferBottom: true });

    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    await window.AIPanelDom.setEditorText(inputEl, text, { afterInputDelay: 650 });
    const submitResult = await window.AIPanelDom.submitMessage(inputEl, {
      selectors: [
        'button[aria-label*="Send" i]',
        'button[aria-label*="Submit" i]',
        'button[aria-label*="Run" i]',
        'button[mattooltip*="Send" i]',
        'button[mattooltip*="Run" i]',
        'button[data-test-id*="send" i]',
        'button[data-testid*="send" i]',
        'button.send-button',
        '.input-area button',
        'button mat-icon[data-mat-icon-name="send"]'
      ],
      positivePattern: /(send|submit|run|发送|提交|运行)/i,
      enterFallback: true,
      maxWait: 7000,
      afterClickDelay: 900
    });

    // Start capturing response after sending
    console.log('[AI Panel] Gemini message sent via', submitResult.method, 'starting response capture...');
    waitForStreamingComplete();

    return true;
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
