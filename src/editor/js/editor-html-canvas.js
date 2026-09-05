// editor-html-canvas.js — Experimental native HTML-in-Canvas composition

import { indexSlideObjects } from './editor-object-model.js';

const CANVAS_ID = 'slides-grab-html-canvas';
const ROOT_ID = 'slides-grab-html-canvas-root';

export function enableHtmlInCanvas(doc) {
  const view = doc?.defaultView;
  const body = doc?.body;
  if (!view || !body || typeof view.CanvasRenderingContext2D === 'undefined') return null;
  if (body.querySelector(`#${CANVAS_ID}`)) {
    return body.querySelector(`#${CANVAS_ID}`);
  }

  const canvas = doc.createElement('canvas');
  canvas.id = CANVAS_ID;
  canvas.dataset.slidesGrabRuntime = 'html-in-canvas';
  canvas.setAttribute('layoutsubtree', '');
  canvas.width = Math.round(body.getBoundingClientRect().width || body.clientWidth);
  canvas.height = Math.round(body.getBoundingClientRect().height || body.clientHeight);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  const context = canvas.getContext('2d');
  if (typeof context?.drawElementImage !== 'function' || typeof canvas.requestPaint !== 'function') {
    return null;
  }

  const root = doc.createElement('div');
  root.id = ROOT_ID;
  root.dataset.slidesGrabRuntime = 'html-in-canvas-root';
  root.style.cssText = 'position:relative;width:100%;height:100%;';
  const children = Array.from(body.children);
  for (const child of children) root.append(child);
  canvas.append(root);
  body.append(canvas);

  const draw = () => {
    context.reset();
    const transform = context.drawElementImage(root, 0, 0, canvas.width, canvas.height);
    root.style.transform = transform.toString();
  };
  canvas.addEventListener('paint', draw);
  canvas.requestPaint();
  canvas.dataset.renderer = 'native';
  indexSlideObjects(doc);
  return canvas;
}

