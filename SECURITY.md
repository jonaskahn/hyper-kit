# Security Policy

## Supported Versions

HYPER-KIT is a small, actively-developed plugin. Only the latest published version receives security fixes — there are no long-term-support branches.

| Version | Supported |
| ------- | :-------: |
| latest  |    ✅     |
| older   |    ❌     |

## What Counts as a Security Issue Here

HYPER-KIT is a local Hyper terminal plugin — it runs with the same privileges as your terminal and shells out to a few OS-level tools for specific features:

- `tool-probe.ts` / `system-info.ts` invoke local CLI tools (git, docker, etc.) to detect what's installed and read network/battery/CPU info.
- `now-playing.ts` shells out to `dbus-send` (Linux), `osascript` (macOS), or PowerShell (Windows) to read and control media playback.

A security issue here looks like: a way for plugin config or probed process output to trigger command execution beyond what's intended, a path/temp-file handling bug that lets another local user read or tamper with data, or any other flaw that grants broader access than "run as the user who's already running Hyper." General bugs, crashes, or UI glitches with no security impact belong in a regular issue instead.

## Reporting a Vulnerability

Please **do not** open a public issue for a suspected vulnerability.

Instead, report it privately via [GitHub Security Advisories](https://github.com/jonaskahn/hyper-kit/security/advisories/new) for this repository. Please include:

- A description of the issue and its potential impact
- Steps to reproduce (a minimal `~/.hyper.js` config or a repro repo helps)
- The affected version or commit

You should get an initial response within a few days. Confirmed issues will be prioritized and fixed in a new release; you'll be credited in the release notes unless you'd prefer otherwise.
