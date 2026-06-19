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
  updated_by   uuid references auth.users(id)
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
