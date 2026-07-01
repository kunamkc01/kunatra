import { pathToFileURL } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { assess, salariedSample, type Position } from '@atlas/engine';
import { loadPosition } from './db.ts';
import { HttpError } from './pool.ts';
import * as repo from './repo.ts';

export const app = express();
app.use(express.json());

// Permissive CORS for local development (Next.js dev server on :3000).
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/** Wrap an async handler so thrown errors reach the error middleware. */
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- assessment (the engine read) ----------------------------------------
// Falls back to the bundled salaried sample when no DB / id is configured,
// so the API is runnable and demoable out of the box.
app.get('/api/assessment', h(async (req, res) => {
  const householdId = req.query.household as string | undefined;
  let position: Position = salariedSample;
  if (householdId && process.env.DATABASE_URL) position = await loadPosition(householdId);
  res.json(assess(position));
}));

app.get('/api/households/:id/assessment', h(async (req, res) => {
  res.json(assess(await loadPosition(req.params.id)));
}));

// ---- households ----------------------------------------------------------
app.post('/api/households', h(async (req, res) => res.status(201).json(await repo.createHousehold(req.body))));
app.get('/api/households/:id', h(async (req, res) => res.json(await repo.getHousehold(req.params.id))));
app.patch('/api/households/:id', h(async (req, res) => res.json(await repo.updateHousehold(req.params.id, req.body))));
app.delete('/api/households/:id', h(async (req, res) => { await repo.deleteHousehold(req.params.id); res.sendStatus(204); }));

// ---- assets --------------------------------------------------------------
app.get('/api/households/:id/assets', h(async (req, res) => res.json(await repo.listAssets(req.params.id))));
app.post('/api/households/:id/assets', h(async (req, res) => res.status(201).json(await repo.createAsset(req.params.id, req.body))));
app.get('/api/assets/:id', h(async (req, res) => res.json(await repo.getAsset(req.params.id))));
app.patch('/api/assets/:id', h(async (req, res) => res.json(await repo.updateAsset(req.params.id, req.body))));
app.delete('/api/assets/:id', h(async (req, res) => { await repo.deleteAsset(req.params.id); res.sendStatus(204); }));

// ---- loans ---------------------------------------------------------------
app.get('/api/households/:id/loans', h(async (req, res) => res.json(await repo.listLoans(req.params.id))));
app.post('/api/households/:id/loans', h(async (req, res) => res.status(201).json(await repo.createLoan(req.params.id, req.body))));
app.patch('/api/loans/:id', h(async (req, res) => res.json(await repo.updateLoan(req.params.id, req.body))));
app.delete('/api/loans/:id', h(async (req, res) => { await repo.deleteLoan(req.params.id); res.sendStatus(204); }));

// ---- error handling ------------------------------------------------------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

// Only start the server when run directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => console.log(`Kunatra API on :${port}`));
}
