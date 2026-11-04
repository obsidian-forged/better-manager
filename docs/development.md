# Development

The repository follows the [official Obsidian sample plugin agent guidance](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/AGENTS.md) and the [official ESLint plugin](https://github.com/obsidianmd/eslint-plugin). Project-specific requirements are in [AGENTS.md](../AGENTS.md).

Use Node.js 24 and the committed npm lockfile:

```sh
npm ci
npm run check
npm run build
```

`check` runs TypeScript, the complete recommended Obsidian ESLint configuration with type information, and every `tests/*.test.mjs` file. ESLint runs from the repository root so manifest, package and license rules are included. Generated bundles, test fixtures and Node build scripts are excluded from plugin-runtime linting. The Check workflow runs the same commands on pushes and pull requests. Tag releases must pass the same checks before building the draft release attachments.

The project also enforces its local rules against direct style mutations and console diagnostics outside a live `DEBUG` guard. Use shared components and diagnostic callbacks instead of bypassing these rules.

The SDK is pinned independently of `minAppVersion`. The development-only ESLint dependency uses the project's SDK through an npm override, so API availability checks read the same annotated definitions as TypeScript. New runtime APIs still need a guarded fallback; do not raise the minimum application version simply to silence a warning.

Settings use real declarative pages on Obsidian 1.13 and later. Each page embeds the existing editor, including its explicit Save control. Setting names and descriptions feed both native search and the manager's search. Older versions retain the imperative settings view.

Keep generated `main.js`, temporary vaults and development reports out of source control. UI and device checks use isolated vaults. Automated tests do not establish real-device or minimum-version compatibility. Release review and publishing are separate from local development checks.
