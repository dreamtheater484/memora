// Serves directions.html for local review at http://localhost:4599
// (wrapped in a full HTML document, the way the published page is).
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), 'directions.html');
const port = Number(process.env.PORT) || 4599;

createServer(async (req, res) => {
  if (req.url !== '/' && !req.url.startsWith('/?')) {
    res.writeHead(404).end();
    return;
  }
  const body = await readFile(file, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
      body +
      '</html>',
  );
}).listen(port, '127.0.0.1', () => console.log(`Mockups at http://localhost:${port}`));
