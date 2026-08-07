# Contributing to HYPER-KIT

Thanks for wanting to contribute! This document covers how to propose a change, and the coding style we follow once you do.

Before opening anything, please skim:

- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — how we expect people to treat each other here.
- [SECURITY.md](./SECURITY.md) — found a vulnerability? Report it privately, not as a public issue.
- [THIRD_PARTY.md](./THIRD_PARTY.md) — licenses for the tooling this project depends on.

## How to Contribute

1. **Fork and clone** the repository, then install dependencies: `npm install`.
2. **Create a branch** off `main` named for what it does (`fix/tab-drag-ghost`, `feat/media-volume-step`), not who's doing it.
3. **Make your change.** Keep it scoped to one concern — a bug fix, a feature, a refactor. Don't mix unrelated changes into one PR.
4. **Add or update tests** for anything you change. A change with no test coverage is hard to review and easy to regress later.
5. **Run the full check before opening a PR:**
   ```sh
   npm run check   # typecheck + lint + format:check + test + build
   ```
   All of it must pass — CI runs the same command.
6. **Write a clear commit message and PR description**: what changed, why, and how you verified it. If your change touches something that shells out to the OS, say what you tested it against and on which platform.
7. **Open the PR against `main`.** Screenshots or a short clip are appreciated for anything visual.

Small fixes (typos, docs, a one-line bug fix) don't need an issue first. Anything that changes behavior or adds a feature should start as an issue or a short discussion, so nobody spends time building the wrong thing.

## Coding Philosophy

We write code that reads like well-organized prose: a reader should understand *what* a function does from its name and shape alone, and *why* it exists from the surrounding code — without needing a comment for either.

This isn't invented in a vacuum. It's a distillation of:

- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) — naming, types, module structure
- [clean-code-typescript](https://github.com/labs42io/clean-code-typescript) — a TypeScript-specific adaptation of Robert C. Martin's *Clean Code*
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — language idioms (narrowing, `unknown` vs `any`, readonly)
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript) — formatting/naming baseline

Where these guidelines and an ESLint/Prettier rule disagree, the linter wins — raise formatting disagreements in `eslint.config.mjs` / `.prettierrc.json`, not in code review.

### KISS

Prefer the boring, obvious solution over a clever one. Most changes don't need a DI container, a class hierarchy, or a generic abstraction built for a case that only appears once. If you need a paragraph to explain why a piece of code is shaped the way it is, restructure it instead of explaining it.

```ts
// Avoid — a strategy pattern for a single, unchanging case
interface DiscountStrategy { apply(price: number): number }
class NoDiscount implements DiscountStrategy { apply(price: number) { return price; } }
function getDiscount(): DiscountStrategy { return new NoDiscount(); }

// Prefer
function applyDiscount(price: number): number {
  return price;
}
```

### DRY — but only for real duplication

Two places independently computing the same derived value is duplication worth extracting. Two unrelated functions that happen to both loop over an array are not. Don't build a shared helper until a third call site actually needs it — the first two are often still finding their real shape, and an early abstraction tends to guess wrong.

```ts
// Worth extracting — both compute the same derived value
const activeTabCount = tabs.filter((tab) => tab.isActive).length;
const activePaneCount = panes.filter((pane) => pane.isActive).length;
// -> function countActive<T extends { isActive: boolean }>(items: T[]): number

// Not duplication — same shape, unrelated meaning; leave these alone
tabs.forEach((tab) => tab.close());
logs.forEach((entry) => entry.flush());
```

### Single Responsibility

A file, and each function in it, should have one reason to change. If you're adding a branch to handle "and also update the DOM" inside something that parses data, that's a sign the DOM handling belongs somewhere else.

```ts
// Avoid — parsing and rendering change for different reasons
function parseAndRenderTabs(raw: string): void { /* parse ... */ /* render ... */ }

// Prefer — each function has one reason to change
function parseTabs(raw: string): Tab[] { /* ... */ }
function renderTabs(tabs: Tab[]): void { /* ... */ }
```

### No Premature Abstraction

A few similar lines of code are better than a one-off interface, factory, or config object built for a single caller. Don't design for a hypothetical future feature — add the abstraction when a second real caller actually needs it.

```ts
// Avoid — a factory for one kind, "just in case" more show up
function createFormatter(kind: "date") { /* ... */ }

// Prefer — call the thing directly until a second kind actually exists
function formatDate(value: Date): string { /* ... */ }
```

## Naming

- Names should carry enough meaning that a reader doesn't need to open the function body to know what it does.
- Functions are verbs (`computeInsertIndex`, `pruneStaleEntries`). Values are nouns (`pendingJobs`, `DEFAULT_TIMEOUT`).
- Booleans read as a yes/no question (`hasPendingWrite`, not `pendingWrite` or `checkPending`).
- Avoid abbreviations that need decoding (`groupId`, not `gId`). Short names in tight, well-scoped loops (`i`, `id`) are fine when used consistently.
- Match plural/singular and casing to what's modeled: a map of many entries reads as `xById` or `xMap`; a constant object of related values is `SCREAMING_SNAKE_CASE`.

