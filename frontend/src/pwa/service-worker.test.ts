import { describe, expect, test } from "vitest";
import { registerPwaServiceWorker } from "./service-worker";
import { createServiceWorkerSource } from "./service-worker-template";

class EventTargetStub {
  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class InstallingWorkerStub extends EventTargetStub {
  state = "installing";
}

describe("PWA 离线壳", () => {
  test("离线壳只预缓存当前构建静态资源，并按规则和构建版本清理旧缓存", () => {
    const source = createServiceWorkerSource({
      buildVersion: "0.1.0-test",
      rulesVersion: "guandan-v4",
      staticAssets: ["/index.html", "/assets/app-test.js", "/assets/app-test.css"]
    });

    expect(source).toContain('const CACHE_NAME = "card-game-shell:guandan-v4:0.1.0-test"');
    expect(source).toContain('"/assets/app-test.js"');
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain('cache.match("/index.html")');
    expect(source).toContain(
      "cacheNames.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)"
    );
    expect(source).not.toContain("indexedDB");
  });

  test("检测到等待中的新 Service Worker 时显示升级入口，确认后才激活", async () => {
    const registration = new EventTargetStub() as EventTargetStub & {
      waiting?: { postMessage: (message: unknown) => void };
    };
    const messages: unknown[] = [];
    registration.waiting = { postMessage: (message) => messages.push(message) };
    const updates: Array<() => void> = [];

    await registerPwaServiceWorker({
      serviceWorkerContainer: {
        controller: {},
        register: async () => registration
      },
      onUpdateAvailable: (update) => updates.push(update)
    });

    expect(updates).toHaveLength(1);
    updates[0]();
    expect(messages).toEqual([{ type: "SKIP_WAITING" }]);
  });

  test("新 worker 安装完成后才进入等待状态时仍显示升级入口", async () => {
    const registration = new EventTargetStub() as EventTargetStub & {
      waiting?: { postMessage: (message: unknown) => void };
      installing?: InstallingWorkerStub;
    };
    const installing = new InstallingWorkerStub();
    registration.installing = installing;
    const updates: Array<() => void> = [];

    await registerPwaServiceWorker({
      serviceWorkerContainer: {
        controller: {},
        register: async () => registration
      },
      onUpdateAvailable: (update) => updates.push(update)
    });
    registration.dispatch("updatefound");
    expect(updates).toHaveLength(0);

    registration.waiting = { postMessage: () => undefined };
    installing.state = "installed";
    installing.dispatch("statechange");

    expect(updates).toHaveLength(1);
  });

  test("没有 Service Worker API 的运行时不注册，保持 SSR-safe", async () => {
    await expect(
      registerPwaServiceWorker({ onUpdateAvailable: () => undefined })
    ).resolves.toBeUndefined();
  });
});
