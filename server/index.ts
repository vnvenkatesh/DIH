import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { initDb } from './db.js';
import app from './app.js';

const PORT = process.env.API_PORT ?? 3001;

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
