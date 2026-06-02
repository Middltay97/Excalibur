import type { CapacitorConfig } from '@capacitor/cli';

/**
 * CountRight Capacitor configuration.
 *
 * This native shell loads the published Lovable web app remotely so UI/logic
 * changes ship instantly via `Publish` — only rebuild the APK when you change
 * the icon, name, permissions, or version.
 */
const config: CapacitorConfig = {
  appId: 'app.countright.scanner',
  appName: 'CountRight',
  webDir: 'capacitor-www',
  server: {
    url: 'https://aagcountright.lovable.app/m',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: [
      'aagcountright.lovable.app',
      '*.lovable.app',
      '*.supabase.co',
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
