# GSC Agent

English · [简体中文](README.md)

Let your local AI agent (Claude Code, Codex, Cursor, Claude Desktop, …) use the Google Search Console you are already logged into in Chrome to click **Request indexing** for your URLs — and report honestly whether Google confirmed it.

- No Google OAuth, API key or Cloud project. It uses your existing browser session.
- The extension connects automatically when Chrome starts. The agent uses a GSC tab you already have open, or opens one in the background. Click the extension icon on a GSC tab to pin the agent to that tab.
- It reports `submitted` only after reading Google's confirmation.

> Note: tool results, CLI output and error messages are currently in Simplified Chinese. Your agent can read and translate them for you.

## What it does

- **Single URL or batches.** Batches run in the background in order; duplicates in a batch run once.
- **Read-only by default.** When you ask about index status, the agent uses `gsc_inspect_url`, which never submits, costs no quota and reports why a page is not indexed. It submits only after you agree in the conversation: `submit` requests indexing (good for updated pages), `if_unindexed` inspects first and submits only if the URL is clearly not indexed. Batches also default to inspecting.
- **Picks the property for you.** Supports URL-prefix and domain properties, using the open property if it already covers the URL, otherwise the most specific match.
- **Protects your quota.** Counts submissions per property over 24 hours and stops at the limit. Batches wait 120 s after each confirmed submission by default.
- **Stoppable, resumable, auditable.** Stop a batch at any time, resume from `remaining`, and query the local history.
- **Self-check.** One command verifies installation, browser connection and versions, and tells you how to fix problems. Add `--page` for a read-only pass on the real GSC page that names the broken rule after a GSC redesign.

It does not guarantee indexing, read performance data or submit sitemaps.

## How it works

```
AI agent ──MCP──> local MCP server ──socket──> native host ──native messaging──> Chrome extension ──> your GSC tab
```

## Requirements

- macOS or Linux. Windows is not supported yet.
- A Chromium browser: Chrome, Chromium, Edge, Brave, Vivaldi, or Arc on macOS. On Linux, Snap and Flatpak browsers cannot launch native hosts; use the official packages.
- Node.js 22.22+
- GSC interface language: English or Simplified Chinese (other languages: see [CUSTOMIZE.md](CUSTOMIZE.md))

## Install

```sh
git clone https://github.com/Patrick5D/gsc-agent-extension.git gsc-agent
cd gsc-agent
npm install
npm run setup
```

`setup` copies the extension and native host to `~/.gsc-agent/`, registers the host with every installed browser, and prints the next steps. Run it again after installing another browser.

1. Open the browser's extensions page (`chrome://extensions`, `edge://extensions`, `brave://extensions`…), enable **Developer mode**, click **Load unpacked** and choose `~/.gsc-agent/extension`. On macOS, press ⌘⇧. in the file picker to show hidden folders.
2. Add the MCP server to your agent (see below).
3. Make sure the browser is logged into Search Console. The extension connects on its own and the badge shows **ON**.
4. Run `npm run doctor`. Every check should pass.

## Connect your agent

`npm run config` prints configs for all supported clients. `npm run config -- <client>` prints one: `claude-code`, `codex`, `cursor`, `claude-desktop` or `json`. To save a JSON file, run `node bridge/cli.js config json > mcp.json` (`npm run` adds two banner lines).

A single submission can take up to about 4 minutes, so raise the tool timeout to 270 s or more:

- **Claude Code:** start it with `MCP_TOOL_TIMEOUT=270000 claude`.
- **Codex:** add `tool_timeout_sec = 270` under `[mcp_servers.gsc-agent]` in `~/.codex/config.toml`.
- **Clients without a timeout setting:** ask the agent to use `gsc_start_batch` even for one URL. It returns immediately; poll `gsc_batch_status` for the result.

## Usage

Just ask your agent, for example:

- "Is https://example.com/article indexed?" (inspect only)
- "Request indexing for https://example.com/article."
- "Check these 20 URLs, submit only the unindexed ones, and report each result."

