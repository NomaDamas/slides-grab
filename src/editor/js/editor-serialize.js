// editor-serialize.js — Clean slide serialization shared by edit history and transforms

export function serializeSlideDocument(doc) {
  if (!doc?.documentElement) return '';
  const documentElement = doc.documentElement.cloneNode(true);
  const canvasRoot = documentElement.querySelector('[data-slides-grab-runtime="html-in-canvas-root"]');
  const canvasHost = documentElement.querySelector('[data-slides-grab-runtime="html-in-canvas"]');
  if (canvasRoot && canvasHost?.parentNode) {
    const parent = canvasHost.parentNode;
    for (const child of Array.from(canvasRoot.children)) {
      parent.insertBefore(child, canvasHost);
    }
  }
  documentElement.querySelectorAll('[data-slides-grab-runtime]').forEach((node) => node.remove());
  documentElement.querySelectorAll('[data-slides-grab-editing]').forEach((node) => {
    node.removeAttribute('data-slides-grab-editing');
    node.removeAttribute('contenteditable');
  });
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

