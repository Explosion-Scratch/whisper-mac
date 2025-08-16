import { AppConfig } from "../config/AppConfig";
import { SelectedTextService } from "./SelectedTextService";
import { SecureStorageService } from "./SecureStorageService";

export class GeminiService {
  private readonly apiBase = "https://generativelanguage.googleapis.com/v1beta";

  async processAudioWithContext(
    audioWavBase64: string,
    config: AppConfig
  ): Promise<string> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) throw new Error("GEMINI_API_KEY not found");

    const selectedTextService = new SelectedTextService();
    const savedState = await selectedTextService.getSelectedText();
    const windowInfo = await selectedTextService.getActiveWindowInfo();

    const systemPrompt = (config.ai.prompt || "").replace(
      /{writing_style}/g,
      config.ai.writingStyle || ""
    );

    let messagePrompt = (config.ai.messagePrompt || "")
      .replace(/{text}/g, "")
      .replace(/{selection}/, savedState.text || "")
      .replace(/{title}/g, windowInfo.title || "")
      .replace(/{app}/g, windowInfo.appName || "");

    if (!savedState.hasSelection) {
      messagePrompt = messagePrompt.replace(/<sel>[^<]+<\/sel>/, "");
    }

    const modelId = config.ai.model || "gemini-2.5-flash";
    const url = `${this.apiBase}/models/${encodeURIComponent(
      modelId
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType: "audio/x-wav",
                data: audioWavBase64,
              },
            },
            { text: messagePrompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    } as any;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Gemini request failed: ${response.status} ${errText}`);
    }

    const json: any = await response.json();
    console.log(json);
    const text = this.extractText(json) || "";
    return text.trim();
  }

  private async resolveApiKey(): Promise<string | null> {
    try {
      const fromEnv =
        process.env["GEMINI_API_KEY"] || process.env["AI_API_KEY"];
      if (fromEnv) return fromEnv;
      const secure = new SecureStorageService();
      const stored = await secure.getApiKey();
      return stored || null;
    } catch {
      return null;
    }
  }

  private extractText(payload: any): string | null {
    try {
      const candidates = payload?.candidates || [];
      if (!candidates.length) return null;
      const parts = candidates[0]?.content?.parts || [];
      const texts = parts
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean);
      return this.extractCode(texts.join("\n"));
    } catch {
      return null;
    }
  }

  private extractCode(string: string): string | null {
    const codeRegex = /```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```/;
    const match = string.match(codeRegex);
    return match ? match[1] : string;
  }
}
