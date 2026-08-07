# Third-Party Notices

HYPER-KIT itself ships **zero bundled runtime dependencies**. The build (`npm run build`) is a plain `tsc` compile — no bundler — and the compiled output resolves `react` / `react-dom` from Hyper's own runtime at load time (the same pattern every Hyper local plugin uses) rather than bundling its own copies.

## Development & Build Tooling

These packages are used only to build, lint, test, and type-check this project. None of them ship in `dist/` or run inside Hyper.

| Package                      | Version | License      |
| ----------------------------- | ------- | ------------ |
| typescript                    | ^5.6    | Apache-2.0   |
| eslint                        | ^9.0    | MIT          |
| typescript-eslint             | ^8.0    | MIT          |
| eslint-config-prettier        | ^10.0   | MIT          |
| prettier                      | ^3.0    | MIT          |
| vitest                        | ^3.0    | MIT          |
| jsdom                         | ^26.0   | MIT          |
| seamless-immutable             | ^7.1    | BSD-3-Clause |
| @types/node                   | ^22.0   | MIT          |
| @types/react                  | ^18.0   | MIT          |
| @types/react-dom              | ^18.0   | MIT          |
| @types/seamless-immutable     | ^7.1    | MIT          |

`seamless-immutable` mirrors the shape of Hyper's own Redux state in tests (Hyper uses it internally) — it's a test-only dependency, not something this plugin bundles or requires at runtime.

## Runtime Host Dependencies

At runtime, this plugin is loaded inside Hyper's own Electron/Node process and uses capabilities Hyper already provides rather than bundling them:

- **react / react-dom** — provided by Hyper's own plugin runtime; this project only depends on their type declarations (`@types/react`, `@types/react-dom`) for compile-time checking.
- **Node built-ins** (`child_process`, `fs`, `os`) — accessed via `window.require(...)` inside Hyper's renderer process, per Hyper's own plugin API. Not a package dependency of this project.

## Keeping This File Current

If you add a `dependencies` entry that ships in `dist/` or is otherwise redistributed, add it to the table above with its license. Dev/test-only tooling that never ships doesn't need more than the table already here.
