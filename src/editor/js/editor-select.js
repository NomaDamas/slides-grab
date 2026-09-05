// editor-select.js — Object selection, hover, tool mode UI

import { state, TOOL_MODE_DRAW, TOOL_MODE_SELECT, SLIDE_W, SLIDE_H, NON_SELECTABLE_TAGS, DIRECT_TEXT_TAGS } from './editor-state.js';
import {
  slideIframe, slidePanel, objectLayer, drawBox, toolModeDrawBtn, toolModeSelectBtn,
  bboxToolbar, selectToolbar, editorHint, objectSelectedBox, objectHoverBox,
  selectedObjectMini, miniTag, miniText, selectEmptyHint,
  toggleBold, toggleItalic, toggleUnderline, toggleStrike,
  alignLeft, alignCenter, alignRight,
  popoverTextInput, popoverApplyText, popoverTextColorInput, popoverBgColorInput,
  popoverSizeInput, popoverApplySize,
} from './editor-dom.js';
import {
  currentSlideFile, getSlideState, setStatus, clamp,
  normalizeHexColor, parsePixelValue, isBoldFontWeight,
} from './editor-utils.js';
import { renderBboxes, scaleSlide, clientToSlidePoint, getXPath } from './editor-bbox.js';
import { indexSlideObjects } from './editor-object-model.js';
import { serializeSlideDocument } from './editor-serialize.js';

const MIN_OBJECT_SIZE = 16;
const OBJECT_MOVE_EPSILON = 4;
const SLIDE_BACKGROUND_AREA_RATIO = 0.85;
const RESIZE_HANDLE_STYLES = new Set(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se', 'move']);

let objectTransform = null;
let commitObjectTransform = () => {};
let commitInlineTextEdit = () => {};
let suppressNextObjectClick = false;

export function setObjectTransformCommitHandler(callback) {
  commitObjectTransform = typeof callback === 'function' ? callback : (() => {});
}

export function setInlineTextEditCommitHandler(callback) {
  commitInlineTextEdit = typeof callback === 'function' ? callback : (() => {});
}

function isObjectTransformActive() {
  return Boolean(objectTransform);
}

function resolveObjectTransformTarget() {
  const selected = getSelectedObjectElement();
  if (!selected) return null;

  const rect = elementToSlideRect(selected);
  return rect ? { element: selected, rect } : null;
}

function clampObjectGeometry(base, dx, dy, handle = 'move') {
  const next = {
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
  };

  if (handle === 'move') {
    next.x = base.x + dx;
    next.y = base.y + dy;
  } else {
    if (handle.includes('w')) {
      next.x = base.x + dx;
      next.width = base.width - dx;
    }
    if (handle.includes('e')) {
      next.width = base.width + dx;
    }
    if (handle.includes('n')) {
      next.y = base.y + dy;
      next.height = base.height - dy;
    }
    if (handle.includes('s')) {
      next.height = base.height + dy;
    }
  }

  const minimumWidth = handle === 'move'
    ? Math.max(1, base.width)
    : base.width <= 4 ? 1 : MIN_OBJECT_SIZE;
  const minimumHeight = handle === 'move'
    ? Math.max(1, base.height)
    : base.height <= 4 ? 1 : MIN_OBJECT_SIZE;
  next.x = clamp(Math.round(next.x), 0, SLIDE_W - Math.min(SLIDE_W, minimumWidth));
  next.y = Math.round(next.y);
  next.y = clamp(next.y, 0, SLIDE_H - Math.min(SLIDE_H, minimumHeight));

  if (next.width < minimumWidth) {
    next.width = minimumWidth;
    if (handle.includes('w')) {
      next.x = base.x + base.width - minimumWidth;
    }
  }

  if (next.height < minimumHeight) {
    next.height = minimumHeight;
    if (handle.includes('n')) {
      next.y = base.y + base.height - minimumHeight;
    }
  }

  next.x = clamp(Math.round(next.x), 0, SLIDE_W - Math.min(SLIDE_W, minimumWidth));
  next.y = clamp(Math.round(next.y), 0, SLIDE_H - Math.min(SLIDE_H, minimumHeight));
  next.width = clamp(Math.round(next.width), minimumWidth, SLIDE_W - next.x);
  next.height = clamp(Math.round(next.height), minimumHeight, SLIDE_H - next.y);

  return next;
}

function getObjectHandleAnchor(rect, handleType) {
  const hasWest = handleType.includes('w');
  const hasEast = handleType.includes('e');
  const hasNorth = handleType.includes('n');
  const hasSouth = handleType.includes('s');

  if (hasWest && !hasEast) {
    return {
      x: rect.x,
      y: rect.y + (hasNorth ? 0 : hasSouth ? rect.height : rect.height / 2),
    };
  }

  if (hasEast && !hasWest) {
    return {
      x: rect.x + rect.width,
      y: rect.y + (hasNorth ? 0 : hasSouth ? rect.height : rect.height / 2),
    };
  }

  if (hasNorth) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y,
    };
  }

  if (hasSouth) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height,
    };
  }

  return {
    x: rect.x,
    y: rect.y,
  };
}

