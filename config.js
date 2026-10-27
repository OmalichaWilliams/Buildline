// Supabase connection for the standalone app.
// Project > Settings > API: copy the Project URL and the anon public key.
// The anon key is meant to be public; the access rules in supabase/schema.sql protect the data.
// Leave the placeholders in place to run the page with example data only.
window.SDQ_CONFIG = {
  supabaseUrl: 'YOUR_SUPABASE_URL',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
};
