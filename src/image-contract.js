import { dirname, join, resolve } from 'node:path';

import motionContract from './motion-contract.cjs';

const { MOTION_RUNTIME_HTML } = motionContract;

const ABSOLUTE_FILESYSTEM_PATH_RE = /^(file:\/\/|\/Users\/|\/home\/|\/var\/|\/tmp\/|\/private\/|\/Volumes\/|[A-Za-z]:[\\/]|\\\\)/i;
const SCHEME_RE = /^[a-z][a-z0-9+\-.]*:/i;
const CSS_URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

export const LOCAL_ASSET_PREFIX = './assets/';

const ASSET_CONTRACT_RULES = {
  image: {
    label: 'image',
    remoteCode: 'remote-image-url',
    remoteInsecureCode: 'remote-image-url-insecure',
    absoluteCode: 'absolute-filesystem-image-path',
    rootRelativeCode: 'root-relative-image-path',
    otherSchemeCode: 'unsupported-image-url-scheme',
    noncanonicalCode: 'noncanonical-relative-image-path',
  },
  video: {
    label: 'video',
    remoteCode: 'remote-video-url',
    remoteInsecureCode: 'remote-video-url-insecure',
    absoluteCode: 'absolute-filesystem-video-path',
    rootRelativeCode: 'root-relative-video-path',
    otherSchemeCode: 'unsupported-video-url-scheme',
    noncanonicalCode: 'noncanonical-relative-video-path',
  },
};

export function looksLikeAbsoluteFilesystemPath(value) {
  return ABSOLUTE_FILESYSTEM_PATH_RE.test((value || '').trim());
}

export function extractCssUrls(value) {
  const input = typeof value === 'string' ? value : '';
  const matches = [];
  let match;
  while ((match = CSS_URL_RE.exec(input)) !== null) {
    const candidate = (match[2] || '').trim();
    if (candidate) {
      matches.push(candidate);
    }
  }
  return matches;
}

export function classifyImageSource(source) {
  const value = typeof source === 'string' ? source.trim() : '';

  if (!value) return { kind: 'empty' };
  if (value.startsWith('data:')) return { kind: 'data-url' };
  if (value.startsWith('https://')) return { kind: 'remote-url' };
  if (value.startsWith('http://')) return { kind: 'remote-url-insecure' };
  if (looksLikeAbsoluteFilesystemPath(value)) return { kind: 'absolute-filesystem-path' };
  if (value.startsWith(LOCAL_ASSET_PREFIX)) return { kind: 'local-asset-path' };
  if (value.startsWith('/')) return { kind: 'root-relative-path' };
  if (SCHEME_RE.test(value)) return { kind: 'other-scheme' };
  return { kind: 'noncanonical-relative-path' };
}

export function resolveSlideSourcePath(slidePath, source) {
  return resolve(dirname(slidePath), source);
}

function injectIntoHead(html, snippet) {
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${snippet}`);
  }

  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>\n${snippet}\n</head>`);
  }

  return `${snippet}\n${html}`;
}

function buildAssetContractReport({ slideFile, sources = [], assetType = 'image' }) {
  const rules = ASSET_CONTRACT_RULES[assetType] || ASSET_CONTRACT_RULES.image;
  const { label } = rules;
  const issues = [];

  for (const entry of sources) {
    const source = typeof entry?.source === 'string' ? entry.source.trim() : '';
    const classification = classifyImageSource(source);

    if (classification.kind === 'empty' || classification.kind === 'data-url') {
      continue;
    }

    if (classification.kind === 'remote-url') {
      issues.push({
        severity: 'critical',
        code: rules.remoteCode,
        message: `Remote ${label} URLs are unsupported in saved slide HTML. Download the ${label} into ./assets/<file> instead.`,
        slide: slideFile,
        ...entry,
      });
      continue;
    }

    if (classification.kind === 'remote-url-insecure') {
      issues.push({
        severity: 'critical',
        code: rules.remoteInsecureCode,
        message: `Remote http:// ${label} URLs are unsupported in saved slide HTML. Download the ${label} into ./assets/<file> instead.`,
        slide: slideFile,
        ...entry,
      });
      continue;
    }

    if (classification.kind === 'absolute-filesystem-path') {
      issues.push({
        severity: 'critical',
        code: rules.absoluteCode,
        message: `Absolute filesystem ${label} paths are unsupported. Use ./assets/<file> instead.`,
        slide: slideFile,
        ...entry,
      });
      continue;
    }

    if (classification.kind === 'root-relative-path') {
      issues.push({
        severity: 'critical',
        code: rules.rootRelativeCode,
        message: `Root-relative ${label} paths are unsupported. Use ./assets/<file> instead.`,
        slide: slideFile,
        ...entry,
      });
      continue;
    }

    if (classification.kind === 'other-scheme' && rules.otherSchemeCode) {
      issues.push({
        severity: 'critical',
        code: rules.otherSchemeCode,
        message: `Non-file URL schemes for ${label} assets are unsupported in saved slide HTML. Download the ${label} into ./assets/<file> instead.`,
        slide: slideFile,
        ...entry,
      });
      continue;
    }

    if (classification.kind === 'noncanonical-relative-path') {
      issues.push({
        severity: 'warning',
        code: rules.noncanonicalCode,
        message: `Use ./assets/<file> for portable local ${label} assets.`,
        slide: slideFile,
        ...entry,
      });
    }
  }

  return issues;
}

