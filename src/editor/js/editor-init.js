// editor-init.js — Entry point: imports, event bindings, init()

import { state, TOOL_MODE_DRAW, TOOL_MODE_SELECT, setSlideFrame } from './editor-state.js';
import {
  btnPrev, btnNext, slideIframe, slideWrapper, drawLayer, promptInput, modelSelect,
  imageProviderSelect,
  objectLayer,
  btnSend, btnClearBboxes, slideCounter,
  toggleBold, toggleItalic, toggleUnderline, toggleStrike,
  alignLeft, alignCenter, alignRight,
  popoverTextInput, popoverApplyText, popoverTextColorInput, popoverBgColorInput,
  popoverSizeInput, popoverApplySize, toolModeDrawBtn, toolModeSelectBtn,
} from './editor-dom.js';
import {
  currentSlideFile, getSlideState, normalizeModelName, setStatus,
  saveSelectedModel, loadModelOptions, clamp,
} from './editor-utils.js';
import { renderChatMessages } from './editor-chat.js';
import {
  onBboxChange, renderBboxes, scaleSlide, startDrawing, moveDrawing, endDrawing,
  clearBboxesForCurrentSlide, initBboxLayerEvents, getXPath,
} from './editor-bbox.js';
import {
  setToolMode, updateToolModeUI, renderObjectSelection, updateObjectEditorControls,
  getSelectedObjectElement, setSelectedObjectXPath, updateHoveredObjectFromPointer,
  clearHoveredObject, getSelectableTargetAt, readSelectedObjectStyleState,
  initObjectInteractionEvents, setObjectTransformCommitHandler, consumeObjectTransformClickSuppression,
} from './editor-select.js';
import {
  mutateSelectedObject, applyTextDecorationToken,
  scheduleDirectSave, recordDirectEditHistory, undoDirectEdit, redoDirectEdit, clearDirectEditHistory,
  consumeInternalDocumentRestore,
} from './editor-direct-edit.js';
import { updateSendState, applyChanges } from './editor-send.js';
import { goToSlide } from './editor-navigation.js';
import { connectSSE, loadRunsInitial } from './editor-sse.js';
import { configureEditorClient, getEditorClient, updateEditorClientLabels } from './editor-type.js';

// Late-binding: connect bbox changes to updateSendState
onBboxChange(updateSendState);

// Bbox layer events
initBboxLayerEvents();

// Navigation
btnPrev.addEventListener('click', () => { void goToSlide(state.currentIndex - 1); });
btnNext.addEventListener('click', () => { void goToSlide(state.currentIndex + 1); });

// Tool modes
toolModeDrawBtn.addEventListener('click', () => {
  setToolMode(TOOL_MODE_DRAW);
  updateEditorClientLabels();
});
toolModeSelectBtn.addEventListener('click', () => {
  setToolMode(TOOL_MODE_SELECT);
  updateEditorClientLabels();
});

// Clear bboxes
btnClearBboxes.addEventListener('click', clearBboxesForCurrentSlide);

// Drawing
drawLayer.addEventListener('mousedown', startDrawing);
drawLayer.addEventListener('mousemove', (event) => {
  if (state.toolMode !== TOOL_MODE_SELECT) return;
  updateHoveredObjectFromPointer(event.clientX, event.clientY);
});
drawLayer.addEventListener('mouseleave', clearHoveredObject);
drawLayer.addEventListener('click', (event) => {
  if (state.toolMode !== TOOL_MODE_SELECT) return;
  if (consumeObjectTransformClickSuppression()) return;
  if (event.target && event.target.closest && event.target.closest('.object-handle')) return;
  const target = getSelectableTargetAt(event.clientX, event.clientY);
  if (!target) {
    setSelectedObjectXPath('', 'No selectable object at this point.');
    return;
  }

  const xpath = getXPath(target);
  setSelectedObjectXPath(xpath, `Object selected on ${currentSlideFile()}.`);
});
if (objectLayer) {
  objectLayer.addEventListener('mousemove', (event) => {
    if (state.toolMode !== TOOL_MODE_SELECT) return;
    updateHoveredObjectFromPointer(event.clientX, event.clientY);
  });
  objectLayer.addEventListener('mouseleave', clearHoveredObject);
  objectLayer.addEventListener('click', (event) => {
    if (state.toolMode !== TOOL_MODE_SELECT) return;
    if (consumeObjectTransformClickSuppression()) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('.object-handle')) return;

    const selectable = getSelectableTargetAt(event.clientX, event.clientY);
    if (!selectable) {
      setSelectedObjectXPath('', 'No selectable object at this point.');
      return;
    }

    const xpath = getXPath(selectable);
    setSelectedObjectXPath(xpath, `Object selected on ${currentSlideFile()}.`);
  });
}
window.addEventListener('mousemove', moveDrawing);
window.addEventListener('mouseup', endDrawing);

