ALTER TABLE public.profiles ADD COLUMN team_id text;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_team_id_check
  CHECK (team_id IS NULL OR team_id IN (
    'red-alpha','orange-nova','yellow-magna','green-gamma','blue-theta','indigo-delta','violet-sigma'
  ));