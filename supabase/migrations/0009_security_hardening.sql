-- Migration 0009: hardening from the post-DDL advisor lint.
-- Pins search_path on trigger functions; tightens case_files write policies.
-- NOTE: advance_case_status / clear_case_gate remain SECURITY DEFINER and
-- executable by `authenticated` BY DESIGN — they are the human-only gate RPCs
-- and must be callable by reviewers. That advisor WARN is expected and accepted.

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end; $$;

create or replace function public.case_files_gate_guard()
returns trigger language plpgsql set search_path = '' as $$
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

-- Reviewer writes scoped: create any case; edit a case that is unassigned or
-- assigned to you. (status/gate stay blocked by the column GRANT regardless.)
drop policy if exists case_files_insert on public.case_files;
create policy case_files_insert on public.case_files
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists case_files_update on public.case_files;
create policy case_files_update on public.case_files
  for update to authenticated
  using (assigned_to is null or assigned_to = (select auth.uid()))
  with check (assigned_to is null or assigned_to = (select auth.uid()));
