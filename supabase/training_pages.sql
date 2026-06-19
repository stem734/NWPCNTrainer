-- =============================================================================
-- S1 Hotspot Training — shared storage on the MyMedInfo Supabase project
-- Additive only. Run in the Supabase SQL editor. Reuses the existing
-- is_admin() helper defined in MyMedInfo's rls.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Editor check (training editors = MyMedInfo active owner/admin users)
-- ---------------------------------------------------------------------------
create or replace function public.is_training_editor()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.is_admin();
$$;

grant execute on function public.is_training_editor() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Edit locks (prevent simultaneous editing)
-- ---------------------------------------------------------------------------
create or replace function public.acquire_training_lock(page_id uuid)
returns table (success boolean, locked_by_user_id uuid, locked_at_time timestamptz, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  existing_lock_user uuid;
  existing_lock_time timestamptz;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    return query select false, null::uuid, null::timestamptz, 'Not authenticated'::text;
    return;
  end if;

  if not public.is_training_editor() then
    return query select false, null::uuid, null::timestamptz, 'Not authorized'::text;
    return;
  end if;

  select locked_by, locked_at into existing_lock_user, existing_lock_time
  from public.training_pages where id = page_id;

  -- If locked by this user, renew the lock
  if existing_lock_user = current_user_id then
    update public.training_pages
    set locked_at = now()
    where id = page_id;
    return query select true, current_user_id, now(), 'Lock renewed'::text;
    return;
  end if;

  -- If locked by another user and not stale (30 mins), reject
  if existing_lock_user is not null and existing_lock_time > now() - interval '30 minutes' then
    return query select false, existing_lock_user, existing_lock_time, 'Page locked by another user'::text;
    return;
  end if;

  -- Acquire or steal stale lock
  update public.training_pages
  set locked_by = current_user_id, locked_at = now()
  where id = page_id;

  return query select true, current_user_id, now(), 'Lock acquired'::text;
end;
$$;

grant execute on function public.acquire_training_lock(uuid) to authenticated;

create or replace function public.release_training_lock(page_id uuid)
returns table (success boolean, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    return query select false, 'Not authenticated'::text;
    return;
  end if;

  update public.training_pages
  set locked_by = null, locked_at = null
  where id = page_id and locked_by = current_user_id;

  if found then
    return query select true, 'Lock released'::text;
  else
    return query select false, 'You do not hold this lock'::text;
  end if;
end;
$$;

grant execute on function public.release_training_lock(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.training_pages (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'Untitled training page',
  published    boolean not null default false,
  image_path   text,
  image_width  integer,
  image_height integer,
  hotspots     jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  locked_by    uuid references auth.users(id),
  locked_at    timestamptz
);

create index if not exists training_pages_published_idx
  on public.training_pages (published);

alter table public.training_pages enable row level security;

-- Anyone (including anonymous viewers) can read PUBLISHED pages.
drop policy if exists training_read_published on public.training_pages;
create policy training_read_published on public.training_pages
  for select
  using (published = true);

-- Editors can do everything (incl. read their own drafts).
drop policy if exists training_editor_all on public.training_pages;
create policy training_editor_all on public.training_pages
  for all
  using (public.is_training_editor())
  with check (public.is_training_editor());

-- ---------------------------------------------------------------------------
-- Storage bucket for screenshots (public read, editor-only write)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('training-images', 'training-images', true)
on conflict (id) do nothing;

drop policy if exists training_images_public_read on storage.objects;
create policy training_images_public_read on storage.objects
  for select
  using (bucket_id = 'training-images');

drop policy if exists training_images_editor_insert on storage.objects;
create policy training_images_editor_insert on storage.objects
  for insert
  with check (bucket_id = 'training-images' and public.is_training_editor());

drop policy if exists training_images_editor_update on storage.objects;
create policy training_images_editor_update on storage.objects
  for update
  using (bucket_id = 'training-images' and public.is_training_editor());

drop policy if exists training_images_editor_delete on storage.objects;
create policy training_images_editor_delete on storage.objects
  for delete
  using (bucket_id = 'training-images' and public.is_training_editor());
