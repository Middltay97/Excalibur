import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BADGE_KEY = "countright.mobile.badge";

export function getBadge(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(BADGE_KEY);
}

export function setBadge(badge: string) {
  localStorage.setItem(BADGE_KEY, badge);
}

export function clearBadge() {
  localStorage.removeItem(BADGE_KEY);
}

/**
 * Client-only badge reader. Returns `undefined` on the server / first render,
 * then the badge value (or null) once mounted. Use this in routes that render
 * inside SSR so we don't get a hydration mismatch from the localStorage read.
 */
export function useBadge(): string | null | undefined {
  const [badge, setBadgeState] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setBadgeState(getBadge());
  }, []);
  return badge;
}


export async function callMobile<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mobile-counter", {
    body: { action, ...payload },
  });
  if (error) {
    // Supabase wraps non-2xx as FunctionsHttpError; try to read message from data
    const msg = (data as any)?.error || error.message;
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}
