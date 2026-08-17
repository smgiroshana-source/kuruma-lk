-- Commission joins the expense categories (broker/introducer payments).
-- Repair leaves the picker — it folds into Maintenance — but stays valid
-- here so every existing 'repairs' row keeps saving.

alter table public.expenses drop constraint if exists expenses_category_check;

alter table public.expenses add constraint expenses_category_check check (
  category in (
    -- the operator's list
    'grocery', 'rent', 'electricity', 'water', 'stationery',
    'internet', 'transport', 'maintenance', 'commission', 'other',
    -- written by Staff/HR, never picked by hand
    'salaries',
    -- legacy values already in the table
    'repairs', 'utilities', 'fuel', 'bank_charges', 'tax', 'petty_cash',
    'consumables', 'tools', 'insurance', 'advertising'
  )
);

select 'commission category added' as status;
