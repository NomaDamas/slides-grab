# slides-grab 한국어 README

<p align="center">AI가 만든 HTML 슬라이드에서 원하는 영역을 직접 선택하고, 그 영역을 다시 AI에게 편집시킬 수 있는 에이전트 우선 발표 자료 프레임워크입니다.</p>

<p align="center">
  <a href="README.md">English README</a> | <strong>한국어</strong>
</p>

<p align="center">
  <a href="https://github.com/vkehfdl1/slides-grab/releases/download/v0.0.1-demo/demo.mp4">
    <img src="docs/assets/demo.gif" alt="slides-grab 데모" width="720">
  </a>
</p>

<p align="center">
  <strong>👉 slides-grab으로 무엇을 만들 수 있는지 확인하세요:</strong>
  <a href="https://vkehfdl1.github.io/slides-grab/"><strong>라이브 쇼케이스 갤러리</strong></a><br>
  slides-grab으로 만든 실제 발표 자료를 열고 슬라이드를 넘겨볼 수 있습니다.
</p>

---

## 빠른 시작

slides-grab은 슬라이드를 HTML과 CSS로 작성하고, 브라우저 기반 편집기에서 영역을 드래그해 수정 요청을 보낸 뒤 PDF 또는 실험적/불안정한 PPTX·Figma용 PPTX로 내보내는 도구입니다.

AI 코딩 에이전트에 아래 안내 중 하나를 붙여넣어 설치를 시작할 수 있습니다.

**Claude Code:**

```text
Read https://raw.githubusercontent.com/vkehfdl1/slides-grab/main/docs/installation/claude.md and follow every step.
```

**Codex:**

```text
Read https://raw.githubusercontent.com/vkehfdl1/slides-grab/main/docs/installation/codex.md and follow every step.
```

저장소를 직접 개발하거나 수정하려면 다음을 실행합니다.

```bash
git clone https://github.com/vkehfdl1/slides-grab.git && cd slides-grab
npm ci && npx playwright install chromium
```

> Node.js **20 이상**이 필요합니다.

### 설치: 저장소를 클론하지 않는 방법

CLI와 공유 에이전트 스킬만 사용하려면 npm 패키지를 설치하면 됩니다.

```bash
npm install slides-grab
npx playwright install chromium
npx slides-grab install-skills --target all --scope user
```

이 방법은 일반적인 사용에 충분합니다. slides-grab 자체를 수정하거나 기여하려는 경우에만 저장소를 클론하세요.

이 명령은 같은 공유 Agent Skills와 얇은 런타임 adapter를 Codex 런타임과 Claude Code 런타임 위치에 모두 설치합니다. 패키지된 워크플로우는 번들된 `SKILL.md`, `references/`, `slides-grab` CLI만 사용합니다. `slides-grab pdf`, `slides-grab convert`, `slides-grab figma` export는 현재 슬라이드 파일에 대한 최신 `slides-grab design-gate` `proceed` 기록이 없으면 차단됩니다.

## 왜 slides-grab인가요?

많은 AI 도구가 슬라이드 HTML을 생성하지만, 사용자가 화면에서 **수정하고 싶은 부분을 직접 가리키고** 그 자리에서 반복 편집할 수 있게 해 주는 도구는 드뭅니다. slides-grab은 다음 흐름을 제공합니다.

- **Plan** — 에이전트가 주제나 파일을 바탕으로 슬라이드 아웃라인을 만듭니다.
- **Design** — 에이전트가 각 슬라이드를 독립적인 HTML 파일로 작성합니다.
- **Edit** — 브라우저 편집기에서 bbox 영역 선택, 직접 텍스트 편집, 에이전트 기반 재작성을 수행합니다.
- **Export** — 한 명령으로 PDF를 만들고, 실험적/불안정한 PPTX 또는 Figma 가져오기용 PPTX도 생성할 수 있습니다.

## CLI 명령어

워크플로 명령은 `--slides-dir <path>`를 지원하며 기본값은 `slides`입니다.

