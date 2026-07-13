# PPTX Skill - Experimental / Unstable PowerPoint Conversion

Converts HTML slides into experimental / unstable PowerPoint presentation files on a best-effort basis.

## Feature Overview

### 1. New Presentation (HTML -> PPTX)
Convert HTML slide files to experimental / unstable PowerPoint output

### 2. Edit Existing Presentation
Modify contents of a PPTX file

### 3. Thumbnail Generation
Generate preview images of a presentation

## Prerequisites (Stage 3)

This skill is **Stage 3**. It executes only when ALL of the following conditions are met:

1. **Explicit user request required**: Only run when the user explicitly requests PPTX conversion ("convert to PPTX", "make a PowerPoint", etc.).
2. **HTML slides reviewed**: All HTML slides must have been reviewed and approved by the user in `viewer.html`.
3. **No automatic execution**: Do not automatically start PPTX conversion just because slide generation is complete.

If prerequisites are not met, guide the user to review slides in `<slides-dir>/viewer.html` first (default: `slides/viewer.html`).

---

## Core Workflow

### HTML -> PPTX Conversion

1. **Prepare HTML slides**
   - Verify HTML files exist in selected `--slides-dir` (default: `slides/`)
   - Validate each file is 720pt x 405pt (16:9) specification

2. **Run the editable-text engine** (experimental / unstable)
   ```bash
   slides-grab convert --slides-dir <path> --output presentation.pptx --engine text
   ```
   - Use the packaged `slides-grab convert` command rather than runtime-local skill scripts.
   - Omit `--engine text` to use the default raster engine for higher visual fidelity.

3. **Verify results**
   - Check generated PPTX file carefully; expect best-effort fidelity only
   - Visual verification via thumbnail

## Script Usage

### Programmatic Conversion Note
The packaged runtime exposes PPTX conversion through `slides-grab convert`. Do not import converter files from runtime-local skill directories in installed-agent workflows.

```bash
slides-grab convert --slides-dir <path> --output presentation.pptx --engine text
```

### Thumbnail / OOXML Inspection

Use standard local tools such as LibreOffice, Poppler, or OOXML unzip/zip inspection when you need thumbnails or package-level debugging. These steps are diagnostic aids, not required packaged runtime commands.

```bash
unzip presentation.pptx -d output_dir
```

## Reference Documents

- [html2pptx.md](html2pptx.md) - HTML to PPTX conversion detailed guide
- [ooxml.md](ooxml.md) - Office Open XML technical reference

## PptxGenJS Key Rules

### Color Codes
```javascript
// Correct - without #
{ color: 'FF0000' }

// Wrong - causes file corruption
{ color: '#FF0000' }
```

### Adding Slides
```javascript
const slide = pres.addSlide();

// Add text
slide.addText('Title', {
  x: 0.5,
  y: 0.5,
  w: 9,
  h: 1,
  fontSize: 36,
  color: '1a1a2e',
  bold: true
});

// Add image
slide.addImage({
  path: 'image.png',
  x: 1,
  y: 2,
  w: 4,
  h: 3
});

// Add shape
slide.addShape(pres.ShapeType.rect, {
  x: 0.5,
  y: 1,
  w: 3,
  h: 2,
  fill: { color: '1e3a5f' }
});
```

### Adding Charts
```javascript
// Bar chart
slide.addChart(pres.ChartType.bar, [
  {
    name: 'Series 1',
    labels: ['A', 'B', 'C'],
    values: [10, 20, 30]
  }
], {
  x: 1,
  y: 2,
  w: 8,
  h: 4
});

// Pie chart
slide.addChart(pres.ChartType.pie, [...], {...});

// Line chart
slide.addChart(pres.ChartType.line, [...], {...});
```

## Full Conversion Process

```
+-------------------+
|   HTML Slides     |
| <slides-dir>/*.html |
+---------+---------+
          |
          v
+-------------------+
|  html2pptx.js     |
|  (Playwright +    |
|   PptxGenJS)      |
+---------+---------+
          |
          v
+-------------------+
|   PPTX File       |
| presentation.pptx |
+---------+---------+
          |
          v
+-------------------+
|  thumbnail.py     |
|  (Preview)        |
+-------------------+
```

## Dependencies

### Node.js
- pptxgenjs: PowerPoint generation
- playwright: Browser rendering
- sharp: Image processing

### Python
- markitdown: Markdown conversion
- defusedxml: XML parsing
- pillow: Image processing

### System
- LibreOffice: PDF/image conversion (soffice)
- Poppler: PDF to image (pdftoppm)

## Important Notes

- PPTX export is **experimental / unstable** and may require manual cleanup after generation.

1. **Color codes**: No `#` prefix in PptxGenJS
2. **Fonts**: Web-safe fonts only
3. **Text**: Only p, h1-h6, ul, ol tags are converted
4. **Gradients**: Replace CSS gradients with images
5. **Validation**: Always verify with thumbnails after conversion