function getOffsetParentOrigin(element) {
  const offsetParent = element.offsetParent;
  if (!isElementNode(offsetParent)) {
    return { x: 0, y: 0 };
  }

  const tag = offsetParent.tagName.toLowerCase();
  const frameWindow = slideIframe.contentWindow;
  const styles = frameWindow?.getComputedStyle ? frameWindow.getComputedStyle(offsetParent) : null;
  if ((tag === 'body' || tag === 'html') && styles?.position === 'static') {
    return { x: 0, y: 0 };
  }

  const rect = offsetParent.getBoundingClientRect();
  return {
    x: rect.left + parsePixelValue(styles?.borderLeftWidth, 0),
    y: rect.top + parsePixelValue(styles?.borderTopWidth, 0),
  };
}

function serializeObjectTransformDocument(doc) {
  return serializeSlideDocument(doc);
}

function ensureLayoutPlaceholder(element, rect) {
  const view = slideIframe.contentWindow;
  const computed = view?.getComputedStyle?.(element);
  if (!computed || computed.position === 'absolute' || computed.position === 'fixed') return;
  if (element.previousElementSibling?.dataset?.slideObjectPlaceholder === element.dataset.slideObjectId) return;

  const placeholder = element.ownerDocument.createElement('div');
  if (element.ownerDocument.body.dataset.slidesGrabFlatScene === '1') return;
  placeholder.dataset.slideObjectPlaceholder = element.dataset.slideObjectId || '';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.style.width = `${Math.round(rect.width)}px`;
  placeholder.style.height = `${Math.round(rect.height)}px`;
  placeholder.style.flex = `0 0 ${Math.round(rect.width)}px`;
  placeholder.style.marginTop = computed.marginTop;
  placeholder.style.marginRight = computed.marginRight;
  placeholder.style.marginBottom = computed.marginBottom;
  placeholder.style.marginLeft = computed.marginLeft;
  placeholder.style.visibility = 'hidden';
  placeholder.style.pointerEvents = 'none';
  placeholder.style.boxSizing = 'border-box';
  element.before(placeholder);
}

function applyObjectGeometryToElement(element, rect) {
  ensureLayoutPlaceholder(element, rect);
  element.style.position = element.style.position || 'absolute';
  element.style.boxSizing = 'border-box';

  const origin = getOffsetParentOrigin(element);
  const localX = rect.x - origin.x;
  const localY = rect.y - origin.y;

  element.style.left = `${Math.round(localX)}px`;
  element.style.top = `${Math.round(localY)}px`;
  element.style.width = `${Math.round(rect.width)}px`;
  element.style.height = `${Math.round(rect.height)}px`;
  element.style.maxWidth = 'none';
  element.style.maxHeight = 'none';
}

function isElementNode(node) {
  return Boolean(node) && node.nodeType === Node.ELEMENT_NODE;
}

function isSlideBackgroundElement(el) {
  const rect = el.getBoundingClientRect();
  const areaRatio = (rect.width * rect.height) / (SLIDE_W * SLIDE_H);
  return areaRatio >= SLIDE_BACKGROUND_AREA_RATIO && el.children.length > 0;
}

