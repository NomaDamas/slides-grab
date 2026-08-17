import { access, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  buildImageContractReport,
  buildVideoContractReport,
  classifyImageSource,
  resolveSlideSourcePath,
} from '../image-contract.js';
import { TemplatePackError, loadTemplatePackFromSlidesDir } from '../template-pack.js';
import { checkLayoutDensity } from '../template-layout.js';

const require = createRequire(import.meta.url);
const {
  DEFAULT_SLIDE_MODE,
  getSlideModeConfig,
} = require('../slide-mode.cjs');

export const FRAME_PT = getSlideModeConfig(DEFAULT_SLIDE_MODE).framePt;
export const FRAME_PX = getSlideModeConfig(DEFAULT_SLIDE_MODE).framePx;
export const SLIDE_FILE_PATTERN = /^slide-.*\.html$/i;
export const TEXT_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li';
export const TOLERANCE_PX = 0.5;

export function toSlideOrder(fileName) {
  const match = fileName.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.POSITIVE_INFINITY;
}

export function sortSlideFiles(a, b) {
  const orderA = toSlideOrder(a);
  const orderB = toSlideOrder(b);
  if (orderA !== orderB) return orderA - orderB;
  return a.localeCompare(b);
}

export function buildIssue(code, message, payload = {}) {
  return { code, message, ...payload };
}

export function summarizeSlides(slides) {
  const summary = {
    totalSlides: slides.length,
    passedSlides: 0,
    failedSlides: 0,
    criticalIssues: 0,
    warnings: 0,
  };

  for (const slide of slides) {
    if (slide.status === 'pass') {
      summary.passedSlides += 1;
    } else {
      summary.failedSlides += 1;
    }

    summary.criticalIssues += slide.summary.criticalCount;
    summary.warnings += slide.summary.warningCount;
  }

  return summary;
}

export function createValidationResult(slides, slideMode = DEFAULT_SLIDE_MODE) {
  const { framePt, framePx } = getSlideModeConfig(slideMode);
  return {
    generatedAt: new Date().toISOString(),
    frame: {
      widthPt: framePt.width,
      heightPt: framePt.height,
      widthPx: framePx.width,
      heightPx: framePx.height,
    },
    slides,
    summary: summarizeSlides(slides),
  };
}

export function createValidationFailure(error, slideMode = DEFAULT_SLIDE_MODE) {
  const { framePt, framePx } = getSlideModeConfig(slideMode);
  return {
    generatedAt: new Date().toISOString(),
    frame: {
      widthPt: framePt.width,
      heightPt: framePt.height,
      widthPx: framePx.width,
      heightPx: framePx.height,
    },
    slides: [],
    summary: {
      totalSlides: 0,
      passedSlides: 0,
      failedSlides: 0,
      criticalIssues: 1,
      warnings: 0,
    },
    error: error instanceof Error ? error.message : String(error),
  };
}

function buildElementPath(element) {
  return typeof element === 'string' && element ? element : 'unknown';
}

