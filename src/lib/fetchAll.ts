// Helpers to defeat PostgREST's default 1000-row response cap.
//
// A plain `.select()` that the code then sums/iterates as if complete is a
// silent-truncation bug: for a vendor with >1000 matching rows only the first
// 1000 come back, so totals are wrong with no error. These page through the
// full result set in batches.
//
// IMPORTANT: the buildQuery callback MUST apply a UNIQUE ordering (e.g.
// `.order('id')`) so offset `.range()` pagination is stable — without a unique
// tiebreaker, ties have no defined order across batches and rows get
// duplicated/dropped.

type PageResult<T> = { data: T[] | null; error: any }

/** Page a single list query in `pageSize` batches until exhausted. */
export async function fetchAllRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  // Hard stop well above any realistic dataset, guards against an accidental
  // non-terminating page (e.g. a full page that never shrinks).
  const MAX_PAGES = 1000
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

/**
 * Fetch rows filtered by a large `id` list. A `.in()` with thousands of ids
 * builds an over-long URL and still hits the 1000-row cap, so chunk the id list
 * AND page each chunk's result. buildQuery receives the id chunk + range.
 */
export async function fetchAllByIds<T = any>(
  ids: string[],
  buildQuery: (idChunk: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
  chunkSize = 300,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const rows = await fetchAllRows<T>((f, t) => buildQuery(chunk, f, t), pageSize)
    all.push(...rows)
  }
  return all
}
