-- Migration 0015: hardening from the post-DDL lint.
--   (a) scorer views run as the querying user (security_invoker), not the creator,
--       so they honor RLS instead of bypassing it.
--   (b) the scoring orchestration functions truncate + rebuild scores; they must
--       NOT be callable by anon/authenticated. Restrict to service_role (a future
--       scoring cron / edge function calls run_all_scoring).

alter view public.score_nela        set (security_invoker = on);
alter view public.score_cluster     set (security_invoker = on);
alter view public.score_passthru    set (security_invoker = on);
alter view public.score_modballoon  set (security_invoker = on);
alter view public.score_soleconc    set (security_invoker = on);
alter view public.score_compcollapse set (security_invoker = on);
alter view public.score_priceout    set (security_invoker = on);
alter view public.score_fye         set (security_invoker = on);
alter view public.score_geomismatch set (security_invoker = on);

revoke all on function public.run_scoring()       from public, anon, authenticated;
revoke all on function public.compute_composite() from public, anon, authenticated;
revoke all on function public.run_all_scoring()   from public, anon, authenticated;
grant execute on function public.run_all_scoring() to service_role;
