'use strict';

// ---- content.txt parser ----
function parseContent(text) {
  const items = [];
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^(keyword|youtube|home)\s*:\s*(.+)$/i);
    if (!m) return;
    const type = m[1].toLowerCase();
    let value = m[2].trim();
    if (type === 'home') {
      const [link, ...rest] = value.split('|');
      items.push({ type, url: link.trim(), title: rest.join('|').trim() });
    } else {
      items.push({ type, value });
    }
  });
  return items;
}

function youtubeId(url) {
  const m = String(url).match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ---- home video links -> embeddable ----
function homeVideo(url, title) {
  let m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/) || url.match(/drive\.google\.com\/.*[?&]id=([\w-]+)/);
  if (m) {
    return { kind: 'home', provider: 'drive', title: title || 'Home video',
      embed: `https://drive.google.com/file/d/${m[1]}/preview`,
      thumb: `https://drive.google.com/thumbnail?id=${m[1]}&sz=w640` };
  }
  m = url.match(/mega\.nz\/(?:file|embed)\/([\w-]+)#([\w-]+)/);
  if (m) {
    return { kind: 'home', provider: 'mega', title: title || 'Home video',
      embed: `https://mega.nz/embed/${m[1]}#${m[2]}`, thumb: null };
  }
  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(url)) {
    return { kind: 'home', provider: 'direct', title: title || 'Home video', src: url, thumb: null };
  }
  return null;
}

// ---- YouTube search (scrape results page; API key optional) ----
function walk(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return; }
  if (node.videoRenderer && node.videoRenderer.videoId) out.push(node.videoRenderer);
  for (const k of Object.keys(node)) walk(node[k], out);
}

function parseSearchHtml(html, limit) {
  const m = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const vr = [];
  walk(data, vr);
  const seen = new Set();
  const res = [];
  for (const v of vr) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    // skip live streams / premieres (no length)
    if (!v.lengthText) continue;
    res.push({
      kind: 'youtube', id: v.videoId,
      title: ((v.title && v.title.runs && v.title.runs.map((r) => r.text).join('')) || 'Video'),
      channel: v.ownerText && v.ownerText.runs ? v.ownerText.runs[0].text : '',
      duration: v.lengthText.simpleText || '',
      thumb: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    });
    if (res.length >= limit) break;
  }
  return res;
}

async function searchScrape(q, limit) {
  const r = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgIQAQ%253D%253D', {
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1; SOCS=CAI' },
  });
  if (!r.ok) throw new Error('YouTube search HTTP ' + r.status);
  return parseSearchHtml(await r.text(), limit);
}

async function searchApi(q, limit, key) {
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.search = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: String(Math.min(limit, 50)),
    q, key, safeSearch: 'strict', videoEmbeddable: 'true' });
  const r = await fetch(u);
  if (!r.ok) throw new Error('YouTube API HTTP ' + r.status);
  const j = await r.json();
  return (j.items || []).map((i) => ({
    kind: 'youtube', id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle, duration: '',
    thumb: `https://i.ytimg.com/vi/${i.id.videoId}/hqdefault.jpg`,
  }));
}

async function searchKeyword(q, limit, key) {
  if (key) { try { return await searchApi(q, limit, key); } catch (e) { console.error(e.message); } }
  return searchScrape(q, limit);
}

async function oembedTitle(id) {
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title, channel: j.author_name };
  } catch { return null; }
}

function shuffle(a, seed) {
  // seeded so a refresh gives a new order but one session stays stable if seed is reused
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

module.exports = { parseContent, youtubeId, homeVideo, parseSearchHtml, searchKeyword, oembedTitle, shuffle };