export function buildImageContractReport({ slideFile, sources = [] }) {
  return buildAssetContractReport({ slideFile, sources, assetType: 'image' });
}

export function buildVideoContractReport({ slideFile, sources = [] }) {
  return buildAssetContractReport({ slideFile, sources, assetType: 'video' });
}

export function buildSlideRuntimeHtml(html, { baseHref, slideFile }) {
  const snippets = [];

  if (baseHref && !/<base\b/i.test(html)) {
    snippets.push(`<base data-slides-grab-runtime="base" href="${baseHref}">`);
  }

  if (/\bdata-motion-root\b/i.test(html)) {
    snippets.push(MOTION_RUNTIME_HTML);
  }

  const script = `<script data-slides-grab-runtime="diagnostics">
(() => {
  const slideFile = ${JSON.stringify(slideFile)};
  const localAssetPrefix = ${JSON.stringify(LOCAL_ASSET_PREFIX)};
  const absolutePathRe = ${ABSOLUTE_FILESYSTEM_PATH_RE.toString()};
  const schemeRe = ${SCHEME_RE.toString()};
  const prefix = '[slides-grab:image]';

  function describeElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
    if (element === document.body) return 'body';

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += '#' + current.id;
        parts.unshift(part);
        break;
      }
      if (current.classList.length > 0) {
        part += '.' + Array.from(current.classList).slice(0, 2).join('.');
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  }

  function warn(message, detail) {
    console.warn(prefix + ' ' + slideFile + ': ' + message, detail);
  }

  function fail(message, detail) {
    console.error(prefix + ' ' + slideFile + ': ' + message, detail);
  }

  function validateAssetSource(kind, source, { allowEmpty = true, onNoncanonical = 'warn' } = {}) {
    const value = (source || '').trim();
    if (!value) {
      return allowEmpty;
    }
    if (value.startsWith('data:')) {
      return true;
    }
    if (value.startsWith('https://')) {
      fail('remote ' + kind + ' URL is unsupported in saved slides; download it into ./assets/<file>', { src: value });
      return false;
    }
    if (value.startsWith('http://')) {
      fail('remote http:// ' + kind + ' URL is unsupported in saved slides; download it into ./assets/<file>', { src: value });
      return false;
    }
    if (absolutePathRe.test(value) || value.startsWith('/')) {
      fail('non-portable ' + kind + ' path is unsupported', { src: value });
      return false;
    }
    if (schemeRe.test(value)) {
      fail('unsupported ' + kind + ' URL scheme in saved slides; download it into ./assets/<file>', { src: value });
      return false;
    }
    if (!value.startsWith(localAssetPrefix)) {
      const report = onNoncanonical === 'fail' ? fail : warn;
      report('noncanonical local ' + kind + ' path should use ./assets/<file>', { src: value });
    }
    return true;
  }

  function getVideoSources(video) {
    const sources = [];
    const directSrc = (video.getAttribute('src') || '').trim();
    if (directSrc) {
      sources.push(directSrc);
    }
    for (const source of video.querySelectorAll('source[src]')) {
      const src = (source.getAttribute('src') || '').trim();
      if (src) {
        sources.push(src);
      }
    }
    return sources;
  }

  window.addEventListener('error', (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement) {
      const src = (target.getAttribute('src') || target.currentSrc || '').trim();
      if (!src || src.startsWith('data:')) return;
      if (src.startsWith(localAssetPrefix)) {
        fail('missing local asset', { src });
        return;
      }
      fail('image failed to load', { src });
      return;
    }

    if (target instanceof HTMLVideoElement) {
      const sources = getVideoSources(target);
      if (sources.some((src) => src.startsWith(localAssetPrefix))) {
        fail('missing local video asset', { sources });
        return;
      }
      fail('video failed to load', { sources });
      return;
    }

    if (target instanceof HTMLSourceElement && target.parentElement instanceof HTMLVideoElement) {
      const src = (target.getAttribute('src') || '').trim();
      if (!src) return;
      if (src.startsWith(localAssetPrefix)) {
        fail('missing local video asset', { src });
        return;
      }
      fail('video source failed to load', { src });
    }
  }, true);

  window.addEventListener('DOMContentLoaded', () => {
    for (const image of document.querySelectorAll('img[src]')) {
      const src = (image.getAttribute('src') || '').trim();
      validateAssetSource('image', src);
    }

    for (const video of document.querySelectorAll('video')) {
      for (const src of getVideoSources(video)) {
        validateAssetSource('video', src);
      }

      const poster = (video.getAttribute('poster') || '').trim();
      if (poster) {
        validateAssetSource('image', poster);
      }
    }

    for (const element of document.body.querySelectorAll('*')) {
      if (element === document.body) continue;
      const backgroundImage = window.getComputedStyle(element).backgroundImage;
      if (!backgroundImage || backgroundImage === 'none' || !backgroundImage.includes('url(')) continue;
      fail('non-body background-image is not supported for slide content', {
        element: describeElement(element),
        backgroundImage,
      });
    }
  });
})();
</script>`;

  snippets.push(script);

  return injectIntoHead(html, snippets.join('\n'));
}

export function resolveLocalAssetPath(slidePath, source) {
  return join(dirname(slidePath), source.replace(/^\.\//, ''));
}