```ts
// Avoid
const d = new Map<string, Tab>();
function chk(x: unknown) { /* ... */ }

// Prefer
const tabsById = new Map<string, Tab>();
function hasPendingWrite(state: unknown) { /* ... */ }
```

## Functions

- One level of abstraction per function. A function that builds output shouldn't also decide *when* to refresh its input — that belongs one layer up.
- Keep functions small enough to read without scrolling. If a function needs a comment to separate "part 1" from "part 2", split it into two functions.
- Prefer a handful of named parameters or a small options object over a boolean flag parameter — a flag usually means the function has two code paths pretending to be one.
- Extract a helper the moment describing its containing function's job would need "and": "clear the timer *and* mark it done" is two responsibilities, so it's two functions.

```ts
// Avoid — the flag selects between two unrelated behaviors
function fetchTabs(includeArchived: boolean): Tab[] { /* ... */ }

// Prefer — split, each name says what it returns
function fetchActiveTabs(): Tab[] { /* ... */ }
function fetchArchivedTabs(): Tab[] { /* ... */ }
```

## Comments

**Default: no comments, ever.** Code should describe itself through naming and structure. If you feel the pull to explain what a block does, that's a signal to rename or restructure it — not a reason to annotate it. Treat wanting to write a comment as a sign the code needs another pass, not as permission to add one.

```ts
// Avoid — the comment is doing the naming's job
// check if the tab has unsaved changes
function check(t: Tab): boolean { return t.dirty && !t.saving; }

// Prefer — the name carries the meaning, no comment needed
function hasUnsavedChanges(tab: Tab): boolean {
  return tab.dirty && !tab.saving;
}
```

The one rare exception is a single line capturing a genuinely non-obvious **why** — a hidden constraint, a workaround for a specific external bug, or a heuristic that can't be derived by reading the code. Before writing one, ask whether renaming or restructuring removes the need for it:

```ts
// retry once before failing: the upstream API is known to drop the
// first connection after an idle period longer than 60s
```

That's the bar — a comment that explains a decision, not an operation.

Never acceptable:

- A comment restating what the next line already says (`// increment i` above `i++`).
- Commented-out code — delete it, git history is the record of what used to be there.
- Journal-style comments (`// fixed 2024-03-01`, `// added for issue #123`) — that belongs in the commit message and PR description, not the file.
- A comment as a substitute for a clearer name or an extracted function.

## Types

- `any` is reserved for a genuine untyped external boundary (a host API with no type declarations). Document why it's there — it's an exception, not a default.
- Everywhere else, prefer a real type. Where a shape is genuinely unknown until runtime, use `unknown` and narrow it with a type guard.
- Don't annotate what's already obvious from its initializer.
- Prefer `interface` for object shapes that might be extended, `type` for unions and aliases.

```ts
// Avoid — `any` throws away the type checker
function onEvent(payload: any) { console.log(payload.tabId); }

// Prefer — `unknown` forces a narrowing check at the boundary
function onEvent(payload: unknown) {
  if (isTabEvent(payload)) console.log(payload.tabId);
}

interface TabConfig { id: string; title: string } // object shape, may grow
type Alignment = "left" | "right" | "center";      // union, not an object
```

## Error Handling

- Don't silently swallow an error unless the reason it's safe to ignore is stated in a comment.
- Don't add a `try`/`catch` "just in case" around code that can't actually throw — it hides real bugs instead of preventing them.
- Validate at boundaries (user config, external process output, network responses), not in the middle of logic that trusts its own callers.

```ts
// Avoid — swallows the error with no explanation, and no boundary to justify it
function loadConfig(raw: string): Config {
  try {
    return JSON.parse(raw);
  } catch {
    return {} as Config;
  }
}

// Prefer — validate once, at the boundary, and say why a failure is recoverable
function loadConfig(raw: string): Config {
  const parsed = JSON.parse(raw); // let a malformed config file fail loudly
  return isConfig(parsed) ? parsed : DEFAULT_CONFIG;
}
```

## Testing

- Arrange-act-assert: set up state, call the function, assert the result. Avoid shared mutable fixtures beyond what `beforeEach`/`afterEach` explicitly reset.
- Prefer exercising real behavior (a real DOM event, a real return value) over asserting a mock was called with the right arguments — it costs a little more setup and pays for itself in tests that catch real breakage.
- If your code touches shared or module-level state, reset it in `afterEach` so tests stay independent of run order.

```ts
// Avoid — only proves the mock was called, not that the behavior is correct
it("closes the tab", () => {
  const close = vi.fn();
  handleClose({ close });
  expect(close).toHaveBeenCalled();
});

// Prefer — arrange real state, act, assert the real outcome
it("closes the tab", () => {
  const tab = createTab({ isOpen: true });
  handleClose(tab);
  expect(tab.isOpen).toBe(false);
});
```

## Formatting

Enforced by Prettier and ESLint (`npm run format`, `npm run lint`). Don't hand-format around what the tooling already does automatically.
