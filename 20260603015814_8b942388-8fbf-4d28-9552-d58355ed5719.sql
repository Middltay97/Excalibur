CREATE TABLE public.count_allocation_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  percentage numeric NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.count_allocation_rules TO authenticated;
GRANT ALL ON public.count_allocation_rules TO service_role;

ALTER TABLE public.count_allocation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage allocation rules"
ON public.count_allocation_rules
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated view allocation rules"
ON public.count_allocation_rules
FOR SELECT
TO authenticated
USING (true);

CREATE TRIGGER set_count_allocation_rules_updated_at
BEFORE UPDATE ON public.count_allocation_rules
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
