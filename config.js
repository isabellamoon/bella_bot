// Supabase 연결 정보 — 둘 다 공개용 값이라 웹에 들어가도 괜찮다.
// 실제 보호는 Supabase 보안 규칙(봇 저장소의 web/supabase_policies.sql)이 한다.
// ANON_KEY: Supabase → Project Settings → API Keys 의 publishable(anon) 키
window.BOT_CONFIG = {
  SUPABASE_URL: "https://gbovxjwfcuvcpoqmexeg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_YDaJXmgQoK0850AKjenZAw_qxRxhuFD",
};
