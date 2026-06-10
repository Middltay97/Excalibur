
-- 1. email_recipients: admin-only SELECT
DROP POLICY IF EXISTS "Authenticated view recipients" ON public.email_recipients;
CREATE POLICY "Admins view recipients"
  ON public.email_recipients FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. sku_master: restrict to admin/verifier
DROP POLICY IF EXISTS "Authenticated view sku_master" ON public.sku_master;
CREATE POLICY "Admins and verifiers view sku_master"
  ON public.sku_master FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'verifier'::app_role)
  );

-- 3. Revoke EXECUTE from authenticated/anon on SECURITY DEFINER functions
--    that should only be called via server (service role) or after explicit role checks.
REVOKE EXECUTE ON FUNCTION public.mobile_apply_scan(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_cycle(uuid) FROM PUBLIC, anon;
-- delete_cycle stays callable by authenticated (it checks admin role internally);
-- if you prefer to lock it down further, revoke from authenticated as well.
