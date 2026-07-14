// editor-send.js — API submission (applyChanges), updateSendState

import { state, runsById, activeRunBySlide, pendingRequestBySlide } from './editor-state.js';
import { slideIframe, slideStatusChip, btnSend, btnClearBboxes, promptInput, imageProviderSelect } from './editor-dom.js';
import { currentSlideFile, getSlideState, getLatestRunForSlide, normalizeBoxStatus, normalizeModelName, setStatus } from './editor-utils.js';
import { addChatMessage, renderRunsList } from './editor-chat.js';
import { renderBboxes, extractTargetsForBox } from './editor-bbox.js';
import { flushDirectSaveForSlide } from './editor-direct-edit.js';
import { buildApplyRequestBody, getEditorClient } from './editor-type.js';

export function updateSlideStatusChip() {
  const slide = currentSlideFile();
  if (!slide) {
    slideStatusChip.textContent = 'idle';
    slideStatusChip.className = 'slide-status-chip idle';
    return;
  }

  let status = 'idle';
  if (pendingRequestBySlide.has(slide)) {
    status = 'running';
  } else if (activeRunBySlide.has(slide)) {
    status = 'running';
  } else {
    const latest = getLatestRunForSlide(slide);
    if (latest?.status === 'success') status = 'success';
    if (latest?.status === 'failed') status = 'failed';
  }

  slideStatusChip.textContent = status;
  slideStatusChip.className = `slide-status-chip ${status}`;
}

export function updateSendState() {
  const slide = currentSlideFile();
  if (!slide) {
    btnSend.disabled = true;
    btnClearBboxes.disabled = true;
    return;
  }

  const ss = getSlideState(slide);
  const prompt = (promptInput.value || '').trim();
  const pendingCount = ss.boxes.filter((box) => normalizeBoxStatus(box.status) === 'pending').length;
  const blocked = pendingRequestBySlide.has(slide) || activeRunBySlide.has(slide);
  const editorClient = getEditorClient();
  const model = editorClient.usesModel ? normalizeModelName(ss.model) : '';

  state.imageProvider = imageProviderSelect?.value || 'codex';
  const requiresBbox = !editorClient.usesImageProvider;
  btnSend.disabled = !prompt || (requiresBbox && pendingCount === 0) || blocked || (editorClient.usesModel && !model);
  btnClearBboxes.disabled = ss.boxes.length === 0 || blocked;
  updateSlideStatusChip();
}

export async function applyChanges() {
  const slide = currentSlideFile();
  if (!slide) return;

  const editorClient = getEditorClient();
  if (editorClient.supportsDirectSave) await flushDirectSaveForSlide(slide);

  const ss = getSlideState(slide);
  const prompt = (promptInput.value || '').trim();
  const pendingBoxes = ss.boxes.filter((box) => normalizeBoxStatus(box.status) === 'pending');
  const model = editorClient.usesModel
    ? normalizeModelName(ss.model) || state.selectedModel || state.defaultModel
    : '';
  const imageProvider = imageProviderSelect?.value || 'codex';
  state.imageProvider = imageProvider;
  if (!prompt) return;
  if (!editorClient.usesImageProvider && pendingBoxes.length === 0) {
    setStatus('No pending (red) bbox to run. Draw a new box or click Rerun on a green box.');
    return;
  }

  const submittedBoxIds = pendingBoxes.map((box) => box.id);
  const submittedSet = new Set(submittedBoxIds);

  const selections = pendingBoxes.map((box) => ({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    targets: editorClient.includesSelectionTargets ? extractTargetsForBox(box) : [],
  }));

  addChatMessage('user', `[${slide}] [${editorClient.usesImageProvider ? `image:${imageProvider}` : model}] ${prompt}`, slide);

  pendingRequestBySlide.add(slide);
  ss.prompt = '';
  promptInput.value = '';
  updateSendState();
  const engineLabel = editorClient.usesImageProvider ? `Image ${imageProvider}` : model.startsWith('claude-') ? 'Claude' : 'Codex';
  setStatus(`Submitting ${slide} to ${engineLabel}...`);

  try {
    const res = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildApplyRequestBody({
        slide,
        prompt,
        model,
        selections,
        provider: imageProvider,
      })),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = data.error || `Server error ${res.status}`;
      addChatMessage('error', `[${slide}] ${message}`, slide);
      setStatus(`Error: ${message}`);
      return;
    }

    if (data.runId) {
      const existing = runsById.get(data.runId) || {};
      runsById.set(data.runId, {
        ...existing,
        runId: data.runId,
        slide,
        status: data.success ? 'success' : 'failed',
        code: data.code,
        message: data.message,
        model: data.model || model,
        startedAt: existing.startedAt || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        logPreview: existing.logPreview || '',
      });
      renderRunsList();
    }

    addChatMessage(
      data.success ? 'system' : 'error',
      `[${slide}] ${data.message || (data.success ? 'Completed' : 'Failed')}`,
      slide,
    );

    if (data.success) {
      if (editorClient.usesImageProvider && data.image?.assetRef && slide === currentSlideFile()) {
        const slideImage = slideIframe?.contentDocument?.querySelector('img.slide-image');
        if (slideImage) {
          const refreshedImageUrl = new URL(data.image.assetRef, slideIframe.contentWindow.location.href);
          refreshedImageUrl.searchParams.set('refresh', Date.now().toString());
          slideImage.src = refreshedImageUrl.href;
        }
      }

      let marked = 0;
      for (const box of ss.boxes) {
        if (submittedSet.has(box.id) && normalizeBoxStatus(box.status) === 'pending') {
          box.status = 'review';
          marked += 1;
        }
      }
      renderBboxes();
      setStatus(
        marked > 0
          ? `${data.message || 'Codex run completed.'} Review ${marked} green bbox${marked === 1 ? '' : 'es'}: Check to accept or Rerun.`
          : (data.message || 'Codex run completed.'),
      );
    } else {
      setStatus(data.message || 'Codex run failed.');
    }
  } catch (error) {
    addChatMessage('error', `[${slide}] ${error.message}`, slide);
    setStatus(`Error: ${error.message}`);
  } finally {
    pendingRequestBySlide.delete(slide);
    updateSendState();
  }
}
