import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/install")({
  component: InstallPage,
  head: () => ({
    meta: [
      { title: "Install CycleCount on your scanner" },
      {
        name: "description",
        content:
          "Install CycleCount on Android RF scanners, phones, and tablets. Step-by-step Add to Home Screen instructions.",
      },
    ],
  }),
});

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type CheckState = "pass" | "fail" | "pending";

function Check({ label, state, hint }: { label: string; state: CheckState; hint?: string }) {
  const icon = state === "pass" ? "✓" : state === "fail" ? "✗" : "…";
  const color =
    state === "pass" ? "text-success" : state === "fail" ? "text-destructive" : "text-muted-foreground";
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`font-mono ${color}`}>{icon}</span>
      <span className="flex-1">
        <span className="text-foreground">{label}</span>
        {hint && <span className="ml-2 text-xs text-muted-foreground">{hint}</span>}
      </span>
    </li>
  );
}

function InstallPage() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [diag, setDiag] = useState({
    publishedHost: "pending" as CheckState,
    notIframe: "pending" as CheckState,
    manifest: "pending" as CheckState,
    icon192: "pending" as CheckState,
    icon512: "pending" as CheckState,
    serviceWorker: "pending" as CheckState,
    bip: "pending" as CheckState,
    standalone: "pending" as CheckState,
    hostName: "",
    ua: "",
  });

  useEffect(() => {
    setShareUrl(window.location.origin);

    // Pick up an event captured before React mounted
    const existing = (window as unknown as { __bipEvent?: BIPEvent }).__bipEvent;
    if (existing) setDeferred(existing);

    const onReady = () => {
      const ev = (window as unknown as { __bipEvent?: BIPEvent }).__bipEvent;
      if (ev) setDeferred(ev);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("pwa-bip-ready", onReady);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);

    // Diagnostics
    const host = window.location.hostname;
    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch {
      inIframe = true;
    }
    const isPreview =
      host.includes("id-preview--") || host.includes("lovableproject.com") || host === "localhost";
    const standalone = window.matchMedia("(display-mode: standalone)").matches;

    const next = {
      publishedHost: (!isPreview ? "pass" : "fail") as CheckState,
      notIframe: (!inIframe ? "pass" : "fail") as CheckState,
      manifest: "pending" as CheckState,
      icon192: "pending" as CheckState,
      icon512: "pending" as CheckState,
      serviceWorker: ("serviceWorker" in navigator ? "pass" : "fail") as CheckState,
      bip: (existing ? "pass" : "pending") as CheckState,
      standalone: (standalone ? "pass" : "fail") as CheckState,
      hostName: host,
      ua: navigator.userAgent,
    };
    setDiag(next);

    Promise.all([
      fetch("/manifest.webmanifest", { method: "HEAD" })
        .then((r) => r.ok)
        .catch(() => false),
      fetch("/icon-192.png", { method: "HEAD" })
        .then((r) => r.ok)
        .catch(() => false),
      fetch("/icon-512-maskable.png", { method: "HEAD" })
        .then((r) => r.ok)
        .catch(() => false),
    ]).then(([m, i1, i2]) => {
      setDiag((d) => ({
        ...d,
        manifest: m ? "pass" : "fail",
        icon192: i1 ? "pass" : "fail",
        icon512: i2 ? "pass" : "fail",
      }));
    });

    const bipReadyDiag = () => setDiag((d) => ({ ...d, bip: "pass" }));
    window.addEventListener("pwa-bip-ready", bipReadyDiag);

    return () => {
      window.removeEventListener("pwa-bip-ready", onReady);
      window.removeEventListener("pwa-bip-ready", bipReadyDiag);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div>
        <Link to="/" className="text-xs text-muted-foreground hover:underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">Install on your scanner</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          CycleCount installs as a Progressive Web App — no APK file. Once installed it gets a home
          screen icon and launches fullscreen, just like a native app.
        </p>
      </div>

      {installed ? (
        <div className="card-elevated border-2 border-success/40">
          <div className="text-sm font-semibold text-success">✓ Installed</div>
          <p className="mt-1 text-sm text-muted-foreground">
            CycleCount is installed on this device. Launch it from the home screen.
          </p>
        </div>
      ) : (
        <div className="card-elevated space-y-4">
          {deferred ? (
            <button
              onClick={handleInstall}
              className="w-full rounded-md bg-primary py-3 text-base font-semibold text-primary-foreground hover:opacity-90"
            >
              Install CycleCount
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">
              No one-tap install offered yet on this browser. Use the manual steps below — they
              always work in Chrome on Android.
            </p>
          )}
        </div>
      )}

      <div className="card-elevated space-y-3">
        <h2 className="text-lg font-semibold">Manual install (Chrome on Android)</h2>
        <ol className="ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            Open Chrome on the scanner and go to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
              {shareUrl || "this site"}
            </code>
            .
          </li>
          <li>Tap the ⋮ menu in the top-right corner of Chrome.</li>
          <li>
            Tap <span className="font-semibold text-foreground">Install app</span> (or{" "}
            <span className="font-semibold text-foreground">Add to Home screen</span>).
          </li>
          <li>Confirm. CycleCount appears on the device's home screen.</li>
          <li>Open it from the home screen — it launches fullscreen.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          If "Install app" isn't in the menu, scroll the menu — on long Chrome menus it can be near
          the bottom. If it's still missing, check the diagnostics below.
        </p>
      </div>

      <div className="card-elevated space-y-3">
        <h2 className="text-lg font-semibold">Diagnostics</h2>
        <p className="text-xs text-muted-foreground">
          If the install button never appears, this tells us why.
        </p>
        <ul className="space-y-1.5">
          <Check
            label="On the published site (not editor preview)"
            state={diag.publishedHost}
            hint={diag.hostName}
          />
          <Check label="Not inside an iframe" state={diag.notIframe} />
          <Check label="manifest.webmanifest reachable" state={diag.manifest} />
          <Check label="icon-192.png reachable" state={diag.icon192} />
          <Check label="icon-512-maskable.png reachable" state={diag.icon512} />
          <Check label="Service worker supported" state={diag.serviceWorker} />
          <Check
            label="Chrome offered install (beforeinstallprompt fired)"
            state={diag.bip}
            hint={diag.bip === "pending" ? "may take a few seconds, or browser doesn't support it" : undefined}
          />
          <Check
            label="Already installed (running standalone)"
            state={diag.standalone}
            hint={diag.standalone === "pass" ? "you're good" : undefined}
          />
        </ul>
        <p className="break-all text-[10px] text-muted-foreground">UA: {diag.ua}</p>
      </div>

      <div className="card-elevated space-y-2">
        <h2 className="text-lg font-semibold">iPhone / iPad</h2>
        <p className="text-sm text-muted-foreground">
          Open in Safari → tap <span className="font-semibold text-foreground">Share</span> → tap{" "}
          <span className="font-semibold text-foreground">Add to Home Screen</span>.
        </p>
      </div>
    </div>
  );
}
