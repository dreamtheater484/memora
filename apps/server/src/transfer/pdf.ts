import type { PdfRequest } from '@memora/shared';
import type { AssetsService } from '../assets/service';
import { ApiError } from '../errors';

/*
 * One-click PDFs (§9.10) through Gotenberg, when `MEMORA_GOTENBERG_URL` is set. The browser
 * sends the printable document; images go in as data, and a content security policy keeps
 * Gotenberg's browser from loading anything else, so a page can't make it fetch addresses.
 */

const TIMEOUT_MS = 120_000;

const POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:";

/** Replaces `asset:<id>` references to the user's images with their data. */
export function withImages(
  html: string,
  image: (id: string) => { mime: string; data: Buffer } | null,
): string {
  const cache = new Map<string, string | null>();
  return html.replace(/asset:([0-9a-f-]{36})/gi, (whole, id: string) => {
    const key = id.toLowerCase();
    if (!cache.has(key)) {
      const found = image(key);
      cache.set(
        key,
        found && found.mime.startsWith('image/') && found.mime !== 'image/svg+xml'
          ? `data:${found.mime};base64,${found.data.toString('base64')}`
          : null,
      );
    }
    return cache.get(key) ?? whole;
  });
}

/** Puts the policy first in the document's head. */
export function locked(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (head) => `${head}${meta}`)
    : `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

export async function renderPdf(
  url: string,
  assets: AssetsService,
  owner: string,
  request: PdfRequest,
): Promise<Buffer> {
  const html = locked(
    withImages(request.html, (id) => {
      try {
        const { meta, data } = assets.get(owner, id);
        return { mime: meta.mime, data };
      } catch {
        return null;
      }
    }),
  );
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('printBackground', 'true');
  form.append('preferCssPageSize', 'true');
  form.append('skipNetworkIdleEvent', 'true');
  let response: Response;
  try {
    response = await fetch(`${url}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(502, 'pdf_failed', 'The PDF service can’t be reached.');
  }
  if (!response.ok) {
    throw new ApiError(
      502,
      'pdf_failed',
      `The PDF service couldn’t make the PDF (${response.status}).`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
