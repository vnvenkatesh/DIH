import express from 'express';
import cors from 'cors';

import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import llmRouter from './routes/llm.js';
import rationalizerRouter from './routes/rationalizer.js';
import pdfCompareRouter from './routes/pdfCompare.js';
import dataMappingRouter from './routes/dataMapping.js';
import xpathExtractorRouter from './routes/xpathExtractor.js';
import syntheticDataRouter from './routes/syntheticData.js';
import layoutRecommendationRouter from './routes/layoutRecommendation.js';
import exactCompareApiRouter from './routes/exactCompareApi.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/v1/auth', authRouter);
app.use('/v1/users', usersRouter);
app.use('/v1/llm', llmRouter);
app.use('/v1/rationalizer', rationalizerRouter);
app.use('/v1/pdf-compare', pdfCompareRouter);
app.use('/v1/data-mapping', dataMappingRouter);
app.use('/v1/xpath-extractor', xpathExtractorRouter);
app.use('/v1/synthetic-data', syntheticDataRouter);
app.use('/v1/layout-recommendation', layoutRecommendationRouter);
app.use('/v1/api', exactCompareApiRouter);

app.get('/v1/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
