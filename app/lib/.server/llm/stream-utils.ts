import { Readable } from 'node:stream';

/**
 * Ensure a value is a genuine WHATWG ReadableStream.
 *
 * On some Node runtimes (e.g. Vercel's serverless functions) the AI SDK may
 * yield a Node.js `stream.Readable` instead of a Web `ReadableStream`. Passing
 * a Node Readable to `new Response(...)` throws:
 *   "First parameter has member 'readable' that is not a ReadableStream"
 * because Node Readable instances expose a `readable` boolean property.
 *
 * This helper converts a Node Readable to a Web ReadableStream and validates
 * the result so the caller can safely pass it to `new Response(...)`.
 */
export function ensureWebReadableStream(stream: unknown, providerName = 'unknown'): ReadableStream {
  const debugInfo = {
    provider: providerName,
    constructorName: stream?.constructor?.name ?? typeof stream,
    typeof: typeof stream,
    instanceofReadableStream: stream instanceof ReadableStream,
    hasReadableMember: !!(stream && typeof stream === 'object' && 'readable' in (stream as Record<string, unknown>)),
  };

  console.log('[ensureWebReadableStream]', JSON.stringify(debugInfo));

  // Already a WHATWG ReadableStream.
  if (stream instanceof ReadableStream) {
    return stream;
  }

  // Node.js Readable (has a `readable` boolean member and a `pipe` method).
  const maybeNode = stream as { pipe?: unknown };

  if (maybeNode && typeof maybeNode.pipe === 'function') {
    const webStream = Readable.toWeb(stream as Readable);

    console.log('[ensureWebReadableStream] converted Node Readable to Web ReadableStream');

    return webStream as ReadableStream;
  }

  throw new Error(
    `Expected ReadableStream but received ${Object.prototype.toString.call(stream)} (provider: ${providerName})`,
  );
}
