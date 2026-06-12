# Repository Guidelines

## Project Structure & Module Organization

This Manifest V3 Chrome extension uses Vite, React, and TypeScript. Source lives in `src/`:

- `src/background/`: service worker, classification, embedding, clustering, storage, scoring, and diary logic.
- `src/content/`: content script, observers, extraction pipeline, and `site-extractors/` for supported pages.
- `src/popup/`, `src/options/`, `src/diary/`: React UI entry points with local HTML, TSX, and CSS.
- `src/shared/`: constants, message contracts, site detection, and shared types.
- `manifest.config.ts`, `vite.config.ts`, `tsconfig.json`: metadata, build inputs, aliases, and strict compiler settings.

Treat `dist/` as generated output. Do not edit it directly.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` starts the Vite dev server on port `5173` with HMR on `5174`.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm run build` runs type checking and produces the Chrome-loadable extension in `dist/`.
- `npm run preview` serves the built Vite output for inspection.

To test in Chrome, run `npm run build`, open `chrome://extensions/`, enable Developer Mode, and load `dist/`.

## Coding Style & Naming Conventions

Use TypeScript ES modules, React function components, and the `@/` alias. Keep protocol changes in `src/shared/messages.ts` and `src/shared/types.ts`.

Follow the existing style: two-space indentation, double quotes, semicolons, explicit return types for exported or non-trivial functions, and `async`/`await` for Chrome API flows. Use `PascalCase` for components and types, `camelCase` for functions and variables, and kebab-style file names such as `site-detection.ts`.

## Testing Guidelines

No automated test runner is configured. For every change, run `npm run typecheck` and `npm run build`. Manually verify affected extension behavior in Chrome, especially service worker logs, tab grouping, content extraction, options persistence, and popup/diary flows.

If adding tests later, prefer colocated `*.test.ts` or `*.test.tsx` files and add the runner command to `package.json`.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries such as `Add diary history tracking to tab grouping`. Keep the first line focused on the behavior change; English or Korean is acceptable when it matches the surrounding work.

Pull requests should include a concise description, verification steps, screenshots for UI changes, and notes about extension permissions, storage migrations, or model downloads when relevant. Link related issues when available.

## Security & Configuration Tips

This extension processes page content locally. Avoid introducing remote content uploads unless explicitly discussed. Keep host permissions and externally fetched assets minimal, and document any new Chrome permissions in the PR description.