Which tab is used: an open GSC property tab, preferring the visible one, then the most recently viewed; a batch keeps the same tab. With none open, a GSC tab is opened in the background and reused. Clicking the extension icon on a GSC tab pins the agent there until that tab is closed. Set `AUTO_CONNECT` to `false` in `extension/config.js` to connect only when you click the icon.

| Tool | Purpose |
|---|---|
| `gsc_inspect_url` | Read-only check of one URL with the reason, no quota used: `url` |
| `gsc_request_indexing` | Submit one URL after the user agrees: `url`, `mode` (`submit` by default, or `if_unindexed`), `skip_recent_hours` |
| `gsc_start_batch` | Background batch: `urls`, `mode` (`inspect` by default; submitting needs the user's consent), `interval_seconds`, `skip_recent_hours` |
| `gsc_batch_status` | Progress, results, `current`, `remaining`, `nextAt` |
| `gsc_stop_batch` | Stop after the current URL finishes |
| `gsc_submission_history` | Local history filtered by `url` / `status` |
| `gsc_doctor` | Installation, connection and version checks |

The result statuses are:

| Status | Meaning |
|---|---|
| `submitted` | GSC confirmed the request |
| `inspected` / `already_indexed` | Inspection finished, or the URL was skipped because it is already indexed. `reason` holds the report's status line, such as "Page is not indexed: Discovered – currently not indexed"; `submitted` also carries the `reason` seen before submitting |
| `recently_submitted` | Skipped by `skip_recent_hours` |
| `blocked` | Stopped before clicking (login, property, quota or error dialog) |
| `unconfirmed` | Clicked but no confirmation was read; check the tab before retrying |

Batch and quota rules:

- Only one batch runs at a time.
- Set the per-property limit with `GSC_AGENT_DAILY_QUOTA` (default 10). `0` disables it.
- Chrome throttles timers in background tabs. For long batches, keep the GSC tab in use in its own visible window.

## Upgrading

`git pull && npm install && npm run setup`, reload the extension, and restart the agent's MCP connection. Check [CHANGELOG.md](CHANGELOG.md) (Simplified Chinese) for changes marked **不兼容** (breaking).

## Maintain your own version

Everything customizable lives in two files. `extension/config.js` holds the auto-connect switch, the GSC text rules, the native host name and the page timeouts. `bridge/config.js` holds the data directory and the defaults. See [CUSTOMIZE.md](CUSTOMIZE.md) (Simplified Chinese) for adding a GSC language, adapting to a GSC redesign, or using your own extension ID.

## Limitations

- This tool automates the GSC web UI. It is not an official API, so a GSC redesign can break it.
- Judge for yourself whether automation fits Google's terms of service, and keep the submission rate close to normal manual use.
- macOS and Linux only; no Windows yet.
- Switching properties needs the property list. In a GSC tab where the property picker has never been clicked by hand (including the tab the extension opens in the background), scripts cannot open that list. Open and close the picker once by hand in that tab; it keeps working after reloads. URLs inside the current property are not affected.
- If the agent reports errors such as "找不到网址检查框" (inspect box not found), run `npm run doctor -- --page`. It inspects the current property's home page read-only and names the rule in `extension/config.js` that no longer matches.

## Security boundaries

- **The trust boundary is your OS account.** The native host listens on a socket under `~/.gsc-agent/`, readable only by you, but any program running as you can use it to drive your logged-in GSC.
- **Small extension permissions:** native messaging, scripting, and `https://search.google.com/*` only. No other sites, no Google credentials.
- **"Submit only with consent" is an instruction to the agent, not a hard block.** The hard limit is the per-property daily cap `GSC_AGENT_DAILY_QUOTA`.
- **History stays local** in `~/.gsc-agent/history/` and contains URLs and report links.

## Development

`npm test` runs MCP-to-host integration tests with a simulated Chrome, page-script tests on jsdom, service-worker tests with a simulated `chrome` API, and CLI tests. Nothing is sent to Google.

## License

[MIT](LICENSE)
