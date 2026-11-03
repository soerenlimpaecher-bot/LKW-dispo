-- Rechte: Supabase vergibt standardmäßig EXECUTE an anon/authenticated. Das wird hier
-- zurückgenommen und gezielt neu vergeben.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Büro und Küche (angemeldet; die Funktionen prüfen die Rolle selbst)
grant execute on function
  public.staff_role_of_current_user(),
  public.app_now(),
  public.office_save_driver(uuid, text, text, text, boolean),
  public.office_save_courier(uuid, text, boolean),
  public.office_issue_token(public.token_subject, uuid),
  public.office_revoke_token(public.token_subject, uuid),
  public.office_save_order(uuid, date, text),
  public.office_cancel_order(uuid),
  public.office_set_location(uuid, float8, float8, text),
  public.office_move_order(uuid, uuid),
  public.office_merge_groups(uuid, uuid[]),
  public.office_split_group(uuid, uuid[]),
  public.office_unlock_orders(uuid[]),
  public.office_regroup(date),
  public.office_release_group(uuid),
  public.office_dashboard(date),
  public.rating_stats(date, date),
  public.kitchen_save_meal(date, text, text, numeric, boolean),
  public.kitchen_overview(date)
to authenticated;

-- Fahrer- und Lieferfahrer-Funktionen nur für den Server (service_role).
grant execute on all functions in schema public to service_role;

-- Realtime für die Live-Ansichten von Büro und Küche (RLS gilt auch hier).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.orders, public.delivery_locations, public.delivery_groups, public.group_assignments,
      public.delivery_confirmations, public.daily_meals, public.notifications, public.ratings;
  end if;
end;
$$;
