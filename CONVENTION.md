# Code Conventions

How to write and organize TypeScript in this repository. The goal is code that reads like well-organized prose: a reader should be able to understand *what* a function does from its name and shape alone, and *why* it exists from the surrounding structure — without needing a comment to explain either.

These conventions are not invented in a vacuum. They're a distillation of:

- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) — naming, types, module structure
- [clean-code-typescript](https://github.com/labs42io/clean-code-typescript) — a TypeScript-specific adaptation of Robert C. Martin's *Clean Code*
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — language idioms (narrowing, `unknown` vs `any`, readonly)
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript) — formatting/naming baseline, consistent with this repo's Prettier config

Where these conventions and an ESLint/Prettier rule disagree, the linter wins — don't relitigate formatting in code review, only in `eslint.config.mjs` / `.prettierrc.json`.

## Principles

- **KISS.** Prefer the boring, obvious solution. A plugin this size does not need a DI container, a class hierarchy, or a generic abstraction for a case that appears once.
- **DRY — but only for real duplication.** Two files independently computing `getState().termGroups.termGroups` is duplication (see `platform/hyper-store.ts`'s `getTermGroups()`). Two unrelated functions that happen to both loop over an array are not. Don't extract a shared helper until a third call site actually needs it.
- **Single responsibility per file.** A file should have one reason to change. If you're adding an `if` branch to handle "also update the DOM" inside a function that parses data, that's a sign the DOM-handling belongs in a different file.
- **No premature abstraction.** Three similar lines of code are better than a one-off interface, factory, or config object built for a single caller. Don't design for a hypothetical future feature — the layered structure below exists precisely so a *real* future feature has an obvious place to go without needing speculative scaffolding today.

## Naming

- Names carry meaning; a reader shouldn't need to open the function body to know what it does.
- Functions are verbs (`computeInsertIndex`, `pruneStaleSessions`, `emitCwdChanged`). Values are nouns (`cwdMap`, `pendingRun`, `SELECTORS`).
- Booleans read as a yes/no question: `hasPromptSignal`, not `promptSignal` or `checkPrompt`.
- No abbreviations that need decoding (`groupUid`, not `gUid`; `pointerY`, not `pY`). Existing short names in hot loops (`uid`, `cwd`) are fine because they're domain-standard and used consistently everywhere.
- Match the plural/singular and casing of the thing being modeled: a `Map` of many entries is `xMap` (`cwdMap`), a single constant object of related values is `SCREAMING_SNAKE_CASE` (`SELECTORS`, `DEFAULT_WIDTH`).

## Functions

- One level of abstraction per function. `renderEnvPanel` builds HTML strings; it doesn't also decide *when* to re-probe tools — that's `reloadEnvPanel`'s job one layer up.
- Small enough to read without scrolling. If a function needs a comment to separate "part 1" from "part 2", it's two functions.
- Prefer a handful of named parameters or a small options object over a boolean flag parameter — `attachControls()` doesn't take a `verbose: boolean`; if it needed a mode switch, that mode would be a named export, not a flag threaded through.
- Extract a helper the moment a name would need "and" to describe it. `clearPendingRun` exists so `onSessionUserData` doesn't have to say "clear the pending timer and also mark it running."

## Comments

**Default: no comments.** If the code needs a comment to say *what* it does, rename things or restructure until it doesn't.

The **only** acceptable comment explains a non-obvious **why**: a hidden constraint, a workaround for a specific bug, or a heuristic that isn't derivable from reading the code. Examples already in this codebase that earn their keep:

```ts
// only OSC 7 (pwd) marks a prompt: preexec emits OSC 0 titles, which would
// falsely flip running -> done right when a command starts
function hasPromptSignal(data: string): boolean { ... }
```

```ts
// use a freshly-created, owner-only-permission temp dir (not a fixed,
// predictable path) so another local user can't pre-plant a symlink or
// read/tamper with the probe script
```

Neither of these is derivable by reading the next line — they explain a decision, not an operation. That's the bar.

Never acceptable:
- A comment restating what the next line already says (`// increment i` above `i++`).
- Commented-out code. Delete it — git history is the record of what used to be there.
- Journal-style comments (`// fixed 2024-03-01`, `// added by X for issue #123`). That belongs in the commit message and the PR description, not the file.

## Types

- `any` is reserved for the genuine untyped external boundary: Hyper's own plugin API (`decorateConfig(config: Record<string, any>)`) and Node's `child_process`/`fs`/`os` modules accessed via `window.require(...)`, which have no local type declarations. These are documented exceptions, not a default.
- Everywhere else, prefer a real type. Where the shape is genuinely unknown until runtime (e.g. an incoming action in a reducer), use `unknown` and narrow with a type guard — see `isReorderAction` in `core/reorder.ts`.
- Don't type things that don't need it. A local variable whose type is obvious from its initializer doesn't need an annotation.
- Prefer `interface` for object shapes that might be extended (`KeyedStore<V>`, `HyperStore`), `type` for unions and aliases (`Status`, `ReorderAction`).

## File and module organization

`src/` is layered. Each layer may import only from itself or the layers before it in this list:

1. **`core/`** — pure, host-agnostic logic and types. No DOM, no Node, no Hyper store, no `localStorage`. If you can unit-test it without `jsdom`, it belongs here.
2. **`platform/`** — a thin wrapper around exactly one host capability each: the Hyper redux store (`hyper-store.ts`), DOM events (`event-bus.ts`), `localStorage` (`width-storage.ts`), style injection (`style-injector.ts`), `child_process` probing (`tool-probe.ts`), plus `platform/state/` — small encapsulated stores (built on `core/keyed-store.ts`) for state genuinely shared by two or more features.
3. **`features/tabs/`** — one file per user-visible capability of the vertical-tab cartridge, composing `core/` + `platform/` into behavior (`drag-drop-tabs.ts`, `tabs.ts`, `tabbar.ts`, `session-tracking.ts`, `env-panel.ts`). A feature may import another feature only when the two are genuinely coupled (e.g. `tabs.ts` calls `env-panel.ts`'s `updateEnvInfo`); if a third feature needs the same thing, promote it down into `core/` or `platform/` instead of letting cross-imports fan out.
4. **`index.ts`** — the single Hyper-facing composition root. It may import anything. This is the only file that should know about Hyper's plugin hook surface (`decorateConfig`, `middleware`, `decorateTab`, etc.) — everything else is plain TypeScript that happens to be consumed by it.

`config.ts` and `types.ts` sit outside this stack as shared exceptions any layer may import — they're small, single-purpose, and used everywhere.

**Where does a new feature go?** If it's a new user-visible capability (a new panel, a new interaction), add one file to `features/tabs/`. If it needs a new piece of shared state, add a small store to `platform/state/`. If it needs a new host capability (a new Electron/Node API), add one file to `platform/`. If it's pure logic with no side effects, it goes in `core/`. Don't reach backward — `core/` never imports from `platform/` or `features/`.

## Error handling

- Don't silently swallow an error unless the reason it's safe to ignore is stated. `platform/hyper-store.ts`'s `getTermGroups()` catches because the store genuinely may not be ready yet during startup, and an empty result is a correct, harmless fallback — that's worth the one-line comment it has.
- Don't add a `try`/`catch` "just in case" around code that can't actually throw. It hides real bugs instead of preventing them.
- Validate at boundaries (user config from `~/.hyper.js`, data from `child_process`), not in the middle of pure logic that trusts its own callers.

## Testing

- `test/` mirrors `src/`'s directory layout exactly — a file's tests live at the same relative path, one directory deeper.
- Arrange-act-assert: set up state, call the function, assert the result. No shared mutable fixtures beyond what `beforeEach`/`afterEach` explicitly resets.
- This project prefers real `jsdom` over deep mocking — dispatch a real `MouseEvent`, read real `classList`/`querySelector` results, rather than asserting a spy was called with the right arguments. It costs a little more setup and pays for itself in tests that catch real breakage.
- Because state lives in module-level singletons (by design — see `platform/state/`), tests that touch them must explicitly reset what they touched (`setStore(null)`, `cancelDrag()`, clearing a `Map`) in `afterEach`. This isn't optional cleanup, it's what keeps tests independent.

## Formatting

Enforced by Prettier and ESLint (`npm run format`, `npm run lint`). Don't hand-format around what the tools would do automatically, and don't argue style points that `.prettierrc.json` already settles.
