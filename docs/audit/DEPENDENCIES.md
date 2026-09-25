# Dependencies

Audit date: 2026-09-23. Lookups: `npm view <pkg> version deprecated` against registry.npmjs.org and the PyPI JSON API (`pypi.org/pypi/<pkg>/json`), both run on 2026-09-23. Resolved npm versions come from `bun.lock`.

Manifests found:

| Manifest | Consumer | Entries | Lockfile |
|---|---|---|---|
| [package.json](../package.json) | TanStack Start app (`src/`), scripts | 81 dependencies + 19 devDependencies | [bun.lock](../bun.lock) (text lockfile, `minimumReleaseAge = 86400` guard in [bunfig.toml](../bunfig.toml)) |
| [requirements.txt](../requirements.txt) (repo root) | Python YouTube service `app/` and `tests_py/` | 7 lower-bound ranges | none |
| [ai-service/requirements.txt](../ai-service/requirements.txt) | Vision/forensics service | 21 exact pins + 1 unpinned best-effort install (`c2pa-python`, in the Dockerfile) | none |
| [osint-workers/theharvester/Dockerfile](../osint-workers/theharvester/Dockerfile) | theHarvester worker | 4 pip installs inline | none |

## 1. Install checks

| Check | Result |
|---|---|
| `bun install --frozen-lockfile --dry-run` | Completed in 97 ms with no lockfile changes. The lockfile is consistent with `package.json`. `node_modules/` is present (509 top-level entries). |
| Python `app/` (root requirements) | Not installed by this audit. The machine's system Python 3.9.6 already had `fastapi 0.128.8`, `yt_dlp 2025.10.14`, `pytest 8.4.2`, so `tests_py` ran (5 passed). Note the current latest of every entry except `httpx`, `piexif`-class packages requires Python ≥ 3.10, so a fresh `pip install -r requirements.txt` on Python 3.9 would resolve older releases; there is no lockfile, so the resolved set is not reproducible. |
| Python `ai-service/` | Not installable on this machine: `numpy==2.2.1` requires Python ≥ 3.10, `scikit-image==0.26.0` and `onnxruntime-gpu==1.20.2` require ≥ 3.11; the system interpreter is 3.9.6 and `pytesseract`/`torch` are absent, so all 8 test modules errored at import. The service's own Dockerfile targets Python 3.11 on a CUDA 12.1 base image; every exact pin exists on PyPI (table below), so the pinned set is installable on 3.11 in principle. **Not verified by an actual install.** |
| `pip install theHarvester` (worker Dockerfile) | The PyPI package `theHarvester` is version **0.0.1, released 2019-02-04**, 97.5 KB (PyPI page fetched). It is not the current tool (the real project is at 4.x on GitHub). The worker image, if built, installs a six-year-old stub. Whether the image was ever built is UNKNOWN. |
| `c2pa-python` | Unpinned; installed "best-effort" with `|| echo` in [ai-service/Dockerfile:24](../ai-service/Dockerfile#L24). Latest is 0.37.10 (requires Python ≥ 3.10). Whether the code in [ai-service/app/forensics.py:119-153](../ai-service/app/forensics.py#L119-L153) (`c2pa.Reader(stream=...)`, `c2pa.C2paError.ManifestNotFound`) matches the 0.37 API is UNKNOWN. |

## 2. npm dependencies (`package.json` → `bun.lock` → registry latest)

"Gap" compares the resolved version with the registry's latest. "Imported" means a direct `import`/`require` exists in `src/`, `scripts/`, `vite.config.ts` or `eslint.config.js`.

### dependencies (81)

| Package | Range | Resolved | Latest (2026-09-23) | Gap | Imported directly? |
|---|---|---|---|---|---|
| @distube/ytdl-core | ^4.16.12 | 4.16.12 | 4.16.12 | current | yes (lazy, fallback only; the code states it "can no longer read YouTube's player script") |
| @hookform/resolvers | ^5.2.2 | 5.2.2 | 5.9.1 | minor behind | **no** |
| @mozilla/readability | ^0.6.0 | 0.6.0 | 0.6.0 | current | yes |
| @radix-ui/react-accordion | ^1.2.12 | 1.2.12 | 1.2.20 | patch behind | yes (ui) |
| @radix-ui/react-alert-dialog | ^1.1.15 | 1.1.15 | 1.1.23 | patch behind | yes (ui) |
| @radix-ui/react-aspect-ratio | ^1.1.8 | 1.1.8 | 1.1.15 | patch behind | yes (ui) |
| @radix-ui/react-avatar | ^1.1.11 | 1.1.11 | 1.2.6 | minor behind | yes (ui) |
| @radix-ui/react-checkbox | ^1.3.3 | 1.3.3 | 1.3.11 | patch behind | yes (ui) |
| @radix-ui/react-collapsible | ^1.1.12 | 1.1.12 | 1.1.20 | patch behind | yes (ui) |
| @radix-ui/react-context-menu | ^2.2.16 | 2.2.16 | 2.3.7 | minor behind | yes (ui) |
| @radix-ui/react-dialog | ^1.1.15 | 1.1.15 | 1.1.23 | patch behind | yes (ui) |
| @radix-ui/react-dropdown-menu | ^2.1.16 | 2.1.16 | 2.1.24 | patch behind | yes (ui) |
| @radix-ui/react-hover-card | ^1.1.15 | 1.1.15 | 1.1.23 | patch behind | yes (ui) |
| @radix-ui/react-label | ^2.1.8 | 2.1.8 | 2.1.15 | patch behind | yes (ui) |
| @radix-ui/react-menubar | ^1.1.16 | 1.1.16 | 1.1.24 | patch behind | yes (ui) |
| @radix-ui/react-navigation-menu | ^1.2.14 | 1.2.14 | 1.2.22 | patch behind | yes (ui) |
| @radix-ui/react-popover | ^1.1.15 | 1.1.15 | 1.1.23 | patch behind | yes (ui) |
| @radix-ui/react-progress | ^1.1.8 | 1.1.8 | 1.1.16 | patch behind | yes (ui) |
| @radix-ui/react-radio-group | ^1.3.8 | 1.3.8 | 1.4.7 | minor behind | yes (ui) |
| @radix-ui/react-scroll-area | ^1.2.10 | 1.2.10 | 1.2.18 | patch behind | yes (ui) |
| @radix-ui/react-select | ^2.2.6 | 2.2.6 | 2.3.7 | minor behind | yes (ui) |
| @radix-ui/react-separator | ^1.1.8 | 1.1.8 | 1.1.15 | patch behind | yes (ui) |
| @radix-ui/react-slider | ^1.3.6 | 1.3.6 | 1.4.7 | minor behind | yes (ui) |
| @radix-ui/react-slot | ^1.2.4 | 1.2.4 | 1.3.3 | minor behind | yes (ui) |
| @radix-ui/react-switch | ^1.2.6 | 1.2.6 | 1.3.7 | minor behind | yes (ui) |
| @radix-ui/react-tabs | ^1.1.13 | 1.1.13 | 1.1.21 | patch behind | yes (ui) |
| @radix-ui/react-toggle | ^1.1.10 | 1.1.10 | 1.1.18 | patch behind | yes (ui) |
| @radix-ui/react-toggle-group | ^1.1.11 | 1.1.11 | 1.1.19 | patch behind | yes (ui) |
| @radix-ui/react-tooltip | ^1.2.8 | 1.2.8 | 1.2.16 | patch behind | yes (ui) |
| @tailwindcss/vite | ^4.2.1 | 4.2.4 | 4.3.3 | minor behind | yes (vite.config) |
| @tanstack/react-query | ^5.101.1 | 5.101.1 | 5.103.2 | minor behind | yes |
| @tanstack/react-router | ^1.170.16 | 1.170.16 | 1.170.38 | patch behind | yes |
| @tanstack/react-start | ^1.168.26 | 1.168.26 | 1.168.57 | patch behind | yes. Note the version skew: router 1.170 with start 1.168; the code repeatedly notes that this Start version "exposes no `createServerFileRoute`", so the app has no HTTP API routes at all. |
| @tanstack/router-plugin | ^1.168.18 | 1.168.18 | 1.168.40 | patch behind | **no** (not imported; may be required transitively by react-start) |
| asn1js | ^3.0.10 | 3.0.10 | 3.0.10 | current | **no** direct import (used transitively by pkijs; a code comment names it) |
| c2pa | ^0.30.17 | 0.30.17 | 0.30.17 | **deprecated** ("This package is no longer being actively developed. Please use @contentauth/c2pa-web instead.") | yes |
| class-variance-authority | ^0.7.1 | 0.7.1 | 0.7.1 | current | yes |
| clsx | ^2.1.1 | 2.1.1 | 2.1.1 | current | yes |
| cmdk | ^1.1.1 | 1.1.1 | 1.1.1 | current | yes (ui) |
| cookie-es | ^3.1.1 | 3.1.1 | 3.1.1 | current | **no** |
| croner | ^10.0.1 | 10.0.1 | 10.0.1 | current | **no** |
| date-fns | ^4.1.0 | 4.1.0 | 4.4.0 | minor behind | **no** |
| defu | ^6.1.7 | 6.1.7 | 6.1.7 | current | **no** |
| destr | ^2.0.5 | 2.0.5 | 2.0.5 | current | **no** |
| embla-carousel-react | ^8.6.0 | 8.6.0 | 8.6.0 | current | yes (ui) |
| exifr | ^7.1.3 | 7.1.3 | 7.1.3 | current | yes |
| fflate | ^0.8.3 | 0.8.3 | 0.8.3 | current | yes |
| h3-js | ^4.5.0 | 4.5.0 | 4.5.0 | current | yes (dynamic import in gps-interference.ts) |
| input-otp | ^1.4.2 | 1.4.2 | 1.5.0 | minor behind | yes (ui) |
| jsdom | ^30.0.1 | 30.0.1 | 30.1.1 | minor behind | yes |
| leaflet | ^1.9.4 | 1.9.4 | 1.9.4 | current | yes |
| libphonenumber-js | ^1.13.11 | 1.13.11 | 1.13.13 | patch behind | yes |
| lucide-react | ^0.575.0 | 0.575.0 | 1.47.0 | **major behind** | yes |
| node-forge | ^1.4.0 | 1.4.0 | 1.4.0 | current | yes |
| pdf-lib | ^1.17.1 | 1.17.1 | 1.17.1 | current | yes |
| pkijs | ^3.4.0 | 3.4.0 | 3.4.1 | patch behind | yes |
| react | ^19.2.0 | 19.2.5 | 19.3.0 | minor behind | yes |
| react-day-picker | ^9.14.0 | 9.14.0 | 10.0.1 | **major behind** | yes (ui) |
| react-dom | ^19.2.0 | 19.2.5 | 19.3.0 | minor behind | yes |
| react-hook-form | ^7.71.2 | 7.73.1 | 7.88.0 | minor behind | yes (ui) |
| react-markdown | ^10.1.0 | 10.1.0 | 10.1.0 | current | yes |
| react-resizable-panels | ^4.6.5 | 4.10.0 | 4.13.2 | minor behind | yes (ui) |
| recharts | ^2.15.4 | 2.15.4 | 3.10.1 | **major behind** | yes (ui/chart) |
| remark-gfm | ^4.0.1 | 4.0.1 | 4.0.1 | current | yes |
| rss-parser | ^3.13.0 | 3.13.0 | 3.13.0 | current | yes |
| scule | ^1.3.0 | 1.3.0 | 1.3.0 | current | **no** |
| sonner | ^2.0.7 | 2.0.7 | 2.0.8 | patch behind | yes |
| std-env | ^4.1.0 | 4.2.0 | 4.2.0 | current | **no** |
| tailwind-merge | ^3.5.0 | 3.5.0 | 3.7.0 | minor behind | yes |
| tailwindcss | ^4.2.1 | 4.2.4 | 4.3.3 | minor behind | yes |
| tesseract.js | ^7.0.0 | 7.0.0 | 7.0.0 | current | yes |
| topojson-client | ^3.1.0 | 3.1.0 | 3.1.0 | current | **no** |
| tw-animate-css | ^1.3.4 | 1.4.0 | 1.4.0 | current | yes (css) |
| ufo | ^1.6.4 | 1.6.4 | 1.6.4 | current | **no** |
| unctx | ^2.5.0 | 2.5.0 | 3.0.1 | **major behind** | **no** |
| undici | 7.29.0 (exact) | 7.29.0 | 8.11.0 | **major behind** | no direct import in src (exact pin; purpose not documented in repo) |
| vaul | ^1.1.2 | 1.1.2 | 1.1.2 | current | yes (ui) |
| vite-tsconfig-paths | ^6.0.2 | 6.1.1 | 6.1.1 | current | yes (vite.config) |
| worldmonitor | ^0.1.3 | 0.1.3 | 0.1.3 | current | **no** (purpose unknown; nothing references it) |
| youch-core | ^0.3.3 | 0.3.3 | 0.3.3 | current | **no** |
| zod | ^3.24.2 | 3.25.76 | 4.6.5 | **major behind** | yes |

### devDependencies (19)

| Package | Range | Resolved | Latest (2026-09-23) | Gap |
|---|---|---|---|---|
| @eslint/js | ^9.32.0 | 9.39.4 | 10.0.1 | **major behind** |
| @types/bun | ^1.3.14 | 1.3.14 | 1.4.2 | minor behind |
| @types/jsdom | ^30.0.0 | 30.0.0 | 30.0.0 | current |
| @types/node | ^22.16.5 | 22.19.17 | 26.6.2 | major behind (22.x matches the `node:22-alpine` runtime image) |
| @types/react | ^19.2.0 | 19.2.14 | 19.3.0 | minor behind |
| @types/react-dom | ^19.2.0 | 19.2.3 | 19.3.0 | minor behind |
| @vitejs/plugin-react | ^5.2.0 | 5.2.0 | 6.1.1 | **major behind** |
| eslint | ^9.32.0 | 9.39.4 | 10.11.0 | **major behind** |
| eslint-config-prettier | ^10.1.1 | 10.1.8 | 10.1.8 | current |
| eslint-plugin-prettier | ^5.2.6 | 5.5.5 | 5.5.6 | patch behind |
| eslint-plugin-react-hooks | ^5.2.0 | 5.2.0 | 7.1.1 | **major behind** |
| eslint-plugin-react-refresh | ^0.4.20 | 0.4.26 | 0.5.7 | minor behind |
| globals | ^15.15.0 | 15.15.0 | 17.12.0 | **major behind** |
| nitro | 3.0.260603-beta (exact) | 3.0.260603-beta | 3.0.260903-beta | beta channel; newer beta exists |
| playwright-core | ^1.62.1 | 1.62.1 | 1.63.0 | minor behind |
| prettier | ^3.7.3 | 3.8.3 | 3.9.9 | minor behind |
| typescript | ^5.8.3 | 5.9.3 | 7.0.2 | **major behind** |
| typescript-eslint | ^8.56.1 | 8.59.0 | 8.70.1 | minor behind |
| vite | ^8.0.16 | 8.0.16 | 8.3.0 | minor behind |

Summary: 100 packages; 1 deprecated (`c2pa`); 11 at least one major behind (`lucide-react`, `react-day-picker`, `recharts`, `unctx`, `undici`, `zod`, `@eslint/js`, `@vitejs/plugin-react`, `eslint`, `eslint-plugin-react-hooks`, `globals`, `typescript`; `@types/node` deliberately tracks Node 22); 15 dependencies are declared but never imported by project code (`@hookform/resolvers`, `@tanstack/router-plugin`, `asn1js`, `cookie-es`, `croner`, `date-fns`, `defu`, `destr`, `scule`, `std-env`, `topojson-client`, `ufo`, `unctx`, `worldmonitor`, `youch-core`); none was found missing from the registry.

Licences of npm packages were not scanned in this audit. The code documents a few (pkijs BSD-3-Clause, c2pa MIT, exifr MIT, tesseract.js Apache-2.0). Whether any transitive dependency is GPL/AGPL is UNKNOWN.

## 3. Python: root `requirements.txt` (service `app/`)

| Requirement | Pin exists on PyPI | Latest (2026-09-23) | Latest requires Python | Notes |
|---|---|---|---|---|
| fastapi>=0.110.0 | 0.110.0: yes | 0.141.1 | >=3.10 | Range, not pinned. |
| uvicorn>=0.28.0 | yes | 0.53.0 | >=3.10 | |
| yt-dlp>=2024.3.10 | yes | 2026.8.19 | >=3.10 | yt-dlp changes monthly because YouTube changes; a 2024 floor with no ceiling means behaviour depends on install date. |
| pydantic>=2.6.0 | yes | 2.13.5 | >=3.9 | |
| pytest>=8.0.0 | yes | 9.1.1 | >=3.10 | |
| httpx>=0.27.0 | yes | 0.28.1 | >=3.8 | Not imported by `app/` (only FastAPI's TestClient needs it). |
| imageio-ffmpeg>=0.4.9 | yes | 0.6.0 | >=3.9 | Bundles an ffmpeg binary used for yt-dlp merging ([app/config.py:12-21](../app/config.py#L12-L21)). |

No lockfile. Not deprecated. Nothing missing from the registry.

## 4. Python: `ai-service/requirements.txt`

| Pin | Exists on PyPI | Latest (2026-09-23) | Latest requires Python | Gap | Notes |
|---|---|---|---|---|---|
| fastapi==0.115.6 | yes | 0.141.1 | >=3.10 | minor behind | |
| uvicorn[standard]==0.34.0 | yes | 0.53.0 | >=3.10 | minor behind | |
| pydantic==2.10.4 | yes | 2.13.5 | >=3.9 | minor behind | |
| pydantic-settings==2.7.0 | yes | 2.15.0 | >=3.10 | minor behind | |
| torch==2.5.1 | yes | 2.14.0 | >=3.10 | **9 minor releases behind** | File comments require installing from the cu121 index first; a plain `pip install -r` on a CUDA host may swap in the wrong build (the comment records this happening). |
| torchvision==0.20.1 | yes | 0.29.0 | >=3.10, !=3.14.1 | behind | must match torch. |
| python-multipart==0.0.20 | yes | 0.0.32 | >=3.10 | patch behind | |
| numpy==2.2.1 | yes | 2.5.3 | >=3.12 (latest); the pin needs >=3.10 | behind | |
| pillow==11.1.0 | yes | 12.3.0 | >=3.10 | **major behind** | |
| piexif==1.1.3 | yes | 1.1.3 | any | current | Last release 2019 (not deprecated on PyPI). |
| pytesseract==0.3.13 | yes | 0.3.13 | >=3.8 | current | |
| scipy==1.14.1 | yes | 1.18.1 | >=3.12 (latest) | behind | |
| transformers==4.47.1 | yes | 5.17.0 | >=3.10 | **major behind** | The file records that an earlier pin `5.15.0` "does not exist on PyPI" and was never installed; 4.47.1 was chosen as the version verified with Grounding DINO and Florence-2. |
| timm==1.0.28 | yes | 1.0.30 | >=3.8 | patch behind | |
| accelerate==1.14.0 | yes | 1.15.0 | >=3.10 | minor behind | |
| einops==0.8.2 | yes | 0.8.2 | >=3.9 | current | |
| insightface==1.0.1 | yes | 2.0 | >=3.10 | **major behind** | Licence issue for the models, see COLLECTORS.md row 59. |
| scikit-image==0.26.0 | yes | 0.26.0 | >=3.11 | current | |
| onnxruntime-gpu==1.20.2 | yes | 1.30.0 | >=3.11 | behind (pinned deliberately for CUDA 12.x per file comment) | Must not be installed alongside `onnxruntime` (file comment). |
| opencv-python-headless==5.0.0.93 | yes | 5.0.0.93 | >=3.6 | current | |
| c2pa-python (unpinned, Dockerfile only) | — | 0.37.10 | >=3.10 | unpinned | API compatibility with the code is UNKNOWN. |

No lockfile. Nothing deprecated on PyPI. Nothing missing from the registry.

## 5. Other pinned software

| Item | Where | Pin | Notes |
|---|---|---|---|
| Bun | Dockerfile `oven/bun:1`; local 1.3.14 | major only | Build tool and test runner only. |
| Node | Dockerfile `node:22-alpine`; local 24.18.0 | 22 in production, 24 locally | Tests run under Bun, production runs under Node; the repo documents a bug (`Bun.CryptoHasher`) that passed tests and failed in production because of this. |
| Python | ai-service Dockerfile `python3.11`; local 3.9.6 | | Local interpreter cannot run ai-service. |
| CUDA base | `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` | | Falls back to CPU if no GPU. |
| SpiderFoot, SearXNG, IVRE images | [osint-workers/docker-compose.yml](../osint-workers/docker-compose.yml) | `:latest` | Unpinned container images. |
| theHarvester | worker Dockerfile | `pip install theHarvester` | Installs PyPI 0.0.1 (2019). See section 1. |
| fastapi / uvicorn / pydantic (worker) | worker Dockerfile | 0.115.6 / 0.34.0 / 2.10.4 | Same pins as ai-service. |
| Vendored model weights | `ai-service/models/` | not in repo (`.gitkeep` only) | Grounding DINO tiny, Florence-2-large, InsightFace buffalo_l, YAMNet ONNX must be supplied out of band. |
| Tesseract traineddata (browser) | fetched at runtime unless `VITE_TESSERACT_LANG_PATH` | ~27.6 MB for 14 languages | Remote fetch at runtime. |
