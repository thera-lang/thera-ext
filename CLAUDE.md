# Thera VS Code Extension

The VS Code extension for [Thera](../thera/), a programming language designed
for LLMs and coding agents. It provides TextMate syntax highlighting, snippets,
Run/Test CodeLenses, and a language client that talks to the `thera lsp` server.

## Repo map

- `src/extension.ts` — the entire extension: SDK path resolution (`thera.path`
  setting → PATH → locate prompt), the language client, commands (restart
  server, locate SDK, run/test), and the CodeLens provider.
- `syntaxes/` — TextMate grammar (`thera.tmLanguage.json`) and code snippets.
- `language-configuration.json` — brackets, comments, surrounding pairs.
- `dist/extension.js` — esbuild bundle output, **checked in** (the extension is
  distributed by cloning this repo, so the bundle must be committed and fresh;
  rebuild with `npm run compile`).

## Key facts

- The language server is **not** part of this repo — the extension spawns
  `thera lsp` from the user's Thera SDK over stdio. New server-side LSP features
  (completion, hover, etc.) need no client changes: `vscode-languageclient`
  negotiates capabilities automatically.
- Server-side work lives in the Thera repo (`pkgs/cli/`); this repo only needs
  changes for client-side behavior (settings, commands, middleware, UI).

## Commands

```
npm run typecheck   # tsc --noEmit
npm run compile     # esbuild bundle → dist/extension.js
npm run watch       # compile on change
```

To try changes: open this folder in VS Code and press F5 to launch an Extension
Development Host, then open a `.thera` file.

## Working conventions

- Keep changes `npm run typecheck` clean, and rebuild `dist/` when `src/`
  changes.
- Work in small, self-contained increments.
- Match the surrounding code's style and comment density.
- Perform work in new branches (no commits to main).
- Each PR should be focused on a single task, feature, or arc of work.
- PR descriptions should be brief; a summary sentence or two, the main items in
  bullet points, and an optional summary of caveats or things to be aware of.
