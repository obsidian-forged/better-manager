import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
let request;
const built = await build({ stdin: { contents: "export * from './src/network/http-error'; export { fetchReleaseVersions, installThemeFromGithub } from './src/github-install';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false, external: ['obsidian'], logLevel: 'silent' });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(() => ({ requestUrl: input => request(input), Notice: class {}, Platform: {}, normalizePath: value => value }), loaded, loaded.exports);
const { HttpRequestError, assertHttpSuccess, fetchReleaseVersions, installThemeFromGithub, errorObject, errorMessage } = loaded.exports;
const response = (status, message, headers = {}) => ({ status, text: typeof message === 'string' ? message : JSON.stringify(message), headers });
test('HTTP errors preserve status and server reason without treating every 403 as rate limiting', () => {
    const denied = new HttpRequestError(response(403, { message: 'Resource not accessible by personal access token' }));
    assert.match(denied.message, /HTTP 403.*Resource not accessible/);
    assert.equal(denied.rateLimited, false);
    const limited = new HttpRequestError(response(403, { message: 'API rate limit exceeded' }, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '2000000000' }), 1000);
    assert.equal(limited.rateLimited, true); assert.equal(limited.retryAt, 2000000000000);
    const retry = new HttpRequestError(response(429, { message: 'Slow down' }, { 'Retry-After': '60' }), 1000);
    assert.equal(retry.retryAt, 61000); assert.match(retry.message, /HTTP 429/);
});
test('HTML, credentials and malformed responses do not leak into displayed HTTP errors', () => {
    assert.equal(new HttpRequestError(response(502, '<html>private proxy page</html>')).message, 'HTTP 502: Request failed');
    const redacted = new HttpRequestError(response(401, { message: 'ghp_sensitive123 https://x.example/?token=private <b>denied</b>' }));
    assert.doesNotMatch(redacted.message, /sensitive123|token=|<b>/);
    assert.doesNotThrow(() => assertHttpSuccess(response(200, 'ok')));
});
test('unknown failures become Error instances without exposing object payloads or losing HTTP context', () => {
    const original = new HttpRequestError(response(403, { message: 'Access denied' }));
    assert.equal(errorObject(original), original);
    assert.equal(errorMessage(original), 'HTTP 403: Access denied');
    assert.equal(errorObject('Download interrupted').message, 'Download interrupted');
    assert.equal(errorObject(0).message, '0');
    assert.equal(errorObject({ token: 'private' }).message, 'Unknown error');
    assert.equal(errorObject(null).message, 'Unknown error');
});
test('an unavailable fallback preserves the original HTTP 403 without retrying the limited API', async () => {
    const calls = [];
    request = async input => { calls.push(input.url); return response(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }); };
    const manager = { settings: {}, getGithubToken: async () => undefined };
    await assert.rejects(fetchReleaseVersions(manager, 'test/denied', { includeManifest: true, force: true }), /HTTP 403.*API rate limit/);
    assert.equal(calls.filter(url => url.startsWith('https://api.github.com/')).length, 1);
    assert.ok(calls.some(url => url.endsWith('/releases.atom')));
});
test('a missing Latest release still permits history; proxies do not receive GitHub credentials', async () => {
    const requests = [];
    request = async input => { requests.push(input); return input.url.includes('/latest') ? response(404, { message: 'Not Found' }) : { ...response(200, '[]'), json: [] }; };
    await fetchReleaseVersions({ settings: {}, getGithubToken: async () => 'secret' }, 'test/no-latest', { force: true });
    assert.equal(requests.filter(input => input.url.startsWith('https://api.github.com/')).length, 2);
    assert.equal(requests[0].headers.Authorization, 'Bearer secret');
    requests.length = 0;
    await fetchReleaseVersions({ settings: { GITHUB_PROXY: 'https://proxy.example/' }, getGithubToken: async () => 'secret' }, 'test/proxied', { force: true });
    assert.ok(requests.every(input => !input.headers.Authorization));
});
test('malformed release metadata cannot enter update decisions', async () => {
    request = async input => input.url.startsWith('https://api.github.com/')
        ? { ...response(200, '{}'), json: { tag_name: '1.0.0', assets: [{ name: 1, browser_download_url: 'https://example.com/main.js' }] } }
        : response(404, { message: 'Not found' });
    await assert.rejects(fetchReleaseVersions({ settings: {}, getGithubToken: async () => undefined }, 'test/invalid-release', { force: true }), /Invalid GitHub release asset/);
});
test('a theme manifest cannot escape its installation directory', async () => {
    const writes = [], task = { update() {}, done() {}, fail() {} };
    const manager = { settings: {}, getGithubToken: async () => undefined, translator: { t: key => key }, tasks: { start: () => task },
        app: { vault: { configDir: '.custom', adapter: { async exists() { return false; }, async mkdir(path) { writes.push(path); }, async write(path) { writes.push(path); } } } } };
    request = async input => input.url.includes('/releases/latest')
        ? { ...response(200, '{}'), json: { tag_name: '1.0.0', assets: [{ name: 'manifest.json', browser_download_url: 'https://example.com/manifest.json' }, { name: 'theme.css', browser_download_url: 'https://example.com/theme.css' }] } }
        : response(200, input.url.endsWith('manifest.json') ? JSON.stringify({ name: '../outside' }) : 'body {}');
    assert.equal(await installThemeFromGithub(manager, 'test/theme'), false);
    assert.deepEqual(writes, []);
});
