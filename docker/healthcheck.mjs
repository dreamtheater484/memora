// Docker HEALTHCHECK: exits 0 when the Memora server answers /api/health with status "ok".
const port = process.env.PORT || '3000';

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(4000),
  });
  const body = await response.json();
  process.exit(response.ok && body.status === 'ok' ? 0 : 1);
} catch {
  process.exit(1);
}
