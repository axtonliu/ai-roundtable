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

  // File injection for Gemini. Gemini's UI changes frequently, so try the
  // supported browser surfaces in order: file input, paste, then drop.
  async function injectFiles(filesData) {
    console.log('[AI Panel] Gemini injecting files:', filesData.length);

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

    const beforeSnapshot = getUploadSnapshot(files);
    const attempts = [];

    if (await tryGeminiFileInputUpload(files, beforeSnapshot)) {
      console.log('[AI Panel] Gemini files injected via file input');
      return true;
    }
    attempts.push('file input');

    if (await tryGeminiPasteUpload(files, beforeSnapshot)) {
      console.log('[AI Panel] Gemini files injected via paste event');
      return true;
    }
    attempts.push('paste');

    if (await tryGeminiDropUpload(files, beforeSnapshot)) {
      console.log('[AI Panel] Gemini files injected via drop event');
      return true;
    }
    attempts.push('drop');

    throw new Error(`Gemini 文件上传未被页面接受（已尝试: ${attempts.join(', ')}）。请手动上传，或打开 Gemini 页面 console 查看 [AI Panel] Gemini upload 日志。`);
  }

  async function tryGeminiFileInputUpload(files, beforeSnapshot) {
    await revealGeminiFileInputs();

    const fileInputs = getFileInputCandidates(files);
    console.log('[AI Panel] Gemini file input candidates:', fileInputs.length);

    for (const fileInput of fileInputs) {
      try {
        const dataTransfer = createFileDataTransfer(files);
        fileInput.files = dataTransfer.files;
        dispatchFileInputEvents(fileInput, dataTransfer);

        if (await waitForGeminiUploadAccepted(files, beforeSnapshot, 8000)) {
          return true;
        }
      } catch (e) {
        console.log('[AI Panel] Gemini file input injection error:', e.message);
      }
    }

    return false;
  }

  async function revealGeminiFileInputs() {
    const beforeCount = document.querySelectorAll('input[type="file"]').length;
    const buttons = findUploadButtons();
    console.log('[AI Panel] Gemini upload buttons:', buttons.length, 'file inputs before:', beforeCount);

    for (const btn of buttons.slice(0, 4)) {
      clickElement(btn);
      await sleep(350);

      const menuItems = findUploadMenuItems();
      for (const item of menuItems.slice(0, 3)) {
        clickElement(item);
        await sleep(350);
        if (document.querySelectorAll('input[type="file"]').length > beforeCount) return;
      }

      if (document.querySelectorAll('input[type="file"]').length > beforeCount) return;
    }
  }

  function findUploadButtons() {
    const selectors = [
      'button[aria-label*="Add files" i]',
      'button[aria-label*="Upload" i]',
      'button[aria-label*="Attach" i]',
      'button[aria-label*="Add" i]',
      'button[aria-label*="file" i]',
      'button[mattooltip*="Add files" i]',
      'button[mattooltip*="Upload" i]',
      'button[mattooltip*="Attach" i]',
      'button[data-test-id*="upload" i]',
      'button[data-testid*="upload" i]'
    ];
    const matches = collectElements(selectors).filter(isVisible);
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(el => {
      if (!isVisible(el)) return false;
      const label = getElementLabel(el).toLowerCase();
      return /(add files|upload|attach|file|image|photo|添加文件|上传|附件|图片|照片)/i.test(label);
    });

    return uniqueElements([...matches, ...buttons]);
  }

  function findUploadMenuItems() {
    const selectors = [
      '[role="menuitem"]',
      '[role="option"]',
      'button',
      'li',
      '[data-test-id*="upload" i]',
      '[data-testid*="upload" i]'
    ];

    return collectElements(selectors).filter(el => {
      if (!isVisible(el)) return false;
      const label = getElementLabel(el).toLowerCase();
      return /(upload|files|file|device|computer|image|photo|上传|文件|本机|电脑|图片|照片)/i.test(label) &&
             !/(drive|camera|photos|notebook|google drive|相机|云端硬盘|notebooklm)/i.test(label);
    });
  }

  function getFileInputCandidates(files) {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const scored = inputs.map(input => ({ input, score: scoreFileInput(input, files) }))
      .filter(item => item.score > -Infinity)
      .sort((a, b) => b.score - a.score);

    return scored.map(item => item.input);
  }

  function scoreFileInput(input, files) {
    const accept = (input.getAttribute('accept') || '').toLowerCase();
    const label = getElementLabel(input).toLowerCase();
    let score = 0;

    if (!input.disabled) score += 10;
    if (input.multiple || files.length === 1) score += 10;
    if (/image|file|upload|attach|gemini|上传|文件|图片/.test(`${accept} ${label}`)) score += 20;
    if (!accept) score += 5;

    for (const file of files) {
      const type = (file.type || '').toLowerCase();
      const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
      if (!accept ||
          accept.includes(type) ||
          accept.includes(type.split('/')[0] + '/*') ||
          accept.includes(ext)) {
        score += 10;
      } else {
        score -= 30;
      }
    }

    return score;
  }

  async function tryGeminiPasteUpload(files, beforeSnapshot) {
    const target = findGeminiUploadTarget();
    if (!target) return false;

    const dataTransfer = createFileDataTransfer(files);
    target.focus?.();

    let event;
    try {
      event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      });
    } catch (err) {
      event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
    }

    target.dispatchEvent(event);
    return await waitForGeminiUploadAccepted(files, beforeSnapshot, 8000);
  }

  async function tryGeminiDropUpload(files, beforeSnapshot) {
    const target = findGeminiUploadTarget();
    if (!target) return false;

    const dataTransfer = createFileDataTransfer(files);
    const events = ['dragenter', 'dragover', 'drop'];

    for (const eventType of events) {
      const event = new DragEvent(eventType, {
        bubbles: true,
        cancelable: true,
        dataTransfer
      });
      target.dispatchEvent(event);
      await sleep(80);
    }

    return await waitForGeminiUploadAccepted(files, beforeSnapshot, 8000);
  }

  function dispatchFileInputEvents(fileInput, dataTransfer) {
    const eventOptions = { bubbles: true, cancelable: true, composed: true };
    fileInput.dispatchEvent(new Event('input', eventOptions));
    fileInput.dispatchEvent(new Event('change', eventOptions));
    fileInput.dispatchEvent(new CustomEvent('change', {
      ...eventOptions,
      detail: { files: dataTransfer.files }
    }));
  }

  function findGeminiUploadTarget() {
    const selectors = [
      '.ql-editor[contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'rich-textarea textarea',
      'textarea',
      'main',
      '.conversation-container'
    ];

    return collectElements(selectors).find(isVisible) || document.body;
  }

  function createFileDataTransfer(files) {
    const dataTransfer = new DataTransfer();
    files.forEach(file => dataTransfer.items.add(file));
    return dataTransfer;
  }

  async function waitForGeminiUploadAccepted(files, beforeSnapshot, maxWait) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const snapshot = getUploadSnapshot(files);
      if (snapshot.acceptedCount > beforeSnapshot.acceptedCount) return true;
      if (snapshot.hasFileName && !beforeSnapshot.hasFileName) return true;
      if (snapshot.hasAttachmentUi && snapshot.attachmentUiCount > beforeSnapshot.attachmentUiCount) return true;
      await sleep(250);
    }
    return false;
  }

  function getUploadSnapshot(files) {
    const text = document.body.innerText || '';
    const hasFileName = files.some(file => text.includes(file.name));
    const attachmentSelectors = [
      '[aria-label*="Remove" i]',
      '[aria-label*="Delete" i]',
      '[aria-label*="attached" i]',
      '[aria-label*="attachment" i]',
      '[data-test-id*="attachment" i]',
      '[data-testid*="attachment" i]',
      '[data-test-id*="file" i]',
      '[data-testid*="file" i]',
      'mat-chip',
      '[class*="attachment" i]',
      '[class*="file-chip" i]',
      '[class*="upload" i]'
    ];
    const attachmentUiCount = collectElements(attachmentSelectors).filter(isVisible).length;
    const acceptedCount = files.reduce((count, file) => count + (text.includes(file.name) ? 1 : 0), 0);

    return {
      acceptedCount,
      hasFileName,
      hasAttachmentUi: attachmentUiCount > 0,
      attachmentUiCount
    };
  }

  function getElementLabel(el) {
    if (!el) return '';
    return [
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('mattooltip'),
      el.getAttribute?.('data-testid'),
      el.getAttribute?.('data-test-id'),
      el.getAttribute?.('accept'),
      el.innerText,
      el.textContent
    ].filter(Boolean).join(' ');
  }

  function collectElements(selectors) {
    const elements = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!seen.has(el)) {
          seen.add(el);
          elements.push(el);
        }
      }
    }
    return elements;
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }

  function clickElement(el) {
    const eventOptions = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new PointerEvent('pointerup', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    } catch (err) {
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    }
    el.click?.();
  }

  console.log('[AI Panel] Gemini content script loaded');
})();
