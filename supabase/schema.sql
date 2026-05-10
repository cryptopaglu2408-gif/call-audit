-- Run in Supabase SQL editor.

create extension if not exists "vector";

create table if not exists rubrics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parameters jsonb not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists rubrics_one_active
  on rubrics (is_active) where is_active = true;

create table if not exists ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  sheet_name text not null,
  link_column text not null,
  row_start int not null,
  row_end int not null,
  total_rows int not null,
  status text not null default 'running',
  error text,
  created_at timestamptz not null default now()
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references ingestion_jobs(id) on delete set null,
  source_row int,
  drive_link text,
  storage_path text,
  metadata jsonb default '{}'::jsonb,
  transcript text,
  diarized jsonb,
  duration_seconds numeric,
  language text,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);

create index if not exists calls_status_idx on calls (status);
create index if not exists calls_job_idx on calls (job_id);

create table if not exists call_embeddings (
  call_id uuid primary key references calls(id) on delete cascade,
  embedding vector(384) not null
);

create index if not exists call_embeddings_idx
  on call_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  rubric_id uuid references rubrics(id) on delete set null,
  parameter text not null,
  score numeric not null,
  max_score numeric not null,
  reasoning text,
  created_at timestamptz not null default now(),
  unique (call_id, rubric_id, parameter)
);

create index if not exists scores_call_idx on scores (call_id);

-- Semantic search RPC for the dashboard.
create or replace function match_calls(
  query_embedding vector(384),
  match_count int default 10
)
returns table (
  call_id uuid,
  similarity float,
  transcript text
)
language sql stable
as $$
  select
    c.id as call_id,
    1 - (e.embedding <=> query_embedding) as similarity,
    c.transcript
  from call_embeddings e
  join calls c on c.id = e.call_id
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
