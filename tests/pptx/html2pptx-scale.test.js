import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  getLayoutScale,
  scaleSlideData,
  validateDimensions,
} = require('../../src/html2pptx-scale.cjs');

const EMU_PER_IN = 914400;

test('fit-to-layout validates aspect ratio and calculates presentation scaling', () => {
  const bodyDimensions = { width: 960, height: 540 };
  const pres = {
    presLayout: {
      width: 13.33 * EMU_PER_IN,
      height: 7.5 * EMU_PER_IN,
    },
  };

  const scale = getLayoutScale(bodyDimensions, pres);
  assert.ok(Math.abs(scale.x - 1.333) < 0.001);
  assert.ok(Math.abs(scale.y - (4 / 3)) < 0.001);
  assert.deepEqual(validateDimensions(bodyDimensions, pres, { fitToLayout: true }), []);
  assert.match(validateDimensions(bodyDimensions, pres)[0], /don't match presentation layout/);

  const squareBody = { width: 960, height: 960 };
  assert.match(validateDimensions(squareBody, pres, { fitToLayout: true })[0], /aspect ratio/);
});

test('scaleSlideData transforms every supported geometry and typography field', () => {
  const slideData = {
    placeholders: [{ x: 1, y: 2, w: 3, h: 4 }],
    elements: [
      {
        type: 'line',
        x1: 1,
        y1: 2,
        x2: 3,
        y2: 4,
        width: 5,
      },
      {
        type: 'shape',
        position: { x: 1, y: 2, w: 3, h: 4 },
        shape: {
          rectRadius: 1,
          line: { width: 2 },
          shadow: { blur: 3, offset: 4 },
        },
      },
      {
        type: 'p',
        position: { x: 2, y: 3, w: 4, h: 5 },
        style: {
          fontSize: 10,
          lineSpacing: 12,
          paraSpaceBefore: 2,
          paraSpaceAfter: 3,
          margin: [1, 2, 3, 4],
        },
        text: [{ text: 'Run', options: { fontSize: 8 } }],
      },
      {
        type: 'list',
        position: { x: 3, y: 4, w: 5, h: 6 },
        style: { fontSize: 9, margin: [2, 0, 0, 0] },
        items: [{ text: 'Item', options: { fontSize: 7, bullet: { indent: 5 } } }],
      },
    ],
  };

  scaleSlideData(slideData, { x: 2, y: 3, point: 4 });

  assert.deepEqual(slideData.placeholders[0], { x: 2, y: 6, w: 6, h: 12 });
  assert.deepEqual(slideData.elements[0], {
    type: 'line',
    x1: 2,
    y1: 6,
    x2: 6,
    y2: 12,
    width: 20,
  });
  assert.deepEqual(slideData.elements[1], {
    type: 'shape',
    position: { x: 2, y: 6, w: 6, h: 12 },
    shape: {
      rectRadius: 4,
      line: { width: 8 },
      shadow: { blur: 12, offset: 16 },
    },
  });
  assert.deepEqual(slideData.elements[2], {
    type: 'p',
    position: { x: 4, y: 9, w: 8, h: 15 },
    style: {
      fontSize: 40,
      lineSpacing: 48,
      paraSpaceBefore: 8,
      paraSpaceAfter: 12,
      margin: [4, 8, 12, 16],
    },
    text: [{ text: 'Run', options: { fontSize: 32 } }],
  });
  assert.deepEqual(slideData.elements[3], {
    type: 'list',
    position: { x: 6, y: 12, w: 10, h: 18 },
    style: { fontSize: 36, margin: [8, 0, 0, 0] },
    items: [{ text: 'Item', options: { fontSize: 28, bullet: { indent: 20 } } }],
  });
});
