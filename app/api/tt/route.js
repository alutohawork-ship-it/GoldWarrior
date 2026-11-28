import { NextResponse } from 'next/server';
import crypto from 'crypto';

const BASE = (process.env.TT_REST_BASE || 'https://ttmarginal.fxopen.net').replace(/\/+$/, '');
const ID = process.env.TT_WEB_API_ID;
const KEY = process.env.TT_WEB_API_KEY;
const SECRET = process.env.TT_WEB_API_SECRET;

function ttSign(ts) {
  return crypto.createHmac('sha256', SECRET).update(String(ts) + ID + KEY).digest('base64');
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path'); // e.g., /api/v2/symbol
  
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  const ts = Date.now();
  try {
    const r = await fetch(BASE + path, {
      headers: {
        'X-ClientId': ID,
        'X-Timestamp': String(ts),
        'X-Signature': ttSign(ts),
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
