-- Migration 0006: case_files + the human-only verification gate.
-- This is where the verification standard lives in software.

create table if not exists public.case_files (
  id               uuid primary key default gen_random_uuid(),
  award_unique_id  text not null references public.awards(award_unique_id) on delete cascade,
  status           text not null default 'queue' check (status in ('queue','hold','kill','publish')),
  gate_progress    jsonb not null default '{}'::jsonb,  -- { "gate_1": {"cleared_by":..,"cleared_at":..}, ... }
  reviewer_notes   text,
  evidence         jsonb not null default '[]'::jsonb,  -- array of sourced evidence refs (agents may append)
  assigned_to      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (award_unique_id)
);

create index if not exists case_files_status_idx on public.case_files (status);

comment on table public.case_files is
  'status + gate_progress are HUMAN-ONLY transitions. Agents may read freely and append sourced evidence, but may never advance status or clear a gate. Enforced by column privilege + the human-only RPCs + the case_files_gate_guard trigger.';

-- Touch updated_at on any update.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists case_files_touch on public.case_files;
create trigger case_files_touch before update on public.case_files
  for each row execute function public.touch_updated_at();

-- Gate guard: reject any change to status/gate_progress unless it comes through
-- a human-only RPC (which flips the txn-local ibtn.gate_write flag).
create or replace function public.case_files_gate_guard()
returns trigger language plpgsql as $$
begin
  if (new.status is distinct from old.status
      or new.gate_progress is distinct from old.gate_progress)
     and coalesce(current_setting('ibtn.gate_write', true), 'off') <> 'on'
  then
    raise exception
      'case_files.status / gate_progress are human-only transitions. Use advance_case_status() or clear_case_gate().'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists case_files_gate_guard_trg on public.case_files;
create trigger case_files_gate_guard_trg before update on public.case_files
  for each row execute function public.case_files_gate_guard();

-- Human-only RPC: advance a case's status.
create or replace function public.advance_case_status(
  p_case_id uuid, p_new_status text, p_note text default null
) returns public.case_files
language plpgsql security definer set search_path = public as $$
declare result public.case_files;
begin
  if p_new_status not in ('queue','hold','kill','publish') then
    raise exception 'invalid status %', p_new_status;
  end if;
  perform set_config('ibtn.gate_write', 'on', true);
  update public.case_files
     set status = p_new_status,
         reviewer_notes = coalesce(p_note, reviewer_notes)
   where id = p_case_id
   returning * into result;
  perform set_config('ibtn.gate_write', 'off', true);
  return result;
end; $$;

-- Human-only RPC: clear (or set) a named verification gate.
create or replace function public.clear_case_gate(
  p_case_id uuid, p_gate_key text, p_cleared_by text default null, p_note text default null
) returns public.case_files
language plpgsql security definer set search_path = public as $$
declare result public.case_files;
begin
  perform set_config('ibtn.gate_write', 'on', true);
  update public.case_files
     set gate_progress = gate_progress || jsonb_build_object(
           p_gate_key,
           jsonb_build_object('cleared_by', p_cleared_by, 'cleared_at', now(), 'note', p_note)
         )
   where id = p_case_id
   returning * into result;
  perform set_config('ibtn.gate_write', 'off', true);
  return result;
end; $$;

revoke all on function public.advance_case_status(uuid, text, text) from public, anon;
revoke all on function public.clear_case_gate(uuid, text, text, text) from public, anon;
grant execute on function public.advance_case_status(uuid, text, text) to authenticated;
grant execute on function public.clear_case_gate(uuid, text, text, text) to authenticated;
