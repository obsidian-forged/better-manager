import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { debugConsole, noDirectStyles } from './scripts/eslint-project-rules.mjs';

export default defineConfig([
    globalIgnores(['node_modules/**', 'main.js', 'dist/**', '.device-test/**', '.agent/**', '参考/**',
        'tests/**', 'scripts/**', 'docs/**', 'esbuild.config.mjs', 'version-bump.mjs', 'eslint.review.mjs']),
    ...obsidianmd.configs.recommended,
    { files: ['main.ts', 'src/**/*.ts', 'types/**/*.d.ts'], languageOptions: { parserOptions: { projectService: true } },
        plugins: { bpm: { rules: { 'no-direct-styles': noDirectStyles, 'debug-console': debugConsole } } },
        rules: { 'bpm/no-direct-styles': 'error', 'bpm/debug-console': 'error' } },
]);
