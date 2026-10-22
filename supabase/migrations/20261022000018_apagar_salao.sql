-- Apagar um salão apaga a equipe em cascata; nesse caso não há salão para proteger.
create or replace function public.guard_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid := coalesce(old.salon_id, new.salon_id);
begin
  if not exists (select 1 from public.salons where id = v_salon) then
    return coalesce(new, old);
  end if;
  if (tg_op = 'DELETE' and old.role = 'admin' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)) then
    if not exists (
      select 1 from public.salon_members
      where salon_id = v_salon and role = 'admin' and active and id <> old.id
    ) then
      raise exception 'O salão precisa de pelo menos um administrador ativo';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- Na exclusão em cascata de um salão, o histórico dele some junto; não há o que registrar.
create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  if not exists (select 1 from public.salons where id = (v_row ->> 'salon_id')::uuid) then
    return coalesce(new, old);
  end if;
  insert into public.audit_log (salon_id, table_name, record_id, action, old_data, new_data, changed_by)
  values (
    (v_row ->> 'salon_id')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end $$;
