import { neon } from '@neondatabase/serverless';

async function getDb() {
  const sql = neon(process.env.DATABASE_URL);
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'guest',
      credits INTEGER DEFAULT 4,
      used INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  return sql;
}

async function seedAdminUsers(sql) {
  try {
    const raw = process.env.USERS_DATA;
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [id, u] of Object.entries(data.users)) {
      await sql`
        INSERT INTO users (id, password, role, credits, used, active)
        VALUES (${id}, ${u.password}, ${u.role || 'guest'}, ${u.credits || 4}, ${u.used || 0}, ${u.active !== false})
        ON CONFLICT (id) DO NOTHING
      `;
    }
  } catch(e) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, userId, password, adminKey, newUser } = req.body;

  try {
    const sql = await getDb();
    await seedAdminUsers(sql);

    async function checkAdminAuth() {
      const ADMIN_KEY = process.env.ADMIN_KEY || 'admin1234';
      if (adminKey === ADMIN_KEY) return true;
      if (userId && password) {
        const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
        const user = rows[0];
        if (user && user.password === password && user.role === 'admin') return true;
      }
      return false;
    }

    if (action === 'login') {
      const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
      const user = rows[0];
      if (!user) return res.status(401).json({ error: '아이디가 존재하지 않습니다.' });
      if (!user.active) return res.status(401).json({ error: '비활성화된 계정입니다.' });
      if (user.password !== password) return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
      const remaining = (user.role === 'admin' || user.role === 'member') ? 9999 : user.credits - user.used;
      if (remaining <= 0) return res.status(403).json({ error: '크레딧이 소진되었습니다. 관리자에게 문의하세요.' });
      return res.status(200).json({ success: true, userId, role: user.role, credits: user.credits, used: user.used, remaining });
    }

    if (action === 'admin_login') {
      const authorized = await checkAdminAuth();
      if (!authorized) return res.status(401).json({ error: '관리자 권한이 없습니다.' });
      const rows = await sql`SELECT * FROM users ORDER BY created_at DESC`;
      const users = {};
      rows.forEach(u => { users[u.id] = u; });
      return res.status(200).json({ success: true, users });
    }

    if (action === 'create_user') {
      const authorized = await checkAdminAuth();
      if (!authorized) return res.status(401).json({ error: '관리자 권한이 없습니다.' });
      const { id, pw, credits, role } = newUser;
      if (!id || !pw) return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
      const existing = await sql`SELECT id FROM users WHERE id = ${id}`;
      if (existing.length > 0) return res.status(400).json({ error: '이미 존재하는 아이디입니다.' });
      await sql`INSERT INTO users (id, password, role, credits, used, active) VALUES (${id}, ${pw}, ${role || 'guest'}, ${credits || 4}, 0, true)`;
      return res.status(200).json({ success: true });
    }

    if (action === 'charge_credits') {
      const authorized = await checkAdminAuth();
      if (!authorized) return res.status(401).json({ error: '관리자 권한이 없습니다.' });
      const { id, amount } = req.body;
      await sql`UPDATE users SET credits = credits + ${amount}, used = 0 WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    if (action === 'toggle_active') {
      const authorized = await checkAdminAuth();
      if (!authorized) return res.status(401).json({ error: '관리자 권한이 없습니다.' });
      const { id } = req.body;
      await sql`UPDATE users SET active = NOT active WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: '알 수 없는 액션' });
  } catch(e) {
    return res.status(500).json({ error: '서버 오류: ' + e.message });
  }
}
