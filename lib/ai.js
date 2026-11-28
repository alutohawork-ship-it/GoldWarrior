const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/+$/, '');
const AI_KEY = process.env.OPENAI_API_KEY;
const VIS_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';

export async function aiVision(systemPrompt, userText, imageUrl, ms = 30000) {
  if (!AI_KEY) return null;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
      ]
    }
  ];

  try {
    const r = await fetch(AI_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + AI_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VIS_MODEL,
        max_tokens: 1500,
        temperature: 0,
        messages,
      }),
      signal: AbortSignal.timeout(ms),
    });

    if (!r.ok) return null;
    const data = await r.json();
    const txt = data?.choices?.[0]?.message?.content || '';
    
    // Parse JSON from response
    const a = txt.indexOf('{');
    const b = txt.lastIndexOf('}');
    if (a >= 0 && b > a) {
      return JSON.parse(txt.slice(a, b + 1));
    }
    return null;
  } catch {
    return null;
  }
}

export async function aiText(systemPrompt, userText, ms = 15000) {
  if (!AI_KEY) return null;

  try {
    const r = await fetch(AI_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + AI_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VIS_MODEL,
        max_tokens: 800,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ],
      }),
      signal: AbortSignal.timeout(ms),
    });

    if (!r.ok) return null;
    const data = await r.json();
    return data?.choices?.[0]?.message?.content || '';
  } catch {
    return null;
  }
}
