import { initDb } from '../server/db.js';
import app from '../server/app.js';

let initialized = false;
let initError: Error | null = null;

const REQUIRED_ENV = ['PGHOST', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'JWT_SECRET'] as const;

function checkEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

async function ensureInit() {
  if (initialized) return;
  if (initError) throw initError;

  const missing = checkEnv();
  if (missing.length > 0) {
    const msg = `Missing environment variables: ${missing.join(', ')}. Set them in Vercel → Settings → Environment Variables.`;
    console.error('[api/init]', msg);
    initError = new Error(msg);
    throw initError;
  }

  console.log('[api/init] env vars present, connecting to DB...');
  try {
    await initDb();
    initialized = true;
    console.log('[api/init] DB ready');
  } catch (err: any) {
    console.error('[api/init] DB init failed:', err?.message ?? err);
    initError = err instanceof Error ? err : new Error(String(err));
    throw initError;
  }
}

export default async function handler(req: any, res: any) {
  try {
    await ensureInit();
  } catch (err: any) {
    res.status(500).json({ error: `Server initialisation failed: ${err?.message ?? err}` });
    return;
  }
  app(req, res);
}
