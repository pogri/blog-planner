import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, password, systemPrompt, userMessage, useWebSearch } = req.body;

  // 인증
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
    const user = rows[0];
    if (!user || user.password !== password || !user.active) {
      return res.status(401).json({ error: '인증 오류' });
    }
    if (user.role === 'guest') {
      const remaining = user.credits - user.used;
      if (remaining <= 0) return res.status(403).json({ error: '크레딧이 소진되었습니다.' });
    }
  } catch(e) {
    return res.status(500).json({ error: '인증 DB 오류: ' + e.message });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'API 키 설정 오류' });

  try {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    };

    // 웹 검색 필요한 경우 (의학/법률 카테고리)
    if (useWebSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `Anthropic API 오류 (${response.status})`);
    }

    const result = await response.json();
    // 텍스트 블록만 추출
    const text = result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return res.status(200).json({ success: true, text });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
