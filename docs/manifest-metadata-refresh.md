# Manifest metadata refresh

Implemented against upstream `obsidian-forged/better-manager` main at `c84e19f` (1.2.41).

Changing an installed plugin's `manifest.name` without changing its version previously left ordinary Refresh using the native in-memory registry. Even the separate manifest reload action could not make the new name searchable: the search index contained only Better Manager's saved name and description, plus the manifest author. The 1.2.42 follow-up made the new name searchable but still rendered the saved record title, so a matching card kept its old name.

Manual refresh now reloads native manifests before synchronizing records, and the refreshed name and description are applied to the plugin records that the cards render. Desktop and mobile manifest reload actions share that read operation. Search includes both saved labels and current manifest name, description and author. Cache invalidation handles native registries updated in place and ordinary list redraws.

Plugin manifest file notifications use the existing shared adapter subscription. Events for `<configDir>/plugins/<directory>/manifest.json` are coalesced for 250 ms. Changed registry contents refresh an open manager and apply the new metadata; identical contents do not redraw it. This observer does not adopt settings, restart plugins, or poll directories. Reads are shared across concurrent callers, an event during an older read causes another read, and unloading cancels pending timers and suppresses subsequent UI work.

## Name and description ownership

Records written before 1.2.43 carry no provenance, so an alias and a stale copied name are indistinguishable. Such legacy records adopt the current manifest name and description once, which repairs the reported stale card. After that, `manifestName` and `manifestDescription` record the last manifest values applied: when the saved text still equals those markers it follows the manifest; once the user edits the card title or description it diverges and later manifest renames leave it alone. **Restore to the initial state** resets both the text and the markers, so the record follows the manifest again. The markers are bookkeeping, excluded from configuration-conflict differences.

Validation:

- 1.2.43: 742 automated tests passed; TypeScript and ESLint passed for the changed files. `tests/plugin-manifest-refresh.test.mjs` covers legacy adoption, manual refresh, preserved custom labels, automatic events, cleanup, failure recovery and overlapping reads; `tests/config-conflict.test.mjs` confirms the source markers never create a conflict section.
- 1.2.42: `npm run check`: TypeScript, official ESLint and all 708 tests passed, including six new native API substitute regressions for search, manual refresh, automatic events, cleanup, read failure recovery and overlapping reads.
- `npm run build`: passed; generated `main.js` remains an untracked build artifact under the repository's existing ignore rules.
- Linux desktop window acceptance passed on 2026-11-20 with Obsidian 1.15.0, Electron 43.8.4 and the patched Better Manager 1.2.41 build. A fresh vault at `/tmp/bpm-window-BvrZ0A/BPM-Acceptance`, a separate profile and loopback CDP port 19223 were used. A dedicated chrome-devtools-mcp connection verified the runtime vault path before mutations; usage statistics and CrUX were disabled. SHA-256 confirmed the installed test bundle matched the repository build (`767c7ff0248c8c2547c0b70fd9b2898e42626c78d9ea082b5d61ecf046e0fafe`).

Desktop acceptance results:

| Case | Observed result |
| --- | --- |
| Automatic refresh | Searching the future name initially showed zero cards. An external filesystem edit renamed `Original Probe` to `自动改名-Window-A`; the existing open search updated to one matching card without clicking Refresh. |
| Menu Refresh | A second disk edit left the registry on the previous name. Clicking the actual Refresh menu item loaded `手动改名-Window-B` in 19 ms in this run, before the observer's 250 ms window; searching it returned the fixture card. |
| Toolbar reload | The actual Reload plugin list button loaded `重载改名-Window-C` in approximately 64 ms in this run; its search returned the fixture card. These timings establish the exercised path, not a performance guarantee. |
| User data and runtime | The complete saved plugin record remained equal to its initial value: alias, description, group, tags, note, enabled flag and delay. The running fixture instance remained identical, its version stayed 1.0.0, and it remained enabled. |
| Diagnostics | The connected acceptance window reported no console warnings or errors. |

Screenshots and captured final state are retained in `.device-test/manifest-window-acceptance/`. Tests used an enabled synthetic plugin; mobile devices, minimum-version compatibility and personal-vault deployment were not exercised.

For subsequent application acceptance, repeat the isolated synthetic-plugin workflow; use real devices for mobile acceptance rather than treating this Linux desktop run as mobile coverage.
