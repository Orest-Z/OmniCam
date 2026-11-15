// Runs the counter (worker.mjs, the same code Cloudflare runs) on this PC, with a SQLite file in place of
// Cloudflare's database. Dev tool, no dependencies; needs Node 24.
//
//   node tools/counter/local.mjs [port=8787] [file=~/omnicam-counter.sqlite]
//
// Then start OmniCam pointing at it:
//   PowerShell:  $env:OMNICAM_PING_URL = 'http://localhost:8787/ping'; npm run dev
//   bash:        OMNICAM_PING_URL=http://localhost:8787/ping npm run dev
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';

/** The part of Cloudflare's D1 the worker uses (prepare, bind, run), over a SQLite file or ':memory:'. */
export function d1(file) {
  const db = new DatabaseSync(file);
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let args = [];
      const bound = {
        bind: (...values) => ((args = values), bound),
        run: async () => ({ results: /^\s*select/i.test(sql) ? statement.all(...args) : (statement.run(...args), []) }),
      };
      return bound;
    },
  };
}

if (import.meta.main) {
  const port = Number(process.argv[2] || 8787);
  const file = process.argv[3] || join(homedir(), 'omnicam-counter.sqlite');
  const env = { DB: d1(file), STATS_KEY: 'local' };

  createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const response = await worker.fetch(request, env);
    if (req.method === 'POST') console.log(`${req.url} -> ${response.status}`);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).listen(port, () => {
    console.log(`OmniCam counter on http://localhost:${port} (saved in ${file})`);
    console.log(`Dashboard: http://localhost:${port}/stats (the key is: local)`);
  });
}
