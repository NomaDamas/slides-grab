// Canonical editor model registry — single source of truth for the slide
// editor's model dropdown and dispatch routing. Imported by both Node code
// (scripts/editor-server.js, src/editor/codex-edit.js) and browser code
// (src/editor/js/editor-state.js), so this module MUST stay browser-safe:
// no Node imports, no Node-only globals.
//
// To add a new model:
//   1. Append to CODEX_MODELS or CLAUDE_MODELS below.
//   2. Add a matching <option> to src/editor/editor.html (also a fallback).
//   3. Existing tests/editor/editor-model-dispatch.test.js will automatically
//      verify the new model dispatches correctly through the editor pipeline.
//      No per-model test additions needed.

export const CODEX_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-6-astra',
];

export const CLAUDE_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6'];

export const ALL_MODELS = [...CODEX_MODELS, ...CLAUDE_MODELS];

export const DEFAULT_CODEX_MODEL = CODEX_MODELS[0];
export const DEFAULT_MODEL = DEFAULT_CODEX_MODEL;

export function isClaudeModel(model) {
  return typeof model === 'string' && CLAUDE_MODELS.includes(model.trim());
}

export function isCodexModel(model) {
  return typeof model === 'string' && CODEX_MODELS.includes(model.trim());
}

export function isKnownEditorModel(model) {
  return isCodexModel(model) || isClaudeModel(model);
}
