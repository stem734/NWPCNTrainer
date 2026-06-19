// Supabase connection for the S1 Hotspot Training app.
// Shares the MyMedInfo Supabase project. The publishable (anon) key is designed
// to be exposed in the browser — data access is governed by Row Level Security.
window.TRAINER_CONFIG = {
  supabaseUrl: "https://dleljrtcfvgibrqwivue.supabase.co",
  supabaseKey: "sb_publishable_vft4KvzTFzSRJC-tIYrnbQ_KUSHm3Ie",
  table: "training_pages",
  bucket: "training-images"
};
