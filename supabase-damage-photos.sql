-- ─────────────────────────────────────────────────────────────────────────────
-- Damage photos — WHEEL MART (owner, 2026-10-01)
--
-- A product photo can now be flagged as a DAMAGE photo: taken with the
-- camera or picked from the gallery on the stock count's damage window, or an
-- existing product photo marked as showing the damage. Customers see them on
-- the storefront after the ordinary photos, tagged DAMAGE; the cover photo is
-- never a damage photo; product cards carry a "Damage photos" tag.
--
-- New columns only; existing photos are ordinary (false). Storefront reads of
-- product_images keep working unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.product_images add column if not exists is_damage        boolean not null default false;
alter table public.product_images add column if not exists damage_marked_at timestamptz;
-- Set when the part is marked Repaired: the photo stays as staff history
-- ("before repair") but is no longer shown to customers
alter table public.product_images add column if not exists damage_resolved_at timestamptz;

select 'damage photo flag added' as status;
