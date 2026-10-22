-- =====================================================================
-- Salon OS · 019 · Salão de demonstração do super admin
-- Um salão completo, com dados de exemplo, onde o super admin opera tudo
-- (sem o modo leitura) para apresentar o sistema.
-- =====================================================================

alter table public.salons add column if not exists is_platform_demo boolean not null default false;

-- Abre (e cria na primeira vez) o salão de demonstração do super admin que chamou.
create or replace function public.platform_demo_salon()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.assert_platform_admin();

  select s.id into v_id
    from public.salons s
    join public.salon_members m on m.salon_id = s.id
   where s.is_platform_demo and m.user_id = auth.uid() and m.active and m.role = 'admin'
   order by s.created_at
   limit 1;

  if v_id is null then
    insert into public.salons (name, slug, plan_id, onboarding_completed, is_platform_demo)
    values ('Salão Demonstração', public.unique_salon_slug('Salão Demonstração'), 'pro', true, true)
    returning id into v_id;
    insert into public.salon_members (salon_id, user_id, role) values (v_id, auth.uid(), 'admin');
    perform public.seed_demo_salon(v_id);
    perform public.platform_log('criar_demo', v_id, null, '{}');
  end if;

  update public.profiles set current_salon_id = v_id where id = auth.uid();
  return v_id;
end $$;

revoke execute on function public.platform_demo_salon() from public, anon;
grant execute on function public.platform_demo_salon() to authenticated;