function buildImageIssue(severity, code, message, payload = {}) {
  return {
    severity,
    code,
    message,
    ...payload,
  };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldSkipLocalAssetExistenceCheck(classification) {
  return (
    classification.kind === 'empty'
    || classification.kind === 'data-url'
    || classification.kind === 'remote-url'
    || classification.kind === 'remote-url-insecure'
    || classification.kind === 'absolute-filesystem-path'
    || classification.kind === 'root-relative-path'
    || classification.kind === 'other-scheme'
  );
}

async function inspectImageContract(slidesDir, fileName, inspection) {
  const critical = [];
  const warning = [];
  const slidePath = join(slidesDir, fileName);

  for (const image of inspection.images) {
    const source = image.src;
    const classification = classifyImageSource(source);
    const issues = buildImageContractReport({
      slideFile: fileName,
      sources: [{
        element: buildElementPath(image.element),
        source,
      }],
    });

    for (const issue of issues) {
      const target = issue.severity === 'critical' ? critical : warning;
      target.push(issue);
    }

    if (shouldSkipLocalAssetExistenceCheck(classification)) {
      continue;
    }

    const assetPath = resolveSlideSourcePath(slidePath, source);
    if (!(await fileExists(assetPath))) {
      critical.push(buildImageIssue(
        'critical',
        'missing-local-asset',
        'Local image asset is missing.',
        {
          slide: fileName,
          element: buildElementPath(image.element),
          source,
          assetPath,
        },
      ));
    }
  }

  for (const background of inspection.backgrounds) {
    if (background.urls.length === 0) continue;

    if (background.element !== 'body') {
      critical.push(buildImageIssue(
        'critical',
        'unsupported-background-image',
        'Non-body background-image usage is not supported for slide content. Use <img src="./assets/<file>"> instead.',
        {
          slide: fileName,
          element: buildElementPath(background.element),
          backgroundImage: background.backgroundImage,
          sources: background.urls,
        },
      ));
    }

    const issues = buildImageContractReport({
      slideFile: fileName,
      sources: background.urls.map((source) => ({
        element: buildElementPath(background.element),
        source,
      })),
    });

    for (const issue of issues) {
      const code = issue.code === 'remote-image-url'
        ? 'remote-background-image-url'
        : issue.code === 'remote-image-url-insecure'
          ? 'remote-background-image-url-insecure'
          : issue.code;
      const nextIssue = { ...issue, code };
      const target = issue.severity === 'critical' ? critical : warning;
      target.push(nextIssue);
    }

    for (const source of background.urls) {
      const classification = classifyImageSource(source);
      if (shouldSkipLocalAssetExistenceCheck(classification)) {
        continue;
      }

      const assetPath = resolveSlideSourcePath(slidePath, source);
      if (!(await fileExists(assetPath))) {
        critical.push(buildImageIssue(
          'critical',
          'missing-local-background-asset',
          'Background image references a missing local asset.',
          {
            slide: fileName,
            element: buildElementPath(background.element),
            source,
            assetPath,
          },
        ));
      }
    }
  }

  return { critical, warning };
}

async function inspectVideoContract(slidesDir, fileName, inspection) {
  const critical = [];
  const warning = [];
  const slidePath = join(slidesDir, fileName);

  for (const video of inspection.videos) {
    const sources = [...new Set([
      typeof video.src === 'string' ? video.src : '',
      ...video.sources,
    ].map((source) => source.trim()).filter(Boolean))];

    const issues = buildVideoContractReport({
      slideFile: fileName,
      sources: sources.map((source) => ({
        element: buildElementPath(video.element),
        source,
      })),
    });

    for (const issue of issues) {
      const target = issue.severity === 'critical' ? critical : warning;
      target.push(issue);
    }

    for (const source of sources) {
      const classification = classifyImageSource(source);
      if (shouldSkipLocalAssetExistenceCheck(classification)) {
        continue;
      }

      const assetPath = resolveSlideSourcePath(slidePath, source);
      if (!(await fileExists(assetPath))) {
        critical.push(buildImageIssue(
          'critical',
          'missing-local-video-asset',
          'Local video asset is missing.',
          {
            slide: fileName,
            element: buildElementPath(video.element),
            source,
            assetPath,
          },
        ));
      }
    }

    const poster = typeof video.poster === 'string' ? video.poster.trim() : '';
    if (!poster) {
      continue;
    }

    const posterIssues = buildImageContractReport({
      slideFile: fileName,
      sources: [{
        element: buildElementPath(video.element),
        source: poster,
      }],
    });

    for (const issue of posterIssues) {
      const target = issue.severity === 'critical' ? critical : warning;
      target.push(issue);
    }

    const posterClassification = classifyImageSource(poster);
    if (shouldSkipLocalAssetExistenceCheck(posterClassification)) {
      continue;
    }

    const posterPath = resolveSlideSourcePath(slidePath, poster);
    if (!(await fileExists(posterPath))) {
      critical.push(buildImageIssue(
        'critical',
        'missing-local-video-poster-asset',
        'Video poster image is missing.',
        {
          slide: fileName,
          element: buildElementPath(video.element),
          source: poster,
          assetPath: posterPath,
        },
      ));
    }
  }

  return { critical, warning };
}

export async function findSlideFiles(slidesDir) {
  const entries = await readdir(slidesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SLIDE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort(sortSlideFiles);
}

export function selectSlideFiles(slideFiles, selectedSlides = [], slidesDir = '') {
  if (!Array.isArray(selectedSlides) || selectedSlides.length === 0) {
    return slideFiles;
  }

  const requested = [...new Set(
    selectedSlides
      .map((slide) => basename(String(slide).trim()))
      .filter(Boolean),
  )];

  const available = new Set(slideFiles);
  const missing = requested.filter((slide) => !available.has(slide));
  if (missing.length > 0) {
    const location = slidesDir ? ` in ${slidesDir}` : '';
    throw new Error(`Requested slide file(s) not found${location}: ${missing.join(', ')}`);
  }

  return slideFiles.filter((slide) => available.has(slide) && requested.includes(slide));
}

export async function inspectSlide(page, fileName, slidesDir, slideMode = DEFAULT_SLIDE_MODE) {
  const slidePath = join(slidesDir, fileName);
  const slideUrl = pathToFileURL(slidePath).href;
  const { framePx, sizeLabel } = getSlideModeConfig(slideMode);

  await page.goto(slideUrl, { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });

  const inspection = await page.evaluate(
    ({ framePx, sizeLabel, textSelector, tolerancePx }) => {
      const skipTags = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'TITLE', 'NOSCRIPT']);
      const critical = [];
      const warning = [];
      const seenOverlaps = new Set();
      const cssUrlRe = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

      const round = (value) => Number(value.toFixed(2));
      const extractUrls = (value) => {
        const input = typeof value === 'string' ? value : '';
        const matches = [];
        let match;
        cssUrlRe.lastIndex = 0;
        while ((match = cssUrlRe.exec(input)) !== null) {
          const candidate = (match[2] || '').trim();
          if (candidate) {
            matches.push(candidate);
          }
        }
        return matches;
      };

      const normalizeRect = (rect) => {
        const left = rect.left ?? rect.x ?? 0;
        const top = rect.top ?? rect.y ?? 0;
        const width = rect.width ?? (rect.right - left) ?? 0;
        const height = rect.height ?? (rect.bottom - top) ?? 0;
        const right = rect.right ?? (left + width);
        const bottom = rect.bottom ?? (top + height);
        return {
          x: round(left),
          y: round(top),
          width: round(width),
          height: round(height),
          left: round(left),
          top: round(top),
          right: round(right),
          bottom: round(bottom),
        };
      };

      const inspectCanvasPaint = (canvas) => {
        const rect = canvas.getBoundingClientRect();
        const context = canvas.getContext('2d');
        const metrics = {
          layoutWidth: round(rect.width),
          layoutHeight: round(rect.height),
          bufferWidth: canvas.width,
          bufferHeight: canvas.height,
          sampledPixels: 0,
          paintedSamples: 0,
        };

        if (!context || canvas.width <= 0 || canvas.height <= 0) {
          return {
            empty: true,
            reason: !context ? '2d-context-unavailable' : 'zero-size-drawing-buffer',
            metrics,
          };
        }

        try {
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const totalPixels = canvas.width * canvas.height;
          let sampledPixels = 0;
          let paintedSamples = 0;

          for (let alphaIndex = 3; alphaIndex < imageData.length; alphaIndex += 4) {
            sampledPixels += 1;
            if (imageData[alphaIndex] !== 0) {
              paintedSamples += 1;
              break;
            }
          }

          metrics.sampledPixels = sampledPixels;
          metrics.paintedSamples = paintedSamples;

          return {
            empty: paintedSamples === 0,
            reason: paintedSamples === 0 ? 'transparent-drawing-buffer' : '',
            metrics,
          };
        } catch (error) {
          return {
            empty: true,
            reason: 'drawing-buffer-unreadable',
            metrics: {
              ...metrics,
              detail: error instanceof Error ? error.message : String(error),
            },
          };
        }
      };

      const elementPath = (element) => {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
        if (element === document.body) return 'body';

        const parts = [];
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
          let part = current.tagName.toLowerCase();
          if (current.id) {
            part += `#${current.id}`;
            parts.unshift(part);
            break;
          }

          const classNames = Array.from(current.classList).slice(0, 2);
          if (classNames.length > 0) {
            part += `.${classNames.join('.')}`;
          }

          if (current.parentElement) {
            const siblingsOfSameTag = Array.from(current.parentElement.children)
              .filter((sibling) => sibling.tagName === current.tagName);
            if (siblingsOfSameTag.length > 1) {
              const index = siblingsOfSameTag.indexOf(current);
              part += `:nth-of-type(${index + 1})`;
            }
          }

          parts.unshift(part);
          current = current.parentElement;
        }

        return `body > ${parts.join(' > ')}`;
      };

      const isVisible = (element) => {
        if (skipTags.has(element.tagName)) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const collectDeclaredBackgroundValues = (element) => {
        const values = [];
        const pushValue = (value) => {
          if (
            typeof value !== 'string'
            || value === ''
            || value === 'none'
            || !value.includes('url(')
            || values.includes(value)
          ) {
            return;
          }
          values.push(value);
        };

        pushValue(element.style?.getPropertyValue('background-image'));
        pushValue(element.style?.getPropertyValue('background'));

        const visitRules = (rules) => {
          for (const rule of Array.from(rules || [])) {
            if (rule.type === CSSRule.STYLE_RULE) {
              let matches = false;
              try {
                matches = element.matches(rule.selectorText);
              } catch {
                matches = false;
              }

              if (!matches) continue;
              pushValue(rule.style?.getPropertyValue('background-image'));
              pushValue(rule.style?.getPropertyValue('background'));
              continue;
            }

            if ('cssRules' in rule) {
              try {
                visitRules(rule.cssRules);
              } catch {
                // Ignore cross-origin and invalid stylesheet access.
              }
            }
          }
        };

        for (const sheet of Array.from(document.styleSheets)) {
          try {
            visitRules(sheet.cssRules);
          } catch {
            // Ignore cross-origin stylesheets.
          }
        }

        return values;
      };

      // Detect persisted runtime-only editor/viewer injections.
      const baseElements = Array.from(document.querySelectorAll('head base[href]'));
      for (const base of baseElements) {
        critical.push({
          code: 'persisted-editor-base-tag',
          message: 'Slide contains a <base> tag injected by the editor runtime. Remove it so asset paths resolve correctly outside the editor.',
          element: 'head > base',
          detail: base.getAttribute('href'),
        });
      }

      const editorScriptSignatures = ['[slides-grab:image]', '[slides-grab:'];
      const scripts = Array.from(document.querySelectorAll('head script:not([src])'));
      for (const script of scripts) {
        const text = script.textContent || '';
        const matched = editorScriptSignatures.some((sig) => text.includes(sig));
        if (matched) {
          critical.push({
            code: 'persisted-editor-script',
            message: 'Slide contains a runtime-only editor script that should not be persisted. Remove the injected <script> block.',
            element: 'head > script',
          });
        }
      }

      const bodyRect = document.body.getBoundingClientRect();
      const frameRect = {
        left: bodyRect.left,
        top: bodyRect.top,
        right: bodyRect.left + (bodyRect.width || framePx.width),
        bottom: bodyRect.top + (bodyRect.height || framePx.height),
        width: bodyRect.width || framePx.width,
        height: bodyRect.height || framePx.height,
      };

      const allVisibleElements = Array.from(document.body.querySelectorAll('*')).filter(isVisible);
      const visibleSet = new Set(allVisibleElements);

      for (const element of allVisibleElements) {
        const rect = element.getBoundingClientRect();
        const outsideFrame = (
          rect.left < frameRect.left - tolerancePx
          || rect.top < frameRect.top - tolerancePx
          || rect.right > frameRect.right + tolerancePx
          || rect.bottom > frameRect.bottom + tolerancePx
        );

        if (outsideFrame) {
          critical.push({
            code: 'overflow-outside-frame',
            message: `Element exceeds the ${sizeLabel} slide frame.`,
            element: elementPath(element),
            bbox: normalizeRect(rect),
            frame: normalizeRect(frameRect),
          });
        }
      }

      const textElements = Array.from(document.querySelectorAll(textSelector));
      for (const element of textElements) {
        if (!isVisible(element)) continue;
        const content = (element.textContent || '').trim();
        if (!content) continue;

        const clipped = element.scrollHeight > element.clientHeight;
        if (!clipped) continue;

        critical.push({
          code: 'text-clipped',
          message: 'Text element is clipped because scrollHeight is larger than clientHeight.',
          element: elementPath(element),
          metrics: {
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
          },
          bbox: normalizeRect(element.getBoundingClientRect()),
        });
      }

      const canvases = Array.from(document.querySelectorAll('canvas'));
      for (const canvas of canvases) {
        if (!isVisible(canvas)) continue;

        const result = inspectCanvasPaint(canvas);
        if (!result.empty) continue;

        critical.push({
          code: 'empty-canvas',
          message: 'Canvas has visible layout size but no painted pixels. Chart.js and other canvas charts must render before validation.',
          element: elementPath(canvas),
          detail: result.reason,
          metrics: result.metrics,
          bbox: normalizeRect(canvas.getBoundingClientRect()),
        });
      }

      const parents = [document.body, ...allVisibleElements];
      for (const parent of parents) {
        const children = Array.from(parent.children).filter((child) => visibleSet.has(child));
        if (children.length < 2) continue;

        for (let i = 0; i < children.length; i += 1) {
          for (let j = i + 1; j < children.length; j += 1) {
            const first = children[i];
            const second = children[j];

            const rectA = first.getBoundingClientRect();
            const rectB = second.getBoundingClientRect();

            const overlapWidth = Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left);
            const overlapHeight = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);

            if (overlapWidth <= tolerancePx || overlapHeight <= tolerancePx) continue;

            const firstPath = elementPath(first);
            const secondPath = elementPath(second);
            const overlapKey = [firstPath, secondPath].sort().join('::');

            if (seenOverlaps.has(overlapKey)) continue;
            seenOverlaps.add(overlapKey);

            warning.push({
              code: 'sibling-overlap',
              message: 'Sibling elements overlap in their bounding boxes.',
              parent: elementPath(parent),
              elements: [firstPath, secondPath],
              intersection: {
                x: round(Math.max(rectA.left, rectB.left)),
                y: round(Math.max(rectA.top, rectB.top)),
                width: round(overlapWidth),
                height: round(overlapHeight),
              },
              boxes: [normalizeRect(rectA), normalizeRect(rectB)],
            });
          }
        }
      }

      const images = Array.from(document.querySelectorAll('img')).map((element) => ({
        element: elementPath(element),
        src: (element.getAttribute('src') || '').trim(),
        alt: (element.getAttribute('alt') || '').trim(),
      }));

      const videos = Array.from(document.querySelectorAll('video')).map((element) => ({
        element: elementPath(element),
        src: (element.getAttribute('src') || '').trim(),
        sources: Array.from(element.querySelectorAll('source[src]'))
          .map((source) => (source.getAttribute('src') || '').trim())
          .filter(Boolean),
        poster: (element.getAttribute('poster') || '').trim(),
      }));

      const backgrounds = [document.body, ...Array.from(document.body.querySelectorAll('*'))]
        .map((element) => {
          const computedBackgroundImage = window.getComputedStyle(element).backgroundImage;
          const declaredBackgroundValues = collectDeclaredBackgroundValues(element);
          const declaredBackgroundImage = declaredBackgroundValues.find((value) => extractUrls(value).length > 0) || '';
          const declaredUrls = declaredBackgroundValues.flatMap(extractUrls);
          const urls = declaredUrls.length > 0 ? declaredUrls : extractUrls(computedBackgroundImage);

          return {
            element: element === document.body ? 'body' : elementPath(element),
            backgroundImage: declaredBackgroundImage || computedBackgroundImage,
            urls,
          };
        })
        .filter((entry) => entry.urls.length > 0);

      const templateMetadata = (() => {
        const commentNodes = [
          ...Array.from(document.head?.childNodes || []),
          ...Array.from(document.body?.childNodes || []),
        ].filter((node) => node.nodeType === 8);
        for (const node of commentNodes) {
          const text = node.nodeValue || '';
          const match = text.match(/slides-grab-template:\s*(\{[\s\S]*?\})/);
          if (!match) continue;
          try {
            const parsed = JSON.parse(match[1]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              return {
                layoutId: parsed.layoutId ?? parsed.layout_id ?? null,
                layoutKind: parsed.layoutKind ?? parsed.layout_kind ?? null,
              };
            }
          } catch {
            // Ignore malformed template metadata comments so legacy slides stay untouched.
          }
        }
        return null;
      })();

      const templateRoleText = {};
      const normalizeTemplateRole = (role) => {
        const value = typeof role === 'string' ? role.trim() : '';
        return /^[a-z][a-z0-9_-]{0,63}$/i.test(value) ? value : '';
      };
      const textForRoleElement = (element) => {
        const listItems = Array.from(element.querySelectorAll?.('li') || [])
          .map((item) => (item.textContent || '').trim())
          .filter(Boolean);
        if (listItems.length > 0) return listItems;
        return (element.textContent || '').trim();
      };
      const addTemplateRoleText = (role, value) => {
        const normalizedRole = normalizeTemplateRole(role);
        if (!normalizedRole) return;
        const values = Array.isArray(value)
          ? value.map((entry) => (entry || '').trim()).filter(Boolean)
          : [(value || '').trim()].filter(Boolean);
        if (values.length === 0) return;
        const existing = templateRoleText[normalizedRole];
        if (existing === undefined) {
          templateRoleText[normalizedRole] = values.length === 1 ? values[0] : values;
          return;
        }
        const existingValues = Array.isArray(existing) ? existing : [existing];
        const merged = [...existingValues];
        for (const entry of values) {
          if (!merged.includes(entry)) merged.push(entry);
        }
        templateRoleText[normalizedRole] = merged.length === 1 ? merged[0] : merged;
      };
      if (templateMetadata) {
        for (const element of Array.from(document.body.querySelectorAll('[data-template-role]'))) {
          addTemplateRoleText(element.getAttribute('data-template-role'), textForRoleElement(element));
        }
        for (const element of Array.from(document.body.querySelectorAll('[class]'))) {
          const value = textForRoleElement(element);
          for (const className of Array.from(element.classList)) {
            addTemplateRoleText(className, value);
          }
        }
        const title = document.querySelector('h1') || document.querySelector('h2');
        addTemplateRoleText('title', title ? title.textContent || '' : '');
        const subtitle = document.querySelector('h2') || document.querySelector('.subtitle');
        addTemplateRoleText('subtitle', subtitle ? subtitle.textContent || '' : '');
        addTemplateRoleText('bullets', Array.from(document.querySelectorAll('li'))
          .map((item) => (item.textContent || '').trim())
          .filter(Boolean));
      }

      return {
        critical,
        warning,
        images,
        videos,
        backgrounds,
        template: {
          metadata: templateMetadata,
          roleText: templateRoleText,
        },
      };
    },
    {
      framePx,
      sizeLabel,
      textSelector: TEXT_SELECTOR,
      tolerancePx: TOLERANCE_PX,
    },
  );

  const imageContractIssues = await inspectImageContract(slidesDir, fileName, {
    images: inspection.images,
    backgrounds: inspection.backgrounds,
  });
  const videoContractIssues = await inspectVideoContract(slidesDir, fileName, {
    videos: inspection.videos,
  });

  inspection.critical.push(...imageContractIssues.critical);
  inspection.warning.push(...imageContractIssues.warning);
  inspection.critical.push(...videoContractIssues.critical);
  inspection.warning.push(...videoContractIssues.warning);
  const templateMetadata = inspection.template?.metadata;
  if (templateMetadata) {
    try {
      const pack = loadTemplatePackFromSlidesDir(slidesDir, { optional: true });
      if (pack && Array.isArray(pack.layouts)) {
        const selectedLayout = pack.layouts.find(
          (layout) => layout && layout.layoutId === templateMetadata.layoutId,
        );
        if (selectedLayout) {
          const roleText = inspection.template?.roleText || {};
          const densityWarnings = checkLayoutDensity(roleText, selectedLayout);
          inspection.warning.push(...densityWarnings);
        }
      }
    } catch (error) {
      if (error instanceof TemplatePackError) {
        inspection.warning.push(buildIssue(
          'template-pack-invalid',
          'Template pack could not be loaded for density checks; fix .slides-grab/template-pack.json to enable template validation.',
          { detail: error.message },
        ));
      } else {
        throw error;
      }
    }
  }

  const summary = {
    criticalCount: inspection.critical.length,
    warningCount: inspection.warning.length,
  };

  return {
    slide: fileName,
    status: summary.criticalCount > 0 ? 'fail' : 'pass',
    critical: inspection.critical,
    warning: inspection.warning,
    summary,
  };
}

