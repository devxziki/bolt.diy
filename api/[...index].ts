import { createRequestHandler } from '@remix-run/node';
import * as build from '../build/server/index.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

/* The Remix Vite server build exports the ServerBuild as a namespace object. */
const serverBuild = build as unknown as Parameters<typeof createRequestHandler>[0];

const requestHandler = createRequestHandler(serverBuild, process.env.NODE_ENV);

export default async function (request: Request) {
  try {
    /*
     * On Vercel we don't have Cloudflare bindings, so we expose process.env to the
     * existing app code that reads `context.cloudflare?.env`.
     */
    return await requestHandler(request, {
      cloudflare: { env: process.env } as any,
    });
  } catch (error) {
    console.error(error);

    return new Response('Internal Server Error', { status: 500 });
  }
}
