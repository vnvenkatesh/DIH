import express from 'express';
import pool from '../db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CLAUDE_API  = 'https://api.anthropic.com/v1/messages';

// ── Gemini proxy ─────────────────────────────────────────────────────────────
router.post('/gemini', requireAuth as any, async (req: AuthRequest, res) => {
  try {
    const { model, contents, generationConfig } = req.body;

    const { rows } = await pool.query('SELECT gemini_api_key FROM users WHERE id=$1', [req.user!.id]);
    const apiKey = rows[0]?.gemini_api_key || process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (!apiKey) {
      res.status(400).json({ error: { message: 'Gemini API key not configured. Go to Settings → LLM Provider.' } });
      return;
    }

    const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig }),
    });

    const data = await upstream.json();
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
      res.status(400).json({ error: { message: 'Claude API key not configured. Go to Settings → LLM Provider.' } });
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
      res.status(400).json({ error: { message: 'Claude API key is invalid. Please update it in Settings → LLM Provider.' } });
      return;
    }
    res.status(upstream.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: { message: err?.message ?? 'Claude proxy error' } });
  }
});

export default router;
