// POST /api/contact  — receives the portfolio contact form.
// Saves the message in Supabase, then emails you through Resend.
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVICES = [
  'Web Development', 'Frontend Development', 'Landing Page', 'Graphic Design',
  'UI/UX Design', 'JavaScript Project', 'Website Redesign', 'Other'
];

// Best-effort rate limit: 5 messages per IP per 10 minutes.
// (Serverless instances reset now and then, so this slows spam but is not perfect.)
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 5;
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_HITS;
}

const clean = (v, max) => String(v ?? '').replace(/\0/g, '').trim().slice(0, max);

export default async function handler(req, res) {
  // Only same-site POSTs are expected; no CORS headers are added on purpose.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }

  // Honeypot: real visitors never see this field, bots fill it in.
  // Pretend success so the bot learns nothing.
  if (clean(body.website, 200)) return res.status(200).json({ ok: true });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (limited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many messages. Please try again in a few minutes.' });
  }

  const name = clean(body.name, 100);
  const email = clean(body.email, 200);
  const service = clean(body.service, 60);
  const message = clean(body.message, 3000);

  if (!name) return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  if (!SERVICES.includes(service)) return res.status(400).json({ ok: false, error: 'Please choose a service.' });
  if (message.length < 10) return res.status(400).json({ ok: false, error: 'Please write a slightly longer message.' });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, MY_EMAIL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return res.status(500).json({ ok: false, error: 'Server is not configured yet.' });
  }

  // 1) Save the message (this is the part that must succeed)
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { error: dbError } = await db.from('messages').insert({ name, email, service, message });
  if (dbError) {
    console.error('Supabase insert failed:', dbError.message);
    return res.status(500).json({ ok: false, error: 'Could not save your message. Please try again.' });
  }

  // 2) Email yourself (if this fails the message is still safely saved)
  if (RESEND_API_KEY && MY_EMAIL) {
    try {
      const resend = new Resend(RESEND_API_KEY);
      const { error: mailError } = await resend.emails.send({
        from: 'Portfolio <onboarding@resend.dev>',
        to: MY_EMAIL,
        replyTo: email,
        subject: `New portfolio message from ${name} (${service})`,
        text: `Service: ${service}\nFrom: ${name} <${email}>\n\n${message}`
      });
      if (mailError) console.error('Resend error:', mailError.message || mailError);
    } catch (err) {
      console.error('Email step failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true });
}
