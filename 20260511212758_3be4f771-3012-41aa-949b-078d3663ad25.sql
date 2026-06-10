-- Add badge_id to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS badge_id text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_badge_id_unique
  ON public.profiles (badge_id) WHERE badge_id IS NOT NULL;

-- Lookup function: badge -> user_id (security definer to bypass profiles RLS for the
-- mobile sign-in flow which has no auth session). Returns null if not found.
CREATE OR REPLACE FUNCTION public.get_user_id_by_badge(_badge text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE badge_id = _badge LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_id_by_badge(text) TO anon, authenticated;