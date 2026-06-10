import { BrowserMultiFormatReader } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

interface Props {
  onScan: (text: string) => void;
  onClose: () => void;
}

export function CameraScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const lastScanRef = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | null = null;
    (async () => {
      try {
        controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (!result) return;
            const text = result.getText();
            const now = Date.now();
            // Debounce duplicate scans within 1.5s
            if (lastScanRef.current && lastScanRef.current.text === text && now - lastScanRef.current.at < 1500) {
              return;
            }
            lastScanRef.current = { text, at: now };
            onScan(text);
          },
        );
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      controls?.stop();
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between bg-card p-3 text-card-foreground">
        <div className="text-sm font-medium">Scan barcode</div>
        <button
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Close
        </button>
      </div>
      <div className="relative flex-1">
        <video ref={videoRef} className="h-full w-full object-cover" autoPlay playsInline muted />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-32 w-72 rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
        </div>
        {error && (
          <div className="absolute inset-x-4 bottom-4 rounded-md bg-destructive p-3 text-sm text-destructive-foreground">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
