export type AiModelInfo = {
  id: string;
  name?: string;
};

export class AiProviderService {
  /**
   * Validate the provided API key against the provider and return available models.
   * Tries to be compatible with OpenAI-style and similar providers that expose GET /models.
   */
  async validateAndListModels(
    baseUrl: string,
    apiKey: string,
  ): Promise<{
    success: boolean;
    models: AiModelInfo[];
    error?: string;
  }> {
    try {
      if (!baseUrl) {
        return { success: false, models: [], error: "Base URL is required" };
      }
      if (!apiKey) {
        return { success: false, models: [], error: "API key is required" };
      }

      const normalized = AiProviderService.getApiBaseUrl(baseUrl);
      const url = `${normalized}/models`;
      console.log("Validating API key against:", url);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message ||
            `HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const data = await response.json();
      const models = this.parseModelsResponse(data);
      if (!models.length) {
        return {
          success: false,
          models: [],
          error: "No models returned by provider",
        };
      }
      return { success: true, models };
    } catch (e: any) {
      const message = e?.message || String(e);
      return { success: false, models: [], error: message };
    }
  }

  static getApiBaseUrl(baseUrl: string): string {
    try {
      const trimmed = baseUrl.replace(/\/$/, "");
      const completionsMatch = /(\/v\d+)(?:\/.*)?$/i.exec(trimmed);
      if (completionsMatch) {
        return trimmed.substring(
          0,
          completionsMatch.index + completionsMatch[1].length,
        );
      }
      return trimmed;
    } catch {
      return baseUrl;
    }
  }

  static getChatCompletionsUrl(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/$/, "");
    if (/\/chat\/completions$/i.test(trimmed)) {
      return trimmed;
    }
    return `${AiProviderService.getApiBaseUrl(trimmed)}/chat/completions`;
  }

  private parseModelsResponse(data: any): AiModelInfo[] {
    // Support common shapes:
    // { data: [{ id: "model-id", ...}, ...] }
    // { models: [{ id: "model-id", ...}, ...] }
    // [ { id: "model-id" }, ... ]
    const list: AiModelInfo[] = [];
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.models)
          ? data.models
          : [];
    for (const item of items) {
      if (!item) continue;
      const id = item.id || item.model || item.name;
      if (typeof id === "string" && id.trim()) {
        list.push({ id, name: item?.name });
      }
    }
    return list;
  }
}
