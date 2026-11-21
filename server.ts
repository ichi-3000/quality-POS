import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.ts';
import { getDatabase } from './server/db/connection.ts';
import { runMigrations } from './server/db/migrations.ts';
import { seedDatabase } from './server/db/seed.ts';

async function startServer() {
  const db = getDatabase();
  runMigrations(db);
  seedDatabase(db);

  const app = createApp(db);
  const port = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`QS-IMS server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start QS-IMS server:', err);
  process.exit(1);
});
