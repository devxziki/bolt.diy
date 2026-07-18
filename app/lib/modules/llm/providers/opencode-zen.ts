import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1/chat/completions';

export default class OpenCodeZenProvider extends BaseProvider {
  name = 'OpenCodeZen';
  getApiKeyLink = 'https://opencode.ai/auth';

  config = {
    baseUrlKey: 'OPENCODE_ZEN_API_BASE_URL',
    apiTokenKey: 'OPENCODE_ZEN_API_KEY',
  };

  /*
   * OpenCode Zen free models. These are served through the OpenAI-compatible
   * `/chat/completions` endpoint and are free to use (see https://opencode.ai/docs/zen).
   */
  staticModels: ModelInfo[] = [
    {
      name: 'deepseek-v4-flash-free',
      label: 'DeepSeek V4 Flash Free',
      provider: 'OpenCodeZen',
      maxTokenAllowed: 128000,
    },
    {
      name: 'mimo-v2-5-free',
      label: 'MiMo V2.5 Free',
      provider: 'OpenCodeZen',
      maxTokenAllowed: 64000,
    },
    {
      name: 'north-mini-code-free',
      label: 'North Mini Code Free',
      provider: 'OpenCodeZen',
      maxTokenAllowed: 128000,
    },
    {
      name: 'nemotron-3-ultra-free',
      label: 'Nemotron 3 Ultra Free',
      provider: 'OpenCodeZen',
      maxTokenAllowed: 128000,
    },
    {
      name: 'big-pickle',
      label: 'Big Pickle (Free)',
      provider: 'OpenCodeZen',
      maxTokenAllowed: 128000,
    },
  ];

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;
    const envRecord = this.convertEnvToRecord(serverEnv);

    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: envRecord,
      defaultBaseUrlKey: 'OPENCODE_ZEN_API_BASE_URL',
      defaultApiTokenKey: 'OPENCODE_ZEN_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const resolvedBaseUrl = (baseUrl || ZEN_BASE_URL).replace(/\/chat\/completions$/, '');

    return getOpenAILikeModel(resolvedBaseUrl, apiKey, model);
  }
}
