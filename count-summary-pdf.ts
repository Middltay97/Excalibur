// Shared recovery for "Failed to fetch dynamically imported module" /
// ChunkLoadError situations. These happen when the deployed JS chunks
// referenced by an open tab no longer exist after a redeploy. We can't
// rely solely on the root errorComponent because route-level
// errorComponents intercept first and swallow the recovery path.
//
// Call this from any route-level errorComponent. If it returns true,
// recovery is in flight (caches + service workers being cleared, then
// a hard reload). Render `null` so we don't flash a useless error UI.

type ChunkRecoveryOptions = {
  force?: boolean;
};

function describeError(error: unknown): string {
  return [
    (error as { name?: unknown })?.name,
    (error as { message?: unknown })?.message,
    (error as { stack?: unknown })?.stack,
    String(error ?? ""),
  ]
    .filter(Boolean)
    .join("\n");
}

export function recoverFromChunkLoadError(
  error: unknown,
  options: ChunkRecoveryOptions = {},
): boolean {
  if (typeof window === "undefined") return false;

  const details = describeError(error);

  const isChunkError =
    options.force ||
    /Failed to fetch dynamically imported module/i.test(details) ||
    /Importing a module script failed/i.test(details) ||
    /ChunkLoadError/i.test(details) ||
    /error loading dynamically imported module/i.test(details);

  if (!isChunkError) return false;

  const w = window as typeof window & { __crReloadingChunk?: boolean };
  if (w.__crReloadingChunk) return true;
  w.__crReloadingChunk = true;

  const urlForAttempt = new URL(w.location.href);
  urlForAttempt.searchParams.delete("cr-recover");
  const currentUrl = `${urlForAttempt.pathname}${urlForAttempt.search}${urlForAttempt.hash}`;
  const lastUrl = w.sessionStorage.getItem("cr-chunk-reload-url");
  const lastAt = Number(w.sessionStorage.getItem("cr-chunk-reload-at") || "0");
  const attemptWindowExpired = Date.now() - lastAt > 120_000;
  const attempts =
    lastUrl === currentUrl && !attemptWindowExpired
      ? Number(w.sessionStorage.getItem("cr-chunk-reload-count") || "0")
      : 0;
  if (attempts >= 5) return false;
  w.sessionStorage.setItem("cr-chunk-reload-url", currentUrl);
  w.sessionStorage.setItem("cr-chunk-reload-count", String(attempts + 1));
  w.sessionStorage.setItem("cr-chunk-reload-at", String(Date.now()));

  const reload = () => {
    const url = new URL(w.location.href);
    url.searchParams.set("cr-recover", Date.now().toString());
    w.location.replace(url.toString());
  };

  const clearCaches =
    "caches" in w
      ? w.caches.keys().then((keys) => Promise.all(keys.map((k) => w.caches.delete(k))))
      : Promise.resolve();
  const unregisterWorkers = navigator.serviceWorker
    ? navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    : Promise.resolve();

  Promise.allSettled([clearCaches, unregisterWorkers]).finally(reload);
  return true;
}

export function installChunkLoadRecovery(): void {
  if (typeof window === "undefined") return;
  const w = window as typeof window & { __crChunkRecoveryInstalled?: boolean };
  if (w.__crChunkRecoveryInstalled) return;
  w.__crChunkRecoveryInstalled = true;

  if (new URL(w.location.href).searchParams.has("cr-recover")) {
    w.sessionStorage.removeItem("cr-chunk-reload-url");
    w.sessionStorage.removeItem("cr-chunk-reload-count");
    w.sessionStorage.removeItem("cr-chunk-reload-at");
  }

  w.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    recoverFromChunkLoadError((event as unknown as { payload?: unknown }).payload ?? event, {
      force: true,
    });
  });

  w.addEventListener("unhandledrejection", (event) => {
    recoverFromChunkLoadError(event.reason);
  });

  w.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      const isBuildAsset =
        target instanceof HTMLScriptElement
          ? /\/(?:_build|assets)\//.test(target.src)
          : target instanceof HTMLLinkElement
            ? /\/(?:_build|assets)\//.test(target.href)
            : false;
      recoverFromChunkLoadError(
        (event as ErrorEvent).error ?? (event as ErrorEvent).message ?? event,
        { force: isBuildAsset },
      );
    },
    true,
  );
}
