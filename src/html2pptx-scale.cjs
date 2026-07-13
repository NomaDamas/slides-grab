const PX_PER_IN = 96;
const EMU_PER_IN = 914400;

function validateDimensions(bodyDimensions, pres, options = {}) {
  const errors = [];
  const widthInches = bodyDimensions.width / PX_PER_IN;
  const heightInches = bodyDimensions.height / PX_PER_IN;
  const { fitToLayout = false } = options;

  if (!pres.presLayout) return errors;

  const layoutWidth = pres.presLayout.width / EMU_PER_IN;
  const layoutHeight = pres.presLayout.height / EMU_PER_IN;

  if (fitToLayout) {
    const sourceAspectRatio = widthInches / heightInches;
    const layoutAspectRatio = layoutWidth / layoutHeight;
    if (Math.abs(sourceAspectRatio - layoutAspectRatio) > 0.01) {
      errors.push(
        `HTML aspect ratio (${widthInches.toFixed(1)}" × ${heightInches.toFixed(1)}") ` +
        `doesn't match presentation layout (${layoutWidth.toFixed(1)}" × ${layoutHeight.toFixed(1)}")`,
      );
    }
    return errors;
  }

  if (Math.abs(layoutWidth - widthInches) > 0.1 || Math.abs(layoutHeight - heightInches) > 0.1) {
    errors.push(
      `HTML dimensions (${widthInches.toFixed(1)}" × ${heightInches.toFixed(1)}") ` +
      `don't match presentation layout (${layoutWidth.toFixed(1)}" × ${layoutHeight.toFixed(1)}")`,
    );
  }
  return errors;
}

function getLayoutScale(bodyDimensions, pres) {
  if (!pres.presLayout) {
    return { x: 1, y: 1, point: 1 };
  }

  const layoutWidth = pres.presLayout.width / EMU_PER_IN;
  const layoutHeight = pres.presLayout.height / EMU_PER_IN;
  const sourceWidth = bodyDimensions.width / PX_PER_IN;
  const sourceHeight = bodyDimensions.height / PX_PER_IN;
  const x = layoutWidth / sourceWidth;
  const y = layoutHeight / sourceHeight;

  return { x, y, point: (x + y) / 2 };
}

function scaleTextRun(run, pointScale) {
  if (!run || !run.options) return;
  if (Number.isFinite(run.options.fontSize)) run.options.fontSize *= pointScale;
  if (run.options.bullet && Number.isFinite(run.options.bullet.indent)) {
    run.options.bullet.indent *= pointScale;
  }
}

function scaleSlideData(slideData, scale) {
  if (!slideData || (Math.abs(scale.x - 1) < 0.001 && Math.abs(scale.y - 1) < 0.001)) {
    return;
  }

  for (const placeholder of slideData.placeholders || []) {
    placeholder.x *= scale.x;
    placeholder.y *= scale.y;
    placeholder.w *= scale.x;
    placeholder.h *= scale.y;
  }

  for (const element of slideData.elements || []) {
    if (element.position) {
      element.position.x *= scale.x;
      element.position.y *= scale.y;
      element.position.w *= scale.x;
      element.position.h *= scale.y;
    }

    if (element.type === 'line') {
      element.x1 *= scale.x;
      element.x2 *= scale.x;
      element.y1 *= scale.y;
      element.y2 *= scale.y;
      element.width *= scale.point;
    }

    if (element.style) {
      for (const key of ['fontSize', 'lineSpacing', 'paraSpaceBefore', 'paraSpaceAfter']) {
        if (Number.isFinite(element.style[key])) element.style[key] *= scale.point;
      }
      if (Array.isArray(element.style.margin)) {
        element.style.margin = element.style.margin.map((value) => value * scale.point);
      }
    }

    if (element.shape) {
      if (Number.isFinite(element.shape.rectRadius)) element.shape.rectRadius *= scale.point;
      if (element.shape.line && Number.isFinite(element.shape.line.width)) {
        element.shape.line.width *= scale.point;
      }
      if (element.shape.shadow) {
        if (Number.isFinite(element.shape.shadow.blur)) element.shape.shadow.blur *= scale.point;
        if (Number.isFinite(element.shape.shadow.offset)) element.shape.shadow.offset *= scale.point;
      }
    }

    if (Array.isArray(element.text)) {
      for (const run of element.text) scaleTextRun(run, scale.point);
    }
    if (Array.isArray(element.items)) {
      for (const run of element.items) scaleTextRun(run, scale.point);
    }
  }
}

module.exports = {
  getLayoutScale,
  scaleSlideData,
  validateDimensions,
};
