import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, password } = req.body;

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
    const user = rows[0];
    if (!user || user.password !== password) return res.status(401).json({ error: '인증 오류' });
    if (user.role === 'admin' || user.role === 'member') {
      return res.status(200).json({ success: true, remaining: 9999 });
    }
    const remaining = user.credits - user.used;
    if (remaining <= 0) return res.status(403).json({ error: '크레딧 소진' });
    await sql`UPDATE users SET used = used + 1 WHERE id = ${userId}`;
    return res.status(200).json({ success: true, remaining: remaining - 1 });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
