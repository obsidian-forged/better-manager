# On-demand loading

Implements the loading half of GitHub issue #85 (`[FR] On-demand mode`).

## Behaviour

- **On-demand** is chosen per plugin in **Settings → Better Manager → On-demand loading**. Other plugins keep following normal or delayed startup.
- Choosing on-demand runs the plugin once, remembers its commands, then unloads it. The plugin is also removed from `.obsidian/community-plugins.json`, so Obsidian does not load it at the next startup.
- Remembered commands are registered as placeholders in the command registry. Running one loads the real plugin and forwards to the native command, including editor and context checks. The plugin then stays loaded for the rest of the session.
- After a restart, on-demand plugins stay asleep. Placeholders are armed from `cache/on-demand-commands.json` when the cached manifest version still matches; otherwise the plugin is loaded once to refresh the cache and goes back to sleep.
- **Restore to normal / delayed settings** loads the plugin now and returns it to the native enabled list.
- Choosing a mode or a loading entry publishes the configuration immediately as an explicit user edit, even when **Save settings manually** is enabled; the BPM Save button is not needed.
- BPM-ignored plugins and desktop-only plugins on mobile are never loaded on demand.
- A placeholder whose cached manifest version no longer matches is withdrawn until the plugin is loaded again and its commands are recaptured.
- Device presets still decide whether a plugin is enabled. An on-demand plugin that the current preset disables is disarmed; enabling it again arms it without loading.
- Preview sessions and foreign preset projections unload without rewriting the native enabled list.

## Optional loading entries

All three are enabled by default and stored in shared configuration with the plugin choices:

- **Ribbon loading buttons** — one load button per sleeping plugin.
- **Sidebar loading entry** — a right-sidebar panel listing sleeping plugins, also reachable through the **Open on-demand plugins** command.
- **Right-click loading entry** — a **Load <name> now** item in file and editor context menus. A plugin's own context-menu items appear only after it has loaded; reopen the menu.

These are load entry points, not replayed copies of a sleeping plugin's own Ribbon or context-menu commands. Clicking a load entry loads the plugin; its native UI then appears normally.

## Storage and ownership

- Choices live in `data.json` under `ON_DEMAND` (`plugins`, `ribbon`, `views`, `menus`) and therefore follow configuration sync and conflict resolution.
- Command metadata is disposable and stored in `cache/on-demand-commands.json`; deleting it only costs one recapture per plugin.
- Command capture and the plugin's own runtime state are not written to configuration.
- The runtime polls the running state every 2.5 seconds so plugins enabled or disabled outside the manager, or updated by configuration sync, rearm or disarm without a restart.

## Limitations

- Plugins that need background hooks (`setInterval`, `vault.on`, global listeners) do not run those hooks while asleep; use delayed startup for them.
- Inline and embedded views that require the plugin to be loaded are unaffected by command placeholders.
- Command names and icons are captured in the language active at capture time and refresh on the next load.
- Removing a plugin while it sleeps clears its placeholders and loading entries. Reinstalling it creates a fresh BPM record that starts disabled; enable it again before on-demand loading resumes.
- Desktop acceptance covered commands, restart, Ribbon, panel, context menus, options and external enable/disable. Mobile was not separately tested.
