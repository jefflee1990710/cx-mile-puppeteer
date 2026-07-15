import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFiles } from '../loadEnv.js';
import type { CxForm } from '../scraper/types.js';
import { makeCxTask, syncTaskRangeFromDates } from '../scraper/types.js';
import { fetchDestinations, fetchOrigins } from './airports.js';
import { addSseClient, emitLog } from './events.js';
import { getStatus, shutdown, startLoop, stopLoop } from './loopRunner.js';

loadEnvFiles();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const uiDir = path.join(rootDir, 'src/ui');
const PORT = Number(process.env.PORT ?? 3847);

function normalizeForm(body: Partial<CxForm>): CxForm {
  const tasks = (body.tasks ?? []).map(t => {
    const dates = Array.isArray(t.dates) ? t.dates.filter(Boolean) : [];
    const range = syncTaskRangeFromDates(dates);
    return makeCxTask({
      id: t.id,
      origin: (t.origin ?? '').toUpperCase().trim(),
      dest: (t.dest ?? '').toUpperCase().trim(),
      range,
      dates,
    });
  });
  return {
    autoLogin: !!body.autoLogin,
    countryCode: String(body.countryCode ?? '852').replace(/\D/g, '') || '852',
    mobile: String(body.mobile ?? '').replace(/\D/g, ''),
    password: String(body.password ?? ''),
    tasks,
    cabins: (body.cabins ?? []).filter(c => ['eco', 'pey', 'bus', 'fir'].includes(c)),
    adults: Math.max(1, Number(body.adults) || 1),
    intervalMin: Math.max(1, Number(body.intervalMin) || 30),
  };
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(uiDir));

app.get('/api/status', (_req, res) => {
  res.json(getStatus());
});

app.get('/api/airports/origins', async (_req, res) => {
  try {
    res.json(await fetchOrigins());
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/airports/destinations/:origin', async (req, res) => {
  try {
    const origin = String(req.params.origin ?? '').toUpperCase().trim();
    if (!/^[A-Z]{3}$/.test(origin)) {
      res.status(400).json({ error: 'Invalid origin code' });
      return;
    }
    res.json(await fetchDestinations(origin));
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  addSseClient(res);
  res.write(`data: ${JSON.stringify({ type: 'status', ...getStatus(), at: new Date().toISOString() })}\n\n`);
  req.on('close', () => {
    // cleaned in addSseClient
  });
});

app.post('/api/start', async (req, res) => {
  const form = normalizeForm(req.body ?? {});
  const result = await startLoop(form);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true, status: getStatus() });
});

app.post('/api/stop', async (_req, res) => {
  await stopLoop();
  res.json({ ok: true, status: getStatus() });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(uiDir, 'index.html'));
});

const server = app.listen(PORT, () => {
  emitLog(`CX Mile Puppeteer UI → http://localhost:${PORT}`);
  console.log(`CX Mile Puppeteer listening on http://localhost:${PORT}`);
});

async function onExit() {
  await shutdown();
  server.close();
  process.exit(0);
}

process.on('SIGINT', onExit);
process.on('SIGTERM', onExit);
