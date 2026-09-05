// editor-object-model.js — DOM-to-scene indexing for hybrid slide editing

const IGNORED_TAGS = new Set(['html', 'head', 'script', 'style', 'link', 'meta', 'noscript']);
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']);

function isVisible(element, view) {
  if (!element || !element.getBoundingClientRect) return false;
  const style = view.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number.parseFloat(style.opacity || '1') > 0
    && rect.width > 0
    && rect.height > 0;
}

export function inferObjectType(element) {
  const tag = element?.tagName?.toLowerCase() || '';
  if (tag === 'img' || tag === 'video' || tag === 'svg' || tag === 'canvas') return 'media';
  if (TEXT_TAGS.has(tag)) return 'text';
  if (tag === 'body') return 'background';
  return 'html';
}

export function indexSlideObjects(doc) {
  const view = doc?.defaultView;
  if (!doc?.body || !view) return [];

  const elements = [doc.body, ...Array.from(doc.body.querySelectorAll('*'))];
  const objects = [];
  const usedIds = new Set();
  let nextId = 1;
  const allocateId = () => {
    while (usedIds.has(`html-${nextId}`)) nextId += 1;
    const id = `html-${nextId}`;
    nextId += 1;
    return id;
  };
  for (const element of elements) {
    const tag = element.tagName?.toLowerCase() || '';
    if (tag === 'body' && element.dataset.slidesGrabFlatScene === '1') continue;
    if (
      IGNORED_TAGS.has(tag)
      || element.hasAttribute('data-slides-grab-runtime')
      || element.hasAttribute('data-slides-grab-flat-root')
      || !isVisible(element, view)
    ) continue;

    const type = inferObjectType(element);
    if (!element.dataset.slideObjectId || usedIds.has(element.dataset.slideObjectId)) {
      element.dataset.slideObjectId = allocateId();
    }
    usedIds.add(element.dataset.slideObjectId);
    element.dataset.slideObjectType = type;
    if (tag === 'body') {
      element.dataset.slideObjectLocked = 'true';
    }

    const rect = element.getBoundingClientRect();
    objects.push({
      id: element.dataset.slideObjectId,
      type,
      tag,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      locked: tag === 'body',
    });
  }
  return objects;
}

export function getObjectElementAtPoint(doc, x, y) {
  let element = doc?.elementFromPoint?.(x, y);
  while (element && !element.dataset?.slideObjectId) {
    element = element.parentElement;
  }
  return element || null;
}

