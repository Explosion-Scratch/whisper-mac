import { EventEmitter } from "events";
import { Segment, TranscribedSegment } from "../types/SegmentTypes";
import { ActionHandlerConfig } from "../types/ActionTypes";

export type SetupStatus =
  | "idle"
  | "downloading-models"
  | "setting-up-whisper"
  | "preparing-app"
  | "checking-permissions"
  | "starting-server"
  | "loading-windows"
  | "initializing-plugins"
  | "service-ready";

export type DictationState = "idle" | "recording" | "finishing";

export type TrayIconState = "idle" | "recording";

export interface PermissionStatus {
  granted: boolean;
  checked: boolean;
  error?: string;
}

export interface PluginStateData {
  isLoading: boolean;
  loadingMessage?: string;
  error?: string;
  isRunning: boolean;
  isInitialized: boolean;
  isActive: boolean;
}

export interface AppState {
  app: {
    status: SetupStatus;
    isQuitting: boolean;
    version: string;
  };

  dictation: {
    state: DictationState;
    sessionId: string | null;
    isAccumulatingMode: boolean;
    pushToTalkActive: boolean;
    pendingSkipTransformation: boolean;
  };

  audioCapture: {
    isCapturing: boolean;
    vadReady: boolean;
    chunkStartTime: number | null;
    accumulatedChunks: string[];
    processedSampleCount: number;
    lastSegmentEndSample: number;
  };

  plugins: {
    activePlugin: string | null;
    pluginStates: Record<string, PluginStateData>;
    bufferingEnabled: boolean;
    bufferingOverride: boolean | null;
  };

  segments: {
    items: Segment[];
    initialSelectedText: string | null;
    ignoreNextCompleted: boolean;
    queuedHandlers: ActionHandlerConfig[];
  };

  permissions: {
    accessibility: PermissionStatus;
    microphone: PermissionStatus;
    lastChecked: number | null;
  };

  ui: {
    dictationWindowVisible: boolean;
    settingsWindowVisible: boolean;
    onboardingWindowVisible: boolean;
    trayIconState: TrayIconState;
  };

  settings: {
    onboardingComplete: boolean;
    selectedMicrophone: string;
    launchAtLogin: boolean;
    showDictationWindowAlways: boolean;
  };
}

type StateSelector<T> = (state: AppState) => T;
type StateListener<T> = (value: T, prevValue: T) => void;
type UnsubscribeFn = () => void;

interface Subscription<T> {
  selector: StateSelector<T>;
  listener: StateListener<T>;
  lastValue: T;
}

interface MutexLock {
  name: string;
  acquired: number;
  release: () => void;
}

const initialState: AppState = {
  app: {
    status: "idle",
    isQuitting: false,
    version: "1.0.0",
  },
  dictation: {
    state: "idle",
    sessionId: null,
    isAccumulatingMode: false,
    pushToTalkActive: false,
    pendingSkipTransformation: false,
  },
  audioCapture: {
    isCapturing: false,
    vadReady: false,
    chunkStartTime: null,
    accumulatedChunks: [],
    processedSampleCount: 0,
    lastSegmentEndSample: 0,
  },
  plugins: {
    activePlugin: null,
    pluginStates: {},
    bufferingEnabled: false,
    bufferingOverride: null,
  },
  segments: {
    items: [],
    initialSelectedText: null,
    ignoreNextCompleted: false,
    queuedHandlers: [],
  },
  permissions: {
    accessibility: { granted: false, checked: false },
    microphone: { granted: false, checked: false },
    lastChecked: null,
  },
  ui: {
    dictationWindowVisible: false,
    settingsWindowVisible: false,
    onboardingWindowVisible: false,
    trayIconState: "idle",
  },
  settings: {
    onboardingComplete: false,
    selectedMicrophone: "default",
    launchAtLogin: false,
    showDictationWindowAlways: false,
  },
};

export class AppStore extends EventEmitter {
  private static instance: AppStore;
  private state: AppState;
  private subscriptions: Map<number, Subscription<any>> = new Map();
  private subscriptionId = 0;
  private mutexes: Map<string, Promise<void>> = new Map();
  private mutexResolvers: Map<string, () => void> = new Map();

  private constructor() {
    super();
    this.setMaxListeners(100);
    this.state = this.deepClone(initialState);
  }

  static getInstance(): AppStore {
    if (!AppStore.instance) {
      AppStore.instance = new AppStore();
    }
    return AppStore.instance;
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  getState(): AppState {
    return this.deepClone(this.state);
  }

  setState(
    partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  ): void {
    const prevState = this.deepClone(this.state);

    const updates =
      typeof partial === "function" ? partial(this.state) : partial;

    this.state = this.mergeDeep(this.state, updates);

    this.notifySubscribers(prevState);
    this.emit("state-changed", { prev: prevState, next: this.getState() });
  }

  private mergeDeep(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.mergeDeep(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  subscribe<T>(
    selector: StateSelector<T>,
    listener: StateListener<T>,
  ): UnsubscribeFn {
    const id = ++this.subscriptionId;
    const subscription: Subscription<T> = {
      selector,
      listener,
      lastValue: selector(this.state),
    };
    this.subscriptions.set(id, subscription);

    return () => {
      this.subscriptions.delete(id);
    };
  }

  private notifySubscribers(prevState: AppState): void {
    for (const [, sub] of this.subscriptions) {
      const newValue = sub.selector(this.state);
      if (!this.shallowEqual(newValue, sub.lastValue)) {
        const prevValue = sub.lastValue;
        sub.lastValue = newValue;
        try {
          sub.listener(newValue, prevValue);
        } catch (err) {
          console.error("[AppStore] Subscriber error:", err);
        }
      }
    }
  }

  private shallowEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      return a.every((val, idx) => val === b[idx]);
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => a[key] === b[key]);
  }

  async withMutex<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    await this.acquireMutex(name);
    try {
      return await fn();
    } finally {
      this.releaseMutex(name);
    }
  }

