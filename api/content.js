// GET /api/content — public. Returns the text/links/projects you edited in /admin.
import { createClient } from '@supabase/supabase-js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60');
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (req.method !== 'GET' || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(200).json({});
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.from('site_content').select('key, value');
  if (error) return res.status(200).json({});          // site falls back to its built-in content
  return res.status(200).json(Object.fromEntries(data.map((r) => [r.key, r.value])));
}