export async function scanSlides(page, slidesDir, slideFiles, slideMode = DEFAULT_SLIDE_MODE) {
  const slides = [];

  for (const slideFile of slideFiles) {
    try {
      const result = await inspectSlide(page, slideFile, slidesDir, slideMode);
      slides.push(result);
    } catch (error) {
      slides.push({
        slide: slideFile,
        status: 'fail',
        critical: [
          buildIssue(
            'slide-validation-error',
            'Slide validation failed before checks could complete.',
            { detail: error instanceof Error ? error.message : String(error) },
          ),
        ],
        warning: [],
        summary: {
          criticalCount: 1,
          warningCount: 0,
        },
      });
    }
  }

  return slides;
}

export function formatValidationFailureForExport(result, exportLabel = 'Export') {
  const findings = [];

  for (const slide of result.slides) {
    if (slide.status !== 'fail') continue;
    for (const issue of slide.critical) {
      const source = typeof issue.source === 'string' ? ` (${issue.source})` : '';
      findings.push(`- ${slide.slide}: ${issue.code}${source}`);
      if (findings.length >= 8) break;
    }
    if (findings.length >= 8) break;
  }

  const suffix = findings.length > 0 ? `\n${findings.join('\n')}` : '';
  const modeHint = result.slideMode && result.slideMode !== DEFAULT_SLIDE_MODE
    ? ` --mode ${result.slideMode}`
    : '';
  return `${exportLabel} blocked by slide validation. Run \`slides-grab validate --slides-dir <path>${modeHint}\` for full diagnostics.${suffix}`;
}

