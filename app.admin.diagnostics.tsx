import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/contexts/auth-context";
import { PortalProvider } from "@/contexts/portal-context";
import { Toaster } from "@/components/ui/sonner";
import { installChunkLoadRecovery, recoverFromChunkLoadError } from "@/lib/chunk-recovery";

installChunkLoadRecovery();

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  if (recoverFromChunkLoadError(error)) return null;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Echelon CountRight" },
      {
        name: "description",
        content:
          "Run accurate warehouse cycle counts on RF scanners, phones, and tablets. Upload baselines, scan barcodes, generate variance reports, and email final counts.",
      },
      { name: "theme-color", content: "#18ABBF" },
      { property: "og:title", content: "Echelon CountRight" },
      { name: "twitter:title", content: "Echelon CountRight" },
      {
        name: "description",
        content:
          "Echelon CountRight is a warehouse cycle counting application for accurate inventory management.",
      },
      {
        property: "og:description",
        content:
          "Echelon CountRight is a warehouse cycle counting application for accurate inventory management.",
      },
      {
        name: "twitter:description",
        content:
          "Echelon CountRight is a warehouse cycle counting application for accurate inventory management.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/bb2e3074-575b-4122-ac55-5399efa0ddeb/id-preview-0586ce15--47e4eb45-60d1-4c88-b03d-017400e75735.lovable.app-1778526663199.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/bb2e3074-575b-4122-ac55-5399efa0ddeb/id-preview-0586ce15--47e4eb45-60d1-4c88-b03d-017400e75735.lovable.app-1778526663199.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", href: "/icon-512-maskable.png", sizes: "512x512", type: "image/png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
    scripts: [
      {
        children: `
(function(){
  try {
    function hardRecover(){
      var url = new URL(window.location.href);
      url.searchParams.set('cr-recover', Date.now().toString());
      var clearCaches = 'caches' in window
        ? caches.keys().then(function(keys){ return Promise.all(keys.map(function(k){ return caches.delete(k); })); })
        : Promise.resolve();
      var clearWorkers = 'serviceWorker' in navigator
        ? navigator.serviceWorker.getRegistrations().then(function(regs){ return Promise.all(regs.map(function(r){ return r.unregister(); })); })
        : Promise.resolve();
      Promise.allSettled([clearCaches, clearWorkers])
        .catch(function(){})
        .finally(function(){ window.location.replace(url.toString()); });
    }
    function looksLikeChunkError(value){
      var text = '';
      try { text = String((value && (value.message || value.reason || value.error)) || value || ''); } catch(_) {}
      return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module/i.test(text);
    }
    window.addEventListener('vite:preloadError', function(e){
      try { e.preventDefault(); } catch(_) {}
      hardRecover();
    });
    window.addEventListener('unhandledrejection', function(e){
      if (looksLikeChunkError(e.reason)) hardRecover();
    });
    window.addEventListener('error', function(e){
      var target = e && e.target;
      var src = target && (target.src || target.href || '');
      if (new RegExp('(?:^|/)(?:_build|assets)/').test(src) || looksLikeChunkError(e.error || e.message)) hardRecover();
    }, true);
    var inIframe = false;
    try { inIframe = window.self !== window.top; } catch(e) { inIframe = true; }
    var host = location.hostname;
    var isPreview = host.indexOf('id-preview--') !== -1 || host.indexOf('lovableproject.com') !== -1;
    window.__pwaCanInstall = !inIframe && !isPreview;
    window.addEventListener('beforeinstallprompt', function(e){
      e.preventDefault();
      window.__bipEvent = e;
      window.dispatchEvent(new CustomEvent('pwa-bip-ready'));
    });
    window.addEventListener('appinstalled', function(){
      window.__pwaInstalled = true;
      window.dispatchEvent(new CustomEvent('pwa-installed'));
    });
    if (window.__pwaCanInstall && 'serviceWorker' in navigator) {
      window.addEventListener('load', function(){
        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(function(reg){ return reg.update(); }).catch(function(){});
      });
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs){
        regs.forEach(function(r){ r.unregister(); });
      }).catch(function(){});
    }
  } catch(e) {}
})();
`,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <PortalProvider>
        <AuthProvider>
          <Outlet />
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </PortalProvider>
    </QueryClientProvider>
  );
}
