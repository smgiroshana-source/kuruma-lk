-- ─────────────────────────────────────────────────────────────────────────────
-- Staff log in with a username, not an email
--
-- Shop staff often have no email address, and typing one on a busy counter is
-- error-prone. Supabase Auth still needs an email underneath, so each staff
-- login keeps one (a real address when they have it, otherwise a generated
-- placeholder) — but nobody types it. They type "sajith".
--
-- Usernames are matched case-insensitively and must be unique across the whole
-- system, because the login page is shared by every shop.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.vendor_staff
  add column if not exists username text;

create unique index if not exists vendor_staff_username_uniq
  on public.vendor_staff (lower(username)) where username is not null;

comment on column public.vendor_staff.username is
  'Login name typed by staff. The auth email underneath is never typed by them.';

select 'staff usernames ready' as status;
