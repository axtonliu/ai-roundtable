// AI Panel - shared DOM helpers for AI web chat pages

(function() {
  'use strict';

  if (window.AIPanelDom) return;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect?.();
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           (!rect || rect.width > 0 || rect.height > 0);
  }

  function isDisabled(el) {
    return Boolean(
      el?.disabled ||
      el?.hasAttribute?.('disabled') ||
      el?.getAttribute?.('aria-disabled') === 'true' ||
      el?.closest?.('[aria-disabled="true"]')
    );
  }

  function getNodeLabel(el) {
    if (!el) return '';
    const icon = el.querySelector?.('mat-icon, [data-mat-icon-name], svg[aria-label], svg[title]');
    return [
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('mattooltip'),
      el.getAttribute?.('data-testid'),
      el.getAttribute?.('data-test-id'),
      el.getAttribute?.('data-tooltip'),
      icon?.getAttribute?.('aria-label'),
      icon?.getAttribute?.('title'),
      icon?.getAttribute?.('data-mat-icon-name'),
      icon?.textContent,
      el.innerText,
      el.textContent
    ].filter(Boolean).join(' ').trim();
  }

  function getElementText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return el.value || '';
    }
    return el.innerText || el.textContent || '';
  }

  function dispatchInput(el, inputType, data) {
    let event;
    try {
      event = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType,
        data
      });
    } catch (err) {
      event = new Event('input', { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(event);
  }

  function dispatchBeforeInput(el, inputType, data) {
    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType,
        data
      }));
    } catch (err) {
      // beforeinput is best-effort for rich text editors.
    }
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');

    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function selectElementContents(el) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function setSelectionToEnd(el) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function activateElement(el) {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });

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
    el.focus();
  }

  function setEditableFallback(el, text) {
    const paragraphs = String(text).split('\n').map(line => {
      const div = document.createElement('div');
      div.textContent = line || '\u00a0';
      return `<p>${div.innerHTML}</p>`;
    }).join('');
    el.innerHTML = paragraphs || '<p><br></p>';
  }

  async function setEditorText(el, text, options = {}) {
    if (!el) throw new Error('Input element is required');

    activateElement(el);

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setNativeValue(el, '');
      dispatchBeforeInput(el, 'deleteContentBackward', null);
      dispatchInput(el, 'deleteContentBackward', null);
      setNativeValue(el, text);
      dispatchBeforeInput(el, 'insertText', text);
      dispatchInput(el, 'insertText', text);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      selectElementContents(el);

      let inserted = false;
      try {
        if (document.execCommand) {
          document.execCommand('selectAll', false, null);
          dispatchBeforeInput(el, 'deleteContentBackward', null);
          document.execCommand('delete', false, null);
          dispatchBeforeInput(el, 'insertText', text);
          inserted = document.execCommand('insertText', false, text);
        }
      } catch (err) {
        inserted = false;
      }

      if (!inserted || getElementText(el).trim() !== String(text).trim()) {
        setEditableFallback(el, text);
      }

      setSelectionToEnd(el);
      dispatchInput(el, 'insertText', text);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await sleep(options.afterInputDelay ?? 400);
  }

  function findInputField(selectors, options = {}) {
    const candidates = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        seen.add(el);
        candidates.push(el);
      }
    }

    let best = null;
    let bestScore = -Infinity;

    for (const el of candidates) {
      if (!isVisible(el) || isDisabled(el)) continue;

      const label = getNodeLabel(el).toLowerCase();
      const rect = el.getBoundingClientRect?.();
      let score = 0;

      if (el.tagName === 'TEXTAREA') score += 10;
      const contentEditable = el.getAttribute?.('contenteditable');
      if (el.isContentEditable || (contentEditable && contentEditable !== 'false')) score += 10;
      if (el.getAttribute?.('role') === 'textbox') score += 10;
      if (/prompt|message|ask|type|chat|claude|gemini|输入|消息/.test(label)) score += 20;
      if (options.preferBottom && rect) score += Math.max(0, rect.top / Math.max(window.innerHeight, 1)) * 10;

      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }

    return best;
  }

  function getSearchRoots(inputEl) {
    const roots = [];
    const seen = new Set();
    const selectors = [
      'form',
      'fieldset',
      '[role="form"]',
      '[data-testid*="composer" i]',
      '[class*="composer" i]',
      '[class*="input" i]'
    ];

    for (const selector of selectors) {
      const root = inputEl?.closest?.(selector);
      if (root && !seen.has(root)) {
        roots.push(root);
        seen.add(root);
      }
    }

    roots.push(document);
    return roots;
  }

  function normalizeButton(el) {
    if (!el) return null;
    return el.matches?.('button, [role="button"]') ? el : el.closest?.('button, [role="button"]');
  }

  function scoreSubmitButton(btn, inputEl, positivePattern, negativePattern, allowUnlabeledNearInput = false) {
    if (!btn || !isVisible(btn)) return -Infinity;

    const label = getNodeLabel(btn).toLowerCase();
    const positive = positivePattern || /(send|submit|run|发送|提交)/i;
    const negative = negativePattern || /(stop|cancel|voice|mic|microphone|upload|attach|image|file|menu|settings|stop generating|停止|取消|上传|附件|麦克风)/i;
    const hasPositiveSignal = positive.test(label) || btn.type === 'submit';

    let score = 0;

    if (!hasPositiveSignal && !allowUnlabeledNearInput) return -Infinity;

    if (positive.test(label)) score += 70;
    if (btn.type === 'submit') score += 30;
    if (/send|submit|run/.test(label)) score += 20;
    if (negative.test(label) && !positive.test(label)) score -= 80;
    if (!isDisabled(btn)) score += 15;
    if (isDisabled(btn)) score -= 30;

    const btnRect = btn.getBoundingClientRect?.();
    const inputRect = inputEl?.getBoundingClientRect?.();
    if (btnRect && inputRect) {
      const verticalDistance = Math.abs((btnRect.top + btnRect.bottom) / 2 - (inputRect.top + inputRect.bottom) / 2);
      const horizontalAfterInput = btnRect.left >= inputRect.left - 20;
      score += Math.max(0, 40 - verticalDistance / 4);
      if (horizontalAfterInput) score += 10;
      if (btnRect.bottom > window.innerHeight - 220) score += 10;
    }

    return score;
  }

  function findSubmitButton(options = {}) {
    const {
      inputEl,
      selectors = [],
      positivePattern,
      negativePattern,
      requireEnabled = false
    } = options;

    const candidates = [];
    const seen = new Set();

    for (const root of getSearchRoots(inputEl)) {
      for (const selector of selectors) {
        for (const raw of root.querySelectorAll(selector)) {
          const btn = normalizeButton(raw);
          if (!btn || seen.has(btn)) continue;
          seen.add(btn);
          candidates.push(btn);
        }
      }
      for (const raw of root.querySelectorAll('button, [role="button"]')) {
        const btn = normalizeButton(raw);
        if (!btn || seen.has(btn)) continue;
        seen.add(btn);
        candidates.push(btn);
      }
    }

    let best = null;
    let bestScore = -Infinity;

    for (const btn of candidates) {
      if (requireEnabled && isDisabled(btn)) continue;
      const score = scoreSubmitButton(
        btn,
        inputEl,
        positivePattern,
        negativePattern,
        options.allowUnlabeledNearInput
      );
      if (score > bestScore) {
        best = btn;
        bestScore = score;
      }
    }

    return bestScore >= 15 ? best : null;
  }

  async function waitForSubmitButton(options = {}, maxWait = 6000) {
    const start = Date.now();
    let lastButton = null;

    while (Date.now() - start < maxWait) {
      const button = findSubmitButton({ ...options, requireEnabled: false });
      if (button) lastButton = button;

      const enabledButton = findSubmitButton({ ...options, requireEnabled: true });
      if (enabledButton && !isDisabled(enabledButton)) return enabledButton;

      await sleep(100);
    }

    return lastButton && !isDisabled(lastButton) ? lastButton : null;
  }

  function clickElement(el) {
    const eventOptions = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new PointerEvent('pointerup', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    } catch (err) {
      // PointerEvent is not available in every execution context.
      el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    }
    el.click();
  }

  function pressEnter(el) {
    el.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
    }
  }

  async function submitMessage(inputEl, options = {}) {
    const beforeText = getElementText(inputEl).trim();
    const button = await waitForSubmitButton(options, options.maxWait ?? 6000);

    if (button) {
      clickElement(button);
      await sleep(options.afterClickDelay ?? 700);

      const remainingText = getElementText(inputEl).trim();
      if (options.enterFallback !== false && beforeText && remainingText === beforeText) {
        pressEnter(inputEl);
        await sleep(options.afterEnterDelay ?? 500);
        await verifySubmissionStarted(inputEl, beforeText, options);
        return { method: 'button+enter-fallback' };
      }

      await verifySubmissionStarted(inputEl, beforeText, options);
      return { method: 'button' };
    }

    if (options.enterFallback !== false) {
      pressEnter(inputEl);
      await sleep(options.afterEnterDelay ?? 500);
      await verifySubmissionStarted(inputEl, beforeText, options);
      return { method: 'enter' };
    }

    throw new Error('Could not find enabled send button');
  }

  async function verifySubmissionStarted(inputEl, beforeText, options = {}) {
    if (options.verifySubmitted === false || !beforeText) return true;

    const start = Date.now();
    const maxWait = options.verifyMaxWait ?? 2500;
    while (Date.now() - start < maxWait) {
      const currentText = getElementText(inputEl).trim();
      if (!currentText || currentText !== beforeText) return true;

      if (options.submittingSelectors?.some(selector => document.querySelector(selector))) {
        return true;
      }

      if (!document.contains(inputEl)) return true;
      await sleep(100);
    }

    throw new Error('Submit did not start: input text remained unchanged after click/Enter');
  }

  window.AIPanelDom = {
    findInputField,
    setEditorText,
    submitMessage,
    findSubmitButton,
    waitForSubmitButton,
    isVisible,
    isDisabled,
    getElementText,
    getNodeLabel,
    _test: {
      scoreSubmitButton,
      dispatchInput,
      verifySubmissionStarted
    }
  };
})();
