import { ALL_MODELS } from './model-registry.js';

export let SLIDE_W = 960;
export let SLIDE_H = 540;

export function setSlideFrame(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (Number.isFinite(w) && w > 0) SLIDE_W = Math.round(w);
  if (Number.isFinite(h) && h > 0) SLIDE_H = Math.round(h);
}
export const TOOL_MODE_DRAW = 'draw';
export const TOOL_MODE_SELECT = 'select';
export const POPOVER_TEXT = 'text';
export const POPOVER_TEXT_COLOR = 'text-color';
export const POPOVER_BG_COLOR = 'bg-color';
export const POPOVER_SIZE = 'size';
export const DEFAULT_MODELS = ALL_MODELS.slice();
export const DIRECT_TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']);
export const NON_SELECTABLE_TAGS = new Set(['html', 'head', 'body', 'script', 'style', 'link', 'meta', 'noscript']);

export const slideStates = new Map();
export const activeRunBySlide = new Map();
export const pendingRequestBySlide = new Set();
export const runsById = new Map();
export const directSaveStateBySlide = new Map();
export const localFileUpdateBySlide = new Map();

export const state = {
  slides: [],
  currentIndex: 0,
  drawStart: null,
  drawing: false,
  availableModels: DEFAULT_MODELS.slice(),
  defaultModel: DEFAULT_MODELS[0],
  selectedModel: DEFAULT_MODELS[0],
  toolMode: TOOL_MODE_DRAW,
  editorType: typeof document !== 'undefined' && document.body?.dataset.editorType === 'image' ? 'image' : 'html',
  imageProvider: 'codex',
  hoveredObjectXPath: '',
};