export function consumeObjectTransformClickSuppression() {
  if (!suppressNextObjectClick) return false;
  suppressNextObjectClick = false;
  return true;
}

export function resolveXPath(doc, xpath) {
  if (!doc || typeof xpath !== 'string' || xpath.trim() === '') return null;
  try {
    return doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch {
    return null;
  }
}

export function getSelectedObjectElement(slide = currentSlideFile()) {
  if (!slide) return null;
  const ss = getSlideState(slide);
  if (ss.selectedObjectId) {
    const byId = slideIframe.contentDocument?.querySelector?.(`[data-slide-object-id="${CSS.escape(ss.selectedObjectId)}"]`);
    if (isElementNode(byId)) return byId;
  }
  const xpath = ss.selectedObjectXPath;
  if (!xpath) return null;

  const doc = slideIframe.contentDocument;
  const el = resolveXPath(doc, xpath);
  return isElementNode(el) ? el : null;
}

export function isSelectableElement(el) {
  if (!isElementNode(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (NON_SELECTABLE_TAGS.has(tag)) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function isTextEditableElement(el) {
  if (!isElementNode(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (!DIRECT_TEXT_TAGS.has(tag)) return false;
  const INLINE_TAGS = new Set(['BR','B','STRONG','I','EM','U','S','SPAN','A','SMALL','SUB','SUP','MARK','CODE']);
  return Array.from(el.children).every(c => INLINE_TAGS.has(c.tagName));
}

export function getSelectableTargetAt(clientX, clientY, { cycle = false } = {}) {
  const doc = slideIframe.contentDocument;
  if (!doc) return null;

  const point = clientToSlidePoint(clientX, clientY);
  const thinCandidates = Array.from(doc.querySelectorAll('[data-slide-object-id]'))
    .filter((element) => {
      if (!isSelectableElement(element)) return false;
      const rect = element.getBoundingClientRect();
      if (Math.min(rect.width, rect.height) > 4) return false;
      return point.x >= rect.left - 12
        && point.x <= rect.right + 12
        && point.y >= rect.top - 12
        && point.y <= rect.bottom + 12;
    })
    .sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return (aRect.width * aRect.height) - (bRect.width * bRect.height);
    });
  if (thinCandidates[0]) return thinCandidates[0];

  let node = doc.elementFromPoint(point.x, point.y);
  if (node?.hasAttribute?.('data-slides-grab-runtime')) {
    node = doc.body;
  }
  const candidates = [];
  while (node) {
    if (isSelectableElement(node) && !isSlideBackgroundElement(node)) {
      candidates.push(node);
    }
    node = node.parentElement;
  }
  if (candidates.length === 0) return null;
  if (!cycle) return candidates[0];
  return candidates[1] || candidates[0];
}

export function beginInlineTextEditAt(clientX, clientY) {
  const element = getSelectableTargetAt(clientX, clientY);
  if (!isTextEditableElement(element)) return false;

  const beforeHtml = serializeObjectTransformDocument(slideIframe.contentDocument);
  const xpath = getXPath(element);
  setSelectedObjectXPath(xpath, 'Editing text directly on the slide.');
  element.contentEditable = 'true';
  element.dataset.slidesGrabEditing = 'true';
  element.focus();

  const range = slideIframe.contentDocument.createRange();
  range.selectNodeContents(element);
  const selection = slideIframe.contentWindow.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const finish = () => {
    for (const block of Array.from(element.children)) {
      if (block.tagName !== 'DIV') continue;
      const fragment = element.ownerDocument.createDocumentFragment();
      fragment.append(element.ownerDocument.createElement('br'));
      while (block.firstChild) fragment.append(block.firstChild);
      block.replaceWith(fragment);
    }
    element.contentEditable = 'false';
    delete element.dataset.slidesGrabEditing;
    element.removeEventListener('blur', finish);
    element.removeEventListener('keydown', onKeyDown);
    commitInlineTextEdit({ beforeHtml });
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    element.blur();
  };
  element.addEventListener('blur', finish);
  element.addEventListener('keydown', onKeyDown);
  return true;
}

export function elementToSlideRect(el) {
  if (!isElementNode(el)) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: clamp(Math.round(rect.left), 0, SLIDE_W),
    y: clamp(Math.round(rect.top), 0, SLIDE_H),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function applyOverlayRect(node, rect) {
  if (!node || !rect) {
    if (node) node.style.display = 'none';
    return;
  }

  node.style.display = 'block';
  node.style.left = `${rect.x}px`;
  node.style.top = `${rect.y}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

export function readSelectedObjectStyleState(el) {
  const frameWindow = slideIframe.contentWindow;
  const styles = frameWindow?.getComputedStyle ? frameWindow.getComputedStyle(el) : null;
  const textDecorationLine = styles?.textDecorationLine || '';
  return {
    textEditable: isTextEditableElement(el),
    textValue: (el.innerHTML || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim(),
    textColor: normalizeHexColor(styles?.color, '#111111'),
    backgroundColor: normalizeHexColor(styles?.backgroundColor, '#ffffff'),
    fontSize: parsePixelValue(styles?.fontSize, 24),
    bold: isBoldFontWeight(styles?.fontWeight),
    italic: styles?.fontStyle === 'italic',
    underline: /\bunderline\b/.test(textDecorationLine),
    strike: /\bline-through\b/.test(textDecorationLine),
    textAlign: styles?.textAlign || 'left',
  };
}

function setToggleActive(button, active) {
  if (!button) return;
  button.classList.toggle('active', Boolean(active));
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function setControlEnabled(button, enabled) {
  if (!button) return;
  button.disabled = !enabled;
  button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

export function getSelectedObjectCapabilities(el) {
  const textEditable = isTextEditableElement(el);
  return {
    textEditable,
    textColorEditable: textEditable,
    backgroundEditable: isElementNode(el),
    sizeEditable: textEditable,
    emphasisEditable: textEditable,
    alignEditable: textEditable,
  };
}

function syncInlineInputs(snapshot) {
  if (!document.activeElement || !document.activeElement.closest?.('#select-toolbar')) {
    popoverTextInput.value = snapshot?.textValue || '';
    popoverSizeInput.value = String(snapshot?.fontSize || 24);
  }
  popoverTextColorInput.value = snapshot?.textColor || '#111111';
  popoverBgColorInput.value = snapshot?.backgroundColor || '#ffffff';
}

export function updateObjectEditorControls() {
  const selected = state.toolMode === TOOL_MODE_SELECT ? getSelectedObjectElement() : null;
  const snapshot = selected ? readSelectedObjectStyleState(selected) : null;
  const capabilities = getSelectedObjectCapabilities(selected);

  if (bboxToolbar) {
    bboxToolbar.hidden = state.toolMode !== TOOL_MODE_DRAW;
  }
  if (selectToolbar) {
    selectToolbar.hidden = state.toolMode !== TOOL_MODE_SELECT;
  }

  if (selectedObjectMini && selectEmptyHint) {
    if (selected) {
      const tag = selected.tagName.toLowerCase();
      const fullText = (selected.textContent || '').trim();
      const preview = fullText.slice(0, 24);
      miniTag.textContent = `<${tag}>`;
      miniText.textContent = preview ? ` ${preview}${fullText.length > 24 ? '\u2026' : ''}` : '';
      selectedObjectMini.style.display = '';
      selectEmptyHint.style.display = 'none';
    } else {
      selectedObjectMini.style.display = 'none';
      selectEmptyHint.style.display = state.toolMode === TOOL_MODE_SELECT ? '' : 'none';
    }
  }

  popoverTextInput.disabled = !capabilities.textEditable;
  popoverApplyText.disabled = !capabilities.textEditable;
  popoverTextColorInput.disabled = !capabilities.textColorEditable;
  popoverBgColorInput.disabled = !capabilities.backgroundEditable;
  popoverSizeInput.disabled = !capabilities.sizeEditable;
  popoverApplySize.disabled = !capabilities.sizeEditable;

  setControlEnabled(toggleBold, capabilities.emphasisEditable);
  setControlEnabled(toggleItalic, capabilities.emphasisEditable);
  setControlEnabled(toggleUnderline, capabilities.emphasisEditable);
  setControlEnabled(toggleStrike, capabilities.emphasisEditable);
  setControlEnabled(alignLeft, capabilities.alignEditable);
  setControlEnabled(alignCenter, capabilities.alignEditable);
  setControlEnabled(alignRight, capabilities.alignEditable);

  setToggleActive(toggleBold, capabilities.emphasisEditable && snapshot?.bold);
  setToggleActive(toggleItalic, capabilities.emphasisEditable && snapshot?.italic);
  setToggleActive(toggleUnderline, capabilities.emphasisEditable && snapshot?.underline);
  setToggleActive(toggleStrike, capabilities.emphasisEditable && snapshot?.strike);
  setToggleActive(alignLeft, capabilities.alignEditable && (snapshot?.textAlign === 'left' || snapshot?.textAlign === 'start'));
  setToggleActive(alignCenter, capabilities.alignEditable && snapshot?.textAlign === 'center');
  setToggleActive(alignRight, capabilities.alignEditable && (snapshot?.textAlign === 'right' || snapshot?.textAlign === 'end'));

  syncInlineInputs(snapshot);
}

function beginObjectTransform(event) {
  if (!objectSelectedBox || state.toolMode !== TOOL_MODE_SELECT) return;
  const button = event.button;
  if (typeof button === 'number' && button !== 0) return;

  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const handle = target.closest('[data-object-handle]');
  const handleType = handle?.dataset?.objectHandle || 'move';
  if (!RESIZE_HANDLE_STYLES.has(handleType)) return;

  if (!objectSelectedBox.contains(target) && target !== objectSelectedBox) return;

  const selected = resolveObjectTransformTarget();
  if (!selected) return;

  const start = clientToSlidePoint(event.clientX, event.clientY);
  const anchor = getObjectHandleAnchor(selected.rect, handleType);
  objectTransform = {
    element: selected.element,
    startRect: selected.rect,
    nextRect: selected.rect,
    startHtml: serializeObjectTransformDocument(slideIframe.contentDocument),
    hasMoved: false,
    pointerDownX: start.x,
    pointerDownY: start.y,
    handleType,
    anchorX: anchor.x,
    anchorY: anchor.y,
    pointerOffsetX: start.x - anchor.x,
    pointerOffsetY: start.y - anchor.y,
  };

  event.preventDefault();
  event.stopPropagation();
  objectSelectedBox.style.cursor = handleType === 'move' ? 'move' : 'grabbing';
}

function continueObjectTransform(event) {
  if (!isObjectTransformActive()) return;
  const {
    element,
    startRect,
    handleType,
    anchorX,
    anchorY,
    pointerOffsetX,
    pointerOffsetY,
    pointerDownX,
    pointerDownY,
    hasMoved,
  } = objectTransform;
  if (!element || !objectSelectedBox) return;

  const cursor = clientToSlidePoint(event.clientX, event.clientY);
  const adjustedCursorX = cursor.x - pointerOffsetX;
  const adjustedCursorY = cursor.y - pointerOffsetY;
  const dx = adjustedCursorX - anchorX;
  const dy = adjustedCursorY - anchorY;

  if (!hasMoved && Math.abs(cursor.x - pointerDownX) <= OBJECT_MOVE_EPSILON && Math.abs(cursor.y - pointerDownY) <= OBJECT_MOVE_EPSILON) {
    return;
  }

  objectTransform.hasMoved = true;

  const nextRect = clampObjectGeometry(startRect, dx, dy, handleType);

  objectTransform.nextRect = nextRect;
  applyObjectGeometryToElement(element, nextRect);
  applyOverlayRect(objectSelectedBox, nextRect);
}

function endObjectTransform() {
  if (!isObjectTransformActive()) return;
  const stateSnapshot = objectTransform;
  objectTransform = null;
  if (objectSelectedBox) {
    objectSelectedBox.style.cursor = '';
    renderObjectSelection();
  }

  const snapshotRect = stateSnapshot?.startRect;
  const element = stateSnapshot?.element;
  const finalRect = stateSnapshot?.nextRect || snapshotRect;
  const hasMoved = Boolean(stateSnapshot?.hasMoved);

  if (!hasMoved) return;

  suppressNextObjectClick = true;
  window.setTimeout(() => {
    suppressNextObjectClick = false;
  }, 0);

  if (element && finalRect && snapshotRect) {
    if (
      finalRect.x !== snapshotRect.x ||
      finalRect.y !== snapshotRect.y ||
      finalRect.width !== snapshotRect.width ||
      finalRect.height !== snapshotRect.height
    ) {
      applyObjectGeometryToElement(element, finalRect);
      commitObjectTransform({ beforeHtml: stateSnapshot?.startHtml || '' });
    }
  }
}

export function initObjectInteractionEvents() {
  if (!objectLayer) return;
  objectSelectedBox.addEventListener('mousedown', beginObjectTransform);
  window.addEventListener('mousemove', continueObjectTransform);
  window.addEventListener('mouseup', endObjectTransform);
}

export function renderObjectSelection() {
  indexSlideObjects(slideIframe.contentDocument);
  const selectedEl = state.toolMode === TOOL_MODE_SELECT ? getSelectedObjectElement() : null;
  const hoveredEl = state.toolMode === TOOL_MODE_SELECT
    ? resolveXPath(slideIframe.contentDocument, state.hoveredObjectXPath)
    : null;

  const selectedRect = selectedEl ? elementToSlideRect(selectedEl) : null;
  const hoveredRect = hoveredEl && hoveredEl !== selectedEl ? elementToSlideRect(hoveredEl) : null;
  applyOverlayRect(objectSelectedBox, selectedRect);
  applyOverlayRect(objectHoverBox, hoveredRect);
}

export function updateToolModeUI() {
  const isDraw = state.toolMode === TOOL_MODE_DRAW;
  slidePanel.classList.toggle('mode-draw', isDraw);
  slidePanel.classList.toggle('mode-select', !isDraw);
  if (objectLayer) {
    objectLayer.style.pointerEvents = isDraw ? 'none' : 'auto';
  }
  toolModeDrawBtn.classList.toggle('active', isDraw);
  toolModeSelectBtn.classList.toggle('active', !isDraw);
  toolModeDrawBtn.setAttribute('aria-pressed', isDraw ? 'true' : 'false');
  toolModeSelectBtn.setAttribute('aria-pressed', !isDraw ? 'true' : 'false');
  editorHint.textContent = isDraw
    ? 'Drag on the slide to add red bboxes. Cmd/Ctrl+Enter to run.'
    : 'Click an object to edit. \u2318B bold \u00b7 \u2318I italic \u00b7 \u2318U underline';
  renderBboxes();
  renderObjectSelection();
  updateObjectEditorControls();
  scaleSlide();
}

export function setToolMode(mode) {
  state.toolMode = mode === TOOL_MODE_SELECT ? TOOL_MODE_SELECT : TOOL_MODE_DRAW;
  state.drawing = false;
  state.drawStart = null;
  drawBox.style.display = 'none';
  if (isObjectTransformActive()) {
    endObjectTransform();
  }
  if (state.toolMode !== TOOL_MODE_SELECT) {
    state.hoveredObjectXPath = '';
  }
  updateToolModeUI();
  setStatus(state.toolMode === TOOL_MODE_SELECT ? 'Select mode enabled.' : 'BBox draw mode enabled.');
}

export function setSelectedObjectXPath(xpath, statusMessage = 'Object selected.') {
  const slide = currentSlideFile();
  if (!slide) return;
  const ss = getSlideState(slide);
  ss.selectedObjectXPath = xpath || '';
  const selected = xpath ? resolveXPath(slideIframe.contentDocument, xpath) : null;
  ss.selectedObjectId = isElementNode(selected) ? selected.dataset.slideObjectId || '' : '';
  state.hoveredObjectXPath = xpath || '';
  renderObjectSelection();
  updateObjectEditorControls();
  if (statusMessage) {
    setStatus(statusMessage);
  }
}

export function updateHoveredObjectFromPointer(clientX, clientY) {
  if (state.toolMode !== TOOL_MODE_SELECT) return;
  const target = getSelectableTargetAt(clientX, clientY);
  state.hoveredObjectXPath = target ? getXPath(target) : '';
  renderObjectSelection();
}

export function clearHoveredObject() {
  state.hoveredObjectXPath = '';
  renderObjectSelection();
}
