import { assetUploadQuerySchema, idSchema, isInlineImage } from '@memora/shared';
import type { FastifyInstance } from 'fastify';
import { ApiError, parse } from '../errors';
import { authOf, type RouteDeps } from './auth';

type Id = { Params: { id: string } };

/** `filename*` keeps any name; the plain `filename` is an ASCII stand-in for old clients. */
function disposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Files in pages (§9.5, §10): `PUT /assets/:id?name=…` with the file as the body, and
 * `GET /assets/:id` to load it. Only real images are shown inline; everything else is a
 * download, sandboxed, so a file can never run as a page of Memora's.
 */
export async function assetRoutes(
  app: FastifyInstance,
  { assets, config }: RouteDeps,
): Promise<void> {
  const access = { access: 'user' as const };
  const limit = config.maxUploadBytes;

  await app.register(async (scope) => {
    // The body is the file as it is, whatever its type (JSON and text files included).
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: limit }, (_req, body, done) =>
      done(null, body),
    );
    scope.put<Id>(
      '/api/v1/assets/:id',
      { config: access, bodyLimit: limit },
      async (request, reply) => {
        const { user } = authOf(request);
        const id = parse(idSchema, request.params.id);
        const { name } = parse(assetUploadQuerySchema, request.query);
        const data = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const { meta, created } = assets.put(user.id, id, {
          name,
          claimedType: request.headers['content-type'],
          data,
        });
        return reply.code(created ? 201 : 200).send(meta);
      },
    );
    scope.setErrorHandler((error, _request, reply) => {
      if ((error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        const mb = Math.round(limit / 1024 / 1024);
        const body = new ApiError(413, 'file_too_large', `Files can be up to ${mb} MB.`, {
          limit,
        }).toBody();
        return reply.code(413).send(body);
      }
      throw error;
    });
  });

  app.get<Id>('/api/v1/assets/:id', { config: access }, async (request, reply) => {
    const { user } = authOf(request);
    const id = parse(idSchema, request.params.id);
    const { meta, sha256, data } = assets.get(user.id, id);
    const etag = `"${sha256}"`;
    reply
      // An id always names the same bytes, so browsers may keep them.
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('ETag', etag)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header(
        'Content-Disposition',
        disposition(isInlineImage(meta.mime) ? 'inline' : 'attachment', meta.name),
      );
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type(meta.mime).send(data);
  });
}
