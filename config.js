// 应用配置（联网同步用）
// 复用现有 lifeisprg 项目的 Supabase（无需新建项目、无需任何手动操作）。
// 同步机制：ledgers 表里一个保留行承载整份数据的 JSON 大字段，多端共享同一份（军机处模型）。
// anon/public key 可放前端；表已开启 anon 读写权限。
window.APP_CONFIG = {
  SUPABASE_URL: "https://gcwehwqcccmjxrqtolev.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdjd2Vod3FjY2NtanhycXRvbGV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MTQzNDAsImV4cCI6MjEwMDE5MDM0MH0.X0X-75d1wPSTXECZDRVtkWVyDaj9ot9JLp_Qc2YamB8"
};
