'use strict';
// Where the feed text (content.txt) lives.
// Preferred: a file on a separate GitHub branch ("content"), so the admin page can save without
// triggering a Render redeploy. Fallback: the content.txt bundled in the Docker image.
const fs = require('fs');
const path = require('path');

const REPO = process.env.GITHUB_REPO === undefined ? 'wroxtaaar/YouTube-kids-app' : process.env.GITHUB_REPO;
const BRANCH = process.env.CONTENT_BRANCH || 'content';
const FILE = process.env.CONTENT_PATH || 'content.txt';
const TOKEN = process.env.GITHUB_TOKEN || '';
const API = process.env.GITHUB_API || 'https://api.github.com';
const LOCAL = process.env.CONTENT_FILE || path.join(__dirname, 'content.txt');
const TTL = parseInt(process.env.CONTENT_CACHE_SECONDS || '30', 10) * 1000;

let cache = null; // { t, text, sha, source }

function headers(extra) {
  const h = { 'user-agent': 'kidtube', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...extra };
  if (TOKEN) h.authorization = 'Bearer ' + TOKEN;
  return h;
}
const fileUrl = () => `${API}/repos/${REPO}/contents/${encodeURIComponent(FILE)}`;

async function remote() {
  const r = await fetch(fileUrl() + '?ref=' + encodeURIComponent(BRANCH), { headers: headers(), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('GitHub ' + r.status);
  const j = await r.json();
  return { text: Buffer.from(j.content || '', 'base64').toString('utf8'), sha: j.sha };
}

async function load(force) {
  if (!force && cache && Date.now() - cache.t < TTL) return cache;
  if (REPO) {
    try { cache = { t: Date.now(), ...(await remote()), source: 'github' }; return cache; }
    catch (e) {
      if (cache && cache.source === 'github') { cache.t = Date.now(); return cache; } // keep last good copy
      console.error('content: GitHub read failed (' + e.message + '), using bundled content.txt');
    }
  }
  // bundled fallback; retry GitHub again sooner than the normal TTL
  cache = { t: Date.now() - TTL + 5000, text: fs.readFileSync(LOCAL, 'utf8'), sha: null, source: 'bundled' };
  return cache;
}

async function save(text) {
  if (!TOKEN || !REPO) { const e = new Error('GITHUB_TOKEN is not set on the server, so edits cannot be saved yet.'); e.status = 503; throw e; }
  let sha;
  try { sha = (await remote()).sha; } catch (e) { if (!/GitHub 404/.test(e.message)) throw e; }
  const body = { message: 'Update feed from admin page', content: Buffer.from(text, 'utf8').toString('base64'), branch: BRANCH, ...(sha ? { sha } : {}) };
  const r = await fetch(fileUrl(), { method: 'PUT', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!r.ok) {
    const e = new Error('GitHub refused the save (' + r.status + '). Check the token has "Contents: Read and write" on the repo and the "' + BRANCH + '" branch exists.');
    e.status = 502; console.error('content save:', r.status, (await r.text()).slice(0, 300)); throw e;
  }
  cache = null;
}

module.exports = { load, save, canWrite: () => !!(TOKEN && REPO) };