initObjectInteractionEvents();
setObjectTransformCommitHandler(({ beforeHtml } = {}) => {
  recordDirectEditHistory(beforeHtml);
  scheduleDirectSave(300, 'Object geometry updated and saved.');
});

// Send
btnSend.addEventListener('click', applyChanges);

// Model select
modelSelect.addEventListener('change', () => {
  const nextModel = normalizeModelName(modelSelect.value);
  if (!state.availableModels.includes(nextModel)) {
    modelSelect.value = state.selectedModel;
    return;
  }

  const slide = currentSlideFile();
  if (slide) {
    const ss = getSlideState(slide);
    ss.model = nextModel;
  }
  state.selectedModel = nextModel;
  state.defaultModel = nextModel;
  saveSelectedModel(state.selectedModel);
  updateSendState();
  setStatus(`Model selected: ${state.selectedModel}`);
});

imageProviderSelect?.addEventListener('change', () => {
  state.imageProvider = imageProviderSelect.value || 'god-tibo';
  updateSendState();
  setStatus(`Image provider selected: ${state.imageProvider}`);
});

// Prompt input
promptInput.addEventListener('input', () => {
  const slide = currentSlideFile();
  if (slide) {
    const ss = getSlideState(slide);
    ss.prompt = promptInput.value;
  }
  updateSendState();
});

// Text editing
popoverApplyText.addEventListener('click', () => {
  if (popoverApplyText.disabled) return;
  mutateSelectedObject((el) => {
    const escaped = popoverTextInput.value
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    el.innerHTML = escaped.replace(/\n/g, '<br>');
  }, 'Object text updated and saved.', { delay: 120 });
});

popoverApplySize.addEventListener('click', () => {
  if (popoverApplySize.disabled) return;
  const size = clamp(Number.parseInt(popoverSizeInput.value || '24', 10) || 24, 8, 180);
  mutateSelectedObject((el) => {
    el.style.fontSize = `${size}px`;
  }, 'Object font size updated and saved.');
});

popoverTextInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    popoverApplyText.click();
  }
});

popoverSizeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    popoverApplySize.click();
  }
});

popoverTextColorInput.addEventListener('input', () => {
  if (popoverTextColorInput.disabled) return;
  mutateSelectedObject((el) => {
    el.style.color = popoverTextColorInput.value;
  }, 'Text color updated.', { delay: 300 });
});

popoverBgColorInput.addEventListener('input', () => {
  if (popoverBgColorInput.disabled) return;
  mutateSelectedObject((el) => {
    el.style.backgroundColor = popoverBgColorInput.value;
  }, 'Background color updated.', { delay: 300 });
});

function hasEditableFocus() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (activeElement.matches('input, textarea, select')) return true;
  return activeElement.isContentEditable;
}

// Style toggles
toggleBold.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    const nextBold = !readSelectedObjectStyleState(el).bold;
    el.style.fontWeight = nextBold ? '700' : '400';
  }, 'Object font weight updated and saved.');
});

toggleItalic.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    const nextItalic = !readSelectedObjectStyleState(el).italic;
    el.style.fontStyle = nextItalic ? 'italic' : 'normal';
  }, 'Object font style updated and saved.');
});

toggleUnderline.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    const nextUnderline = !readSelectedObjectStyleState(el).underline;
    applyTextDecorationToken(el, 'underline', nextUnderline);
  }, 'Object underline updated and saved.');
});

toggleStrike.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    const nextStrike = !readSelectedObjectStyleState(el).strike;
    applyTextDecorationToken(el, 'line-through', nextStrike);
  }, 'Object strikethrough updated and saved.');
});

// Alignment
alignLeft.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    el.style.textAlign = 'left';
  }, 'Object alignment updated and saved.');
});

alignCenter.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    el.style.textAlign = 'center';
  }, 'Object alignment updated and saved.');
});

