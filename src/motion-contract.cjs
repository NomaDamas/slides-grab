const MOTION_ACTIVE_CLASS = 'slides-grab-motion-active';
const MOTION_ROOT_ATTRIBUTE = 'data-slides-grab-motion-root';

const STATIC_MOTION_STYLE = `
html[data-motion="static"] *,
html[data-motion="static"] *::before,
html[data-motion="static"] *::after {
  animation: none !important;
  transition: none !important;
}`;

const MOTION_RUNTIME_HTML = `<style data-slides-grab-runtime="motion">
${STATIC_MOTION_STYLE}
@media print, (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
<script data-slides-grab-runtime="motion">
(() => {
  const activeClass = ${JSON.stringify(MOTION_ACTIVE_CLASS)};
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let requestedActive = false;

  function renderMotionState() {
    const shouldAnimate = requestedActive
      && document.documentElement.dataset.motion !== 'static'
      && !motionPreference.matches;

    for (const root of document.querySelectorAll('[${MOTION_ROOT_ATTRIBUTE}]')) {
      root.classList.remove(activeClass);
      if (shouldAnimate) {
        void root.offsetWidth;
        root.classList.add(activeClass);
      }
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    let nextActive;
    if (event.data === 'slides-grab:activate') nextActive = true;
    else if (event.data === 'slides-grab:deactivate') nextActive = false;
    else return;
    if (requestedActive === nextActive) return;
    requestedActive = nextActive;
    renderMotionState();
  });

  motionPreference.addEventListener('change', renderMotionState);
})();
</script>`;

function buildStaticSlideHtml(html) {
  if (!new RegExp(`\\b${MOTION_ROOT_ATTRIBUTE}\\b`, 'i').test(html)) {
    return html;
  }

  const style = `<style data-slides-grab-runtime="motion-static">${STATIC_MOTION_STYLE}</style>`;
  if (!/<html\b[^>]*>/i.test(html)) {
    return `${style}\n<script data-slides-grab-runtime="motion-static">document.documentElement.dataset.motion = 'static';</script>\n${html}`;
  }

  const withMotionState = html.replace(/<html\b[^>]*>/i, (tag) => {
    if (/\bdata-motion\s*=/i.test(tag)) {
      return tag.replace(
        /\bdata-motion\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        'data-motion="static"',
      );
    }
    return tag.replace(/>$/, ' data-motion="static">');
  });
  if (/<head\b[^>]*>/i.test(withMotionState)) {
    return withMotionState.replace(/<head\b[^>]*>/i, (head) => `${head}\n${style}`);
  }
  return withMotionState.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n${style}`);
}

async function gotoStaticSlide(page, url, html) {
  if (!new RegExp(`\\b${MOTION_ROOT_ATTRIBUTE}\\b`, 'i').test(html)) {
    return page.goto(url, { waitUntil: 'load' });
  }

  const staticHtml = buildStaticSlideHtml(html);
  await page.route(url, (route) => route.fulfill({
    body: staticHtml,
    contentType: 'text/html',
  }));
  try {
    return await page.goto(url, { waitUntil: 'load' });
  } finally {
    await page.unroute(url);
  }
}

module.exports = {
  MOTION_ACTIVE_CLASS,
  MOTION_ROOT_ATTRIBUTE,
  MOTION_RUNTIME_HTML,
  buildStaticSlideHtml,
  gotoStaticSlide,
};
