import * as keytar from "keytar";

const SERVICE_NAME = "WhisperMac";

export class SecureStorageService {
  async setApiKey(envKey: string, apiKey: string): Promise<void> {
    const account = `${envKey}_API_KEY`;
    await keytar.setPassword(SERVICE_NAME, account, apiKey);
  }

  async getApiKey(envKey: string): Promise<string | null> {
    const account = `${envKey}_API_KEY`;
    return keytar.getPassword(SERVICE_NAME, account);
  }

  async deleteApiKey(envKey: string): Promise<void> {
    const account = `${envKey}_API_KEY`;
    await keytar.deletePassword(SERVICE_NAME, account);
  }
}
