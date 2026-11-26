// 🧭 설정 도우미: 벨라가 객관식 · 단답형으로 묻고, 끝에 '이렇게 바꿀게요' 요약 → [적용] 해야 저장. AI 아님.
// 질문 흐름은 setup-flows.js (데이터). 여기는 ① 흐름 돌리는 엔진(SetupCore, 화면 · DB 없음) ② 웹 화면 ③ 웹 저장.
// 저장은 각 설정 카드와 똑같이 boss_settings 한 줄 upsert (같은 RLS · 관리자만). app.js 가 window.BELLA_WEB 으로 함수 · 상수를 빌려줌.
(() => {
  // ================= ① 엔진 (플랫폼 무관: 디스코드 · 카톡 봇도 같은 규칙으로 옮기면 됨) =================
  // ctx = { cur: 지금 설정 한 줄, src: { 소스이름: [{value,label}] }, k: { 상수이름: 값 }, ops: { cats(names) → {value}|{err} } }
  function SetupCore(flow, ctx) {
    const K = (v) => (typeof v === "string" && v.startsWith("$") ? ctx.k[v.slice(1)] : v);
    const sub = (t) => String(t ?? "").replace(/\$(\w+)/g, (m, n) => (n in ctx.k ? (Array.isArray(ctx.k[n]) ? ctx.k[n].join(", ") : String(ctx.k[n])) : m));
    const steps = flow.steps;
    const ans = {};            // 단계 id → { value, label, patch, line }
    let i = -1, hist = [];
    const same = (x) => (x && typeof x === "object" ? JSON.stringify(x) : String(x ?? ""));
    const ok = (s) => !s.when || (ans[s.when.step] && s.when.in.includes(ans[s.when.step].value));
    const listOf = (field, def) => {
      const raw = ctx.cur[field];
      if (raw == null || raw === "") return [].concat(K(def) ?? []);
      try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : [].concat(K(def) ?? []); } catch { return [].concat(K(def) ?? []); }
    };
    const labelOf = (srcName, v) => (ctx.src[srcName] || []).find((x) => String(x.value) === String(v))?.label ?? String(v);
    function curText(c) {
      if (!c) return "";
      const v = ctx.cur[c.field] ?? c.def;
      if (c.map) return c.map[v] ?? String(v ?? "");
      if (c.names) { const l = ctx.ops.catNames(ctx.cur[c.field]); return l.length ? l.join(" · ") : "없음"; }
      if (c.fmt === "cp") return ctx.cur.cp_start && ctx.cur.cp_days > 0 ? `${ctx.cur.cp_start}부터 ${ctx.cur.cp_days}일마다` : "자동 주기 꺼짐";
      if (c.fmt === "days") return +v > 0 ? `${v}일` : "꺼짐";
      if (c.fmt === "days0") return +v ? `${v}일마다` : "끔";
      if (c.fmt === "board") return listOf(c.field, "$board_rec").map((k) => labelOf("board_items", k)).join(" · ") + (ctx.cur[c.field] ? "" : " (추천)");
      if (c.fmt === "build") return v ? labelOf("builds_" + (c.field.includes("win") ? "win" : "mobile"), v) : "내보내지 않음";
      return String(v ?? "");
    }
    function goNext() {
      for (let j = i + 1; j < steps.length; j++) if (ok(steps[j])) { i = j; return; }
      i = steps.length;
    }
    // 지금 물을 것 (화면이 그리기만 하면 되게 다 풀어 줌)
    function view() {
      if (i >= steps.length) return { kind: "summary", ...summary() };
      const s = steps[i];
      const base = { kind: s.type, id: s.id, ask: sub(s.ask), now: curText(s.cur), canBack: hist.length > 0 };
      if (s.type === "choice") {
        const fromSrc = (ctx.src[s.from] || []).map((x) => ({ label: x.label, value: x.value }));
        return { ...base, options: [...fromSrc, ...(s.options || [])].map((o, n) => ({ n, label: o.label, input: o.input || null })) };
      }
      if (s.type === "numbers") {      // 항목마다 숫자 (비우면 기본값)
        const now = (ctx.cur[s.field] && typeof ctx.cur[s.field] === "object") ? ctx.cur[s.field] : {};
        return { ...base, items: (ctx.src[s.from] || []).map((x) => ({ ...x, cur: now[x.value] ?? "" })), min: s.min, max: s.max, blank: s.blank, unit: s.unit || "" };
      }
      if (s.type === "multi") {
        const items = (ctx.src[s.from] || []).slice();
        let picked = listOf(s.pick, s.def);
        if (s.from === "board_items") picked = picked.filter((v) => items.some((x) => x.value === v));
        else picked.forEach((v) => { if (!items.some((x) => x.value === v)) items.push({ value: v, label: v }); });   // 목록에 없는 이름(지운 보스 등)도 보이게
        return { ...base, items, picked: [...new Set(picked)].slice(0, s.max || 999), min: s.min || 0, max: s.max || 0, ordered: !!s.ordered,
          quick: (s.quick || []).map((q) => ({ label: q.label, pick: [].concat(K(q.pick) ?? []) })) };
      }
      const d = K(s.def);
      return { ...base, def: d != null && !String(s.def).startsWith("$") ? (ctx.cur[s.def] ?? "") : (d ?? ""), hint: sub(s.hint || ""), long: !!s.long, maxlen: s.maxlen || 0,
        quick: (s.quick || []).map((q) => ({ label: q.label, value: K(q.value) })) };
    }
    function conv(s, v, input) {
      const rule = input || s;
      if (rule.valid === "date") {
        const t = String(v).trim();
        let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/), y, mo, d;
        if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
        else if ((m = t.match(/^(\d{1,2})[-./](\d{1,2})$/))) [y, mo, d] = [+ctx.k.today.slice(0, 4), +m[1], +m[2]];
        else return { err: "날짜는 2026-11-24 또는 11/24 처럼 적어 주세요" };
        const dt = new Date(Date.UTC(y, mo - 1, d));
        if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { err: "없는 날짜예요" };
        return { value: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
      }
      if (rule.valid === "int") {
        const t = String(v).replace(/[^\d-]/g, "");
        if (!/^-?\d+$/.test(t)) return { err: "숫자로 적어 주세요" + (rule.hint ? ` (${rule.hint})` : "") };
        const n = +t;
        if ((rule.min != null && n < rule.min) || (rule.max != null && n > rule.max)) return { err: `${rule.min} ~ ${rule.max} 사이로 적어 주세요` };
        return { value: n };
      }
      if (rule.valid === "names") return { value: String(v) };
      return { value: v };
    }
    function store(s, value, label, set) {
      let patch = null, line = null;
      if (set) patch = { ...set };
      else if (s.field && value !== undefined) {
        const as = s.as || "str";
        if (as === "map") patch = { [s.field]: value };
        else if (as === "json") patch = { [s.field]: JSON.stringify(value) };
        else if (as === "int") patch = { [s.field]: +value };
        else if (as === "cats") { const r = ctx.ops.cats(value); if (r.err) return r.err; patch = { [s.field]: r.value }; label = r.label; }
        else patch = { [s.field]: value };
      }
      if (patch && s.sum) line = `${s.sum}: ${label}`;
      hist.push({ i, ans: JSON.stringify(ans) });
      ans[s.id] = { value, label, patch, line };
      goNext();
      return null;
    }
    return {
      flow, view, ctx,
      start() { i = -1; hist = []; for (const k in ans) delete ans[k]; goNext(); },
      back() { const h = hist.pop(); if (!h) return; i = h.i; const a = JSON.parse(h.ans); for (const k in ans) delete ans[k]; Object.assign(ans, a); },
      // choice: n = 고른 버튼 번호, text = '직접 적기' 값 / multi: list / text: 적은 글
      answer(x) {
        const s = steps[i];
        if (s.type === "choice") {
          const opts = [...(ctx.src[s.from] || []).map((o) => ({ label: o.label, value: o.value })), ...(s.options || [])];
          const o = opts[x.n];
          if (!o) return "버튼을 다시 눌러 주세요";
          if (o.go) return { go: o.go };
          if (o.end) { hist.push({ i, ans: JSON.stringify(ans) }); i = steps.length; return null; }
          if (o.input) { const r = conv(s, x.text, o.input); if (r.err) return r.err; return store(s, r.value, `${r.value}${s.cur?.fmt?.startsWith("days") ? "일" : ""}`); }
          const v = K(o.value);
          if (o.route || !("value" in o)) { hist.push({ i, ans: JSON.stringify(ans) }); ans[s.id] = { value: K(o.value), label: o.label }; goNext(); return null; }
          return store(s, v, o.label, o.set);
        }
        if (s.type === "numbers") {
          const v = view(), out = {};
          for (const it of v.items) {
            const t = String(x.map?.[it.value] ?? "").trim();
            if (t === "") continue;
            const n = Number(t);
            if (!Number.isFinite(n) || n < v.min || n > v.max) return `'${it.label}' 은(는) ${v.min} ~ ${v.max} 숫자로 적어 주세요`;
            out[it.value] = Math.round(n * 100) / 100;
          }
          const set = v.items.filter((it) => it.value in out);
          const lab = set.length ? set.map((it) => `${it.label} ${out[it.value]}${v.unit}`).join(" · ") + (set.length < v.items.length ? ` (나머지 ${v.blank}${v.unit})` : "") : `전부 ${v.blank}${v.unit}`;
          return store(s, out, lab);
        }
        if (s.type === "multi") {
          const v = view(), list = x.list || [];
          if (list.length < v.min) return `${v.min}개 이상 골라 주세요`;
          if (v.max && list.length > v.max) return `최대 ${v.max}개까지예요`;
          const lab = list.length ? list.map((k) => v.items.find((it) => it.value === k)?.label ?? k).join(" · ") : "(없음)";
          return store(s, list, lab);
        }
        const r = conv(s, x.text);
        if (r.err) return r.err;
        return store(s, r.value, String(r.value));
      },
      summary,
    };
    function summary() {
        const patch = {}, lines = [];
        for (const s of steps) {
          const a = ans[s.id];
          if (!a || !a.patch || !ok(s)) continue;
          // 지금 값과 같은 칸은 빼기 (바뀌는 것만 적용 · 요약에도 바뀌는 것만)
          const diff = Object.entries(a.patch).filter(([k, v]) => same(v) !== same(ctx.cur[k]));
          if (!diff.length) continue;
          Object.assign(patch, Object.fromEntries(diff));
          if (a.line) lines.push(a.line);
        }
        return { patch, lines, canBack: hist.length > 0 };
    }
  }
  window.SetupCore = SetupCore;

  // ================= ② · ③ 웹 화면 + 저장 =================
  const F = window.SETUP_FLOWS, W = () => window.BELLA_WEB;
  if (!F) return;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/\n/g, "<br>");

  const css = document.createElement("style");
  css.textContent = `
    .setup-box { position: fixed; z-index: 60;   /* 자리(오른쪽 창 · 폰 폭은 아래 판)는 helper.js 가 도우미 창과 같이 정함 */
      display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 10px 40px rgba(0,0,0,.5); }
    .setup-box[hidden] { display: none; }
    .setup-box header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .setup-box .helper-log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .setup-ctl { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .setup-ctl button { padding: 5px 11px; font-size: 13px; border-radius: 99px; }
    .setup-ctl button.on { background: var(--accent); color: #1a1033; border-color: var(--accent); }
    .setup-ctl button .ord { font-weight: 700; margin-right: 4px; }
    .setup-ctl form { display: flex; gap: 6px; width: 100%; }
    .setup-ctl input, .setup-ctl textarea { flex: 1; min-width: 0; font: inherit; }
    .setup-ctl form.long { flex-direction: column; } .setup-ctl textarea { min-height: 7em; resize: vertical; }
    .setup-nums { flex-direction: column; } .setup-nums label { display: flex; align-items: center; gap: 6px; font-size: 13px; } .setup-nums input { width: 5.5em; flex: none; }
    .setup-err { color: var(--bad); font-size: 13px; margin-top: 6px; }
    .setup-now { color: var(--muted); font-size: 12.5px; display: block; margin-top: 4px; }
    .setup-sum { margin: 6px 0 0; padding-left: 18px; }
    .setup-done .setup-ctl, .setup-done form { display: none; }
    #btn-setup { margin-left: auto; }`;
  document.head.appendChild(css);

  const box = document.createElement("section");
  box.className = "setup-box"; box.hidden = true;
  box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "설정 도우미");
  box.innerHTML = `<header><span aria-hidden="true">🧭</span><b>설정 도우미</b>
      <button class="helper-close" aria-label="닫기">✕</button></header><div class="helper-log"></div>`;
  document.body.appendChild(box);
  const log = box.querySelector(".helper-log");
  box.querySelector(".helper-close").onclick = () => close();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) close(); });

  // 툴바 버튼: 관리자에게만 (길드원은 설정 탭이 숨겨짐 → 같이 숨김)
  const btn = document.createElement("button");
  btn.id = "btn-setup"; btn.className = "ghost small"; btn.textContent = "🧭 설정 도우미"; btn.hidden = true;
  btn.onclick = () => (box.hidden ? open() : close());
  const tb = document.querySelector("#main .toolbar");
  if (tb) tb.appendChild(btn);
  const syncBtn = () => {
    const st = document.querySelector('#tabs button[data-tab="settings"]');
    btn.hidden = !st || st.hidden || !W();
    if (!box.hidden && !items().length) close();
    saySync();
  };
  // 왼쪽 벨라 머리 위 한 줄 말풍선 (helper.js BellaHelper.say). 관리자 · 길드원마다 F.bubble 말을 번갈아. 누르면 오른쪽 창
  let sayN = 0, sayT = null;
  function saySync() {
    const H = window.BellaHelper; if (!H) return;
    const ready = W() && W().state.me && W().G() && !document.querySelector("#main")?.hidden;
    const lines = !ready ? [] : (F.bubble || []).filter((l) => (l.member || isStaff()) && (!l.needs || window[l.needs]) && items().length);
    clearTimeout(sayT);
    if (!lines.length) return H.say("");
    const l = lines[sayN % lines.length];
    H.say(l.text, () => open(l.flow));
    if (lines.length > 1) sayT = setTimeout(() => { sayN++; saySync(); }, 15000);   // 15초마다 다음 말
  }
  const tabs = document.querySelector("#tabs");
  // 로그인 · 길드 · 역할이 정해질 때마다(탭 숨김 · 우상단 역할 표시 · 본문 열림) 버튼 · 말풍선 다시 맞춤
  const mo = new MutationObserver(() => setTimeout(syncBtn));
  if (tabs) mo.observe(tabs, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  for (const sel of ["#me", "#main"]) { const el = document.querySelector(sel); if (el) mo.observe(el, sel === "#main" ? { attributes: true } : { subtree: true, childList: true, characterData: true, attributes: true }); }
  setTimeout(syncBtn);

  let run = null, gid = null, busy = false;
  function bubble(html, who = "bot") {
    const el = document.createElement("div");
    el.className = "helper-msg " + who;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  const freeze = () => log.querySelectorAll(".helper-msg.bot:not(.setup-done)").forEach((x) => x.classList.add("setup-done"));
  const me = (t) => { freeze(); bubble(esc(t), "me"); };
  const isStaff = () => !!(W() && W().state.me && W().G() && !W().state.member);   // 관리자 (길드 고르기 전 · 길드원은 아님). 저장은 RLS · SQL 이 한 번 더 막음
  // 지금 쓸 수 있는 메뉴: 저장 함수(needs)가 이 페이지에 있고, 관리자 또는 길드원용(member) 갈래만
  const items = () => (W() && W().state.me && W().G() ? F.menu.items.filter((m) => (!m.needs || window[m.needs]) && (m.member || isStaff())) : []);

  function open(flowId) {
    if (!items().length) return;
    if (window.BellaHelper) window.BellaHelper.close();     // 오른쪽 창은 하나만
    box.hidden = false;
    box.querySelector("header b").textContent = isStaff() ? "설정 도우미" : "벨라 도우미";
    if (!log.children.length || gid !== W().G()) { log.innerHTML = ""; bubble(md(isStaff() ? F.hello : F.helloMember || F.hello)); if (!flowId) menu(); }
    if (flowId && items().some((m) => m.flow === flowId) && !run) { freeze(); startFlow(flowId); }
    window.BellaHelper?.sync();
  }
  function close() { box.hidden = true; window.BellaHelper?.sync(); }
  function menu(ask = F.menu.ask) {
    run = null; gid = W().G();
    const el = bubble(`${md(ask)}<div class="setup-ctl">${items().map((m) => `<button data-m="${F.menu.items.indexOf(m)}">${esc(m.label)}</button>`).join("")}</div>`);
    el.onclick = (e) => {
      const b = e.target.closest("[data-m]"); if (!b || el.classList.contains("setup-done")) return;
      const m = F.menu.items[+b.dataset.m];
      me(m.label);
      if (m.soon) { bubble(md(m.soon)); menu("다른 걸 바꿀까요?"); return; }
      startFlow(m.flow);
    };
  }

  // ---------- 웹: 지금 값 · 소스 읽기 (각 카드와 같은 표 · 같은 함수) ----------
  async function loadCtx(flow) {
    const w = W(), sb = w.sb, g = w.G();
    const need = JSON.stringify(flow);
    const [rows, bosses, battle, builds] = await Promise.all([
      flow.load.length ? w.q(sb.from("boss_settings").select(flow.load.join(",")).eq("guild_id", g)) : [],
      /bosses|cat_suggest/.test(need) ? w.q(sb.from("bosses").select("name,display,kind").eq("guild_id", g).order("name")) : [],
      /cat_suggest/.test(need) ? w.q(sb.from("raids").select("id").eq("guild_id", g).eq("category", "battle").limit(1)) : [],
      /builds_/.test(need) ? w.q(sb.rpc("web_vb_builds", { gid: g })).catch(() => []) : [],
    ]);
    let cur = rows[0] || {};
    if (flow.target === "att_score") {      // 평점: JSON 한 칸을 mode · cat · boss · battle 로 풀어서 (저장은 서버가 다시 정리)
      let v; try { v = JSON.parse(cur.att_score || "{}"); } catch { v = {}; }
      const obj = (d) => (d && typeof d === "object" && !Array.isArray(d) ? d : {});
      cur = { mode: v && v.mode === "item" ? "item" : "cat", cat: obj(v && v.cat), boss: obj(v && v.boss), battle: obj(v && v.battle) };
    }
    const catNames = (w.cleanCats(rows[0]?.att_cats) || []).map((c) => c.name);
    const boardLabel = Object.fromEntries(w.FB_GROUPS.flatMap(([, l]) => l));
    const boardOrder = w.FB_GROUPS.flatMap(([, l]) => l.map(([k]) => k));
    let board; try { board = cur.panel_board ? JSON.parse(cur.panel_board) : w.FB_REC.slice(); } catch { board = w.FB_REC.slice(); }
    board = [...new Set(board.map((k) => ({ names: "bossnames", aliases: "bossnames" }[k] || k)).filter((k) => boardLabel[k]))].slice(0, w.FB_MAX);
    const sug = w.suggestCats(bosses, battle.length > 0);
    const bl = (k) => builds.filter((b) => b.path.startsWith(k + "/")).map((b) => ({ value: b.path, label: `${w.buildTag(b.path)} · ${w.mb(b.size)} · ${w.fmtDate(b.uploaded_at)}` }));
    const kp = w.kstParts(new Date().toISOString());
    return {
      cur,
      src: {
        bosses: bosses.map((b) => ({ value: b.name, label: b.display || b.name })),
        battle_types: w.BATTLE_TYPES.map((t) => ({ value: t, label: t })),
        board_items: boardOrder.map((k) => ({ value: k, label: boardLabel[k] })),
        score_cats: (catNames.length ? catNames : ["보스", "전투"]).map((n) => ({ value: n, label: n })),
        builds_win: bl("win"), builds_mobile: bl("mobile"),
      },
      k: {
        farm_default: w.FARM_DEFAULT.slice(), battle_all: w.BATTLE_TYPES.slice(), board_rec: w.FB_REC.slice(),
        score_mode: cur.mode,
        board_grouped: boardOrder.filter((k) => board.includes(k)),
        cat_suggest: sug.map((c) => c.name).join(", "),
        today: `${kp.y}-${String(kp.mo).padStart(2, "0")}-${String(kp.d).padStart(2, "0")}`,
      },
      ops: {
        catNames: (v) => (w.cleanCats(v) || []).map((c) => c.name),
        // 추천 분류에 이름만 바꿔 넣기 → 출석 탭 저장과 같은 검사(cleanCats) 통과해야
        cats(text) {
          const names = String(text).split(/[,，、]/).map((x) => x.replace(/\s+/g, " ").trim());
          if (names.length !== sug.length) return { err: `추천은 ${sug.length}개예요 — 이름도 ${sug.length}개를 쉼표로 적어 주세요` };
          if (names.some((n) => !n)) return { err: "빈 이름이 있어요" };
          if (names.some((n) => n.length > 20)) return { err: "이름은 20자까지예요" };
          const all = sug.map((c, n) => ({ ...c, name: names[n] }));
          const clean = w.cleanCats(all) || [];
          const bad = names.find((n) => !clean.some((c) => c.name === n));
          if (bad !== undefined || clean.length !== all.length) return { err: `'${bad ?? names[0]}' 은(는) 쓸 수 없어요 (이름이 겹치거나 시트 기본 칸 이름)` };
          return { value: JSON.stringify(clean), label: clean.map((c) => c.name).join(" · ") };
        },
      },
    };
  }

  async function startFlow(id) {
    const flow = F.flows[id];
    if (!flow) return;
    const wait = bubble(`<span class="muted">지금 설정을 불러오는 중…</span>`);
    let ctx;
    try { ctx = await loadCtx(flow); } catch (e) { wait.remove(); bubble("지금 설정을 불러오지 못했어요. 잠시 뒤에 다시 해 주세요."); menu("다른 걸 바꿀까요?"); return; }
    wait.remove();
    run = SetupCore(flow, ctx); run.start(); gid = W().G();
    ask();
  }

  // ---------- 화면: 지금 단계 그리기 ----------
  function ask(err) {
    const v = run.view();
    if (v.kind === "summary") return summary(v);
    const back = v.canBack ? `<button data-back>← 뒤로</button>` : "";
    const stop = `<button data-stop>그만두기</button>`;
    let ctl = "";
    if (v.kind === "choice") ctl = v.options.map((o) => `<button data-n="${o.n}">${esc(o.label)}</button>`).join("");
    else if (v.kind === "numbers") {
      ctl = `<form class="setup-nums" novalidate>${v.items.map((it) => `<label>${esc(it.label)} <input type="number" inputmode="decimal" step="0.5" min="${v.min}" max="${v.max}" data-k="${esc(it.value)}" value="${esc(it.cur)}" placeholder="${esc(v.blank)}"> ${esc(v.unit)}</label>`).join("")}
        <button class="primary">다 적었어요</button></form>`;
    } else if (v.kind === "multi") {
      ctl = (v.quick.length ? v.quick.map((q, n) => `<button data-q="${n}">↺ ${esc(q.label)}</button>`).join("") + `<span style="flex-basis:100%"></span>` : "")
        + v.items.map((it) => `<button data-v="${esc(it.value)}">${esc(it.label)}</button>`).join("")
        + `<span style="flex-basis:100%"></span><button class="primary" data-ok>다 골랐어요</button>`;
    } else {
      ctl = (v.quick || []).map((q, n) => `<button data-q="${n}">${esc(q.label)}</button>`).join("")
        + (v.long
          ? `<form class="long"><textarea maxlength="${v.maxlen || 1500}" placeholder="${esc(v.hint || "")}">${esc(v.def)}</textarea><button class="primary">보내기</button></form>`
          : `<form><input maxlength="${v.maxlen || 200}" placeholder="${esc(v.hint || "")}" value="${esc(v.def)}"><button class="primary">보내기</button></form>`);
    }
    const el = bubble(`${md(v.ask)}${v.now ? `<span class="setup-now">지금: ${esc(v.now)}</span>` : ""}
      <div class="setup-ctl">${ctl}</div><div class="setup-ctl">${back}${stop}</div>${err ? `<div class="setup-err">${esc(err)}</div>` : ""}`);
    let picked = v.kind === "multi" ? v.picked.slice() : null;
    const paint = () => {
      if (!picked) return;
      el.querySelectorAll("[data-v]").forEach((b) => {
        const k = picked.indexOf(b.dataset.v);
        b.classList.toggle("on", k >= 0);
        const o = b.querySelector(".ord"); if (o) o.remove();
        if (k >= 0 && v.ordered) b.insertAdjacentHTML("afterbegin", `<span class="ord">${k + 1}</span>`);
      });
      const ok = el.querySelector("[data-ok]");
      if (ok) ok.textContent = `다 골랐어요 (${picked.length}${v.max ? `/${v.max}` : ""}개)`;
    };
    paint();
    const done = () => el.classList.contains("setup-done");
    const reply = (r, said) => {
      if (r && r.go) {
        me(said);
        bubble(`${esc({ attendance: "출석", settings: "설정", vbella: "버추얼 벨라" }[r.go] || r.go)} 탭을 열어 드릴게요. 여기선 아무것도 안 바꿨어요.`);
        goTab(r.go); menu("다른 걸 바꿀까요?"); return;
      }
      if (typeof r === "string") { el.querySelector(".setup-err")?.remove(); el.insertAdjacentHTML("beforeend", `<div class="setup-err">${esc(r)}</div>`); return; }
      me(said); ask();
    };
    el.onclick = (e) => {
      if (done()) return;
      const b = e.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-stop")) { me("그만두기"); bubble("알겠어요, 아무것도 안 바꿨어요."); menu("다른 걸 바꿀까요?"); return; }
      if (b.hasAttribute("data-back")) { me("← 뒤로"); run.back(); ask(); return; }
      if (v.kind === "choice" && b.dataset.n != null) {
        const o = v.options[+b.dataset.n];
        if (o.input) {         // 직접 적기: 이 자리에 입력칸
          el.querySelector(".setup-in")?.remove();
          b.closest(".setup-ctl").insertAdjacentHTML("afterend", `<div class="setup-ctl setup-in"><form><input inputmode="numeric" placeholder="${esc(o.input.hint || "")}"><button class="primary">보내기</button></form></div>`);
          const f = el.querySelector(".setup-in form");
          f.querySelector("input").focus();
          f.onsubmit = (ev) => { ev.preventDefault(); const t = f.querySelector("input").value.trim(); if (t) reply(run.answer({ n: o.n, text: t }), t); };
          return;
        }
        reply(run.answer({ n: o.n }), o.label);
      } else if (v.kind === "multi") {
        if (b.dataset.v != null) {
          const k = picked.indexOf(b.dataset.v);
          if (k >= 0) picked.splice(k, 1);
          else if (v.max && picked.length >= v.max) { reply(`최대 ${v.max}개까지예요`); return; }
          else picked.push(b.dataset.v);
          paint();
        } else if (b.dataset.q != null) { picked = v.quick[+b.dataset.q].pick.filter((x) => v.items.some((it) => it.value === x)); paint(); }
        else if (b.hasAttribute("data-ok")) {
          const lab = picked.length ? picked.map((k) => v.items.find((it) => it.value === k)?.label ?? k).join(" · ") : "(없음)";
          reply(run.answer({ list: picked.slice() }), lab);
        }
      } else if (v.kind === "text" && b.dataset.q != null) {
        const val = String(v.quick[+b.dataset.q].value ?? "");
        reply(run.answer({ text: val }), b.textContent);
      }
    };
    const nums = el.querySelector(".setup-nums");
    if (nums) nums.onsubmit = (e) => {
      e.preventDefault(); if (done()) return;
      const map = Object.fromEntries([...nums.querySelectorAll("input")].map((x) => [x.dataset.k, x.value]));
      const r = run.answer({ map });
      reply(r, typeof r === "string" ? "" : (Object.entries(map).filter(([, t]) => t !== "").map(([k, t]) => `${k} ${t}`).join(" · ") || "(빈칸 그대로)"));
    };
    const form = el.querySelector(".setup-ctl form:not(.setup-nums)");
    if (form) {
      form.onsubmit = (e) => { e.preventDefault(); if (done()) return; const t = form.querySelector("input, textarea").value.trim(); if (t) reply(run.answer({ text: t }), t); };
      form.querySelector("input, textarea").focus();
    }
  }

  function summary(v) {
    if (!Object.keys(v.patch).length) {
      bubble("바뀌는 게 없어요 — 지금 설정 그대로 둘게요.");
      return menu("다른 걸 바꿀까요?");
    }
    const fl = run.flow, okLabel = fl.applyLabel || "✅ 적용";
    const el = bubble(`<b>${esc(fl.sumTitle || "이렇게 바꿀게요")}</b> <span class="muted small">(${esc(fl.title)} · ${esc(fl.sumNote || "길드 전체")})</span>
      <ul class="setup-sum">${v.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <span class="setup-now">${esc(fl.applyHint || "[적용] 을 눌러야 저장돼요.")}</span>
      <div class="setup-ctl"><button class="primary" data-apply>${esc(okLabel)}</button>${v.canBack ? `<button data-back>← 뒤로</button>` : ""}<button data-redo>처음부터</button><button data-stop>그만두기</button></div>`);
    el.onclick = async (e) => {
      const b = e.target.closest("button"); if (!b || el.classList.contains("setup-done") || busy) return;
      if (b.hasAttribute("data-back")) { me("← 뒤로"); run.back(); ask(); return; }
      if (b.hasAttribute("data-redo")) { me("처음부터"); run.start(); ask(); return; }
      if (b.hasAttribute("data-stop")) { me("그만두기"); bubble("알겠어요, 아무것도 안 바꿨어요."); menu("다른 걸 바꿀까요?"); return; }
      if (!b.hasAttribute("data-apply")) return;
      const w = W();
      if ((!isStaff() && !run.flow.member) || w.G() !== gid) { me("적용"); bubble("서버가 바뀌었어요. 처음부터 다시 해 주세요 — 아무것도 안 바꿨어요."); menu(); return; }
      busy = true; b.disabled = true; b.textContent = run.flow.target === "suggest" ? "보내는 중…" : "저장하는 중…";
      try {
        // 설정 카드와 같은 저장: boss_settings 한 줄 upsert (RLS = 관리자만)
        if (run.flow.target === "att_score") {
          // 평점은 SQL web_set_att_score 로만 저장 (관리자 · 숫자 범위를 서버가 검사) — app.js 출석 탭 평점 카드와 같은 함수
          const c = run.ctx.cur;
          await window.bellaSaveAttScore({ mode: c.mode, cat: c.cat, boss: c.boss, battle: c.battle, ...v.patch });
        } else if (run.flow.target === "suggest") {
          // 문의하기 = 디스코드 /건의하기와 같은 저장(suggestions 표, source 'web'). 웹에서 부를 함수가 생기면(브랜치4 · 5) 이 이름으로 꽂힘
          await window.bellaSendSuggestion({ kind: v.patch.kind, body: v.patch.body });
        } else await w.q(w.sb.from("boss_settings").upsert({ guild_id: gid, ...v.patch }, { onConflict: "guild_id" }));
      } catch (err) {
        busy = false; b.disabled = false; b.textContent = okLabel;
        // 서버가 준 이유(예: '점수는 0~100')를 그대로 보여 줌
        bubble(`저장하지 못했어요. 바뀐 건 없어요.${err && err.message ? `<br><span class="setup-err">${esc(err.message)}</span>` : ""}<br>고친 뒤 [← 뒤로] 로 다시 하거나, 권한(관리자) · 인터넷 연결을 확인하고 다시 눌러 주세요.`);
        return;
      }
      busy = false;
      me(okLabel);
      bubble(md(run.flow.target === "suggest" ? run.flow.done : `바꿨어요! ${run.flow.done || ""}`));
      w.toast(run.flow.target === "suggest" ? "보냈어요" : `설정 도우미: ${run.flow.title} 저장했어요`);
      if (["settings", "attendance", "vbella"].includes(w.state.tab)) w.render();
      menu(run.flow.target === "suggest" ? "더 도와드릴 게 있나요?" : "더 바꿀 게 있나요?");
    };
  }

  function goTab(tab) {
    const b = document.querySelector(`#tabs button[data-tab="${tab}"]`);
    if (b && !b.hidden) b.click();
  }
  window.SetupHelper = { open, close };
  saySync();
})();