const EXPORT_BLOCKING_IMAGE_CONTRACT_CODES = new Set([
  'absolute-filesystem-image-path',
  'absolute-filesystem-video-path',
  'missing-local-asset',
  'missing-local-background-asset',
  'missing-local-video-asset',
  'missing-local-video-poster-asset',
  'remote-background-image-url',
  'remote-background-image-url-insecure',
  'remote-image-url',
  'remote-image-url-insecure',
  'remote-video-url',
  'remote-video-url-insecure',
  'root-relative-image-path',
  'root-relative-video-path',
  'unsupported-image-url-scheme',
  'unsupported-video-url-scheme',
  'unsupported-background-image',
]);

function filterExportBlockingSlides(result, shouldBlockIssue) {
  const slides = result.slides
    .map((slide) => {
      const critical = slide.critical.filter(shouldBlockIssue);
      const warning = slide.warning.filter(shouldBlockIssue);
      const criticalCount = critical.length;
      const warningCount = warning.length;
      return {
        ...slide,
        status: criticalCount > 0 ? 'fail' : 'pass',
        critical,
        warning,
        summary: {
          ...slide.summary,
          criticalCount,
          warningCount,
        },
      };
    })
    .filter((slide) => slide.critical.length > 0 || slide.warning.length > 0);

  return {
    ...result,
    slides,
    summary: summarizeSlides(slides),
  };
}

export function isBlockingImageContractIssue(issue) {
  return EXPORT_BLOCKING_IMAGE_CONTRACT_CODES.has(issue?.code);
}

export async function ensureSlidesPassValidation(
  slidesDir,
  {
    exportLabel = 'Export',
    selectedSlides = [],
    slideMode = DEFAULT_SLIDE_MODE,
    shouldBlockIssue = isBlockingImageContractIssue,
  } = {},
) {
  const slideFiles = selectSlideFiles(await findSlideFiles(slidesDir), selectedSlides, slidesDir);
  if (slideFiles.length === 0) {
    throw new Error(`No slide-*.html files found in: ${slidesDir}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    const slides = await scanSlides(page, slidesDir, slideFiles, slideMode);
    const result = {
      ...createValidationResult(slides, slideMode),
      slideMode,
    };
    const blockingResult = filterExportBlockingSlides(result, shouldBlockIssue);
    if (blockingResult.summary.failedSlides > 0) {
      throw new Error(formatValidationFailureForExport(blockingResult, exportLabel));
    }
    return blockingResult;
  } finally {
    await browser.close();
  }
}
