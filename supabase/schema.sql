-- ============================================================
-- RemindAI Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

create extension if not exists "pgcrypto";

-- 1. Tasks table: stores daily tasks and AI-generated 2-minute starter steps
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  starter_step text not null default 'Spend 2 minutes setting up your workspace for this task.',
  estimated_minutes integer not null default 25,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  scheduled_for date not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  source text not null default 'web' check (source in ('web', 'email_reply', 'rollover')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_tasks_scheduled_for on public.tasks (scheduled_for);
create index if not exists idx_tasks_status on public.tasks (status);

-- 2. Daily briefs table: stores the AI morning plan, email logs, and evening replies
create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  brief_date date unique not null,
  subject text,
  greeting text,
  frog_of_the_day text,
  lazy_hack text,
  schedule_json jsonb default '[]'::jsonb,
  morning_email_id text,
  morning_sent_at timestamptz,
  evening_email_id text,
  evening_sent_at timestamptz,
  raw_evening_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_daily_briefs_date on public.daily_briefs (brief_date);

-- 3. Table privileges (newer Supabase projects don't auto-grant these on new tables;
--    without them you get "permission denied for table tasks")
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.tasks to anon, authenticated, service_role;
grant select, insert, update, delete on public.daily_briefs to anon, authenticated, service_role;

-- 4. Row Level Security (RLS) Policies (allows publishable key access for personal single-user mode)
alter table public.tasks enable row level security;
alter table public.daily_briefs enable row level security;

drop policy if exists "Allow all access to tasks" on public.tasks;
create policy "Allow all access to tasks"
  on public.tasks
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow all access to daily_briefs" on public.daily_briefs;
create policy "Allow all access to daily_briefs"
  on public.daily_briefs
  for all
  to anon, authenticated
  using (true)
  with check (true);
