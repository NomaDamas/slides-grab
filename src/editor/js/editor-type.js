import { state, TOOL_MODE_SELECT } from './editor-state.js';
import { btnSend, btnSendLabel, editorBrand, editorHint } from './editor-dom.js';

const EDITOR_CLIENTS = Object.freeze({
  html: Object.freeze({
    type: 'html',
    title: 'HTML Editor - slides-grab',
    brand: 'HTML Editor',
    drawHint: 'HTML Editor: drag on the slide to add red bboxes. Cmd/Ctrl+Enter to run.',
    selectHint: 'HTML Editor: click an object to edit. Cmd/Ctrl+B, I, or U to style text.',
    sendLabel: 'Run HTML Edit',
    sendTitle: 'Run HTML edit',
    usesModel: true,
    usesImageProvider: false,
    supportsDirectSave: true,
    includesSelectionTargets: true,
    requestMode: '',
  }),
  image: Object.freeze({
    type: 'image',
    title: 'Image Editor - slides-grab',
    brand: 'Image Editor',
    drawHint: 'Image Editor: drag on the slide to add red bboxes for regeneration.',
    selectHint: 'Image Editor: draw a bbox for image regeneration.',
    sendLabel: 'Regenerate Image',
    sendTitle: 'Regenerate slide image',
    usesModel: false,
    usesImageProvider: true,
    supportsDirectSave: false,
    includesSelectionTargets: false,
    requestMode: 'image',
  }),
});

export function getEditorClient(editorType = state.editorType) {
  return EDITOR_CLIENTS[editorType] || EDITOR_CLIENTS.html;
}

export function updateEditorClientLabels() {
  const client = getEditorClient();
  document.title = client.title;
  editorBrand.textContent = client.brand;
  editorHint.textContent = state.toolMode === TOOL_MODE_SELECT ? client.selectHint : client.drawHint;
  btnSendLabel.textContent = client.sendLabel;
  btnSend.title = client.sendTitle;
}

export function configureEditorClient(editorType) {
  const client = getEditorClient(editorType);
  state.editorType = client.type;
  document.body.dataset.editorType = client.type;
  updateEditorClientLabels();
  return client;
}

export function buildApplyRequestBody({ slide, prompt, model, provider, selections }) {
  const client = getEditorClient();
  const body = {
    slide,
    prompt,
    selections: selections.map((selection) => ({
      ...selection,
      targets: client.includesSelectionTargets ? selection.targets : [],
    })),
  };

  if (client.usesModel) body.model = model;
  if (client.requestMode) body.mode = client.requestMode;
  if (client.usesImageProvider) body.provider = provider;
  return body;
}
