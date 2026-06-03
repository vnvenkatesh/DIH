import { initDb } from '../server/db.js';
import app from '../server/app.js';

let initialized = false;

export default async function handler(req: any, res: any) {
  if (!initialized) {
    await initDb();
    initialized = true;
  }
  app(req, res);
}
