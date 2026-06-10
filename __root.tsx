import { createFileRoute } from "@tanstack/react-router";

// Serves /.well-known/assetlinks.json for Android Trusted Web Activity
// (TWA) verification. Without this Chrome shows a URL bar at the top of
// the installed Play Store app.
//
// After running `bubblewrap build` for the first time, replace the values
// below with the package name and SHA-256 fingerprint Bubblewrap prints
// (or paste the contents of the assetlinks.json file it generates).
const ASSETLINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "REPLACE_WITH_PACKAGE_NAME",
      sha256_cert_fingerprints: [
        "REPLACE_WITH_SHA256_FINGERPRINT_FROM_BUBBLEWRAP",
      ],
    },
  },
];

export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify(ASSETLINKS, null, 2), {
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
