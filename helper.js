// 벨라꼬붕 도우미: 화면 왼쪽 아래 캐릭터. 누르면 대화창이 열리고, 질문의 키워드로 helper-data.js 의 답을 골라 보여 준다.
// 넓은 화면은 상반신, 좁은 화면(노트북 · 휴대폰)은 동그란 얼굴 버튼.
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
    <section class="helper-box" role="dialog" aria-label="벨라꼬붕 도우미" hidden>
      <header><span class="helper-face small" aria-hidden="true"></span><b>벨라꼬붕</b><span class="muted small">도우미</span>
        <button class="helper-close" aria-label="닫기">✕</button></header>
      <div class="helper-log"></div>
      <form class="helper-ask"><input placeholder="무엇이 궁금하세요? (예: 컷 시간 고치기)" maxlength="80"><button class="primary">보내기</button></form>
    </section>`;
  document.body.appendChild(root);
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
    const el = bubble(`<div class="helper-chips">${list.map((i) => `<button data-id="${i.id}">${esc(i.chip)}</button>`).join("")}</div>`, "chips");
    el.onclick = (e) => {
      const b = e.target.closest("button[data-id]"); if (!b) return;
      const it = D.items.find((i) => i.id === b.dataset.id);
      bubble(esc(it.chip), "me"); answer(it);
    };
  }
  function goTab(tab) {
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
    box.hidden = false; root.classList.add("open");
    if (!started) { started = true; mood("smile"); bubble(md(D.hello)); chips(); }
    input.focus();
  }
  function close() { box.hidden = true; root.classList.remove("open"); }
  root.querySelectorAll(".helper-char, .helper-face:not(.small)").forEach((b) => (b.onclick = () => (box.hidden ? open() : close())));
  root.querySelector(".helper-close").onclick = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) close(); });

  root.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return;
    input.value = "";
    bubble(esc(q), "me");
    const it = find(q);
    if (it) answer(it);
    else { mood("trouble"); bubble(md(D.fallback)); chips(); }
  };
})();
