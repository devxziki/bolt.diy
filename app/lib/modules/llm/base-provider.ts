import type { LanguageModelV1 } from 'ai';
import type { ProviderInfo, ProviderConfig, ModelInfo } from './types';
import type { IProviderSetting } from '~/types/model';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LLMManager } from './manager';
import { Readable } from 'node:stream';

/** Default timeout for model listing API calls (5 seconds) */
const MODEL_FETCH_TIMEOUT = 5_000;

export abstract class BaseProvider implements ProviderInfo {
  abstract name: string;
  abstract staticModels: ModelInfo[];
  abstract config: ProviderConfig;
  cachedDynamicModels?: {
    cacheId: string;
    models: ModelInfo[];
  };

  getApiKeyLink?: string;
  labelForGetApiKey?: string;
  icon?: string;

  /**
   * Convert Cloudflare Env bindings to a plain Record<string, string>.
   * Useful because provider methods expect Record<string, string> but
   * Cloudflare Workers pass an Env interface.
   */
  protected convertEnvToRecord(env?: Env): Record<string, string> {
    if (!env) {
      return {};
    }

    return Object.entries(env).reduce(
      (acc, [key, value]) => {
        acc[key] = String(value);

        return acc;
      },
      {} as Record<string, string>,
    );
  }

  /**
   * Rewrite localhost / 127.0.0.1 URLs to host.docker.internal when
   * running inside Docker. Only applies on the server side.
   */
  protected resolveDockerUrl(baseUrl: string, serverEnv?: Record<string, string>): string {
    const isDocker = process?.env?.RUNNING_IN_DOCKER === 'true' || serverEnv?.RUNNING_IN_DOCKER === 'true';

    if (!isDocker) {
      return baseUrl;
    }

    return baseUrl.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal');
  }

  /**
   * Create an AbortSignal that times out after the given milliseconds.
   * Used to prevent model-listing fetches from hanging indefinitely.
   */
  protected createTimeoutSignal(ms: number = MODEL_FETCH_TIMEOUT): AbortSignal {
    return AbortSignal.timeout(ms);
  }

  getProviderBaseUrlAndKey(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: IProviderSetting;
    serverEnv?: Record<string, string>;
    defaultBaseUrlKey: string;
    defaultApiTokenKey: string;
  }) {
    const { apiKeys, providerSettings, serverEnv, defaultBaseUrlKey, defaultApiTokenKey } = options;
    let settingsBaseUrl = providerSettings?.baseUrl;
    const manager = LLMManager.getInstance();

    if (settingsBaseUrl && settingsBaseUrl.length == 0) {
      settingsBaseUrl = undefined;
    }

    const baseUrlKey = this.config.baseUrlKey || defaultBaseUrlKey;
    let baseUrl =
      settingsBaseUrl ||
      serverEnv?.[baseUrlKey] ||
      process?.env?.[baseUrlKey] ||
      manager.env?.[baseUrlKey] ||
      this.config.baseUrl;

    if (baseUrl && baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }

    const apiTokenKey = this.config.apiTokenKey || defaultApiTokenKey;
    const apiKey =
      apiKeys?.[this.name] || serverEnv?.[apiTokenKey] || process?.env?.[apiTokenKey] || manager.env?.[apiTokenKey];

    return {
      baseUrl,
      apiKey,
    };
  }
  getModelsFromCache(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }): ModelInfo[] | null {
    if (!this.cachedDynamicModels) {
      return null;
    }

    const cacheKey = this.cachedDynamicModels.cacheId;
    const generatedCacheKey = this.getDynamicModelsCacheKey(options);

    if (cacheKey !== generatedCacheKey) {
      this.cachedDynamicModels = undefined;

      return null;
    }

    return this.cachedDynamicModels.models;
  }
  getDynamicModelsCacheKey(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }) {
    // Only include provider-relevant env keys, not the entire server environment
    const relevantEnvKeys = [this.config.baseUrlKey, this.config.apiTokenKey].filter(Boolean) as string[];
    const relevantEnv: Record<string, string> = {};

    for (const key of relevantEnvKeys) {
      if (options.serverEnv?.[key]) {
        relevantEnv[key] = options.serverEnv[key];
      }
    }

    return JSON.stringify({
      apiKeys: options.apiKeys?.[this.name],
      providerSettings: options.providerSettings?.[this.name],
      serverEnv: relevantEnv,
    });
  }
  storeDynamicModels(
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Record<string, string>;
    },
    models: ModelInfo[],
  ) {
    const cacheId = this.getDynamicModelsCacheKey(options);

    this.cachedDynamicModels = {
      cacheId,
      models,
    };
  }

  // Declare the optional getDynamicModels method
  getDynamicModels?(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]>;

  abstract getModelInstance(options: {
    model: string;
    serverEnv?: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1;
}

type OptionalApiKey = string | undefined;

export function getOpenAILikeModel(baseURL: string, apiKey: OptionalApiKey, model: string) {
  const openai = createOpenAI({
    baseURL,
    apiKey,
  });

  return openai(model);
}

/*
 * Wrap fetch so we can log Zen API failures (status, url) in the server logs.
 * This helps diagnose environment-specific issues (e.g. Vercel egress).
 */
function createZenFetch(providerName: string) {
  return async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url;

    try {
      const response = await fetch(input, init);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[${providerName}] Zen API error ${response.status} for ${url}: ${body.slice(0, 300)}`);
      }

      /*
       * On some Node runtimes (e.g. Vercel's serverless functions on Node 18/20/22)
       * the global `fetch` can yield a Node.js `stream.Readable` as `response.body`
       * instead of a WHATWG `ReadableStream`. A Node Readable exposes a `readable`
       * boolean member, so when the AI SDK later calls `new Response(response.body)`
       * (or `response.body.pipeThrough(...)`) the runtime throws:
       *   "First parameter has member 'readable' that is not a ReadableStream"
       * Normalise the body to a genuine Web `ReadableStream` before any downstream
       * consumer touches it, preserving the streaming behaviour.
       */
      if (
        response.body &&
        !(response.body instanceof ReadableStream) &&
        typeof (response.body as any).pipe === 'function'
      ) {
        const webBody = Readable.toWeb(response.body as Readable);

        return new Response(webBody as ReadableStream, response);
      }

      return response;
    } catch (error: any) {
      console.error(`[${providerName}] Zen API request failed for ${url}: ${error?.message || error}`);
      throw error;
    }
  };
}

export function getOpenAICompatibleModel(
  baseURL: string,
  apiKey: OptionalApiKey,
  model: string,
  providerName = 'opencode-zen',
) {
  const provider = createOpenAICompatible({
    name: 'opencode-zen',
    baseURL,

    /*
     * The OpenCode Zen API rejects the `Bearer ` prefix that the AI SDK adds by
     * default, so we pass a dummy apiKey (to satisfy the SDK's required check)
     * and set the Authorization header to the raw key ourselves.
     */
    apiKey: apiKey ? ' ' : undefined,
    headers: apiKey ? { Authorization: apiKey } : undefined,
    fetch: createZenFetch(providerName),
  });

  return provider(model);
}
