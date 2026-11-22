import express from 'express';
import type { DbInstance } from './db/types.ts';
import type { HttpApp } from './httpTypes.ts';
import { registerRoutes } from './routes.ts';

export function createApp(db: DbInstance) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerRoutes(app as unknown as HttpApp, db);
  return app;
}
