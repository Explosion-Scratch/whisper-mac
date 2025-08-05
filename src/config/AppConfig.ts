import { join } from "path";
import { homedir } from "os";

export type DictationWindowPosition = "active-app-corner" | "screen-corner";

export interface AiTransformationConfig {
  enabled: boolean;
  prompt: string;
  baseUrl: string;
  envKey: string;
  model: string;
  stream: boolean;
  maxTokens: number;
  temperature: number;
  topP: number;
  messagePrompt: string;
}

export class AppConfig {
  modelPath: string;
  serverPort: number;
  defaultModel: string;
  cachePath: string;
  dataDir: string;

  // Dictation window configuration
  dictationWindowPosition: DictationWindowPosition;
  dictationWindowWidth: number;
  dictationWindowHeight: number;
  dictationWindowOpacity: number;
  showDictationWindowAlways: boolean;
  skipSelectedTextRetrieval: boolean; // New option for faster startup

  // Text transformation configuration
  transformTrim: boolean;

  // AI transformation configuration
  ai: AiTransformationConfig;

  constructor() {
    this.modelPath = "";
    this.serverPort = 9090;
    this.defaultModel = "Systran/faster-whisper-tiny.en";
    this.cachePath = "";
    this.dataDir = join(__dirname, "../../.whispermac-data");

    // Dictation window defaults
    this.dictationWindowPosition = "screen-corner";
    this.dictationWindowWidth = 400;
    this.dictationWindowHeight = 50;
    this.dictationWindowOpacity = 0.95;
    this.showDictationWindowAlways = false;
    this.skipSelectedTextRetrieval = false; // Set to true for fastest startup

    // Text transformation defaults
    this.transformTrim = true;

    // AI transformation defaults
    this.ai = {
      enabled: true,
      baseUrl: "https://api.cerebras.ai/v1/chat/completions",
      envKey: "CEREBRAS",
      model: "qwen-3-32b",
      stream: true,
      maxTokens: 16382,
      temperature: 0.6,
      topP: 0.95,
      prompt: `You are an expert text editor based on natural language instructions that the user speaks. The user will speak something (transcribed below) and your job is to polish it and follow any natural language instructions within. Do this based on shared context, the current text on the user's screen, and the transcription of what the user is saying. Output in markdown. Keep the user's wording relatively intact, try to make as few changes as possible unless requested otherwise. Be aware for words and phrases that might sound identical to something else - These were likely transcribed wrong, e.g. "UYUX" probably is "UI/UX", or "Function deep out. Takes weight" means "Function debounce, takes wait". Beware that repetitions are likely the user correcting something previously said, e.g. "QUINN332B QWEN332B" should resolve to "Qwen3-32B". When you're confused think about the context this was said in. Don't use annoying formatting like bold words unless specifically requested. Only output the new changed text. E.g. the user may say "dear boss I want a raise sincerely bob ok fix it" and you could output:

----EXAMPLE----
Hi [Manager's Name], I hope you're well. I’d like to schedule a brief meeting to discuss the possibility of a salary adjustment based on my contributions and responsibilities. Please let me know a convenient time for you.

Best regards, Bob
----END EXAMPLE----

If the ROUGH TRANSCRIPTION was "Oh my gosh, I love how are you? Hello how are you? Is what I meant"
----EXAMPLE----
Oh my gosh hello how are you!!
----END EXAMPLE----
(This is because "I love how are you" does't make sense, but sounds semantically similar to "Hello how are you" which is clarified later)

${
  false
    ? `----WRITING STYLE----
JavaScript code
----END WRITING STYLE----`
    : ""
}

Perform these modifications based on the context, text and transcription given.`,
      messagePrompt: `<sel>----SELECTION----\n{selection}\n----END SELECTION----\n\n</sel>----ROUGH TRANSCRIPTION----\n{text}\n----END ROUGH TRANSCRIPTION----\n\n----INSTRUCTION---- Now output only the changed text. No explanations or other text. ----END INSTRUCTION---- Changed text: /no_think`,
    };
  }

  setCachePath(path: string): void {
    this.cachePath = path;
  }

  setModelPath(path: string): void {
    this.modelPath = path;
  }

  setServerPort(port: number): void {
    this.serverPort = port;
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  setDataDir(path: string): void {
    this.dataDir = path;
  }

  getModelsDir(): string {
    return join(this.dataDir, "models");
  }

  getCacheDir(): string {
    return join(this.dataDir, "cache");
  }

  getWhisperLiveDir(): string {
    return join(this.dataDir, "whisperlive");
  }
}