새 클론에서는 `--help`, `list-templates`, `list-styles`, `preview-styles` 같은 탐색 명령은 덱 없이도 동작합니다. `edit`, `edit-image`, `build-viewer`, `validate`, `png`, `design-gate`는 `slide-*.html` 파일이 들어 있는 슬라이드 작업공간이 필요하고, `convert`, `pdf`, `figma`는 추가로 최신 `Proceed` design gate가 필요합니다.

```bash
slides-grab edit              # HTML 슬라이드 편집기 실행
slides-grab edit-image        # 이미지 네이티브 슬라이드 편집기 실행
slides-grab build-viewer      # 단일 viewer.html 생성
slides-grab validate          # Playwright 기반 슬라이드 HTML 검증
slides-grab convert           # 실험적/불안정한 PPTX로 내보내기
slides-grab convert --resolution 2160p  # 고해상도 래스터 PPTX 내보내기
slides-grab convert --engine text  # 편집 가능한 텍스트를 DOM 기반으로 내보내기
slides-grab figma             # Figma Slides 가져오기용 실험적/불안정한 PPTX 생성
slides-grab pdf               # 캡처 모드 PDF 내보내기(기본값)
slides-grab pdf --resolution 2160p  # 고해상도 이미지 기반 PDF 내보내기
slides-grab pdf --mode print  # 검색/선택 가능한 텍스트 PDF 내보내기
slides-grab png               # 슬라이드별 PNG 렌더링(기본 2160p)
slides-grab png --slide-mode card-news  # 인스타그램용 정사각형 PNG 렌더링
slides-grab image --prompt "..."    # 로컬 슬라이드 이미지 생성
slides-grab fetch-video --url <youtube-url> --slides-dir decks/my-deck  # yt-dlp로 동영상 에셋 다운로드
slides-grab tldraw            # .tldr 다이어그램을 슬라이드 크기의 로컬 SVG로 렌더링
slides-grab list-templates    # 사용 가능한 슬라이드 템플릿 표시
slides-grab list-styles       # 기본으로 선택 가능한 92개 디자인 스타일 표시 (3개 소스-앨리어스를 포함해 95개 해석 가능; --all로 전체 표시)
slides-grab preview-styles    # 95개 스타일 미리보기 갤러리를 브라우저에서 열기
```

## 디자인 스타일 모음

