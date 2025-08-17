export type AiModelInfo = {
  id: string;
  name?: string;
};

export class AiProviderService {
  private readonly apiBase = "https://generativelanguage.googleapis.com/v1beta";

  /**
   * Validate the provided API key against Gemini and return available models.
   */
  async validateAndListModels(apiKey: string): Promise<{
    success: boolean;
    models: AiModelInfo[];
    error?: string;
  }> {
    try {
      if (!apiKey) {
        return { success: false, models: [], error: "API key is required" };
      }

      const url = `${this.apiBase}/models?key=${encodeURIComponent(apiKey)}`;
      console.log("Validating API key against Gemini:", url);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message ||
            `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json();
      const models = this.parseModelsResponse(data);
      if (!models.length) {
        return {
          success: false,
          models: [],
          error: "No models returned by Gemini",
        };
      }
      return { success: true, models };
    } catch (e: any) {
      const message = e?.message || String(e);
      return { success: false, models: [], error: message };
    }
  }

  private parseModelsResponse(data: any): AiModelInfo[] {
    // Gemini models response format: { models: [{ name: "models/gemini-2.5-flash", ... }] }
    const list: AiModelInfo[] = [];
    const items = Array.isArray(data?.models) ? data.models : [];

    for (const item of items) {
      if (!item) continue;
      const name = item.name;
      if (typeof name === "string" && name.trim()) {
        // Extract model ID from full name (e.g., "models/gemini-2.5-flash" -> "gemini-2.5-flash")
        const id = name.includes("/") ? name.split("/").pop() || name : name;
        list.push({ id, name: id });
      }
    }
    return list;
  }
}
