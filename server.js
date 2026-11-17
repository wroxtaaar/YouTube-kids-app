'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const PORT = process.env.PORT || 3000;
const PER_KEYWORD = parseInt(process.env.VIDEOS_PER_KEYWORD || '15', 10);
const CACHE_MS = parseInt(process.env.CACHE_MINUTES || '30', 10) * 60 * 1000;
const API_KEY = process.env.YOUTUBE_API_KEY || '';
const CONTENT_FILE = process.env.CONTENT_FILE || path.join(__dirname, 'content.txt');
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
  const items = L.parseContent(fs.readFileSync(CONTENT_FILE, 'utf8'));
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.end('ok'); return; }
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
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log('Kids feed on :' + PORT));