slides-grab은 [corazzon/pptx-design-styles](https://github.com/corazzon/pptx-design-styles)에서 파생된 30개 스타일, slides-grab 고유 스타일 5개, [epoko77-ai/design-diversity](https://github.com/epoko77-ai/design-diversity)에서 파생된 PPT 팩 60개를 포함해 총 95개 디자인 스타일을 제공합니다. 60개 design-diversity PPT 팩은 분류됩니다 — 직접 중복은 빌트인에 앨리어스 처리(기본 숨김)되고, 유사 중복은 `relatedStyleIds`로 연결되며, 완전히 새 팩은 추가됩니다. 따라서 92개만 기본으로 선택 가능하며 95개 모두 해석 가능합니다(`list-styles --all`로 앨리어스 확인). 에이전트에게 특정 스타일을 요청하거나 완전히 커스텀 디자인을 요청할 수 있습니다.

```bash
slides-grab list-styles
slides-grab preview-styles
```

## 레퍼런스 템플릿 및 이미지 네이티브 작업 흐름

기존 회사 덱, 채워진 예시 슬라이드, HTML 레퍼런스 화면, 브랜드 이미지를 새 덱의 기준으로 삼으려면 `slides-grab import-template`를 사용하세요. **채워진 대표 덱**을 빈 마스터 템플릿보다 우선하세요. 채워진 슬라이드는 실제 텍스트 밀도, 스키마 제한, 폰트 fallback, 이미지 처리, 레이아웃 스트레스 상황을 보여 줍니다. 빈 마스터 템플릿은 실제 콘텐츠에서 디자인이 어떻게 무너지는지 보여 주지 못하므로 단독으로는 충분하지 않습니다.

```bash
slides-grab import-template \
  --input references/acme-qbr.pptx \
  --input references/acme-product-page.html \
  --slides-dir decks/acme-qbr
```

이 명령은 `<slides-dir>/.slides-grab/template-pack.json`과 미리보기 에셋을 씁니다. Stage 1에서는 `slide-outline.md`에 `style: template-pack`을 기록하고, Stage 2에서는 template pack의 역할, bbox/스키마 제한, 색상, 폰트, 미리보기 레이아웃 계열을 따라 HTML 슬라이드를 생성하세요. 내보내기 전에는 `slides-grab validate --slides-dir <path>`와 `slides-grab design-gate`를 실행합니다.

이미지 중심 덱은 슬라이드별로 `slides-grab image --image-native --name slide-XX --reference <template-page.png> --slides-dir <path>`를 실행하세요. 이 명령은 생성 PNG, `slide-XX.html` wrapper, `slides-grab edit-image`에 필요한 재생성 메타데이터를 함께 기록합니다. 가져온 템플릿 페이지 미리보기 PNG를 `--reference` 입력으로 재사용해 스타일/레이아웃 가이드로 활용하세요:

```bash
slides-grab image \
  --image-native \
  --name slide-01 \
  --prompt "<whole-slide prompt>" \
  --slides-dir decks/acme-image \
  --reference decks/acme-qbr/.slides-grab/template-previews/page-01.png
```

이미지 네이티브 슬라이드는 래스터 wrapper이며 생성된 PNG 에셋을 감쌉니다. 빠른 시각 탐색이나 이미지 주도 콘셉트에는 유용하지만 HTML보다 편집 가능성이 낮습니다. 텍스트나 레이아웃을 바꾸려면 semantic HTML을 직접 수정하지 말고 `slides-grab edit-image --slides-dir <path>`를 사용하세요. 덱을 계속 쉽게 편집, 접근성 유지, 검색, 변환해야 한다면 HTML 모드를 쓰고, 시각적 구성이 후속 편집성보다 중요할 때 이미지 네이티브 모드를 쓰세요.

OpenAI 호환 이미지 provider는 슬라이드 파일을 바꾸지 않고 설정할 수 있습니다. 예: `slides-grab image --provider openai --base-url <url> --api-key-env <ENV_NAME>`, 또는 `OPENAI_IMAGE_API_KEY`, `OPENAI_IMAGE_BASE_URL`, `OPENAI_BASE_URL` 환경 변수. 테스트와 fixture는 mock provider 응답(주입된 `generateImageImpl` 또는 에디터 서버의 `PPT_AGENT_MOCK_IMAGE_PROVIDER=1`)을 사용해야 하며 외부 이미지 API 자격 증명이 필요하면 안 됩니다.

## 에셋 규칙

슬라이드에서 사용하는 로컬 이미지와 동영상은 `<slides-dir>/assets/`에 저장하고 각 `slide-XX.html`에서는 `./assets/<file>` 형식으로 참조하세요.

- 권장 이미지: `<img src="./assets/example.png" alt="...">`
- 권장 동영상: `<video src="./assets/demo.mp4" poster="./assets/demo-poster.png"></video>`
- 허용: 완전한 자체 포함 슬라이드를 위한 `data:` URL
- 저장된 슬라이드에서 금지: 원격 `http(s)://` 이미지 URL
- 지원하지 않음: `/Users/...` 또는 `C:\...` 같은 절대 파일 경로
- 저장된 슬라이드에서 지원하지 않음: 원격 동영상 URL. 먼저 `<slides-dir>/assets/`로 다운로드하세요.

내보내기 전에 다음 명령으로 누락된 로컬 에셋과 권장하지 않는 경로 형식을 확인하세요.

```bash
slides-grab validate --slides-dir <path>
```

## 이미지 생성

`slides-grab image`는 프롬프트로 슬라이드용 이미지를 생성하고 결과를 `<slides-dir>/assets/`에 저장한 뒤 HTML에서 사용할 `./assets/<file>` 참조를 출력합니다.

```bash
codex login
slides-grab image --slides-dir decks/my-deck --prompt "Editorial hero image of a robotics warehouse at dawn"
```

기본 이미지 생성 공급자는 로컬 Codex ChatGPT 로그인(`~/.codex/auth.json`)을 재사용할 수 있습니다. 선택적으로 `--provider openai`에는 `OPENAI_API_KEY`, `--provider nano-banana`에는 `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY`가 필요할 수 있습니다.

> 경고: 일부 이미지 생성 경로는 지원되지 않는 비공개 백엔드 또는 계정 권한에 의존할 수 있으므로, 실패하면 웹 검색과 로컬 다운로드 방식으로 대체하세요.

내보내기 전에는 항상 `slides-grab validate --slides-dir <path>`를 실행해 누락된 로컬 에셋과 권장하지 않는 경로 형식을 먼저 확인하세요.

`slides-grab pdf`는 이제 기본적으로 `--mode capture`를 사용합니다. 이 모드는 렌더링된 각 슬라이드를 PDF 안에 래스터 이미지로 캡처해 시각적 충실도를 높입니다. 브라우저 텍스트를 검색하거나 선택할 수 있는 PDF가 더 중요하다면 `--mode print`를 사용하세요.

슬라이드에 `<video>`가 포함되어 있으면 PDF 내보내기는 라이브 자동 재생 프레임 대신 동영상의 poster/썸네일 정지 이미지를 사용합니다. 안정적인 출력이 필요하면 `poster="./assets/<file>"`를 지정하는 방식을 권장합니다.

`slides-grab pdf`와 `slides-grab convert`는 더 선명한 결과물을 위해 기본적으로 `2160p` / `4k` 래스터 출력을 사용합니다. 더 작거나 빠른 산출물이 필요하면 `--resolution <preset>`으로 `720p`, `1080p`, `1440p`, `2160p`, `4k` 중 하나를 지정할 수 있습니다.

`slides-grab convert`는 시각적 충실도가 가장 안정적인 `--engine raster`를 기본값으로 사용합니다. PowerPoint에서 편집 가능한 텍스트가 더 중요하면 `--engine text`를 사용할 수 있습니다. text 엔진은 실험적이며 시맨틱 텍스트 태그가 필요하고, 지원하지 않는 HTML/CSS를 거부할 수 있으며, canvas/SVG 시각 요소는 래스터 이미지로 변환합니다. `--resolution`은 raster 엔진에서만 사용할 수 있습니다. 두 엔진은 presentation 또는 card-news 모드에서 동일한 PowerPoint 슬라이드 크기를 사용합니다.

### 웹 동영상을 덱 에셋으로 다운로드

원본 동영상이 YouTube 또는 `yt-dlp`가 지원하는 다른 페이지에 있다면 먼저 덱의 assets 폴더로 다운로드하세요.

```bash
slides-grab fetch-video \
  --url https://www.youtube.com/watch?v=EXAMPLE \
  --slides-dir decks/my-deck \
  --output-name hero-video
```

이 명령은 저장된 파일 경로와 슬라이드 HTML에 붙여 넣을 `./assets/<file>` 참조를 출력합니다. `PATH`에서 동작하는 `yt-dlp` 바이너리가 필요합니다.

## 여러 덱 작업 흐름

먼저 `decks/my-deck/`에 덱을 만들거나 생성한 뒤 다음처럼 작업할 수 있습니다.

```bash
slides-grab edit       --slides-dir decks/my-deck
slides-grab edit-image --slides-dir decks/my-deck
slides-grab validate   --slides-dir decks/my-deck
slides-grab pdf        --slides-dir decks/my-deck --output decks/my-deck.pdf
slides-grab pdf        --slides-dir decks/my-deck --mode print --output decks/my-deck-searchable.pdf
slides-grab png        --slides-dir decks/my-deck --output-dir decks/my-deck/out-png
slides-grab convert    --slides-dir decks/my-deck --output decks/my-deck.pptx
slides-grab convert    --slides-dir decks/my-deck --output decks/my-deck-editable.pptx --engine text
slides-grab figma      --slides-dir decks/my-deck --output decks/my-deck-figma.pptx
```

> **주의:** `slides-grab convert`와 `slides-grab figma`는 현재 **실험적/불안정한** 기능입니다. 출력은 최선의 결과이며 PowerPoint 또는 Figma에서 수동 정리가 필요할 수 있습니다.

## 카드뉴스 작업 흐름

인스타그램식 카드뉴스는 720pt × 720pt 정사각형 프레임을 사용합니다. 모든 단계에서 `--mode card-news` 또는 `--slide-mode card-news`를 맞춰 사용하고, 최종 배포물은 `slides-grab png`를 우선 권장합니다.

```bash
slides-grab edit     --slides-dir decks/my-cards --mode card-news  # HTML 카드뉴스 편집기
slides-grab validate --slides-dir decks/my-cards --mode card-news
slides-grab png      --slides-dir decks/my-cards --slide-mode card-news --resolution 2160p
slides-grab pdf      --slides-dir decks/my-cards --slide-mode card-news --output decks/my-cards.pdf
slides-grab convert  --slides-dir decks/my-cards --mode card-news --output decks/my-cards.pptx
```

## Tldraw 다이어그램 에셋

정확한 슬라이드 영역에 맞고 내보내기에 안전한 로컬 SVG 다이어그램을 새로 만들고 싶다면 `slides-grab tldraw`를 사용하세요. 이 명령은 현재 형식의 `.tldr` 파일과 store-snapshot JSON을 지원합니다. 오래된 pre-records `.tldr` 파일은 먼저 최신 `tldraw` 빌드에서 다시 열고 저장해야 합니다.

```bash
slides-grab tldraw \
  --input decks/my-deck/assets/system.tldr \
  --output decks/my-deck/assets/system.svg \
  --width 640 \
  --height 320 \
  --padding 16
```

생성된 SVG는 일반 로컬 이미지처럼 슬라이드 HTML에서 참조하세요.

```html
<img src="./assets/system.svg" alt="System architecture diagram">
```

내장 `diagram-tldraw` 템플릿은 이 작업 흐름을 시작하기 위한 간단한 출발점입니다.

## Figma 작업 흐름

```bash
slides-grab figma --slides-dir decks/my-deck --output decks/my-deck-figma.pptx
```

이 명령은 HTML→PPTX 파이프라인을 재사용해 Figma Slides의 `Import`로 수동 가져오기 할 수 있는 `.pptx` 덱을 만듭니다. Figma에 직접 업로드하지 않습니다. Figma 내보내기 경로는 **실험적/불안정**하며 최선의 결과만 기대해야 합니다.

## 설치 가이드

자세한 에이전트별 설치 안내는 아래 문서를 참고하세요.

- [Claude 상세 가이드](docs/installation/claude.md)
- [Codex 상세 가이드](docs/installation/codex.md)

## npm 패키지

독립 실행형 CLI와 스킬 사용을 위해 npm 패키지로도 사용할 수 있습니다.

```bash
npm install slides-grab
```

Vercel Agent Skills로 공유 에이전트 스킬을 설치하려면 다음을 실행하세요.

```bash
npx skills add ./node_modules/slides-grab -g -a codex -a claude-code --yes --copy --full-depth
```

이 npm 설치 경로는 일반적인 사용에 충분합니다. slides-grab 자체를 수정하거나 기여하려는 경우에만 저장소를 클론하세요.

## 프로젝트 구조

```text
bin/              CLI 진입점
src/editor/       시각 편집기(HTML + JS 클라이언트 모듈)
scripts/          빌드, 검증, 변환, 편집기 서버 스크립트
templates/        슬라이드 HTML 템플릿(cover, content, chart 등)
src/              디자인 스타일 데이터, 스타일 설정, 경로 해석
skills/           공유 가능한 에이전트 스킬과 참고 문서
docs/             설치 및 사용 가이드
showcase/         GitHub Pages로 배포되는 정적 갤러리
```

## 라이선스

[MIT](LICENSE)

## 감사의 말

이 프로젝트는 Builder Josh의 [ppt_team_agent](https://github.com/uxjoseph/ppt_team_agent)를 바탕으로 만들어졌습니다. 감사드립니다!
