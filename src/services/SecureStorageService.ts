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

  // Plugin secure storage methods
  async setSecureValue(
    pluginName: string,
    key: string,
    value: string
  ): Promise<void> {
    const accountName = `plugin_${pluginName}_${key}`;
    console.log(`[SecureStorage] Setting value for ${accountName}`);
    try {
      await keytar.setPassword(SERVICE_NAME, accountName, value);
      console.log(`[SecureStorage] Successfully set value for ${accountName}`);
    } catch (error) {
      console.error(
        `[SecureStorage] Failed to set value for ${accountName}:`,
        error
      );
      throw error;
    }
  }

  async getSecureValue(
    pluginName: string,
    key: string
  ): Promise<string | null> {
    const accountName = `plugin_${pluginName}_${key}`;
    console.log(`[SecureStorage] Getting value for ${accountName}`);
    try {
      const value = await keytar.getPassword(SERVICE_NAME, accountName);
      console.log(
        `[SecureStorage] Retrieved value for ${accountName}:`,
        value ? "present" : "not found"
      );
      return value;
    } catch (error) {
      console.error(
        `[SecureStorage] Failed to get value for ${accountName}:`,
        error
      );
      throw error;
    }
  }

  async deleteSecureValue(pluginName: string, key: string): Promise<void> {
    const accountName = `plugin_${pluginName}_${key}`;
    await keytar.deletePassword(SERVICE_NAME, accountName);
  }

  async setSecureData(
    pluginName: string,
    key: string,
    data: any
  ): Promise<void> {
    const serialized = JSON.stringify(data);
    await this.setSecureValue(pluginName, key, serialized);
  }

  async getSecureData(pluginName: string, key: string): Promise<any | null> {
    const serialized = await this.getSecureValue(pluginName, key);
    if (!serialized) return null;
    try {
      return JSON.parse(serialized);
    } catch {
      return null;
    }
  }

  async listSecureKeys(pluginName: string): Promise<string[]> {
    const accounts = await keytar.findCredentials(SERVICE_NAME);
    const pluginPrefix = `plugin_${pluginName}_`;
    return accounts
      .filter((acc) => acc.account.startsWith(pluginPrefix))
      .map((acc) => acc.account.substring(pluginPrefix.length));
  }

  async clearPluginData(pluginName: string): Promise<void> {
    const keys = await this.listSecureKeys(pluginName);
    await Promise.all(
      keys.map((key) => this.deleteSecureValue(pluginName, key))
    );
  }
}
