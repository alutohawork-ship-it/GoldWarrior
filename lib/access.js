const KV_URL = (process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const kvOn = !!(KV_URL && KV_TOKEN);

async function kvCmd(args, ms = 4000) {
  if (!kvOn) return null;
  try {
    const r = await fetch(KV_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + KV_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.result !== undefined ? data.result : null;
  } catch {
    return null;
  }
}

export async function checkAccess(email, isBot) {
  if (!email) return { ok: false, key: 'no-email' };
  
  const u = await kvCmd(['GET', 'user:' + email]);
  if (!u) return { ok: false, key: 'belum-terdaftar' };
  
  let user;
  try {
    user = typeof u === 'string' ? JSON.parse(u) : u;
  } catch {
    return { ok: false, key: 'data-corrupt' };
  }

  if (user.plan === 'banned') return { ok: false, key: 'diblokir' };
  if (user.plan === 'lifetime') return { ok: true };
  
  if (user.plan === 'monthly') {
    return Date.now() < user.expiresAt 
      ? { ok: true } 
      : { ok: false, key: 'expired' };
  }
  
  if (user.plan === 'trial') {
    if (Date.now() - user.trialStart > 3 * 864e5) 
      return { ok: false, key: 'trial-habis-waktu' };
    if (user.trialUsed >= 3) 
      return { ok: false, key: 'trial-3x-habis' };
    return { ok: true };
  }
  
  return { ok: false, key: 'plan-tidak-dikenal' };
}

export async function markTrialBotUsed(email) {
  if (!email || !kvOn) return;
  const u = await kvCmd(['GET', 'user:' + email]);
  if (!u) return;
  
  let user;
  try {
    user = typeof u === 'string' ? JSON.parse(u) : u;
  } catch {
    return;
  }
  
  if (user.plan === 'trial') {
    user.trialUsed = (user.trialUsed || 0) + 1;
    await kvCmd(['SET', 'user:' + email, JSON.stringify(user), 'EX', '2592000']);
  }
}

export async function createUser(email, plan = 'trial') {
  if (!kvOn) return { ok: false, reason: 'KV not configured' };
  
  const user = {
    email,
    plan,
    trialStart: Date.now(),
    trialUsed: 0,
    expiresAt: plan === 'monthly' ? Date.now() + 30 * 864e5 : null,
    createdAt: Date.now(),
  };
  
  await kvCmd(['SET', 'user:' + email, JSON.stringify(user), 'EX', '31536000']);
  return { ok: true, user };
}

export async function listUsers() {
  if (!kvOn) return [];
  // Note: KV doesn't support SCAN easily, you'd need to maintain a separate index
  return [];
}
