const canvas = document.querySelector('#slide-canvas');
const context = canvas.getContext('2d');
const fallbackLayer = document.querySelector('#fallback-layer');
const selectionBox = document.querySelector('#selection-box');
const rendererBadge = document.querySelector('#renderer-badge');
const sceneOutput = document.querySelector('#scene-output');
const sourceElements = new Map(
  Array.from(canvas.querySelectorAll('[data-object-id]')).map((element) => [element.dataset.objectId, element]),
);

const initialScene = {
  title: {
    type: 'html',
    x: 84,
    y: 92,
    width: 520,
    height: 230,
    text: 'Editable HTML',
  },
  card: {
    type: 'html',
    x: 680,
    y: 280,
    width: 330,
    height: 190,
    text: 'One shared scene',
  },
};

const scene = structuredClone(initialScene);
const nativeRenderer = typeof context.drawElementImage === 'function'
  && typeof canvas.requestPaint === 'function';
const renderedElements = new Map();
let selectedId = '';
let dragState = null;

function cloneFallbackElements() {
  for (const [id, source] of sourceElements) {
    const clone = source.cloneNode(true);
    clone.dataset.objectId = id;
    fallbackLayer.append(clone);
    renderedElements.set(id, clone);
  }
}

function getRenderedElement(id) {
  return nativeRenderer ? sourceElements.get(id) : renderedElements.get(id);
}

function applyObjectGeometry(element, object) {
  element.style.left = `${object.x}px`;
  element.style.top = `${object.y}px`;
  element.style.width = `${object.width}px`;
  element.style.height = `${object.height}px`;
}

function drawCanvasScene() {
  context.reset();
  context.fillStyle = '#F5F7FB';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = '#DCE6FF';
  context.beginPath();
  context.roundRect(44, 44, 1032, 542, 34);
  context.fill();

  context.fillStyle = '#376DF7';
  context.beginPath();
  context.roundRect(620, 88, 390, 128, 32);
  context.fill();

  context.fillStyle = '#9EB8FF';
  context.beginPath();
  context.arc(966, 128, 78, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = '#6E8DE0';
  context.lineWidth = 4;
  context.setLineDash([10, 10]);
  context.beginPath();
  context.moveTo(604, 206);
  context.bezierCurveTo(690, 206, 624, 376, 680, 376);
  context.stroke();
  context.setLineDash([]);
}

function drawNativeHtml() {
  for (const [id, object] of Object.entries(scene)) {
    const element = sourceElements.get(id);
    applyObjectGeometry(element, object);
    const transform = context.drawElementImage(
      element,
      object.x,
      object.y,
      object.width,
      object.height,
    );
    element.style.transform = transform.toString();
  }
}

function syncTextFromElement(id, element) {
  const heading = element.querySelector('h1, h2');
  scene[id].text = heading?.textContent || '';
}

function updateSelection() {
  if (!selectedId) {
    selectionBox.hidden = true;
    return;
  }
  const object = scene[selectedId];
  selectionBox.hidden = false;
  selectionBox.style.left = `${object.x}px`;
  selectionBox.style.top = `${object.y}px`;
  selectionBox.style.width = `${object.width}px`;
  selectionBox.style.height = `${object.height}px`;
}

function render(drawHtml = false) {
  drawCanvasScene();
  if (nativeRenderer && drawHtml) {
    drawNativeHtml();
  } else if (!nativeRenderer) {
    for (const [id, object] of Object.entries(scene)) {
      applyObjectGeometry(renderedElements.get(id), object);
    }
  }
  updateSelection();
  sceneOutput.textContent = JSON.stringify(getSnapshot(), null, 2);
}

function requestRender() {
  if (nativeRenderer) {
    canvas.requestPaint();
    return;
  }
  render();
}

function getSnapshot() {
  return {
    renderer: nativeRenderer ? 'html-in-canvas' : 'fallback',
    canvasShapeCount: 3,
    objects: structuredClone(scene),
  };
}

function enterEditMode(id, element) {
  selectedId = id;
  element.classList.add('editing');
  const heading = element.querySelector('h1, h2');
  heading.contentEditable = 'true';
  heading.focus();
  const range = document.createRange();
  range.selectNodeContents(heading);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  updateSelection();
}

function leaveEditMode(id, element) {
  const heading = element.querySelector('h1, h2');
  heading.contentEditable = 'false';
  element.classList.remove('editing');
  syncTextFromElement(id, element);
  sourceElements.get(id).querySelector('h1, h2').textContent = scene[id].text;
  requestRender();
}

function bindObject(id, element) {
  element.addEventListener('pointerdown', (event) => {
    if (element.classList.contains('editing')) return;
    selectedId = id;
    dragState = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      objectX: scene[id].x,
      objectY: scene[id].y,
    };
    element.setPointerCapture(event.pointerId);
    updateSelection();
    event.preventDefault();
  });

  element.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    scene[id].x = Math.round(dragState.objectX + event.clientX - dragState.startX);
    scene[id].y = Math.round(dragState.objectY + event.clientY - dragState.startY);
    requestRender();
  });

  element.addEventListener('pointerup', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    element.releasePointerCapture(event.pointerId);
    dragState = null;
    requestRender();
  });

  element.addEventListener('dblclick', () => enterEditMode(id, element));
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    leaveEditMode(id, element);
  });
  element.addEventListener('focusout', () => {
    if (element.classList.contains('editing')) leaveEditMode(id, element);
  });
}

if (!nativeRenderer) cloneFallbackElements();
for (const id of sourceElements.keys()) bindObject(id, getRenderedElement(id));

canvas.addEventListener('paint', () => render(true));
document.querySelector('#reset-button').addEventListener('click', () => {
  Object.assign(scene.title, initialScene.title);
  Object.assign(scene.card, initialScene.card);
  for (const [id, source] of sourceElements) {
    const heading = source.querySelector('h1, h2');
    heading.textContent = initialScene[id].text;
    const rendered = renderedElements.get(id);
    if (rendered) rendered.querySelector('h1, h2').textContent = initialScene[id].text;
  }
  selectedId = '';
  requestRender();
});

rendererBadge.textContent = nativeRenderer
  ? 'Native HTML-in-Canvas renderer'
  : 'DOM overlay fallback';
rendererBadge.classList.toggle('native', nativeRenderer);
requestRender();

window.__htmlInCanvasPoc = {
  ready: true,
  getSnapshot,
  render: requestRender,
};

