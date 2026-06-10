CREATE POLICY "Authenticated view profiles for names"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);