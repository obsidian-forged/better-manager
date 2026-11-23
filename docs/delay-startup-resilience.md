# Delay-startup resilience

## Failure model

Delay mode deliberately removes every managed plugin from `.obsidian/community-plugins.json`; BPM's startup task is then the only thing that starts them. That makes any startup failure fail closed: all managed plugins stay off.

The 1.2.44 changes remove the ways a single failure could reach that state:

- **Partial manifests no longer delete records.** `synchronizePlugins` keeps existing plugin records unless the caller explicitly prunes (the uninstall flow does). A temporarily incomplete manifest list during sync/startup can no longer erase names, groups, tags, notes or enabled states.
- **Device/appearance failures cannot abort plugin startup.** Appearance errors are reported and skipped. Device-manager initialization and device application are isolated; a preset projection failure no longer prevents the delay queue from running.
- **On-demand initialization is optional.** A failure disables on-demand only; BPM initialization and delay startup continue.
- **One bad on-demand plugin cannot block the rest.** Each on-demand startup item is isolated.
- **The delay queue has a fallback drain.** If device application throws, BPM still builds and drains the queue once.
- **Self-check takeover waits for a clean, settled startup.** It runs only after the queue has settled with no failed starts. It can no longer rewrite the startup list while plugins are unstarted.
- **Recovery when nothing starts.** If delay mode settles with no expected plugin running, BPM restores the bound preset's enabled plugins and enabled records to native startup. If BPM initialization itself fails, the same restoration runs before unloading, so the next launch is not locked out.
- **Malformed synced records are repaired** (missing name, tags, enabled flag, group/delay/note) before projection or delay scheduling.

Recovery is fail-open: it may lose delay scheduling for the current launch, but it does not leave every plugin disabled.
