'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./lib');
const Store = require('./store');

const PORT = process.env.PORT || 3000;
const PER_KEYWORD = parseInt(process.env.VIDEOS_PER_KEYWORD || '15', 10);
const CACHE_MS = parseInt(process.env.CACHE_MINUTES || '30', 10) * 60 * 1000;
const API_KEY = process.env.YOUTUBE_API_KEY || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC = path.join(__dirname, 'public');

const cache = new Map(); // key -> {t, v}
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  try { const v = await fn(); if (v && (!Array.isArray(v) || v.length)) cache.set(key, { t: Date.now(), v }); return v; }
  catch (e) { console.error(key, e.message); return hit ? hit.v : null; }
}

// run at most n tasks at once, so many keywords don't hammer YouTube
async function mapLimit(arr, n, fn) {
  const out = new Array(arr.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (next < arr.length) { const i = next++; try { out[i] = await fn(arr[i]); } catch (e) { console.error(e.message); out[i] = []; } }
  }));
  return out;
}

async function buildFeed() {
  const items = L.parseContent((await Store.load()).text);
  const lists = await mapLimit(items, 4, async (it) => {
    if (it.type === 'keyword') return (await cached('kw:' + it.value, () => L.searchKeyword(it.value, PER_KEYWORD, API_KEY))) || [];
    if (it.type === 'youtube') {
      const id = L.youtubeId(it.value);
      if (!id) return [];
      const meta = await cached('yt:' + id, () => L.oembedTitle(id));
      return [{ kind: 'youtube', id, short: /\/shorts\//.test(it.value), title: meta ? meta.title : 'Video', channel: meta ? meta.channel : '',
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }];
    }
    const h = L.homeVideo(it.url, it.title);
    return h ? [{ ...h, id: 'h' + Buffer.from(it.url).toString('base64url').slice(0, 24) }] : [];
  });
  // de-dupe by id
  const seen = new Set();
  return lists.flat().filter((v) => !seen.has(v.id) && seen.add(v.id));
}

// ---- admin (password protected) ----
const fails = new Map(); // ip -> {n, t}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest();
function adminOk(req, res) {
  const ip = clientIp(req), f = fails.get(ip);
  if (f && Date.now() - f.t > 10 * 60 * 1000) fails.delete(ip);
  if (fails.get(ip) && fails.get(ip).n >= 8) return json(res, 429, { error: 'Too many wrong passwords. Try again in 10 minutes.' }), false;
  if (!ADMIN_PASSWORD) return json(res, 503, { error: 'Admin is not set up. Add an ADMIN_PASSWORD environment variable on Render.' }), false;
  const h = req.headers.authorization || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!crypto.timingSafeEqual(sha(given), sha(ADMIN_PASSWORD))) {
    const cur = fails.get(ip) || { n: 0, t: Date.now() }; cur.n++; cur.t = Date.now(); fails.set(ip, cur);
    return json(res, 401, { error: 'Wrong password' }), false;
  }
  fails.delete(ip);
  return true;
}
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readBody(req, max = 100000) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > max) { reject(new Error('Too large')); req.destroy(); } });
    req.on('end', () => resolve(b)); req.on('error', reject);
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.end('ok'); return; }
  if (url.pathname === '/version') {
    const has = (f) => fs.existsSync(path.join(PUBLIC, f));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ commit: (process.env.RENDER_GIT_COMMIT || 'unknown').slice(0, 7), manifest: has('manifest.webmanifest'), sw: has('sw.js'), icon192: has('icon-192.png'), public: fs.readdirSync(PUBLIC) }));
    return;
  }
  if (url.pathname === '/api/admin/content') {
    if (!adminOk(req, res)) return;
    try {
      if (req.method === 'GET') { const c = await Store.load(true); return json(res, 200, { text: c.text, source: c.source, writable: Store.canWrite() }); }
      if (req.method === 'PUT') {
        const text = (JSON.parse(await readBody(req)) || {}).text;
        if (typeof text !== 'string' || text.length > 60000) return json(res, 400, { error: 'Bad content' });
        await Store.save(text);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed' });
    } catch (e) { console.error(e.message); return json(res, e.status || 500, { error: e.message }); }
  }
  if (url.pathname === '/api/admin/title') {
    if (!adminOk(req, res)) return;
    const link = url.searchParams.get('url') || '', id = L.youtubeId(link);
    if (!id) return json(res, 404, { error: 'Not a YouTube link' });
    const meta = await cached('yt:' + id, () => L.oembedTitle(id));
    return json(res, 200, { id, title: meta ? meta.title : '', channel: meta ? meta.channel : '', short: /\/shorts\//.test(link), thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` });
  }
  if (url.pathname === '/admin') { url.pathname = '/admin.html'; }
  if (url.pathname === '/api/feed') {
    try {
      const feed = await buildFeed();
      const seed = parseInt(url.searchParams.get('seed') || '0', 10) || Date.now();
      const home = L.shuffle(feed.filter((v) => v.kind === 'home'), seed);
      const rest = L.shuffle(feed.filter((v) => v.kind !== 'home' && !v.short), seed);
      const shorts = L.shuffle(feed.filter((v) => v.short), seed + 1);
      // weave: a home video after every 3 videos, a strip of 6 Shorts after every 8
      const out = []; let hi = 0, si = 0;
      for (let i = 0; i < rest.length || hi < home.length; i++) {
        if (hi < home.length && i % 3 === 0) out.push(home[hi++]);
        if (i < rest.length) out.push(rest[i]);
        if (i % 8 === 3 && si < shorts.length) { out.push({ kind: 'shorts', id: 'sr' + si, items: shorts.slice(si, si + 6) }); si += 6; }
      }
      while (si < shorts.length) { out.push({ kind: 'shorts', id: 'sr' + si, items: shorts.slice(si, si + 6) }); si += 6; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(out));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'content-type': 'application/json' }); res.end('[]');
    }
    return;
  }
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': /sw\.js$|\.html$|\.webmanifest$/.test(file) ? 'no-cache' : 'public, max-age=86400' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log('Kids feed on :' + PORT));
