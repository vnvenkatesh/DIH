import express from 'express';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { logUsage } from '../utils/usageLogger.js';

const router = express.Router();

const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';
const CLAUDE_API   = 'https://api.anthropic.com/v1/messages';
const OPENAI_API   = 'https://api.openai.com/v1/chat/completions';

// ── Usage stats ───────────────────────────────────────────────────────────────
router.get('/stats', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const summaryResult = await pool.query<{
      provider: string;
      total_calls: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_usd: string;
    }>(`
      SELECT
        provider,
        COUNT(*)::int            AS total_calls,
        SUM(input_tokens)::int   AS total_input_tokens,
        SUM(output_tokens)::int  AS total_output_tokens,
        SUM(cost_usd)            AS total_cost_usd
      FROM llm_usage_logs
      WHERE user_id = $1
      GROUP BY provider
    `, [userId]);

    const recentResult = await pool.query(`
      SELECT id, provider, model, input_tokens, output_tokens, cost_usd, created_at
      FROM llm_usage_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    res.json({ summary: summaryResult.rows, recent: recentResult.rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to fetch stats' });
  }
});

// ── Gemini proxy ─────────────────────────────────────────────────────────────
router.post('/gemini', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { model, contents, generationConfig } = req.body;

    const { rows } = await pool.query('SELECT gemini_api_key FROM users WHERE id=$1', [req.user!.id]);
    const apiKey = rows[0]?.gemini_api_key || process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (!apiKey) {
      res.status(400).json({ error: { message: 'Gemini API key not configured. Go to Settings → AI Providers.' } });
      return;
    }

    const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig }),
    });

    const data = await upstream.json() as any;

    if (upstream.ok) {
      const inputTokens  = data.usageMetadata?.promptTokenCount     ?? 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      logUsage(req.user!.id, 'gemini', model, inputTokens, outputTokens);
    }

    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: { message: err?.message ?? 'Gemini proxy error' } });
  }
});

// ── Claude proxy ──────────────────────────────────────────────────────────────
router.post('/claude', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { model, max_tokens, messages, beta } = req.body;

    const { rows } = await pool.query('SELECT claude_api_key FROM users WHERE id=$1', [req.user!.id]);
    const apiKey = rows[0]?.claude_api_key || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      res.status(400).json({ error: { message: 'Claude API key not configured. Go to Settings → AI Providers.' } });
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    if (beta) headers['anthropic-beta'] = beta;

    const upstream = await fetch(CLAUDE_API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens, messages }),
    });

    const data = await upstream.json() as any;

    if (upstream.status === 401) {
      res.status(400).json({ error: { message: 'Claude API key is invalid. Please update it in Settings → AI Providers.' } });
      return;
    }

    if (upstream.ok) {
      const inputTokens  = data.usage?.input_tokens  ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;
      logUsage(req.user!.id, 'claude', model, inputTokens, outputTokens);
    }

    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: { message: err?.message ?? 'Claude proxy error' } });
  }
});

// ── OpenAI proxy ──────────────────────────────────────────────────────────────
router.post('/openai', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { model, messages, response_format } = req.body;

    const { rows } = await pool.query('SELECT openai_api_key FROM users WHERE id=$1', [req.user!.id]);
    const apiKey = rows[0]?.openai_api_key || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      res.status(400).json({ error: { message: 'OpenAI API key not configured. Go to Settings → AI Providers.' } });
      return;
    }

    const body: Record<string, any> = { model, messages };
    if (response_format) body.response_format = response_format;

    const upstream = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json() as any;

    if (upstream.status === 401) {
      res.status(400).json({ error: { message: 'OpenAI API key is invalid. Please update it in Settings → AI Providers.' } });
      return;
    }

    if (upstream.ok) {
      const inputTokens  = data.usage?.prompt_tokens     ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      logUsage(req.user!.id, 'openai', model, inputTokens, outputTokens);
    }

    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: { message: err?.message ?? 'OpenAI proxy error' } });
  }
});

export default router;
