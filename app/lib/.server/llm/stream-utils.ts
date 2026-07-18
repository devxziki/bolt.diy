/*
 * NOTE: We intentionally do NOT import from `node:stream`. vite-plugin-node-polyfills
 * can shadow `node:stream` with `stream-browserify` (whose `Readable` lacks `toWeb`),
 * which made the earlier fix a no-op. Instead we build the Web `ReadableStream` from
 * the global `ReadableStream` class using the Node stream's async iteration, so the
 * conversion is polyfill-agnostic and always produces a genuine WHATWG ReadableStream.
 */

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
  const maybeNode = stream as { pipe?: unknown } & AsyncIterable<Uint8Array | string> & {
      destroy?: () => void;
    };

  if (maybeNode && typeof maybeNode.pipe === 'function') {
    const webStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of maybeNode) {
            controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        maybeNode.destroy?.();
      },
    });

    console.log('[ensureWebReadableStream] converted Node Readable to Web ReadableStream');

    return webStream as ReadableStream;
  }

  throw new Error(
    `Expected ReadableStream but received ${Object.prototype.toString.call(stream)} (provider: ${providerName})`,
  );
}