  private async acquireMutex(name: string): Promise<void> {
    while (this.mutexes.has(name)) {
      await this.mutexes.get(name);
    }

    let resolver: () => void;
    const promise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    this.mutexes.set(name, promise);
    this.mutexResolvers.set(name, resolver!);
  }

  private releaseMutex(name: string): void {
    const resolver = this.mutexResolvers.get(name);
    if (resolver) {
      resolver();
    }
    this.mutexes.delete(name);
    this.mutexResolvers.delete(name);
  }

  select<T>(selector: StateSelector<T>): T {
    return selector(this.state);
  }

  setAppStatus(status: SetupStatus): void {
    this.setState({ app: { ...this.state.app, status } });
  }

  setDictationState(state: DictationState, sessionId?: string | null): void {
    this.setState({
      dictation: {
        ...this.state.dictation,
        state,
        ...(sessionId !== undefined ? { sessionId } : {}),
      },
    });
  }

  setActivePlugin(pluginName: string | null): void {
    this.setState({
      plugins: { ...this.state.plugins, activePlugin: pluginName },
    });
  }

  updatePluginState(
    pluginName: string,
    updates: Partial<PluginStateData>,
  ): void {
    const currentPluginState = this.state.plugins.pluginStates[pluginName] || {
      isLoading: false,
      isRunning: false,
      isInitialized: false,
      isActive: false,
    };

    this.setState({
      plugins: {
        ...this.state.plugins,
        pluginStates: {
          ...this.state.plugins.pluginStates,
          [pluginName]: { ...currentPluginState, ...updates },
        },
      },
    });
  }

  addSegment(segment: Segment): void {
    this.setState({
      segments: {
        ...this.state.segments,
        items: [...this.state.segments.items, segment],
      },
    });
  }

  setSegments(items: Segment[]): void {
    this.setState({
      segments: { ...this.state.segments, items },
    });
  }

  clearSegments(): void {
    this.setState({
      segments: {
        ...this.state.segments,
        items: [],
        initialSelectedText: null,
        queuedHandlers: [],
      },
      dictation: {
        ...this.state.dictation,
        isAccumulatingMode: false,
      },
    });
  }

  setPermission(
    type: "accessibility" | "microphone",
    status: PermissionStatus,
  ): void {
    this.setState({
      permissions: {
        ...this.state.permissions,
        [type]: status,
        lastChecked: Date.now(),
      },
    });
  }

  setUIState(updates: Partial<AppState["ui"]>): void {
    this.setState({ ui: { ...this.state.ui, ...updates } });
  }

  setSetting<K extends keyof AppState["settings"]>(
    key: K,
    value: AppState["settings"][K],
  ): void {
    this.setState({
      settings: { ...this.state.settings, [key]: value },
    });
  }

  setAudioCaptureState(updates: Partial<AppState["audioCapture"]>): void {
    this.setState({
      audioCapture: { ...this.state.audioCapture, ...updates },
    });
  }

  addAccumulatedChunk(chunk: string): void {
    this.setState({
      audioCapture: {
        ...this.state.audioCapture,
        accumulatedChunks: [
          ...this.state.audioCapture.accumulatedChunks,
          chunk,
        ],
      },
    });
  }

  clearAudioCaptureState(): void {
    this.setState({
      audioCapture: {
        isCapturing: false,
        vadReady: false,
        chunkStartTime: null,
        accumulatedChunks: [],
        processedSampleCount: 0,
        lastSegmentEndSample: 0,
      },
    });
  }

  getSerializableState(): AppState {
    return this.getState();
  }

  reset(): void {
    this.state = this.deepClone(initialState);
    this.emit("state-reset");
  }

  destroy(): void {
    this.subscriptions.clear();
    this.mutexes.clear();
    this.mutexResolvers.clear();
    this.removeAllListeners();
  }
}

export const appStore = AppStore.getInstance();

export const selectors = {
  appStatus: (state: AppState) => state.app.status,
  dictationState: (state: AppState) => state.dictation.state,
  isRecording: (state: AppState) => state.dictation.state === "recording",
  isFinishing: (state: AppState) => state.dictation.state === "finishing",
  isIdle: (state: AppState) => state.dictation.state === "idle",
  activePlugin: (state: AppState) => state.plugins.activePlugin,
  segments: (state: AppState) => state.segments.items,
  completedSegments: (state: AppState) =>
    state.segments.items.filter(
      (s): s is TranscribedSegment =>
        s.type === "transcribed" && s.completed === true,
    ),
  permissions: (state: AppState) => state.permissions,
  trayIconState: (state: AppState) => state.ui.trayIconState,
  isAccumulatingMode: (state: AppState) => state.dictation.isAccumulatingMode,
  bufferingEnabled: (state: AppState) => state.plugins.bufferingEnabled,
  isCapturing: (state: AppState) => state.audioCapture.isCapturing,
  vadReady: (state: AppState) => state.audioCapture.vadReady,
  accumulatedChunks: (state: AppState) => state.audioCapture.accumulatedChunks,
  chunkStartTime: (state: AppState) => state.audioCapture.chunkStartTime,
};
