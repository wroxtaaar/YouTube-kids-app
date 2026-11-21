// Integration test: admin API + store against a fake GitHub API. Run: node test-admin.js
const http = require('http'), { spawn } = require('child_process'), assert = require('assert');
let file = { text: 'keyword: tom and jerry\n', sha: 'sha1', puts: 0 };
const gh = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.endsWith('/contents/content.txt') || u.searchParams.get('ref') !== 'content' && req.method === 'GET') { res.writeHead(404); return res.end('{}'); }
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ content: Buffer.from(file.text).toString('base64'), sha: file.sha })); }
  let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
    const j = JSON.parse(b);
    if (req.headers.authorization !== 'Bearer tok' || j.sha !== file.sha || j.branch !== 'content') { res.writeHead(409); return res.end('{}'); }
    file = { text: Buffer.from(j.content, 'base64').toString(), sha: 'sha' + (++file.puts + 1), puts: file.puts };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
});
const req = (port, path, opt = {}) => fetch('http://127.0.0.1:' + port + path, opt).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
(async () => {
  await new Promise((r) => gh.listen(4781, r));
  const env = { ...process.env, PORT: '4782', GITHUB_API: 'http://127.0.0.1:4781', GITHUB_TOKEN: 'tok', ADMIN_PASSWORD: 'secret pw', CONTENT_CACHE_SECONDS: '0' };
  const srv = spawn('node', ['server.js'], { env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const A = (pw) => ({ headers: { authorization: 'Bearer ' + pw } });
  try {
    assert.equal((await req(4782, '/api/admin/content')).s, 401, 'no password rejected');
    assert.equal((await req(4782, '/api/admin/content', A('nope'))).s, 401, 'wrong password rejected');
    const g = await req(4782, '/api/admin/content', A('secret pw'));
    assert.equal(g.s, 200); assert.equal(g.j.source, 'github'); assert.equal(g.j.writable, true); assert.match(g.j.text, /tom and jerry/);
    const text = 'keyword: road runner\nyoutube: https://www.youtube.com/shorts/abcdefghijk\nhome: https://drive.google.com/file/d/abc123/view | Party\n';
    const p = await req(4782, '/api/admin/content', { method: 'PUT', ...A('secret pw'), headers: { authorization: 'Bearer secret pw', 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    assert.equal(p.s, 200, 'save ok'); assert.equal(file.text, text, 'written to fake GitHub branch');
    const bad = await req(4782, '/api/admin/content', { method: 'PUT', headers: { authorization: 'Bearer secret pw', 'content-type': 'application/json' }, body: '{"text":5}' });
    assert.equal(bad.s, 400);
    const f = await req(4782, '/api/feed');
    const flat = f.j.flatMap((v) => v.kind === 'shorts' ? v.items : [v]);
    assert.ok(flat.some((v) => v.kind === 'home' && v.title === 'Party'), 'home video in feed');
    assert.ok(flat.some((v) => v.id === 'abcdefghijk' && v.short), 'short in feed');
    for (let i = 0; i < 9; i++) await req(4782, '/api/admin/content', A('x' + i));
    assert.equal((await req(4782, '/api/admin/content', A('secret pw'))).s, 429, 'brute force throttled');
    console.log('admin tests ok');
  } finally { srv.kill(); gh.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
