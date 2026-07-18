import pool from '../db.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini — per 1M tokens (standard tier)
  'gemini-2.5-flash':         { input: 0.075, output: 0.30 },
  'gemini-2.5-pro':           { input: 1.25,  output: 10.0 },
  'gemini-2.0-flash':         { input: 0.10,  output: 0.40 },
  'gemini-1.5-flash':         { input: 0.075, output: 0.30 },
  'gemini-1.5-pro':           { input: 1.25,  output: 5.00 },
  // Claude — per 1M tokens
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.0  },
  'claude-sonnet-4-6':          { input: 3.0,   output: 15.0 },
  'claude-opus-4-8':            { input: 15.0,  output: 75.0 },
  'claude-3-5-haiku-20241022':  { input: 0.80,  output: 4.0  },
  'claude-3-5-sonnet-20241022': { input: 3.0,   output: 15.0 },
  'claude-3-haiku-20240307':    { input: 0.25,  output: 1.25 },
  // OpenAI — per 1M tokens
  'gpt-4o':        { input: 2.50,  output: 10.0 },
  'gpt-4o-mini':   { input: 0.15,  output: 0.60 },
  'gpt-4-turbo':   { input: 10.0,  output: 30.0 },
  'gpt-3.5-turbo': { input: 0.50,  output: 1.50 },
};

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 0, output: 0 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function logUsage(
  userId: number,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const cost = calcCost(model, inputTokens, outputTokens);
  pool.query(
    'INSERT INTO llm_usage_logs (user_id, provider, model, input_tokens, output_tokens, cost_usd) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, provider, model, inputTokens, outputTokens, cost],
  ).catch(err => console.error('[usage log error]', err));
}
