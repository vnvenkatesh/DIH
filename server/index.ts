import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import express from 'express';
import cors from 'cors';

import { initDb } from './db.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import rationalizerRouter from './routes/rationalizer.js';
import pdfCompareRouter from './routes/pdfCompare.js';
import dataMappingRouter from './routes/dataMapping.js';
import xpathExtractorRouter from './routes/xpathExtractor.js';
import syntheticDataRouter from './routes/syntheticData.js';
import layoutRecommendationRouter from './routes/layoutRecommendation.js';

const app = express();
const PORT = process.env.API_PORT ?? 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/v1/auth', authRouter);
app.use('/v1/users', usersRouter);
app.use('/v1/rationalizer', rationalizerRouter);
app.use('/v1/pdf-compare', pdfCompareRouter);
app.use('/v1/data-mapping', dataMappingRouter);
app.use('/v1/xpath-extractor', xpathExtractorRouter);
app.use('/v1/synthetic-data', syntheticDataRouter);
app.use('/v1/layout-recommendation', layoutRecommendationRouter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/v1/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`  ✦ API server → http://localhost:${PORT}/v1`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });

export default app;
