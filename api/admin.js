// /api/admin  — private admin API for reading and deleting contact messages.
//   POST /api/admin?action=login   { password }   -> sets a secure login cookie
//   POST /api/admin?action=logout                 -> clears the cookie
//   GET  /api/admin?action=list                   -> all messages (login required)
//   POST /api/admin?action=delete  { id }         -> delete one message (login required)
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const COOKIE = 'admin_session';
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

const attempts = new Map();            // best-effort login rate limit: 5 tries / 10 min / IP
function tooMany(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 5;
}

const secretKey = () =>
  crypto.createHash('sha256').update(`${process.env.ADMIN_PASSWORD}|${process.env.SUPABASE_SERVICE_KEY}`).digest();
const sign = (text) => crypto.createHmac('sha256', secretKey()).update(text).digest('hex');

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function makeToken() {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${sign(exp)}`;
}

function isLoggedIn(req) {
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return false;
  const token = decodeURIComponent(raw.slice(COOKIE.length + 1));
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

function setCookie(req, res, value, maxAge) {
  const host = String(req.headers.host || '');
  const local = /^(localhost|127\.0\.0\.1)/.test(host);
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${local ? '' : '; Secure'}`);
}

const BUCKET = 'portfolio';
const urlOk = (u, allowData) => u === '' || (typeof u === 'string' && u.length <= 600 && /^(https:\/\/|\/|images\/|brewnest\/|\.\/)/i.test(u)) ||
  (allowData && typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u) && u.length < 600000);
const str = (v, n) => String(v ?? '').trim().slice(0, n);

function cleanProjects(list) {
  if (!Array.isArray(list) || list.length > 24) return null;
  const out = [];
  for (const p of list) {
    const category = p?.category === 'graphic-design' ? 'graphic-design' : 'web-development';
    const image = String(p?.image ?? ''), link = String(p?.link ?? '');
    if (!urlOk(image, true) || !(urlOk(link, false) || /^(mailto:|tel:)/i.test(link))) return null;
    out.push({ title: str(p.title, 120), category, description: str(p.description, 600), image, link,
      tags: (Array.isArray(p.tags) ? p.tags : []).slice(0, 8).map((t) => str(t, 30)).filter(Boolean) });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_PASSWORD) {
    console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_KEY or ADMIN_PASSWORD');
    return res.status(500).json({ ok: false, error: 'Admin is not configured yet.' });
  }

  const action = String(req.query?.action || '');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

  if (action === 'login' && req.method === 'POST') {
    if (tooMany(ip)) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' });
    if (!safeEqual(body.password ?? '', ADMIN_PASSWORD)) {
      return res.status(401).json({ ok: false, error: 'Wrong password.' });
    }
    setCookie(req, res, makeToken(), SESSION_MS / 1000);
    return res.status(200).json({ ok: true });
  }

  if (action === 'logout' && req.method === 'POST') {
    setCookie(req, res, '', 0);
    return res.status(200).json({ ok: true });
  }

  // Everything below needs a valid login
  if (!isLoggedIn(req)) return res.status(401).json({ ok: false, error: 'Please log in.' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  if (action === 'list' && req.method === 'GET') {
    const { data, error } = await db.from('messages')
      .select('id, name, email, service, message, created_at')
      .order('created_at', { ascending: false }).limit(500);
    if (error) { console.error(error.message); return res.status(500).json({ ok: false, error: 'Could not load messages.' }); }
    return res.status(200).json({ ok: true, messages: data });
  }

  if (action === 'delete' && req.method === 'POST') {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ ok: false, error: 'Invalid id.' });
    const { error } = await db.from('messages').delete().eq('id', id);
    if (error) { console.error(error.message); return res.status(500).json({ ok: false, error: 'Could not delete.' }); }
    return res.status(200).json({ ok: true });
  }

  // ---- content editing ----
  if (action === 'content' && req.method === 'GET') {
    const { data, error } = await db.from('site_content').select('key, value');
    if (error) return res.status(500).json({ ok: false, error: 'Could not load content. Did you run supabase-cms.sql?' });
    return res.status(200).json({ ok: true, content: Object.fromEntries(data.map((r) => [r.key, r.value])) });
  }

  if (action === 'save' && req.method === 'POST') {
    const rows = [];
    for (const [key, value] of Object.entries(body.changes || {})) {
      if (!/^[a-z0-9_.-]{1,60}$/i.test(key)) return res.status(400).json({ ok: false, error: 'Bad key: ' + key });
      let v;
      if (key === 'projects') { v = cleanProjects(value); if (!v) return res.status(400).json({ ok: false, error: 'Invalid project data (check image/link URLs).' }); }
      else if (typeof value === 'string') {
        v = value.slice(0, 5000);
        if (/\.l\d+$/.test(key) && /^\s*(javascript|vbscript|data):/i.test(v)) return res.status(400).json({ ok: false, error: 'That link is not allowed.' });
      } else return res.status(400).json({ ok: false, error: 'Invalid value for ' + key });
      rows.push({ key, value: v, updated_at: new Date().toISOString() });
    }
    if (!rows.length) return res.status(200).json({ ok: true });
    const { error } = await db.from('site_content').upsert(rows);
    if (error) { console.error(error.message); return res.status(500).json({ ok: false, error: 'Could not save.' }); }
    return res.status(200).json({ ok: true });
  }

  if (action === 'reset' && req.method === 'POST') {
    const key = String(body.key || '');
    if (!/^[a-z0-9_.-]{1,60}$/i.test(key)) return res.status(400).json({ ok: false, error: 'Bad key.' });
    const { error } = await db.from('site_content').delete().eq('key', key);
    return error ? res.status(500).json({ ok: false, error: 'Could not reset.' }) : res.status(200).json({ ok: true });
  }

  // ---- media (images / PDFs) ----
  if (action === 'upload' && req.method === 'POST') {
    const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
    const ext = types[body.type];
    if (!ext || typeof body.data !== 'string') return res.status(400).json({ ok: false, error: 'Use JPG, PNG, WebP, GIF or PDF.' });
    const buf = Buffer.from(body.data, 'base64');
    if (!buf.length || buf.length > 3.2 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'File must be under 3 MB.' });
    const base = str(body.name, 60).replace(/\.[^.]*$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'file';
    const path = `${Date.now()}-${base}.${ext}`;
    let { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: body.type });
    if (error && /bucket/i.test(error.message)) {            // first upload: create the public bucket
      await db.storage.createBucket(BUCKET, { public: true });
      ({ error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: body.type }));
    }
    if (error) { console.error(error.message); return res.status(500).json({ ok: false, error: 'Upload failed.' }); }
    return res.status(200).json({ ok: true, url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, path });
  }

  if (action === 'media' && req.method === 'GET') {
    const { data, error } = await db.storage.from(BUCKET).list('', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) return res.status(200).json({ ok: true, files: [] });
    return res.status(200).json({ ok: true, files: data.filter((f) => f.name && !f.name.startsWith('.'))
      .map((f) => ({ path: f.name, url: db.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl })) });
  }

  if (action === 'media_delete' && req.method === 'POST') {
    const path = String(body.path || '');
    if (!/^[\w.-]+$/.test(path)) return res.status(400).json({ ok: false, error: 'Bad path.' });
    await db.storage.from(BUCKET).remove([path]);
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ ok: false, error: 'Unknown action.' });
}
