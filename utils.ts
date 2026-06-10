import { supabase } from "@/integrations/supabase/client";

export async function fetchUserNames(
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data } = await supabase.rpc("get_profile_names", { _ids: unique });
  for (const row of (data ?? []) as { id: string; full_name: string | null }[]) {
    out.set(row.id, row.full_name ?? "");
  }
  return out;
}
