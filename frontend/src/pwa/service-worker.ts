export interface ServiceWorkerContainerBoundary {
  readonly controller?: unknown;
  register(
    scriptUrl: string,
    options: { readonly updateViaCache: "none" }
  ): Promise<ServiceWorkerRegistrationBoundary>;
  addEventListener?(type: "controllerchange", listener: () => void): void;
}

export interface ServiceWorkerRegistrationBoundary {
  readonly waiting?: { postMessage(message: { readonly type: "SKIP_WAITING" }): void };
  readonly installing?: {
    readonly state: string;
    addEventListener?(type: "statechange", listener: () => void): void;
  };
  addEventListener?(type: "updatefound", listener: () => void): void;
}

function browserServiceWorkerContainer(): ServiceWorkerContainerBoundary | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  return navigator.serviceWorker as unknown as ServiceWorkerContainerBoundary;
}

export async function registerPwaServiceWorker({
  serviceWorkerContainer = browserServiceWorkerContainer(),
  onUpdateAvailable,
  onControllerChange
}: {
  readonly serviceWorkerContainer?: ServiceWorkerContainerBoundary;
  readonly onUpdateAvailable: (applyUpdate: () => void) => void;
  readonly onControllerChange?: () => void;
}): Promise<void> {
  if (!serviceWorkerContainer) return;
  const registration = await serviceWorkerContainer.register("/service-worker.js", {
    updateViaCache: "none"
  });
  const announceUpdate = () => {
    if (!serviceWorkerContainer.controller || !registration.waiting) return;
    onUpdateAvailable(() => registration.waiting?.postMessage({ type: "SKIP_WAITING" }));
  };
  registration.addEventListener?.("updatefound", () => {
    const installing = registration.installing;
    if (!installing) {
      announceUpdate();
      return;
    }
    installing.addEventListener?.("statechange", () => {
      if (installing.state === "installed") announceUpdate();
    });
  });
  serviceWorkerContainer.addEventListener?.("controllerchange", () => onControllerChange?.());
  announceUpdate();
}
