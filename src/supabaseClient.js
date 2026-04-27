// ============================================================
// CLIENTE SUPABASE
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qvpogfucymxuefwswaig.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CYG400Cc_rZzNDFpOttWMw_zi5UsF6c";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
