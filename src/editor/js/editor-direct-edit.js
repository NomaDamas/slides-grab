// editor-direct-edit.js — Style changes, direct save (debounced)

import { localFileUpdateBySlide, state } from './editor-state.js';
import { slideIframe } from './editor-dom.js';
import { currentSlideFile, getDirectSaveState, getSlideState, setStatus } from './editor-utils.js';
import { addChatMessage } from './editor-chat.js';
import { getSelectedObjectElement, renderObjectSelection, updateObjectEditorControls, readSelectedObjectStyleState } from './editor-select.js';

const MAX_HISTORY_ITEMS = 50;
const editHistoryBySlide = new Map();
const internalRestoreTimersBySlide = new Map();
const internalRestoreSlides = new Set();

export function serializeSlideDocument(doc) {
  if (!doc?.documentElement) return '';
  const documentElement = doc.documentElement.cloneNode(true);
  documentElement.querySelectorAll('[data-slides-grab-runtime]').forEach((node) => node.remove());
  documentElement.querySelectorAll('head > base[href="/slides/"]').forEach((node) => node.remove());
  documentElement.querySelectorAll('head > script').forEach((node) => {
    const source = node.textContent || '';
    if (source.includes("const prefix = '[slides-grab:image]'") && source.includes('validateAssetSource')) {
      node.remove();
    }
  });
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
  return `${doctype}\n${documentElement.outerHTML}`;
}

function getEditHistoryState(slide) {
  if (!editHistoryBySlide.has(slide)) {
    editHistoryBySlide.set(slide, {
      undoStack: [],
      redoStack: [],
    });
  }
  return editHistoryBySlide.get(slide);
}

function pushUndoSnapshot(slide, beforeHtml, afterHtml) {
  if (!slide || !beforeHtml || !afterHtml || beforeHtml === afterHtml) return;
  const history = getEditHistoryState(slide);
  history.undoStack.push(beforeHtml);
  if (history.undoStack.length > MAX_HISTORY_ITEMS) {
    history.undoStack.shift();
  }
  history.redoStack = [];
}

function markInternalDocumentRestore(slide) {
  if (!slide) return;
  internalRestoreSlides.add(slide);

  const existingTimer = internalRestoreTimersBySlide.get(slide);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    internalRestoreTimersBySlide.delete(slide);
    internalRestoreSlides.delete(slide);
  }, 1000);
  internalRestoreTimersBySlide.set(slide, timer);
}

export function consumeInternalDocumentRestore(slide) {
  if (!slide || !internalRestoreSlides.has(slide)) return false;

  const timer = internalRestoreTimersBySlide.get(slide);
  if (timer) {
    window.clearTimeout(timer);
  }
  internalRestoreTimersBySlide.delete(slide);
  internalRestoreSlides.delete(slide);
  return true;
}

export function recordDirectEditHistory(beforeHtml) {
  const slide = currentSlideFile();
  const afterHtml = serializeSlideDocument(slideIframe.contentDocument);
  pushUndoSnapshot(slide, beforeHtml, afterHtml);
}

function restoreSlideDocumentHtml(slide, html, message) {
  const doc = slideIframe.contentDocument;
  if (!slide || !doc || !html) return false;

  markInternalDocumentRestore(slide);
  doc.open();
  doc.write(html);
  doc.close();

  const ss = getSlideState(slide);
  if (ss.selectedObjectXPath && !getSelectedObjectElement(slide)) {
    ss.selectedObjectXPath = '';
  }
  state.hoveredObjectXPath = '';
  renderObjectSelection();
  updateObjectEditorControls();
  scheduleDirectSave(0, message);
  setStatus(message);
  return true;
}