alignRight.addEventListener('click', () => {
  mutateSelectedObject((el) => {
    el.style.textAlign = 'right';
  }, 'Object alignment updated and saved.');
});

// Global keyboard
document.addEventListener('keydown', (event) => {
  const inEditableField = hasEditableFocus();
  const key = event.key.toLowerCase();
  const canHandleHistoryShortcut = !inEditableField || document.activeElement?.matches?.('input[type="color"]');

  if (state.toolMode === TOOL_MODE_SELECT && (event.ctrlKey || event.metaKey) && canHandleHistoryShortcut) {
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        redoDirectEdit();
      } else {
        undoDirectEdit();
      }
      return;
    }

    if (key === 'y') {
      event.preventDefault();
      redoDirectEdit();
      return;
    }
  }

  if (state.toolMode === TOOL_MODE_SELECT && (event.ctrlKey || event.metaKey) && !inEditableField) {
    if (key === 'b') { event.preventDefault(); if (!toggleBold.disabled) toggleBold.click(); return; }
    if (key === 'i') { event.preventDefault(); if (!toggleItalic.disabled) toggleItalic.click(); return; }
    if (key === 'u') { event.preventDefault(); if (!toggleUnderline.disabled) toggleUnderline.click(); return; }
  }

  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    applyChanges();
    return;
  }

  if (event.key === 'Escape') {
    if (document.activeElement) document.activeElement.blur();
    return;
  }

  if (inEditableField) return;

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    void goToSlide(state.currentIndex - 1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    void goToSlide(state.currentIndex + 1);
  }
});

// Resize
window.addEventListener('resize', scaleSlide);

// Iframe load
slideIframe.addEventListener('load', () => {
  const slide = currentSlideFile();
  if (slide) {
    if (!consumeInternalDocumentRestore(slide)) {
      clearDirectEditHistory(slide);
    }
    const ss = getSlideState(slide);
    if (ss.selectedObjectXPath && !getSelectedObjectElement(slide)) {
      ss.selectedObjectXPath = '';
    }
  }
  state.hoveredObjectXPath = '';
  renderBboxes();
  renderObjectSelection();
  updateObjectEditorControls();
  updateSendState();
});

function applySlideFrameCss(width, height) {
  if (slideWrapper) {
    slideWrapper.style.width = `${width}px`;
    slideWrapper.style.height = `${height}px`;
  }
  if (slideIframe) {
    slideIframe.style.width = `${width}px`;
    slideIframe.style.height = `${height}px`;
  }
}

async function loadEditorConfig() {
  const serverAuthoredType = state.editorType;
  configureEditorClient(serverAuthoredType);
  let cfg = {};
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cfg = await res.json();
    if (cfg?.editorType !== serverAuthoredType) {
      throw new Error(`Editor type mismatch: page=${serverAuthoredType}, config=${cfg?.editorType || 'missing'}`);
    }
  } catch {
    // Keep the server-authored editor type and default frame dimensions.
  }

  const w = cfg?.framePx?.width;
  const h = cfg?.framePx?.height;
  if (w && h) {
    setSlideFrame(w, h);
    applySlideFrameCss(w, h);
  }
  if (cfg?.slideMode) {
    document.body.dataset.slideMode = cfg.slideMode;
  }
}

// Init
async function init() {
  setStatus('Loading slide list...');

  await loadEditorConfig();

  try {
    const res = await fetch('/api/slides');
    if (!res.ok) {
      throw new Error(`Failed to fetch slide list: ${res.status}`);
    }

    state.slides = await res.json();

    if (state.slides.length === 0) {
      setStatus('No slides found.');
      slideCounter.textContent = '0 / 0';
      return;
    }

    const editorClient = getEditorClient();
    if (editorClient.usesModel) await loadModelOptions();
    updateToolModeUI();
    updateEditorClientLabels();
    await goToSlide(0);
    scaleSlide();
    await loadRunsInitial();
    connectSSE();

    setStatus(editorClient.usesModel
      ? `Ready. Model: ${state.selectedModel}. Draw red pending bboxes, run Codex, then review green bboxes.`
      : `Ready. Image provider: ${state.imageProvider}. Draw red pending bboxes, then regenerate the image.`);
  } catch (error) {
    setStatus(`Error loading slides: ${error.message}`);
    console.error('Init error:', error);
  }
}

init();
