-- Suporte: o super admin vê a operação de qualquer salão, só para leitura.
--
-- O super admin conta como administrador do salão apenas dentro de transações READ ONLY.
-- O PostgREST abre READ ONLY para toda leitura (GET) e para funções STABLE; qualquer escrita
-- roda numa transação de escrita, onde ele continua sem papel no salão. E, mesmo que algo
-- escapasse, o próprio Postgres recusa escrita numa transação READ ONLY.

create or replace function public.salon_role_of(p_salon_id uuid)
returns public.salon_role language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.role
       from public.salon_members m
       join public.salons s on s.id = m.salon_id
      where m.salon_id = p_salon_id
        and m.user_id = auth.uid()
        and m.active
        and s.suspended_at is null),
    case
      when current_setting('transaction_read_only', true) = 'on'
       and public.is_platform_admin()
       and exists (select 1 from public.salons where id = p_salon_id)
      then 'admin'::public.salon_role
    end
  )
$$;

-- Cada entrada do suporte num salão fica no histórico do Painel.
create or replace function public.platform_view_salon(p_salon_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_platform_admin();
  if not exists (select 1 from public.salons where id = p_salon_id) then
    raise exception 'Salão não encontrado';
  end if;
  perform public.platform_log('ver_operacao', p_salon_id, null, '{}'::jsonb);
end $$;
revoke execute on function public.platform_view_salon(uuid) from public, anon;
grant execute on function public.platform_view_salon(uuid) to authenticated;
