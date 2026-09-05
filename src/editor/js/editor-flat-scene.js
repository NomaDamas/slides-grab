// editor-flat-scene.js — Irreversibly flatten layout HTML into independent slide objects

const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']);
const MEDIA_TAGS = new Set(['img', 'video', 'svg', 'canvas']);
const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript']);

function hasVisiblePaint(element, style) {
  if (MEDIA_TAGS.has(element.tagName.toLowerCase())) return true;
  if (TEXT_TAGS.has(element.tagName.toLowerCase())) return true;
  if (style.backgroundImage !== 'none') return true;
  if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') return true;
  return ['Top', 'Right', 'Bottom', 'Left'].some((side) => (
    Number.parseFloat(style[`border${side}Width`] || '0') > 0
    && style[`border${side}Style`] !== 'none'
  ));
}

function copyComputedStyle(source, target, view) {
  const style = view.getComputedStyle(source);
  for (const property of style) {
    target.style.setProperty(property, style.getPropertyValue(property), style.getPropertyPriority(property));
  }
  return style;
}

function cleanClone(clone) {
  clone.removeAttribute('id');
  clone.removeAttribute('class');
  clone.removeAttribute('contenteditable');
  for (const attribute of Array.from(clone.attributes)) {
    if (attribute.name.startsWith('data-slide-object-') || attribute.name.startsWith('data-slides-grab-')) {
      clone.removeAttribute(attribute.name);
    }
  }
}

function readGeneratedText(style) {
  const content = style?.content || '';
  if (!content || content === 'none' || content === 'normal') return '';
  return content
    .replace(/^["']|["']$/g, '')
    .replace(/\\25A0/gi, '\u25a0')
    .replace(/\\(["'])/g, '$1');
}

function makeFlatObject(source, index, bodyRect, view) {
  const tag = source.tagName.toLowerCase();
  const clone = source.cloneNode(TEXT_TAGS.has(tag));
  cleanClone(clone);
  if (!TEXT_TAGS.has(tag)) clone.replaceChildren();
  if (TEXT_TAGS.has(tag)) {
    const before = readGeneratedText(view.getComputedStyle(source, '::before'));
    const after = readGeneratedText(view.getComputedStyle(source, '::after'));
    if (before) clone.prepend(before);
    if (after) clone.append(after);
  }
  if (MEDIA_TAGS.has(tag)) {
    const mediaClone = source.cloneNode(true);
    cleanClone(mediaClone);
    copyComputedStyle(source, mediaClone, view);
    return positionFlatObject(mediaClone, source, index, bodyRect, view);
  }
  copyComputedStyle(source, clone, view);
  return positionFlatObject(clone, source, index, bodyRect, view);
}

function positionFlatObject(clone, source, index, bodyRect, view) {
  const rect = source.getBoundingClientRect();
  const style = view.getComputedStyle(source);
  clone.dataset.slideObjectId = `flat-${index}`;
  clone.dataset.slideObjectType = TEXT_TAGS.has(source.tagName.toLowerCase())
    ? 'text'
    : MEDIA_TAGS.has(source.tagName.toLowerCase()) ? 'media' : 'shape';
  clone.style.position = 'absolute';
  clone.style.left = `${rect.left - bodyRect.left}px`;
  clone.style.top = `${rect.top - bodyRect.top}px`;
  clone.style.right = 'auto';
  clone.style.bottom = 'auto';
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  clone.style.maxWidth = 'none';
  clone.style.maxHeight = 'none';
  clone.style.minWidth = '0';
  clone.style.minHeight = '0';
  clone.style.transform = style.transform === 'none' ? 'none' : style.transform;
  clone.style.transformOrigin = style.transformOrigin;
  clone.style.boxSizing = 'border-box';
  return clone;
}

export function isFlatSceneDocument(doc) {
  return doc?.body?.dataset?.slidesGrabFlatScene === '1';
}

export function flattenSlideDocument(doc) {
  const body = doc?.body;
  const view = doc?.defaultView;
  if (!body || !view) return { count: 0, alreadyFlat: false };
  if (isFlatSceneDocument(doc)) {
    return {
      count: body.querySelectorAll('[data-slide-object-id]').length,
      alreadyFlat: true,
    };
  }

  const bodyRect = body.getBoundingClientRect();
  const sources = Array.from(body.querySelectorAll('*')).filter((element) => {
    const tag = element.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag) || element.hasAttribute('data-slides-grab-runtime')) return false;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number.parseFloat(style.opacity || '1') > 0
      && rect.width > 0
      && rect.height > 0
      && hasVisiblePaint(element, style);
  });

  const root = doc.createElement('div');
  root.dataset.slidesGrabFlatRoot = '1';
  root.style.cssText = `position:relative;width:${bodyRect.width}px;height:${bodyRect.height}px;overflow:hidden;`;
  const bodyStyle = view.getComputedStyle(body);
  root.style.background = bodyStyle.background;
  root.style.color = bodyStyle.color;
  root.style.font = bodyStyle.font;
  sources.forEach((source, index) => root.append(makeFlatObject(source, index + 1, bodyRect, view)));

  body.replaceChildren(root);
  for (const attribute of Array.from(body.attributes)) {
    if (attribute.name.startsWith('data-slide-object-')) body.removeAttribute(attribute.name);
  }
  body.dataset.slidesGrabFlatScene = '1';
  body.dataset.slidesGrabFlatVersion = '1';
  return { count: sources.length, alreadyFlat: false };
}

