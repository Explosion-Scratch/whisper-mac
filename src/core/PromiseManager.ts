import { EventEmitter } from "events";

export interface PromiseData {
  id: string;
  status: "pending" | "resolved" | "rejected" | "cancelled";
  data?: any;
  error?: any;
  timestamp: number;
}

export class PromiseManager extends EventEmitter {
  private static instance: PromiseManager;
  private promises: Map<string, PromiseData> = new Map();
  private resolvers: Map<string, (data: any) => void> = new Map();
  private rejectors: Map<string, (error: any) => void> = new Map();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): PromiseManager {
    if (!PromiseManager.instance) {
      PromiseManager.instance = new PromiseManager();
    }
    return PromiseManager.instance;
  }

  start(name: string, data?: any): void {
    if (this.promises.has(name)) return;
    this.promises.set(name, {
      id: name,
      status: "pending",
      data,
      timestamp: Date.now(),
    });
  }

  resolve(name: string, data?: any): void {
    const p = this.promises.get(name);
    if (!p || p.status !== "pending") return;

    p.status = "resolved";
    p.data = data;

    const resolver = this.resolvers.get(name);
    if (resolver) {
      resolver(data);
      this.resolvers.delete(name);
      this.rejectors.delete(name);
    }
  }

  reject(name: string, error?: any): void {
    const p = this.promises.get(name);
    if (!p || p.status !== "pending") return;

    p.status = "rejected";
    p.error = error;

    const rejector = this.rejectors.get(name);
    if (rejector) {
      rejector(error);
      this.resolvers.delete(name);
      this.rejectors.delete(name);
    }
  }

  waitFor(name: string, timeout?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const p = this.promises.get(name);
      if (!p) return reject(new Error(`Promise '${name}' does not exist`));
      if (p.status === "resolved") return resolve(p.data);
      if (p.status === "rejected") return reject(p.error || new Error(`Promise '${name}' was rejected`));
      if (p.status === "cancelled") return reject(new Error(`Promise '${name}' was cancelled`));

      this.resolvers.set(name, resolve);
      this.rejectors.set(name, reject);

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

  cancel(name: string): boolean {
    const p = this.promises.get(name);
    if (!p || p.status !== "pending") return false;

    p.status = "cancelled";

    const rejector = this.rejectors.get(name);
    if (rejector) {
      rejector(new Error(`Promise '${name}' was cancelled`));
      this.resolvers.delete(name);
      this.rejectors.delete(name);
    }
    return true;
  }

  getPromiseStatus(
    name: string,
  ): "pending" | "resolved" | "rejected" | "cancelled" | "not-found" {
    const p = this.promises.get(name);
    return p ? p.status : "not-found";
  }

  clearPromise(name: string): boolean {
    const existed = this.promises.has(name);
    this.promises.delete(name);
    this.resolvers.delete(name);
    this.rejectors.delete(name);
    return existed;
  }

  async sequence(operations: Array<() => Promise<any>>): Promise<any[]> {
    const results = [];
    for (const operation of operations) {
      try {
        results.push(await operation());
      } catch (error) {
        results.push({ error });
      }
    }
    return results;
  }

  async withLock<T>(
    name: string,
    fn: () => Promise<T> | T,
    timeout?: number,
  ): Promise<T> {
    const lockName = `lock:${name}`;

    while (
      this.promises.has(lockName) &&
      this.getPromiseStatus(lockName) === "pending"
    ) {
      await this.waitFor(lockName, timeout).catch(() => {});
    }

    this.start(lockName);
    try {
      const result = await fn();
      this.resolve(lockName, result);
      return result;
    } catch (error) {
      this.reject(lockName, error);
      throw error;
    }
  }
}

export const promiseManager = PromiseManager.getInstance();
