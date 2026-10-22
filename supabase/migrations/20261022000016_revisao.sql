-- Revisão antes do merge em main.

-- 1. O esperado do caixa só responde para quem vê o caixa (admin e recepção do salão).
create or replace function public.cash_session_expected(p_session_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select s.opening_amount
    + coalesce((select sum(amount) from public.order_payments
                where cash_session_id = s.id and kind = 'dinheiro'), 0)
    + coalesce((select sum(case when kind = 'suprimento' then amount else -amount end)
                from public.cash_movements where cash_session_id = s.id), 0)
  from public.cash_sessions s
  where s.id = p_session_id
    and (auth.uid() is null or public.is_salon_staff(s.salon_id))
$$;

-- 2. Lista de espera: "a partir de hoje" no fuso do salão, não no fuso do servidor (UTC).
alter table public.waitlist alter column date_from drop default;

create or replace function public.waitlist_default_date()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.date_from is null then
    select (now() at time zone timezone)::date into new.date_from from public.salons where id = new.salon_id;
  end if;
  return new;
end $$;
revoke execute on function public.waitlist_default_date() from public, anon, authenticated;

create trigger trg_waitlist_default_date before insert on public.waitlist
  for each row execute function public.waitlist_default_date();
