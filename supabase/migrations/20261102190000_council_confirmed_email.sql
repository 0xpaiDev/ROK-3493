-- Ticket 04 review fix: a Council write needs a confirmed email.
-- The JWT's email claim alone is not enough: an unconfirmed account (password sign-up, another
-- provider) could carry a Council email. Look the user up and require email_confirmed_at.
create or replace function public.is_council()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join council_member m on m.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.is_council() from public, anon;
grant execute on function public.is_council() to authenticated;
