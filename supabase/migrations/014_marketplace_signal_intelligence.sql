-- COBALT V3.9.13 — marketplace behavioural signals, public Q&A intelligence and listing drafts.
-- Additive only. Existing observations remain valid with null values for newly collected signals.

alter table public.observations add column if not exists question_count integer;
alter table public.observations add column if not exists purchase_intent_questions integer;
alter table public.observations add column if not exists compatibility_questions integer;
alter table public.observations add column if not exists condition_questions integer;
alter table public.observations add column if not exists q_and_a jsonb;
alter table public.observations add column if not exists qa_identity_codes jsonb;
alter table public.observations add column if not exists buy_now_available boolean;
alter table public.observations add column if not exists offer_available boolean;
alter table public.observations add column if not exists stock_quantity integer;
alter table public.observations add column if not exists listing_status text;
alter table public.observations add column if not exists sold_detected boolean;

create table if not exists public.product_listing_drafts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  marketplace text not null default 'Trade Me',
  title text,
  description text,
  condition_text text,
  item_specifics jsonb not null default '{}'::jsonb,
  identity jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  field_generations jsonb not null default '{}'::jsonb,
  model text,
  prompt_version text not null default 'listing-draft-v1',
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(product_id, marketplace)
);
create index if not exists product_listing_drafts_product_idx on public.product_listing_drafts(product_id);

drop trigger if exists product_listing_drafts_set_updated_at on public.product_listing_drafts;
create trigger product_listing_drafts_set_updated_at before update on public.product_listing_drafts for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
