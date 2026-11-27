// 벨라꼬붕 도우미: 화면 왼쪽 아래 캐릭터. 누르면 오른쪽 대화창이 열리고, 질문의 키워드로 helper-data.js 의 답을 골라 보여 준다.
// 넓은 화면은 상반신, 좁은 화면(노트북 · 휴대폰)은 동그란 얼굴 버튼. 머리 위엔 한 줄 말풍선(say)만 — 대화는 전부 오른쪽 창.
// 대화창 자리: 넓은 화면 = 오른쪽 아래 창, 폰 폭(700px 미만) = 화면 아래에서 올라오는 판. 설정 도우미(setup-helper.js) 창도 같은 자리 · 하나만 열림.
(() => {
  const D = window.HELPER_DATA;
  if (!D) return;
  const IMG = { basic: "assets/helper/basic.webp", smile: "assets/helper/smile.webp", trouble: "assets/helper/trouble.webp" };
  Object.values(IMG).forEach((src) => { const i = new Image(); i.src = src; });   // 표정 바꿀 때 깜빡임 방지

  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
  const norm = (t) => String(t).toLowerCase().replace(/[\s.,!?~·'"()\-_/]/g, "");

  const root = document.createElement("div");
  root.className = "helper";
  root.innerHTML = `
    <button class="helper-char" aria-label="벨라꼬붕 도우미 열기"><img alt="" src="${IMG.basic}"></button>
    <button class="helper-face" aria-label="벨라꼬붕 도우미 열기"></button>
    <button class="helper-say" hidden></button>
    <section class="helper-box" role="dialog" aria-label="벨라꼬붕 도우미" hidden>
      <header><span class="helper-face small" aria-hidden="true"></span><b>벨라꼬붕</b><span class="muted small">도우미</span>
        <button class="helper-close" aria-label="닫기">✕</button></header>
      <div class="helper-log"></div>
      <form class="helper-ask"><input placeholder="무엇이 궁금하세요? (예: 컷 시간 고치기)" maxlength="80"><button class="primary">보내기</button></form>
    </section>`;
  document.body.appendChild(root);
  // 대화창 자리 (도우미 · 설정 도우미 같이): 왼쪽 벨라 · 왼쪽 화면을 안 가리게 오른쪽, 폰 폭은 아래에서 올라오는 판
  const css = document.createElement("style");
  css.textContent = `
    .helper > .helper-box, .setup-box { left: auto; right: 16px; bottom: 16px; top: auto; width: 420px; max-width: calc(100vw - 32px); max-height: min(80vh, 680px); z-index: 60; }
    .helper-say { position: fixed; left: 16px; z-index: 55; max-width: min(260px, calc(100vw - 32px)); padding: 6px 12px; border-radius: 14px;
      background: var(--panel-2); border: 1px solid var(--accent); color: var(--text); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      box-shadow: 0 4px 16px rgba(0,0,0,.45); cursor: pointer; animation: helper-pop .25s ease; }
    .helper-say::after { content: ""; position: absolute; left: 22px; bottom: -6px; width: 10px; height: 10px; background: var(--panel-2);
      border-right: 1px solid var(--accent); border-bottom: 1px solid var(--accent); transform: rotate(45deg); }
    .helper-say[hidden] { display: none; }
    .helper-msg .helper-sup { padding: 8px 0 0; border-top: 0; }
    @keyframes helper-pop { from { opacity: 0; transform: translateY(6px); } }
    @keyframes helper-up { from { transform: translateY(100%); } }
    @media (max-width: 699px) {
      .helper > .helper-box, .setup-box { left: 0; right: 0; bottom: 0; width: auto; max-width: none; max-height: 82vh; border-radius: 16px 16px 0 0;
        border-bottom: 0; animation: helper-up .22s ease; }
    }`;
  document.head.appendChild(css);
  const sayEl = root.querySelector(".helper-say");
  let sayText = "", sayFn = null;
  // 말풍선 자리: 보이는 캐릭터(상반신 또는 얼굴 버튼) 머리 바로 위
  function placeSay() {
    const who = [...root.querySelectorAll(".helper-char, .helper-face:not(.small)")].find((x) => x.offsetParent !== null || getComputedStyle(x).display !== "none");
    if (!who) return;
    const r = who.getBoundingClientRect();
    const top = who.classList.contains("helper-char") ? r.top + r.height * 0.06 : r.top;   // 상반신은 그림 위 여백만큼 내림
    sayEl.style.bottom = `${Math.max(8, innerHeight - top + 8)}px`;
    sayEl.style.left = `${Math.max(8, r.left + 10)}px`;
  }
  function anyOpen() { return !box.hidden || !!document.querySelector(".setup-box:not([hidden])"); }
  function showSay() { sayEl.hidden = !sayText || anyOpen(); if (!sayEl.hidden) placeSay(); }
  sayEl.onclick = () => { if (sayFn) sayFn(); else open(); };
  addEventListener("resize", () => { if (!sayEl.hidden) placeSay(); });
  const box = root.querySelector(".helper-box"), log = root.querySelector(".helper-log"), input = root.querySelector("input");

  function mood(m) {
    const src = IMG[m] || IMG.basic;
    root.querySelector(".helper-char img").src = src;
    root.querySelectorAll(".helper-face").forEach((f) => (f.style.backgroundImage = `url("${src}")`));
  }
  mood("basic");

  function bubble(html, who = "bot") {
    const el = document.createElement("div");
    el.className = "helper-msg " + who;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function chips() {
    const list = D.items.filter((i) => i.chip);
    const sup = D.support ? `<button data-sup="1">${esc(D.support.chip)}</button>` : "";
    const el = bubble(`<div class="helper-chips">${sup}${list.map((i) => `<button data-id="${i.id}">${esc(i.chip)}</button>`).join("")}</div>`, "chips");
    el.onclick = (e) => {
      if (e.target.closest("button[data-sup]")) { bubble(esc(D.support.chip), "me"); support(); return; }
      const b = e.target.closest("button[data-id]"); if (!b) return;
      const it = D.items.find((i) => i.id === b.dataset.id);
      bubble(esc(it.chip), "me"); answer(it);
    };
  }

  // ---------- 🛟 원격지원 요청 (로그인 필요 · 보내기만, 답은 안 기다림) ----------
  // 서버(SQL 함수 web_support_request(page, msg))로만 보냄 — 층 구분: 앱은 보내고 성공 · 실패만 보여 줌.
  // 로그인은 관리자 웹(index)과 같은 Supabase 디스코드 로그인. 설치 안내 페이지에서 누르면 index 에서 로그인하고, index 도우미가 이어서 받음.
  const SUP_KEY = "helper_support";
  const pageName = () => (location.pathname.split("/").pop() || "index.html") + (location.hash || "");
  let sbLite = null;
  function loadScript(src) {
    return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  }
  async function getSb() {
    if (window.BELLA_WEB && window.BELLA_WEB.sb) return window.BELLA_WEB.sb;      // 관리자 웹: app.js 와 같은 연결
    if (sbLite) return sbLite;
    if (!window.supabase) await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js");
    if (!window.BOT_CONFIG) await loadScript("config.js");
    sbLite = window.supabase.createClient(window.BOT_CONFIG.SUPABASE_URL, window.BOT_CONFIG.SUPABASE_ANON_KEY);
    return sbLite;
  }
  async function support(page = pageName()) {
    const S = D.support;
    let sb, session = null;
    try { sb = await getSb(); session = (await sb.auth.getSession()).data.session; }
    catch (e) { mood("trouble"); bubble(md(S.fail)); return; }
    if (!session) {
      const el = bubble(`${md(S.login)}<div class="helper-go"><button class="primary" data-login="1">${esc(S.loginBtn)}</button></div>`);
      el.querySelector("[data-login]").onclick = () => {
        try { localStorage.setItem(SUP_KEY, JSON.stringify({ page, t: Date.now() })); } catch (e) {}
        sb.auth.signInWithOAuth({ provider: "discord", options: { redirectTo: new URL("./", location.href).href } });
      };
      return;
    }
    const el = bubble(`${md(S.ask)}<form class="helper-ask helper-sup"><input maxlength="200" placeholder="${esc(S.placeholder)}"><button class="primary">${esc(S.send)}</button></form>`);
    const f = el.querySelector("form"), inp = f.querySelector("input");
    inp.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const msg = inp.value.trim(); if (!msg) return;
      f.querySelector("button").disabled = true;
      const { error } = await sb.rpc("web_support_request", { page: page.slice(0, 80), msg: msg.slice(0, 200) });
      if (error) {
        f.querySelector("button").disabled = false; mood("trouble");
        // 로그인이 풀린 채로 부르면 서버가 영어 'permission denied …' 를 돌려줌 → 로그인 안내로 바꿔 보여 줌
        const why = /permission denied/i.test(error.message || "") ? S.login : String(error.message || "").replace(/^오류:\s*/, "");
        bubble(md(`${S.fail}${why ? "\n" + why : ""}`)); return;
      }
      f.remove(); bubble(esc(msg), "me"); mood("smile");
      try { localStorage.removeItem(SUP_KEY); } catch (e) {}
      const back = page !== pageName() ? `<div class="helper-go"><button data-href="${esc(page)}">${esc(S.back)} →</button></div>` : "";
      const done = bubble(md(S.sent) + back);
      const bb = done.querySelector("[data-href]"); if (bb) bb.onclick = () => (location.href = bb.dataset.href);
    };
  }
  function supportResume() {     // 로그인하고 돌아온 뒤: 누른 페이지 이름 그대로 이어서 (10분 안)
    let v = null;
    // 표시는 보내기 성공 · 창 닫기 때 지움 (로그인 직후 페이지가 한 번 더 새로 열려도 이어지게)
    try { v = JSON.parse(localStorage.getItem(SUP_KEY) || "null"); } catch (e) {}
    if (!v || !D.support) return;
    if (Date.now() - (v.t || 0) > 600e3) { try { localStorage.removeItem(SUP_KEY); } catch (e) {} return; }
    open(); bubble(esc(D.support.chip), "me"); support(String(v.page || pageName()));
  }

  function goTab(tab) {
    if (!document.querySelector("#tabs")) { location.href = `./#${tab}`; return; }     // 설치 안내 같은 따로 페이지: 관리자 웹 그 탭으로
    const b = document.querySelector(`#tabs button[data-tab="${tab}"]`);
    if (!b || document.querySelector("#main")?.hidden) {
      bubble("먼저 디스코드로 로그인해 주세요. 로그인하면 그 화면으로 바로 갈 수 있어요.");
      return;
    }
    b.click();
    if (innerWidth < 900) close();
  }
  function answer(it) {
    mood(it.mood || "basic");
    const el = bubble(md(it.say) + (it.go ? `<div class="helper-go">${it.go.map(([label, tab]) => `<button data-tab="${tab}">${esc(label)} →</button>`).join("")}</div>` : ""));
    el.onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) goTab(b.dataset.tab); };
  }
  function find(q) {
    const s = norm(q);
    let best = null, score = 0;
    for (const it of D.items) {
      let sc = 0;
      for (const k of it.keys) if (s.includes(norm(k))) sc += norm(k).length;
      if (sc > score) { best = it; score = sc; }
    }
    return best;
  }

  let started = false;
  function open() {
    if (window.SetupHelper) window.SetupHelper.close();      // 오른쪽 창은 하나만
    box.hidden = false; root.classList.add("open"); sayEl.hidden = true;
    if (!started) { started = true; mood("smile"); bubble(md(D.hello)); chips(); }
    input.focus();
  }
  function close() { try { localStorage.removeItem(SUP_KEY); } catch (e) {} box.hidden = true; root.classList.remove("open"); showSay(); }
  root.querySelectorAll(".helper-char, .helper-face:not(.small)").forEach((b) => (b.onclick = () => (box.hidden ? open() : close())));
  root.querySelector(".helper-close").onclick = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) close(); });

  // 다른 파일(설정 도우미)이 부름: say(글, 누르면 할 일) — 글이 비면 말풍선 숨김. sync() = 창 열림 · 닫힘 뒤 말풍선 다시 맞춤
  window.BellaHelper = { open, close, sync: showSay, say(text, fn) { sayText = text || ""; sayFn = fn || null; sayEl.textContent = sayText; sayEl.title = sayText; showSay(); } };

  root.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return;
    input.value = "";
    bubble(esc(q), "me");
    const it = find(q);
    const sc = (x) => (x ? x.keys.reduce((n, k) => n + (norm(q).includes(norm(k)) ? norm(k).length : 0), 0) : 0);
    if (D.support && sc(D.support) > 0 && sc(D.support) >= sc(it)) support();      // '원격지원' 같은 말 → 바로 요청 받기
    else if (it) answer(it);
    else { mood("trouble"); bubble(md(D.fallback)); chips(); }
  };
  setTimeout(supportResume);
})();
