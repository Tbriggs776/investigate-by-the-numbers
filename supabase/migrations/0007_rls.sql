-- Migration 0007: RLS + the human-only column lockdown on case_files.
-- Internal investigative tool: anon gets nothing, authenticated reviewers read all.

do $$
declare t text;
begin
  foreach t in array array[
    'config','entities','raw_awards','awards','subawards',
    'address_exclusions','scores','composite_scores','case_files'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true);', t || '_read', t);
  end loop;
end $$;

-- case_files: reviewers may create cases and edit evidence/notes/assignment, but
-- NEVER status or gate_progress directly. The column-level UPDATE grant enforces
-- it — the only path to status/gate changes is advance_case_status()/clear_case_gate().
revoke update on public.case_files from authenticated;
grant update (reviewer_notes, evidence, assigned_to) on public.case_files to authenticated;

drop policy if exists case_files_insert on public.case_files;
create policy case_files_insert on public.case_files
  for insert to authenticated with check (true);

-- Row-level permit only; the column GRANT above is what blocks status/gate writes.
drop policy if exists case_files_update on public.case_files;
create policy case_files_update on public.case_files
  for update to authenticated using (true) with check (true);
