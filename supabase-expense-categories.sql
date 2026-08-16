-- ─────────────────────────────────────────────────────────────────────────────
-- Expense categories the operator actually uses
--
-- The table was created with a CHECK constraint listing ten accountant-style
-- categories. The shop's own list — Grocery, Electricity, Water, Stationery,
-- Internet, Transport — would be rejected by Postgres no matter what the API
-- allowed, so the constraint has to be replaced, not just the app's list.
--
-- Legacy values stay valid: old rows must not become unsaveable.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.expenses drop constraint if exists expenses_category_check;

alter table public.expenses add constraint expenses_category_check check (
  category in (
    -- the operator's list
    'grocery', 'rent', 'electricity', 'water', 'stationery',
    'internet', 'transport', 'repairs', 'maintenance', 'other',
    -- written by Staff/HR, never picked by hand
    'salaries',
    -- legacy values already in the table
    'utilities', 'fuel', 'bank_charges', 'tax', 'petty_cash',
    'consumables', 'tools', 'insurance', 'advertising'
  )
);

select 'expense categories updated' as status;
