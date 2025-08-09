import * as keytar from "keytar";

const SERVICE_NAME = "WhisperMac";
const ACCOUNT_NAME = "AI_API_KEY";

export class SecureStorageService {
  async setApiKey(apiKey: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, apiKey);
  }

  async getApiKey(): Promise<string | null> {
    return keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  }

  async deleteApiKey(): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
  }
}
