-- Revendo : sauvegarde en ligne de toutes les données de l'application.
-- À coller dans Supabase → SQL Editor → Run (une seule fois).
create table if not exists public.user_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_data enable row level security;
drop policy if exists "own rows select" on public.user_data;
drop policy if exists "own rows insert" on public.user_data;
drop policy if exists "own rows update" on public.user_data;
drop policy if exists "own rows delete" on public.user_data;
create policy "own rows select" on public.user_data for select using (auth.uid() = user_id);
create policy "own rows insert" on public.user_data for insert with check (auth.uid() = user_id);
create policy "own rows update" on public.user_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows delete" on public.user_data for delete using (auth.uid() = user_id);