function restoreHistorySnapshot(direction) {
  const slide = currentSlideFile();
  if (!slide) return false;
  const history = getEditHistoryState(slide);
  const sourceStack = direction === 'redo' ? history.redoStack : history.undoStack;
  const targetStack = direction === 'redo' ? history.undoStack : history.redoStack;
  const html = sourceStack.pop();
  if (!html) return false;

  const currentHtml = serializeSlideDocument(slideIframe.contentDocument);
  if (currentHtml) {
    targetStack.push(currentHtml);
    if (targetStack.length > MAX_HISTORY_ITEMS) {
      targetStack.shift();
    }
  }

  return restoreSlideDocumentHtml(
    slide,
    html,
    direction === 'redo' ? 'Redo applied and saved.' : 'Undo applied and saved.',
  );
}

export function undoDirectEdit() {
  return restoreHistorySnapshot('undo');
}

export function redoDirectEdit() {
  return restoreHistorySnapshot('redo');
}

export function clearDirectEditHistory(slide) {
  if (!slide) return;
  editHistoryBySlide.delete(slide);
}

async function persistDirectSlideHtml(slide, html, message) {
  if (!slide || !html) return;

  try {
    const res = await fetch(`/api/slides/${encodeURIComponent(slide)}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide, html }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Save failed with HTTP ${res.status}`);
    }

    localFileUpdateBySlide.set(slide, Date.now());
    if (slide === currentSlideFile()) {
      setStatus(message || `${slide} saved.`);
    }
  } catch (error) {
    addChatMessage('error', `[${slide}] Direct edit save failed: ${error.message}`, slide);
    setStatus(`Error: ${error.message}`);
  }
}

function queueDirectSave(slide, html, message) {
  const saveState = getDirectSaveState(slide);
  if (!html) return saveState.chain;
  saveState.chain = saveState.chain
    .catch(() => {})
    .then(() => persistDirectSlideHtml(slide, html, message));
  return saveState.chain;
}

export function scheduleDirectSave(delay = 0, message = 'Object updated and saved.') {
  const slide = currentSlideFile();
  const html = serializeSlideDocument(slideIframe.contentDocument);
  if (!slide || !html) return;

  const saveState = getDirectSaveState(slide);
  saveState.pendingHtml = html;
  saveState.pendingMessage = message;
  if (saveState.timer) {
    window.clearTimeout(saveState.timer);
  }
  saveState.timer = window.setTimeout(() => {
    saveState.timer = null;
    const nextHtml = saveState.pendingHtml;
    const nextMessage = saveState.pendingMessage;
    saveState.pendingHtml = '';
    queueDirectSave(slide, nextHtml, nextMessage);
  }, Math.max(0, delay));
}

export async function flushDirectSaveForSlide(slide) {
  if (!slide) return;

  const saveState = getDirectSaveState(slide);
  if (saveState.timer) {
    window.clearTimeout(saveState.timer);
    saveState.timer = null;
    const html = saveState.pendingHtml;
    const message = saveState.pendingMessage;
    saveState.pendingHtml = '';
    await queueDirectSave(slide, html, message);
    return;
  }

  await saveState.chain.catch(() => {});
}

export function applyTextDecorationToken(el, token, shouldEnable) {
  const frameWindow = slideIframe.contentWindow;
  const styles = frameWindow?.getComputedStyle ? frameWindow.getComputedStyle(el) : null;
  const parts = new Set(
    String(styles?.textDecorationLine || '')
      .split(/\s+/)
      .filter((part) => part === 'underline' || part === 'line-through'),
  );
  if (shouldEnable) {
    parts.add(token);
  } else {
    parts.delete(token);
  }
  el.style.textDecorationLine = parts.size > 0 ? Array.from(parts).join(' ') : 'none';
}

export function mutateSelectedObject(mutator, message, { delay = 0, preserveTextInput = false } = {}) {
  const selected = getSelectedObjectElement();
  if (!selected) return;
  const beforeHtml = serializeSlideDocument(slideIframe.contentDocument);
  mutator(selected);
  recordDirectEditHistory(beforeHtml);
  renderObjectSelection();
  updateObjectEditorControls({ preserveTextInput });
  scheduleDirectSave(delay, message);
  setStatus('Saving direct edit...');
}
