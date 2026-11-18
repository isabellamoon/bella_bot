// Supabase 연결 정보 — 둘 다 공개용 값이라 웹에 들어가도 괜찮다.
// 실제 보호는 Supabase 보안 규칙(봇 저장소의 web/supabase_policies.sql)이 한다.
// ANON_KEY: Supabase → Project Settings → API Keys 의 publishable(anon) 키
window.BOT_CONFIG = {
  SUPABASE_URL: "https://gbovxjwfcuvcpoqmexeg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_YDaJXmgQoK0850AKjenZAw_qxRxhuFD",
  // 구글 시트 연결 (구글 클라우드 OAuth 클라이언트 ID — 공개용 값. 비밀 키는 봇에만 있음)
  GOOGLE_CLIENT_ID: "322156824935-ofn80m3tt3o485oqveodi0omd7c0lel7.apps.googleusercontent.com",
  GOOGLE_REDIRECT: "https://isabellamoon.github.io/bella_bot/google.html",   // 구글 클라우드에 등록한 리디렉션 URI 와 똑같아야 함
};
