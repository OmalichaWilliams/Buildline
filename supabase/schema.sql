-- Solution Delivery Queue: database, roles and access rules for Supabase.
-- Run once in the Supabase SQL editor (Project > SQL Editor > New query > paste > Run).
--
-- Roles (profiles.role):
--   it_admin       accepts requests, owns the queue, sets timelines and resources
--   process_owner  submits prototypes, verifies designs, runs UAT, logs bugs
--   viewer         can see everything, cannot change anything (default for new sign-ins)

-- ---------- people ----------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'viewer' check (role in ('it_admin', 'process_owner', 'viewer')),
  created_at timestamptz not null default now()
);

-- Every new sign-in gets a profile with the viewer role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The signed-in person's role, readable inside policies.
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;

-- ---------- records ----------
-- One row per record. `collection` matches the page's collections:
--   solutions  requests and their stage history          (IT admins and process owners write)
--   bugs       post-deployment bugs                       (IT admins and process owners write)
--   ctrl       queue position, plan, rework counters      (IT admins only)
--   resources  IT people and teams that can be assigned   (IT admins only)
create table if not exists public.documents (
  collection text not null check (collection in ('solutions', 'bugs', 'ctrl', 'resources')),
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);

create or replace function public.touch_document()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch
  before insert or update on public.documents
  for each row execute function public.touch_document();

-- ---------- access rules ----------
alter table public.profiles  enable row level security;
alter table public.documents enable row level security;

drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);

drop policy if exists "IT admins manage roles" on public.profiles;
create policy "IT admins manage roles" on public.profiles
  for update to authenticated
  using (public.app_role() = 'it_admin')
  with check (public.app_role() = 'it_admin');

drop policy if exists "records readable by signed-in users" on public.documents;
create policy "records readable by signed-in users" on public.documents
  for select to authenticated using (true);

create or replace function public.can_write(coll text)
returns boolean language sql stable as $$
  select case
    when coll in ('ctrl', 'resources') then public.app_role() = 'it_admin'
    when coll in ('solutions', 'bugs') then public.app_role() in ('it_admin', 'process_owner')
    else false
  end
$$;

drop policy if exists "write by role (insert)" on public.documents;
create policy "write by role (insert)" on public.documents
  for insert to authenticated with check (public.can_write(collection));

drop policy if exists "write by role (update)" on public.documents;
create policy "write by role (update)" on public.documents
  for update to authenticated using (public.can_write(collection)) with check (public.can_write(collection));

drop policy if exists "write by role (delete)" on public.documents;
create policy "write by role (delete)" on public.documents
  for delete to authenticated using (public.can_write(collection));

-- ---------- live updates ----------
do $$
begin
  alter publication supabase_realtime add table public.documents;
exception when duplicate_object then null;
end $$;

-- ---------- first IT admin ----------
-- After you have signed in once, make yourself an IT admin (replace the email):
--   update public.profiles set role = 'it_admin' where email = 'you@example.com';
