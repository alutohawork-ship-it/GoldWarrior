import { NextResponse } from 'next/server';
import { handleCandles, handleVision } from '@/lib/engine';

// Adapter sederhana agar `res` di engine v221 kompatibel dengan Next.js
function createNextRes() {
  let statusCode = 200;
  let jsonData = null;
  return {
    status: (code) => { 
      statusCode = code; 
      return { json: (data) => { jsonData = data; } }; 
    },
    json: (data) => { jsonData = data; },
    setHeader: () => {},
    get headersSent() { return false; }
  };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const res = createNextRes();
    const lang = body.lang === 'en' ? 'en' : 'id';
    const email = String(body.email || 'guest@alu.pro').trim().toLowerCase();
    const isBot = !!(body.auto || body.bot || body.mode === 'bot');
    const isVis = body.symbol === 'VISION' || body.mode === 'vision' || (Array.isArray(body.images) && body.images.length);

    if (isVis) {
      await handleVision(body, lang, res);
    } else {
      await handleCandles(body, lang, res, isBot, email);
    }

    return NextResponse.json(res.json ? res.json : jsonData, { status: res.status ? res.status : 200 });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ ok: false, reason: 'Internal Server Error' }, { status: 500 });
  }
}
