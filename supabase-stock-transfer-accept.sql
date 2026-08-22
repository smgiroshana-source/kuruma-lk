-- ─────────────────────────────────────────────────────────────────────────────
-- Stock transfer: the receiving shop accepts or rejects
--
-- Until now a transfer landed in the other shop's catalogue silently — stock
-- appeared, a product could be created, and nobody there was told. The
-- receiving shop had no say and no notice.
--
-- Now a send puts the goods IN TRANSIT: they leave the sender's shelf
-- immediately (they physically have) but do not reach the destination until
-- someone there accepts. Accept lands the stock; reject sends it back to the
-- sender, quantity and FIFO cost intact.
--
-- Why the snapshot: the destination product is created at ACCEPT time, which
-- may be days after the send. Reading the source product then would copy
-- whatever it has been edited to since — or fail outright if it was removed.
-- The row it had at send time is stored instead, so what arrives is what was
-- sent.
--
-- Why the batch: a transfer is a physical box. The receiver accepts the box,
-- not each line in it, so every line of one send shares a batch_id.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.stock_transfers
  add column if not exists status           text not null default 'pending',
  add column if not exists batch_id         uuid,
  add column if not exists product_snapshot jsonb,
  add column if not exists moved_unit_cost  integer,
  add column if not exists accepted_at      timestamptz,
  add column if not exists accepted_by      uuid references auth.users(id),
  add column if not exists rejected_at      timestamptz,
  add column if not exists rejected_by      uuid references auth.users(id),
  add column if not exists reject_reason    text,
  add column if not exists reversed_at      timestamptz,
  add column if not exists reversed_by      uuid references auth.users(id),
  -- Set at accept time: did accepting CREATE the destination product, or top
  -- up one they already stocked? A reversal removes a product that only ever
  -- existed because of this transfer, but must never remove one they had.
  add column if not exists created_dest_product boolean;

-- Any row written under the old straight-through behaviour already reached the
-- destination, so it is accepted, not pending. (There are none today — the
-- marketplace-wide SKU rule meant no transfer ever completed — but this must
-- stay correct if it is ever run against a database where some did.)
update public.stock_transfers
   set status = 'accepted', accepted_at = coalesce(accepted_at, transferred_at)
 where status = 'pending' and to_product_id is not null;

alter table public.stock_transfers drop constraint if exists stock_transfers_status_check;
alter table public.stock_transfers add constraint stock_transfers_status_check
  check (status in ('pending', 'accepted', 'rejected', 'reversed'));

-- The receiving shop's "what's waiting for me" query
create index if not exists idx_stock_transfers_incoming
  on public.stock_transfers (to_vendor_id, status, transferred_at desc);

create index if not exists idx_stock_transfers_batch
  on public.stock_transfers (batch_id);

comment on column public.stock_transfers.status is
  'pending = in transit, off the sender''s shelf and not yet on the receiver''s. accepted = landed. rejected = the receiver sent it back. reversed = the sender undid it; nothing moved.';

-- ── Verify ──
select status, count(*) from public.stock_transfers group by status;
