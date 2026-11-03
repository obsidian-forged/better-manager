import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditCss, renderAudit } from './lib/css-audit.mjs';

export async function main(args = process.argv.slice(2)) {
    let input = 'styles.css', outDir = '.device-test/css-audit', maxOverlaps = 1000, positional = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--help') { process.stdout.write('Usage: node scripts/audit-css.mjs [styles.css] [--out-dir directory] [--max-overlaps 1000]\nRead-only audit; writes css-audit.md and css-audit.json.\n'); return; }
        if (arg === '--out-dir' || arg === '--max-overlaps') {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
            if (arg === '--out-dir') outDir = value;
            else { if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid --max-overlaps'); maxOverlaps = Number(value); }
        } else if (arg.startsWith('-') || positional) throw new Error(`Unexpected argument: ${arg}`);
        else { input = arg; positional = true; }
    }
    const source = await readFile(input, 'utf8');
    const report = auditCss(source, { file: path.relative(process.cwd(), path.resolve(input)), maxOverlaps });
    const outputPaths = ['css-audit.json', 'css-audit.md'].map(name => path.resolve(outDir, name));
    if (outputPaths.includes(path.resolve(input))) throw new Error('Output would overwrite the input CSS');
    const realInput = await realpath(input);
    for (const output of outputPaths) {
        const target = await realpath(output).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if (target === realInput) throw new Error('Output alias would overwrite the input CSS');
    }
    await mkdir(outDir, { recursive: true });
    await writeFile(outputPaths[0], JSON.stringify(report, null, 2) + '\n');
    await writeFile(outputPaths[1], renderAudit(report));
    process.stdout.write(JSON.stringify({ ...report.summary, report: path.join(outDir, 'css-audit.md'), details: path.join(outDir, 'css-audit.json') }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
