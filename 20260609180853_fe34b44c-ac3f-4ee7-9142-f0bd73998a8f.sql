UPDATE public.profiles SET team_id = 'red-sigma' WHERE team_id = 'red-alpha';
UPDATE public.profiles SET team_id = 'purple-delta' WHERE team_id IN ('indigo-delta', 'violet-sigma');