# slides-grab for ChatGPT Work/Web

This package exposes the published `slides-grab` skills through ChatGPT's plugin
format. Install the generated ZIP from a ChatGPT Work/Web plugin or local
marketplace interface.

## Supported in hosted ChatGPT

- Presentation planning, outlining, and design guidance
- HTML slide and card-news authoring when the workspace allows file creation
- Skill routing between the bundled planning, design, export, and card-news
  workflows

## Runtime-dependent capabilities

PDF, PNG, experimental PPTX/Figma export, visual validation, the local editor,
and image generation call the `slides-grab` Node.js runtime. They additionally
require some combination of Node.js 20+, Playwright Chromium, local
subprocesses, filesystem access, and provider credentials.

If the ChatGPT environment does not expose those capabilities, use the plugin
for planning and design, then run the generated files locally with the npm
package:

```bash
npm install slides-grab
npx playwright install chromium
```

The plugin package does not include an MCP server or a hosted replacement for
the local runtime. Runtime-dependent steps should report the missing capability
instead of implying that an export completed.
