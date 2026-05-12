import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY
)

// Supabase caps responses at 1000 rows (PostgREST max-rows). This fetches all pages.
export async function fetchAllScores(columns = 'call_id, parameter, score, max_score') {
  const PAGE = 1000
  let page = 0, all = []
  while (true) {
    const { data, error } = await supabase
      .from('scores')
      .select(columns)
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error || !data?.length) break
    all = all.concat(data)
    if (data.length < PAGE) break
    page++
  }
  return all
}
