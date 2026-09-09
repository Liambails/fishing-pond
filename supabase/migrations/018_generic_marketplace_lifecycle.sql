-- COBALT V3.9.20 — generic marketplace capture + lifecycle hardening

-- Products are marketplace products first. Automotive part identity is optional enrichment.
alter table public.products alter column part_type drop not null;

-- Persist general-purpose marketplace facts as first-class observation data while retaining
-- raw_snapshot as the full collector evidence envelope.
alter table public.observations
  add column if not exists description text,
  add column if not exists category_path jsonb,
  add column if not exists primary_image_url text,
  add column if not exists marketplace_attributes jsonb not null default '[]'::jsonb;

comment on column public.observations.marketplace_attributes is
  'Marketplace-provided label/value facts captured generically, e.g. Condition, Colour, Size, Location.';
