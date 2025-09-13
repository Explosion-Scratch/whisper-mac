import { EventEmitter } from "events";

export interface PromiseData {
  id: string;
  status: "pending" | "resolved" | "rejected" | "cancelled";
  data?: any;
  error?: any;
  timestamp: number;
  resolveTime?: number;
  rejectTime?: number;
  cancelTime?: number;
  dependencies?: string[];
}

/**
 * Singleton PromiseManager for coordinating asynchronous operations across the app
 * Allows modules to wait for specific events or operations to complete
 */
export class PromiseManager extends EventEmitter {
  private static instance: PromiseManager;
  private promises: Map<string, PromiseData> = new Map();
  private resolvers: Map<string, (data: any) => void> = new Map();
  private rejectors: Map<string, (error: any) => void> = new Map();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): PromiseManager {
    if (!PromiseManager.instance) {
      PromiseManager.instance = new PromiseManager();
    }
    return PromiseManager.instance;
  }

  /**
   * Start a new promise with a given name
   */
  start(name: string, data?: any): void {
    if (this.promises.has(name)) {
      console.warn(`[PromiseManager] Promise '${name}' already exists`);
      return;
    }

    const promiseData: PromiseData = {
      id: name,
      status: "pending",
      data,
      timestamp: Date.now(),
    };

    this.promises.set(name, promiseData);
    this.emit("promise-started", { name, data });

    console.log(`[PromiseManager] Started promise: ${name}`);
  }

  /**
   * Resolve a promise with data
   */
  resolve(name: string, data?: any): void {
    const promiseData = this.promises.get(name);
    if (!promiseData) {
      console.warn(
        `[PromiseManager] Cannot resolve non-existent promise: ${name}`,
      );
      return;
    }

    if (promiseData.status !== "pending") {
      console.warn(
        `[PromiseManager] Promise '${name}' is already ${promiseData.status}`,
      );
      return;
    }

    promiseData.status = "resolved";
    promiseData.data = data;
    promiseData.resolveTime = Date.now();

    const resolver = this.resolvers.get(name);
    if (resolver) {
      resolver(data);
      this.resolvers.delete(name);
      this.rejectors.delete(name);
    }

    this.promises.set(name, promiseData);
    this.emit("promise-resolved", { name, data });

    console.log(`[PromiseManager] Resolved promise: ${name}`, data);
  }

  /**
   * Reject a promise with error
   */
  reject(name: string, error?: any): void {
    const promiseData = this.promises.get(name);
    if (!promiseData) {
      console.warn(
        `[PromiseManager] Cannot reject non-existent promise: ${name}`,
      );
      return;
    }

    if (promiseData.status !== "pending") {
      console.warn(
        `[PromiseManager] Promise '${name}' is already ${promiseData.status}`,
      );
      return;
    }

    promiseData.status = "rejected";
    promiseData.error = error;
    promiseData.rejectTime = Date.now();

    const rejector = this.rejectors.get(name);
    if (rejector) {
      rejector(error);
      this.resolvers.delete(name);
      this.rejectors.delete(name);
    }

    this.promises.set(name, promiseData);
    this.emit("promise-rejected", { name, error });

    console.error(`[PromiseManager] Rejected promise: ${name}`, error);
  }

  /**
   * Wait for a promise to resolve or reject
   */
  waitFor(name: string, timeout?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const promiseData = this.promises.get(name);

      if (!promiseData) {
        const error = new Error(`Promise '${name}' does not exist`);
        console.error(`[PromiseManager] ${error.message}`);
        reject(error);
        return;
      }

      if (promiseData.status === "resolved") {
        resolve(promiseData.data);
        return;
      }

      if (promiseData.status === "rejected") {
        reject(
          promiseData.error || new Error(`Promise '${name}' was rejected`),
        );
        return;
      }

      if (promiseData.status === "cancelled") {
        reject(new Error(`Promise '${name}' was cancelled`));
        return;
      }

      // Store resolvers for when the promise completes
      this.resolvers.set(name, resolve);
      this.rejectors.set(name, reject);

      // Set up timeout if specified
      if (timeout) {
        setTimeout(() => {
          if (this.resolvers.has(name)) {
            this.resolvers.delete(name);
            this.rejectors.delete(name);
            reject(new Error(`Promise '${name}' timed out after ${timeout}ms`));
          }
        }, timeout);
      }
    });
  }

  /**
   * Wait for multiple promises to resolve
   */
  waitForAll(names: string[], timeout?: number): Promise<any[]> {
    return Promise.all(names.map((name) => this.waitFor(name, timeout)));
  }

  /**
   * Wait for any of the specified promises to resolve
   */
  waitForAny(
    names: string[],
    timeout?: number,
  ): Promise<{ name: string; data: any }> {
    return new Promise((resolve, reject) => {
      const promises = names.map((name) =>
        this.waitFor(name, timeout)
          .then((data) => ({ name, data }))
          .catch((error) => ({ name, error })),
      );

      Promise.race(promises).then((result) => {
        if ("error" in result) {
          reject(result.error);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Execute operations sequentially
   */
  async sequence(operations: Array<() => Promise<any>>): Promise<any[]> {
    const results = [];
    for (const operation of operations) {
      try {
        const result = await operation();
        results.push(result);
      } catch (error) {
        results.push({ error });
      }
    }
    return results;
  }

  /**
   * Check if a promise exists
   */
  hasPromise(name: string): boolean {
    return this.promises.has(name);
  }

  /**
   * Get the status of a promise
   */
  getPromiseStatus(
    name: string,
  ): "pending" | "resolved" | "rejected" | "cancelled" | "not-found" {
    const promiseData = this.promises.get(name);
    return promiseData ? promiseData.status : "not-found";
  }

  /**
   * Get all promise data
   */
  getAllPromises(): PromiseData[] {
    return Array.from(this.promises.values());
  }

  /**
   * Get pending promises
   */
  getPendingPromises(): PromiseData[] {
    return Array.from(this.promises.values()).filter(
      (p) => p.status === "pending",
    );
  }

  /**
   * Get resolved promises
   */
  getResolvedPromises(): PromiseData[] {
    return Array.from(this.promises.values()).filter(
      (p) => p.status === "resolved",
    );
  }

  /**
   * Get rejected promises
   */
  getRejectedPromises(): PromiseData[] {
    return Array.from(this.promises.values()).filter(
      (p) => p.status === "rejected",
    );
  }

  /**
   * Clear a specific promise
   */
  clearPromise(name: string): boolean {
    const existed = this.promises.has(name);
    this.promises.delete(name);
    this.resolvers.delete(name);
    this.rejectors.delete(name);

    if (existed) {
      console.log(`[PromiseManager] Cleared promise: ${name}`);
    }

    return existed;
  }

  /**
   * Cancel a promise
   */
  cancel(name: string): boolean {
    const promiseData = this.promises.get(name);
    if (!promiseData || promiseData.status !== "pending") {
      return false;
    }

    promiseData.status = "cancelled";
    promiseData.cancelTime = Date.now();

    const rejector = this.rejectors.get(name);
    if (rejector) {
      rejector(new Error(`Promise '${name}' was cancelled`));
      this.resolvers.delete(name);
      this.rejectors.delete(name);
    }

    this.emit("promise-cancelled", { name });
    console.log(`[PromiseManager] Cancelled promise: ${name}`);
    return true;
  }

  /**
   * Clear all promises
   */
  clearAll(): void {
    console.log(
      `[PromiseManager] Clearing all promises (${this.promises.size} total)`,
    );
    this.promises.clear();
    this.resolvers.clear();
    this.rejectors.clear();
    this.removeAllListeners();
  }

  /**
   * Get statistics about all promises
   */
  getStats(): {
    total: number;
    pending: number;
    resolved: number;
    rejected: number;
    averageResolveTime: number;
    averageRejectTime: number;
  } {
    const allPromises = Array.from(this.promises.values());
    const resolved = allPromises.filter((p) => p.status === "resolved");
    const rejected = allPromises.filter((p) => p.status === "rejected");

    const resolveTimes = resolved
      .filter((p) => p.resolveTime)
      .map((p) => p.resolveTime! - p.timestamp);

    const rejectTimes = rejected
      .filter((p) => p.rejectTime)
      .map((p) => p.rejectTime! - p.timestamp);

    return {
      total: allPromises.length,
      pending: allPromises.filter((p) => p.status === "pending").length,
      resolved: resolved.length,
      rejected: rejected.length,
      averageResolveTime:
        resolveTimes.length > 0
          ? resolveTimes.reduce((a, b) => a + b, 0) / resolveTimes.length
          : 0,
      averageRejectTime:
        rejectTimes.length > 0
          ? rejectTimes.reduce((a, b) => a + b, 0) / rejectTimes.length
          : 0,
    };
  }
}

// Export singleton instance
export const promiseManager = PromiseManager.getInstance();
