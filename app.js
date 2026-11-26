// 벨라꼬붕 웹 관리 페이지
// Supabase 에 직접 연결. 누가 무엇을 볼·고칠 수 있는지는 Supabase 보안 규칙이 정한다.
// 디스코드 ID(19자리)는 자바스크립트 숫자로 받으면 끝자리가 틀어지므로 항상 ::text 로 받아 문자열로 다룬다.
(() => {
  const cfg = window.BOT_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WD = "월화수목금토일";
  const state = { me: null, guilds: [], gid: null, owner: false, tab: "bosses" };

  // ---------- 공통 ----------
  function toast(msg, err = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (err ? " err" : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), err ? 6000 : 2500);
  }
  async function q(promise) {
    const { data, error } = await promise;
    if (error) { toast("오류: " + error.message, true); throw error; }
    return data;
  }
  // 봇과 같은 형식의 한국 시간 문자열: 2026-11-19T21:00:00+09:00
  function kstIso(d) {
    const k = new Date(d.getTime() + 9 * 3600e3);
    return k.toISOString().slice(0, 19) + "+09:00";
  }
  function kstParts(iso) {
    const d = new Date(iso);
    const k = new Date(d.getTime() + 9 * 3600e3);
    return { y: k.getUTCFullYear(), mo: k.getUTCMonth() + 1, d: k.getUTCDate(), h: k.getUTCHours(), mi: k.getUTCMinutes(), wd: (k.getUTCDay() + 6) % 7 };
  }
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (iso) => { const p = kstParts(iso); return `${pad(p.mo)}/${pad(p.d)}(${WD[p.wd]}) ${pad(p.h)}:${pad(p.mi)}`; };

  // ---------- 리젠·일정 (봇의 boss.py 와 같은 규칙) ----------
  function parseDuration(text) {
    const s = text.replace(/\s/g, "");
    if (!s) return null;
    const re = /(\d+(?:\.\d+)?)(일|d|시간|h|분|m)/gi;
    const unit = { "일": 1440, d: 1440, "시간": 60, h: 60, "분": 1, m: 1 };
    let total = 0, pos = 0, m;
    while ((m = re.exec(s))) {
      if (m.index !== pos) return null;
      total += parseFloat(m[1]) * unit[m[2].toLowerCase()];
      pos = re.lastIndex;
    }
    return pos === s.length && total > 0 ? Math.round(total) : null;
  }
  function parseSchedule(text) {
    const t = text.replace(/\s/g, "");
    const re = /(매일|[월화수목금토일](?:요일)?)?(\d{1,2})시(?!간)(?:(\d{1,2})분)?/g;
    const slots = new Map();
    let day = null, marked = false, m;
    while ((m = re.exec(t))) {
      if (m[1]) { marked = true; day = m[1] === "매일" ? null : WD.indexOf(m[1][0]); }
      else if (!marked) continue;
      const h = +m[2], mi = +(m[3] || 0);
      if (h > 24 || mi > 59) return null;
      slots.set(`${day ?? "*"}@${pad(h % 24)}:${pad(mi)}`, [day, h % 24, mi]);
    }
    if (!marked || !slots.size) return null;
    return [...slots.values()].sort((a, b) => ((a[0] ?? -1) - (b[0] ?? -1)) || a[1] - b[1] || a[2] - b[2]);
  }
  const encodeSchedule = (slots) => slots.map(([d, h, m]) => `${d ?? "*"}@${pad(h)}:${pad(m)}`).join(",");
  function decodeSchedule(s) {
    return (s || "").split(",").filter((p) => p.includes("@")).map((p) => {
      const [d, hm] = p.split("@"); const [h, m] = hm.split(":");
      return [d === "*" ? null : +d, +h, +m];
    });
  }
  function fmtSchedule(slots) {
    const t = (h, m) => `${h}시` + (m ? ` ${m}분` : "");
    const daily = slots.filter((s) => s[0] === null).map((s) => t(s[1], s[2]));
    const weekly = slots.filter((s) => s[0] !== null).map((s) => `${WD[s[0]]} ${t(s[1], s[2])}`);
    return [...(daily.length ? ["매일 " + daily.join(", ")] : []), ...weekly].join(", ");
  }
  function fmtDuration(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
  }
  const fmtRule = (b) => (b.schedule ? fmtSchedule(decodeSchedule(b.schedule)) : b.respawn_min > 0 ? fmtDuration(b.respawn_min) : "미정");
  function parseRule(text) {
    const t = text.trim();
    const slots = parseSchedule(t);
    if (slots) return { respawn_min: 0, schedule: encodeSchedule(slots) };
    if (["", "미정", "모름", "0"].includes(t)) return { respawn_min: 0, schedule: null };
    const m = parseDuration(t);
    return m ? { respawn_min: m, schedule: null } : null;
  }

  // ---------- 로그인 ----------
  async function start() {
    $("#btn-login").onclick = () => (sessionStorageSafe("want_tab", location.hash.slice(1)), sb.auth.signInWithOAuth({
      provider: "discord", options: { redirectTo: location.origin + location.pathname },
    }));
    const { data } = await sb.auth.getSession();
    // 구글 연결 페이지 [다시 연결] 하다 로그인하러 온 경우: 로그인 끝나면 그 페이지로 돌아가 이어서
    if (data && data.session) {
      let back = null;
      try { back = localStorage.getItem("google_retry"); localStorage.removeItem("google_retry"); } catch (e) {}
      if (back) { location.href = "google.html?retry=" + encodeURIComponent(back); return; }
    }
    sb.auth.onAuthStateChange((_e, session) => { if (!!session !== !!state.me) location.reload(); });
    if (!data.session) { $("#login").hidden = false; return; }
    const u = data.session.user.user_metadata || {};
    state.me = { id: String(u.provider_id || ""), name: u.custom_claims?.global_name || u.full_name || u.name || "나", avatar: u.avatar_url };
    $("#me").innerHTML = `${state.me.avatar ? `<img src="${esc(state.me.avatar)}" alt="">` : ""}<span>${esc(state.me.name)}</span>
      <span class="badge" id="my-role" hidden></span>
      <button class="ghost small" id="btn-logout">로그아웃</button>`;
    $("#btn-logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

    state.allGuilds = await q(sb.from("web_guilds").select("guild_id::text,name,icon_url,owner_id::text,owner_name,member_count,joined_at,left_at").order("name"));
    // 길드원 확인: 봇이 들어가 있는 서버마다 내가 멤버인지 봇이 디스코드에 물어봄 (1~2초)
    try {
      const rid = await q(sb.rpc("web_member_request"));
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 800));
        if ((await q(sb.rpc("web_member_status", { rid }))) === "done") break;
      }
    } catch (e) { /* 확인 실패해도 지난 확인 기록(7일)으로 진행 */ }
    // 관리자 서버(staff) + 길드원 서버(member). 지금 봇이 들어가 있는 서버만
    state.guilds = await q(sb.rpc("web_my_guilds"));
    for (const g of state.guilds) Object.assign(g, state.allGuilds.find((x) => x.guild_id === g.guild_id) || {});
    if (!state.guilds.length) { $("#noguild").hidden = false; setTimeout(() => location.reload(), 3000); return; }
    const ownerRows = await q(sb.from("web_owners").select("user_id::text"));
    state.botOwner = ownerRows.length > 0;
    $("#tab-servers").hidden = !state.botOwner;
    const sel = $("#guild");
    sel.innerHTML = state.guilds.map((g) => `<option value="${g.guild_id}">${esc(g.name)}</option>`).join("");
    const saved = localStorage.getItem("gid");
    if (saved && state.guilds.some((g) => g.guild_id === saved)) sel.value = saved;
    sel.onchange = () => { localStorage.setItem("gid", sel.value); selectGuild(sel.value); };
    $("#tabs").onclick = (e) => {
      const b = e.target.closest("button[data-tab]"); if (!b) return;
      document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
      state.tab = b.dataset.tab; render();
    };
    // 바로가기(#vbella 등): 로그인하느라 주소 뒤가 지워졌으면 로그인 전에 기억해 둔 탭으로
    const want = (/^#\w+$/.test(location.hash) ? location.hash.slice(1) : "") || sessionStorageSafe("want_tab", undefined, true);
    const tb = want && document.querySelector(`#tabs button[data-tab="${want}"]:not([hidden])`);
    if (tb && TABS[want]) {
      state.tab = want;
      document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === tb));
    }
    $("#main").hidden = false;
    selectGuild(sel.value);
  }
  async function selectGuild(gid) {
    state.gid = gid;
    const g = state.guilds.find((x) => x.guild_id === gid);
    // 길드원(관리자 아님): 보스 현황(읽기) · 내 출석 · 버추얼 벨라 탭만
    state.member = !!g && g.role === "member";
    const MEMBER_OK = ["bosses", "attendance", "vbella"];
    document.querySelectorAll("#tabs button[data-tab]").forEach((b) => {
      if (b.id === "tab-servers") { b.hidden = !state.botOwner; return; }
      b.hidden = state.member && !MEMBER_OK.includes(b.dataset.tab);
    });
    if (state.member && !MEMBER_OK.includes(state.tab)) {
      state.tab = "bosses";
      document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === "bosses"));
    }
    state.owner = state.botOwner || (g && g.owner_id === state.me.id);
    // 우상단에 이 서버에서의 내 역할 표시
    let role = state.botOwner ? "👑 봇 주인" : g && g.owner_id === state.me.id ? "🏰 서버 주인" : state.member ? "🙋 길드원" : null;
    if (!role) {
      const mine = await q(sb.from("bot_admins").select("user_id::text").eq("guild_id", gid).eq("user_id", state.me.id));
      role = mine.length ? "🛡️ 관리자" : null;
    }
    const badge = $("#my-role");
    badge.textContent = role || "";
    badge.hidden = !role;
    render();
  }
  async function render() {
    const v = $("#view");
    v.innerHTML = `<div class="card muted">불러오는 중…</div>`;
    try { await (state.member ? MEMBER_TABS : TABS)[state.tab](v); } catch (e) { console.error(e); v.innerHTML = `<div class="card">불러오지 못했어요: ${esc(e.message)}</div>`; }
  }
  const G = () => state.gid;
  // sessionStorage 를 못 쓰는 환경에서도 안 깨지게. take=true 면 읽고 지움
  function sessionStorageSafe(key, value, take = false) {
    try {
      if (value !== undefined) { if (value) sessionStorage.setItem(key, value); return value; }
      const v = sessionStorage.getItem(key);
      if (take) sessionStorage.removeItem(key);
      return v || "";
    } catch (e) { return ""; }
  }

  // ---------- 보스 ----------
  async function bossesTab(v) {
    const rows = await q(sb.from("bosses").select("name,respawn_min,aliases,hidden_until,schedule,display,wait_first,kind,alert_offsets").eq("guild_id", G()).order("respawn_min").order("name"));
    const now = kstIso(new Date());
    v.innerHTML = `
      <div class="card">
        <h2>보스 목록 (${rows.length})</h2>
        <p class="muted small">리젠: <code>8시간</code> <code>1시간 30분</code> <code>미정</code> · 요일·시각 보스: <code>화 21시</code> <code>매일 0시, 12시, 18시</code>.
          표시 이름은 메시지에 보일 이름, 별명은 <code>/컷</code>·음성·스크린샷 인식용(쉼표로 구분).</p>
        <div class="table-wrap"><table>
          <thead><tr><th>보스</th><th>구분</th><th>표시 이름</th><th>리젠 / 일정</th><th title="비우면 구분 값 (설정의 인터 · 본토)">알림 (분 전)</th><th>별명</th><th>상태</th><th></th></tr></thead>
          <tbody>${rows.map((b) => {
            const waiting = !!b.wait_first, hidden = !waiting && b.hidden_until && b.hidden_until > now;
            return `<tr data-name="${esc(b.name)}" class="${hidden || waiting ? "hidden-boss" : ""}">
              <td><b>${esc(b.name)}</b></td>
              <td><select name="kind" class="kind-sel"><option value="main" ${b.kind === "inter" ? "" : "selected"}>본토</option><option value="inter" ${b.kind === "inter" ? "selected" : ""}>인터</option></select></td>
              <td><input name="display" value="${esc(b.display || "")}" placeholder="${esc(b.name)}"></td>
              <td><input name="rule" value="${esc(fmtRule(b))}"></td>
              <td><input name="offs" class="offs" value="${esc(b.alert_offsets == null ? "" : b.alert_offsets === "" ? "없음" : b.alert_offsets.split(",").join(", "))}" placeholder="구분 값"></td>
              <td><input name="aliases" value="${esc((b.aliases || "").split(",").filter(Boolean).join(", "))}"></td>
              <td>${waiting ? `<span class="badge off" title="첫 컷이 들어오면 자동으로 켜져요">첫 컷 대기</span>` : hidden ? `<span class="badge off">제외 ~${fmtDate(b.hidden_until)}</span>` : `<span class="badge">활성</span>`}</td>
              <td class="row">
                <button data-act="save" class="primary">저장</button>
                ${waiting ? `<button data-act="unhide">대기 해제</button>` : hidden ? `<button data-act="unhide">제외 해제</button>`
                  : `<button data-act="hide">30일 제외</button><button data-act="wait" title="아직 못 잡는 보스: 첫 컷 전까지 알림·시간표에서 빠져요">첫 컷 대기</button>`}
                <button data-act="delete" class="danger ghost">삭제</button>
              </td></tr>`;
          }).join("")}</tbody></table></div>
      </div>
      <div class="card">
        <h2>보스 추가</h2>
        <div class="grid">
          <label class="field">이름<input id="nb-name" placeholder="예: 트라손"></label>
          <label class="field">리젠 / 일정<input id="nb-rule" placeholder="8시간 · 미정 · 화 21시"></label>
          <label class="field">표시 이름 (선택)<input id="nb-display" placeholder="🔥 트라손 [고대신전]"></label>
          <label class="field">별명 (선택)<input id="nb-aliases" placeholder="트라, 트라숀"></label>
        </div>
        <p><button class="primary" id="nb-add">추가</button></p>
      </div>`;
    const aliasList = (t) => t.split(/[,/、]/).map((x) => x.trim()).filter(Boolean).join(",");
    v.querySelector("tbody").onclick = async (e) => {
      const btn = e.target.closest("button[data-act]"); if (!btn) return;
      const tr = btn.closest("tr"), name = tr.dataset.name;
      const where = (qq) => qq.eq("guild_id", G()).eq("name", name);
      if (btn.dataset.act === "save") {
        const rule = parseRule(tr.querySelector("[name=rule]").value);
        if (!rule) return toast("리젠/일정을 못 알아들었어요. 예: 8시간 · 미정 · 화 21시", true);
        const ot = tr.querySelector("[name=offs]").value.trim();
        const offsets = !ot ? null : /^(없음|끄기|0)$/.test(ot) ? "" : parseMins(ot).join(",");
        if (ot && offsets === "" && !/^(없음|끄기|0)$/.test(ot)) return toast("알림 시간을 못 알아들었어요. 예: 20, 10 (분 전)", true);
        await q(where(sb.from("bosses").update({
          ...rule, kind: tr.querySelector("[name=kind]").value, alert_offsets: offsets, display: tr.querySelector("[name=display]").value.trim() || null,
          aliases: aliasList(tr.querySelector("[name=aliases]").value),
        })));
        toast(`${name} 저장했어요`);
      } else if (btn.dataset.act === "hide") {
        await q(where(sb.from("bosses").update({ hidden_until: kstIso(new Date(Date.now() + 30 * 86400e3)) })));
        toast(`${name} 30일 동안 제외`); render();
      } else if (btn.dataset.act === "unhide") {
        await q(where(sb.from("bosses").update({ hidden_until: null, wait_first: 0 })));
        toast(`${name} 다시 켰어요`); render();
      } else if (btn.dataset.act === "wait") {
        await q(where(sb.from("bosses").update({ hidden_until: "9999-12-31T00:00:00+09:00", wait_first: 1 })));
        toast(`${name} 첫 컷 대기 — 첫 컷이 들어오면 자동으로 켜져요`); render();
      } else if (btn.dataset.act === "delete") {
        if (!confirm(`${name}을(를) 완전히 삭제할까요? (컷 기록은 남아요)`)) return;
        await q(where(sb.from("bosses").delete()));
        toast(`${name} 삭제했어요`); render();
      }
    };
    v.querySelector("tbody").onchange = async (e) => {   // 구분은 고르는 즉시 저장
      const sel = e.target.closest("select.kind-sel"); if (!sel) return;
      const name = sel.closest("tr").dataset.name;
      await q(sb.from("bosses").update({ kind: sel.value }).eq("guild_id", G()).eq("name", name));
      toast(`${name} → ${sel.value === "inter" ? "인터" : "본토"}`);
    };
    $("#nb-add").onclick = async () => {
      const name = $("#nb-name").value.trim();
      const rule = parseRule($("#nb-rule").value);
      if (!name || !rule) return toast("이름과 리젠/일정을 넣어 주세요", true);
      await q(sb.from("bosses").insert({ guild_id: G(), name, ...rule, display: $("#nb-display").value.trim() || null, aliases: aliasList($("#nb-aliases").value) }));
      toast(`${name} 추가했어요`); render();
    };
  }

  // ---------- 알림 시간 칩 (분 전 목록 편집) ----------
  const fmtMin = (m) => (m % 60 === 0 ? `${m / 60}시간 전` : `${m}분 전`);
  const parseMins = (t) => [...new Set((String(t || "").match(/\d+/g) || []).map(Number).filter((n) => n > 0 && n <= 1440))].sort((a, b) => b - a);
  function chipEdit(id, csv) {
    return `<div class="chip-edit" id="${id}" data-v="${esc(csv)}"><span class="chip-list"></span>
      <span class="chip-add"><input type="number" min="1" max="1440" inputmode="numeric" placeholder="분" aria-label="몇 분 전"><button type="button">＋ 추가</button></span></div>`;
  }
  function chipInit(el) {
    el._list = parseMins(el.dataset.v);
    const draw = () => {
      el.querySelector(".chip-list").innerHTML = el._list.map((m) => `<span class="chip-x">${fmtMin(m)}<button type="button" data-m="${m}" aria-label="${fmtMin(m)} 삭제">×</button></span>`).join("") || `<span class="muted small">없음</span>`;
    };
    el.onclick = (e) => {
      const b = e.target.closest("button[data-m]");
      if (b) { el._list = el._list.filter((m) => m !== +b.dataset.m); draw(); }
      else if (e.target.closest(".chip-add button")) add();
    };
    const inp = el.querySelector("input");
    const add = () => { const n = parseMins(inp.value)[0]; if (!n) return; el._list = parseMins([...el._list, n].join(",")); inp.value = ""; draw(); };
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
    draw();
  }

  // ---------- 설정 ----------
  async function settingsTab(v) {
    const [rows, chans] = await Promise.all([
      q(sb.from("boss_settings").select("alert_channel_id::text,raid_channel_id::text,board_channel_id::text,shot_channel_id::text,voice_channel_id::text,alert_offsets,alert_inter,alert_spawn,overdue_alert,raid_minutes,greet_channels,game,home_srv,virtual_bella,vb_member_white,vb_member_note,vb_member_board,vb_member_download,vb_member_rally,raid_rule,bella_open,bella_close,cp_start,cp_days,ms_days,att_from").eq("guild_id", G())),
      q(sb.from("web_channels").select("channel_id::text,name,kind,position,bot_ok").eq("guild_id", G()).order("position")),
    ]);
    const s = rows[0] || {};
    const text = chans.filter((c) => c.kind === "text"), voice = chans.filter((c) => c.kind === "voice");
    const opts = (list, cur) => `<option value="">— 지정 안 함 —</option>` + list.map((c) => `<option value="${c.channel_id}" ${c.channel_id === cur ? "selected" : ""}>${c.kind === "voice" ? "🔊" : "#"} ${esc(c.name)}${c.bot_ok === 0 ? " ⚠️ 봇 권한 없음" : ""}</option>`).join("");
    const greet = s.greet_channels == null ? "all" : s.greet_channels === "" ? "off" : "pick";
    const greetSet = new Set((s.greet_channels || "").split(",").filter(Boolean));
    const GAMES = [["zeus", "제우스: 오만의 신"], ["odin", "오딘 (준비 중)"], ["sol", "솔: 인첸트 (준비 중)"],
      ["archeage", "아키에이지 크로니클 (준비 중)"], ["chrono", "크로노 오디세이 (준비 중)"], ["etc", "기타"]];
    v.innerHTML = `
      <div class="card">
        <h2>🎮 게임</h2>
        <p class="muted small">제우스 전용 기능(일요일 길드전 · 기본 보스 목록 · 현황판 인식)은 제우스 서버에서만 켜져요. 준비 중인 게임은 지원되면 자동으로 켜져요.</p>
        <select id="s-game"><option value="">— 미설정 —</option>${GAMES.map(([c, n]) => `<option value="${c}" ${s.game === c ? "selected" : ""}>${n}</option>`).join("")}</select>
      </div>
      <div class="card">
        <h2>🌐 서버 이전 등록</h2>
        <p class="muted small">우리 길드의 게임 서버(꼬리표)를 적어 주세요. 버추얼 벨라 앱이 '우리 서버'로 써요.</p>
        <label class="field">게임 서버 (예: 포세1)<input id="s-homesrv" maxlength="20" placeholder="포세1" value="${esc(s.home_srv || "")}"></label>
      </div>
      <div class="card">
        <h2>출석 규칙</h2>
        <p class="muted small">요일·시각 보스(케르베로스 · 메데이아 등 정해진 시각에 나오는 보스)를 어떻게 출석으로 칠지 정해요. 리젠 보스는 두 규칙 모두 컷이 들어오면 레이드 등록이 열려요.</p>
        <label><input type="radio" name="rule" value="bella" ${(s.raid_rule || "bella") === "bella" ? "checked" : ""}> <b>벨라 룰</b> (기본) — 출현 n분 전에 레이드 등록이 자동으로 열리고, 출현 m분 뒤 닫혀요. 요일·시각 보스는 컷을 받지 않아요.</label><br>
        <label><input type="radio" name="rule" value="cut" ${s.raid_rule === "cut" ? "checked" : ""}> <b>컷 룰</b> — 요일·시각 보스도 컷이 들어와야 레이드 등록이 열려요 (컷 후 아래 '참여 받는 시간' 동안).</label>
        <div class="grid" style="margin-top:8px">
          <label class="field">벨라 룰: 출현 몇 분 전에 열기<input id="s-bopen" type="number" min="1" max="120" value="${s.bella_open ?? 10}"></label>
          <label class="field">벨라 룰: 출현 몇 분 뒤 닫기<input id="s-bclose" type="number" min="1" max="120" value="${s.bella_close ?? 5}"></label>
        </div>
      </div>
      <div class="card">
        <h2>📍 출석 구간 (체크포인트)</h2>
        <p class="muted small">기록은 지우지 않고 출석 순위를 구간으로 나눠 봐요. 시작일부터 N일마다(그날 0시) 자동으로 나뉘고, 디스코드 관리판 [📍 체크포인트]로 지금 시각을 수동으로 더 찍을 수 있어요. 시작일을 비우면 자동 주기는 꺼져요.</p>
        <div class="grid">
          <label class="field">자동 주기 시작일<input id="s-cpstart" type="date" value="${esc(s.cp_start || "")}"></label>
          <label class="field">며칠마다<input id="s-cpdays" type="number" min="1" max="366" value="${s.cp_days || 14}"></label>
          <label class="field">📍 마일스톤 알림: 구간을 며칠마다 (0 = 끔)<input id="s-msdays" type="number" min="0" max="366" value="${s.ms_days || 0}"></label>
          ${state.botOwner ? `<label class="field">🗄️ 보관 기준일 (봇 주인만 · 그날 0시 이전 기록은 숨김)<input id="s-attfrom" type="date" value="${esc((s.att_from || "").slice(0, 10))}"></label>` : ""}
        </div>
        <p class="muted small">마일스톤: 구간 시작부터 N일마다, 그리고 구간이 끝날 때 디스코드 알림 채널에 그때까지의 출석 순위(출석 보기 기준 · 전체 같이)를 올려요.
          ${s.att_from ? `<br>🗄️ ${esc(s.att_from.slice(5, 10).replace("-", "/"))} 0시 이전 기록은 보관 중이에요 — 출석 순위 · 기록 · 구간 · 구글 시트 · 디스코드 어디에도 안 보이고, 지우진 않았어요.` : ""}</p>
      </div>
      <div class="card">
        <h2>🔔 보스 알림</h2>
        <p class="muted small">출현 몇 분 전에 알릴지. 보스마다 인터 · 본토는 아래 보스 목록에서 골라요.</p>
        <div class="alert-line"><b>인터</b>${chipEdit("s-inter", s.alert_inter ?? "20,10")}</div>
        <div class="alert-line"><b>본토</b>${chipEdit("s-main", s.alert_offsets ?? "5,1")}</div>
        <label class="switch"><input type="checkbox" id="s-spawn" ${(s.alert_spawn ?? 1) ? "checked" : ""}><span class="knob"></span> 출현 시각에도 알림</label>
        <label class="switch"><input type="checkbox" id="s-overdue" ${(s.overdue_alert ?? 1) ? "checked" : ""}><span class="knob"></span> 컷이 30분 넘게 안 올라온 보스 글</label>
      </div>
      <div class="card">
        <h2>🤝 참여</h2>
        <label class="field narrow">컷 후 참여 받는 시간 (분)<input id="s-raid" type="number" min="1" max="120" value="${s.raid_minutes ?? 5}"></label>
      </div>
      <div class="card">
        <h2>채널</h2>
        <p class="muted small">채널을 바꾼 뒤에는 디스코드 관리판 [🔄 새로고침]을 눌러 주세요. 시간표는 1분 안에 새 채널로 옮겨져요.</p>
        <div class="grid">
          <label class="field">🔔 알림<select id="c-alert">${opts(text, s.alert_channel_id)}</select></label>
          <label class="field">⚔️ 레이드·레기온 모집<select id="c-raid">${opts(text, s.raid_channel_id)}</select></label>
          <label class="field">📋 시간표<select id="c-board">${opts(text, s.board_channel_id)}</select></label>
          <label class="field">📸 스크린샷<select id="c-shot">${opts(text, s.shot_channel_id)}</select></label>
          <label class="field">🔊 상주·집결·TTS<select id="c-voice">${opts(voice, s.voice_channel_id)}</select></label>
        </div>
      </div>
      <div class="card">
        <h2>입장 인사</h2>
        <div class="row">
          <label><input type="radio" name="greet" value="all" ${greet === "all" ? "checked" : ""}> 모든 음성 채널</label>
          <label><input type="radio" name="greet" value="pick" ${greet === "pick" ? "checked" : ""}> 고른 채널만</label>
          <label><input type="radio" name="greet" value="off" ${greet === "off" ? "checked" : ""}> 끄기</label>
        </div>
        <div class="chips" style="margin-top:10px">${voice.map((c) => `<label><input type="checkbox" class="g-ch" value="${c.channel_id}" ${greetSet.has(c.channel_id) ? "checked" : ""}> ${esc(c.name)}${c.bot_ok === 0 ? " ⚠️" : ""}</label>`).join("") || `<span class="muted small">음성 채널 정보가 아직 없어요</span>`}</div>
      </div>
      <p><button class="primary" id="s-save">설정 저장</button></p>
      <div class="card" id="m-card"><h2>📣 알림 멘션</h2><p class="muted small">불러오는 중…</p></div>
      <div class="card" id="g-card"><h2>📊 구글 시트</h2><p class="muted small">불러오는 중…</p></div>
      <div class="card" id="fb-card"><h2>⭐ 관리판 보드</h2><p class="muted small">불러오는 중…</p></div>`;
    mentionCard();
    sheetCard();
    favBoardCard($("#fb-card"));
    v.querySelectorAll(".chip-edit").forEach(chipInit);
    $("#s-save").onclick = async () => {
      const csv = (id) => $(id)._list.join(",");
      const mode = v.querySelector("input[name=greet]:checked").value;
      const picked = [...v.querySelectorAll(".g-ch:checked")].map((x) => x.value);
      const val = (id) => $(id).value || null;
      const homeSrv = ($("#s-homesrv").value || "").replace(/[\[\]\s]/g, "") || null;
      if (homeSrv && !/^[가-힣]{2}[0-9]$/.test(homeSrv)) { toast("서버 꼬리표는 포세1 · 아테3 처럼 한글 2자 + 숫자 1자리만 받아요"); return; }
      await q(sb.from("boss_settings").upsert({
        guild_id: G(), game: $("#s-game").value || null,
        home_srv: homeSrv, alert_inter: csv("#s-inter"), alert_offsets: csv("#s-main"), alert_spawn: $("#s-spawn").checked ? 1 : 0, overdue_alert: $("#s-overdue").checked ? 1 : 0, raid_minutes: Math.max(1, +$("#s-raid").value || 5),
        raid_rule: v.querySelector("input[name=rule]:checked").value,
        cp_start: $("#s-cpstart").value || null, cp_days: $("#s-cpstart").value ? Math.min(366, Math.max(1, +$("#s-cpdays").value || 14)) : 0,
        ms_days: Math.min(366, Math.max(0, +$("#s-msdays").value || 0)),
        ...($("#s-attfrom") ? { att_from: $("#s-attfrom").value ? `${$("#s-attfrom").value}T00:00:00+09:00` : null } : {}),   // 봇 주인만 칸이 있음
        bella_open: Math.min(120, Math.max(1, +$("#s-bopen").value || 10)), bella_close: Math.min(120, Math.max(1, +$("#s-bclose").value || 5)),
        alert_channel_id: val("#c-alert"), raid_channel_id: val("#c-raid"), board_channel_id: val("#c-board"),
        shot_channel_id: val("#c-shot"), voice_channel_id: val("#c-voice"),
        greet_channels: mode === "all" ? null : mode === "off" ? "" : picked.join(","),
      }, { onConflict: "guild_id" }));
      toast("설정을 저장했어요");
    };
  }

  // ---------- ⭐ 관리판 보드 (디스코드 관리판에 보일 버튼 최대 10개 · 순서) ----------
  // 저장은 boss_settings.panel_board (JSON 목록, NULL = 추천). 봇 fav_board.py 의 GROUPS · RECOMMENDED · 이름과 같게 유지.
  const FB_GROUPS = [
    ["시작·운영", [["quick", "⚡ 한 번에 시작"], ["battle", "🛡️ 전투 예약"], ["sheet", "📊 구글 연결"], ["checkpoint", "📍 체크포인트"],
      ["cleanup", "🧹 게시판 청소"], ["refresh", "🔄 새로고침"], ["vbella", "✒️ 앱 · 길드원 권한"], ["vbweb", "🌐 버추얼 벨라(웹) 바로가기"]]],
    ["채널", [["chat", "💬 채팅 채널"], ["voice", "🔊 음성 채널"], ["mention", "📣 알림 멘션"]]],
    ["서버", [["admin", "🛡️ 관리자"], ["homesrv", "🌐 서버 이전 등록"], ["invite", "🔗 초대 링크"], ["leave", "🚪 정리하고 내보내기"]]],
    ["설정", [["game", "🎮 게임"], ["timing", "⏱️ 알림·참여"], ["bossnames", "🏷️ 보스 이름·별명"]]],
  ];
  const FB_REC = ["quick", "battle", "sheet", "refresh", "vbella", "chat", "voice", "mention", "timing", "bossnames"];
  const FB_MAX = 10;
  async function favBoardCard(box) {
    if (!box) return;
    const label = Object.fromEntries(FB_GROUPS.flatMap(([, l]) => l));
    const order = FB_GROUPS.flatMap(([, l]) => l.map(([k]) => k));
    const rows = await q(sb.from("boss_settings").select("panel_board").eq("guild_id", G()));
    let list;
    try { list = rows[0] && rows[0].panel_board ? JSON.parse(rows[0].panel_board) : FB_REC.slice(); } catch (e) { list = FB_REC.slice(); }
    const FB_MERGED = { names: "bossnames", aliases: "bossnames" };   // 예전 표시 이름 · 별명 → 보스 이름·별명 하나로
    list = [...new Set(list.map((k) => FB_MERGED[k] || k).filter((k) => label[k]))].slice(0, FB_MAX);
    const draw = () => {
      box.innerHTML = `<h2>⭐ 관리판 보드</h2>
        <p class="muted small">디스코드 관리판에 보일 버튼을 최대 ${FB_MAX}개 고르고 순서를 정해요. 디스코드 [⭐ 보드 편집]과 같은 값이라 어느 쪽에서 바꿔도 보드가 바뀌어요 (웹에서 저장하면 15초 안에).
          [⭐ 보드 편집] · [📂 전체 기능] · [🌐 웹 관리]는 항상 마지막 줄에 있어요.</p>
        <div class="grid">${FB_GROUPS.map(([g, l]) => `<div><b class="small">${g}</b><br>${l.map(([k, t]) =>
          `<label><input type="checkbox" class="fb-pick" value="${k}" ${list.includes(k) ? "checked" : ""}> ${esc(t)}</label><br>`).join("")}</div>`).join("")}</div>
        <h3 class="small" style="margin:12px 0 6px">순서 (${list.length}/${FB_MAX})</h3>
        <ol class="fb-order">${list.map((k, i) => `<li>${esc(label[k])}
          <button type="button" class="ghost small" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="위로">↑</button>
          <button type="button" class="ghost small" data-down="${i}" ${i === list.length - 1 ? "disabled" : ""} aria-label="아래로">↓</button></li>`).join("") || `<span class="muted small">비어 있어요</span>`}</ol>
        <p><button class="primary" id="fb-save">보드 저장</button> <button class="ghost" id="fb-group">묶음 순서로</button> <button class="ghost" id="fb-rec">추천 10개로</button></p>`;
    };
    box.onchange = (e) => {
      const c = e.target.closest(".fb-pick");
      if (!c) return;
      if (c.checked) {
        if (list.length >= FB_MAX) { c.checked = false; toast(`최대 ${FB_MAX}개까지 고를 수 있어요`); return; }
        list.push(c.value);
      } else list = list.filter((k) => k !== c.value);
      draw();
    };
    box.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const swap = (i, j) => { [list[i], list[j]] = [list[j], list[i]]; draw(); };
      if (b.dataset.up) swap(+b.dataset.up, +b.dataset.up - 1);
      else if (b.dataset.down) swap(+b.dataset.down, +b.dataset.down + 1);
      else if (b.id === "fb-group") { list = order.filter((k) => list.includes(k)); draw(); }
      else if (b.id === "fb-rec") { list = FB_REC.slice(); draw(); }
      else if (b.id === "fb-save") {
        await q(sb.from("boss_settings").upsert({ guild_id: G(), panel_board: JSON.stringify(list) }, { onConflict: "guild_id" }));
        toast("관리판 보드를 저장했어요");
      }
    };
    draw();
  }

  // ---------- 버추얼 벨라 탭: 안내 · 설정(켜기 · 길드원 권한) · 데스노트 · 화이트리스트 ----------
  async function vbellaTab(v) {
    const rows = await q(sb.from("boss_settings").select("virtual_bella,vb_member_white,vb_member_note,vb_member_board,vb_member_download_win,vb_member_download_mobile,vb_member_rally,vb_win_build,vb_mobile_build").eq("guild_id", G()));
    const s = rows[0] || {};
    const PERMS = [["white", "화이트리스트 등록 · 삭제 (본인 것만)", 1], ["note", "데스노트 등록", 1], ["board", "보스 현황판 갱신 (앱 스캔 · 스샷)", 1],
                   ["download_win", "🖥️ 윈도우 앱 받기 (웹)", 0], ["download_mobile", "📱 모바일 앱 받기 (웹)", 0], ["rally", "뿔피리 (앱 전체에 용사집결)", 0]];
    v.innerHTML = `
      <div class="card">
        <h2>✒️ 버추얼 벨라 (게임 화면 위 도우미 앱)</h2>
        <p class="muted">보스 컷 · 출현 예고 · 현황판 스캔 · 참여자 확인 · 뿔피리를 게임 화면 위에서 바로 해요.</p>
        <ul class="vb-steps">
          <li><a href="vb-install.html" target="_blank" rel="noopener"><b>윈도우 설치 안내</b></a> — 폴더 준비 · 신뢰 등록 파일(bella_cert) 받기 · 백신 예외 · 되돌리기</li>
          <li><b>로그인</b> — 디스코드에서 <code>/벨라봇 인증</code> → 받은 코드를 앱 로그인 화면에 입력 · 끊기 <code>/벨라연결해제</code></li>
          <li><b>화이트리스트</b> — <code>/화이트 닉네임</code> · <code>/화이트목록</code> · <code>/화이트삭제</code> (나만 보여요)</li>
          <li><b>게임 닉네임 등록</b> — <code>/닉등록 게임닉</code> (참여자 확인 때 디스코드와 맞추는 데 써요)</li>
        </ul>
      </div>
      <div class="card">
        <h2>설정</h2>
        <p class="muted small">앱에서 오는 컷을 받아요. 리젠 보스만 받고, 요일·시각 보스는 컷을 받지 않아요.</p>
        <label><input type="checkbox" id="vb-on" ${s.virtual_bella ? "checked" : ""}> 이 서버에서 버추얼 벨라 켜기</label>
        <h3 class="small" style="margin:14px 0 6px">길드원 권한 <span class="muted">(관리자는 항상 가능)</span></h3>
        <div class="grid">
          ${PERMS.map(([k, t, d]) => `<label><input type="checkbox" class="vb-perm" data-k="${k}" ${(s["vb_member_" + k] ?? d) ? "checked" : ""}> ${t}</label>`).join("")}
        </div>
        <p class="muted small">데스노트 삭제 · 참여자 확인은 항상 관리자만이에요.</p>
        <p><button class="primary" id="vb-save">저장</button></p>
      </div>
      <div class="card" id="vb-builds"></div>
      <div class="card"><h2>⬇️ 앱 받기</h2><div id="vb-dl"></div></div>
      <div class="card"><h2>데스노트 · 화이트리스트</h2><div id="vb-lists"></div></div>`;
    const adminPm = { download_win: true, download_mobile: true };     // 관리자는 늘 받을 수 있음
    vbDownload($("#vb-dl"), adminPm);
    vbBuilds($("#vb-builds"), s, () => vbDownload($("#vb-dl"), adminPm));
    $("#vb-save").onclick = async () => {
      await q(sb.from("boss_settings").upsert({
        guild_id: G(), virtual_bella: $("#vb-on").checked ? 1 : 0,
        ...Object.fromEntries([...v.querySelectorAll(".vb-perm")].map((c) => ["vb_member_" + c.dataset.k, c.checked ? 1 : 0])),
      }, { onConflict: "guild_id" }));
      toast("버추얼 벨라 설정을 저장했어요");
    };
    vbLists($("#vb-lists"));
  }

  // 버추얼 벨라 데스노트(서버 공용) · 화이트리스트 전체(관리자만 · 부캐 전력 노출 방지로 앱에서는 각자 자기 것만)
  async function vbLists(box) {
    if (!box) return;
    const reqs = (await sb.rpc("vb_note_reqs_list", { gid: G() })).data || [];
    const reqHtml = reqs.length ? `<div class="card-sub"><h3>🗑️ 데스노트 제외 신청 ${reqs.length}건</h3>
      <table class="tbl"><tr><th>이름</th><th>신청</th><th>등록한 사람</th><th>이유</th><th></th></tr>${reqs.map((r) => `<tr>
        <td><b>${esc(r.name)}</b></td><td>${esc(r.user_name || r.user_id)} · ${fmtDate(r.created_at)}</td>
        <td>${esc(r.added_by_name || r.added_by || "")}</td><td class="small">${esc(r.reason || "")}</td>
        <td><button class="primary small" data-ok="${r.id}">수락</button> <button class="ghost small" data-no="${r.id}">거절</button></td></tr>`).join("")}</table></div>` : "";
    const [notes, whites] = await Promise.all([sb.rpc("vb_note_all", { gid: G() }), sb.rpc("vb_white_all", { gid: G() })]);
    if (notes.error || whites.error) { box.innerHTML = `<p class="muted small">목록을 못 불러왔어요: ${esc((notes.error || whites.error).message)}</p>`; return; }
    const n = notes.data || [], w = whites.data || [];
    box.innerHTML = reqHtml + `
      <details><summary>☠️ 데스노트 ${n.length}명</summary>
        ${n.length ? `<table class="tbl"><tr><th>이름</th><th>다른 표기</th><th>등록</th><th></th></tr>${n.map((x) => `<tr>
          <td>${esc(x.name)}</td><td class="small">${esc((x.aliases || []).join(", "))}</td>
          <td class="small">${esc(x.added_by_name || x.added_by || "")} · ${esc((x.created_at || "").slice(5, 16).replace("T", " "))}</td>
          <td><button class="danger small" data-del="${esc(x.name)}">삭제</button></td></tr>`).join("")}</table>` : `<p class="muted small">비어 있어요. 앱에서 <code>\\</code> 키로 등록해요.</p>`}
      </details>
      <details><summary>📜 데스노트 기록 (누가 언제 등록 · 삭제했는지)</summary>
        <p><button class="ghost small" id="note-log-btn">최근 300건 불러오기</button></p><div id="note-log"></div>
      </details>
      <details><summary>🤍 화이트리스트 (우리 쪽 부캐) ${w.length}개</summary>
        <p class="muted small">관리자만 보는 전체 목록이에요. 등록·삭제는 각자 앱에서 해요. 여기 있는 이름은 데스노트에 있어도 적대 알림이 안 떠요.</p>
        ${w.length ? `<table class="tbl"><tr><th>부캐</th><th>주인</th><th>등록</th><th></th></tr>${w.map((x) => `<tr>
          <td>${esc(x.name)}</td><td>${esc(x.display_name || x.user_id)}</td>
          <td class="small">${esc((x.created_at || "").slice(5, 16).replace("T", " "))}</td>
          <td><button class="danger small" data-wdel="${esc(x.name)}" data-uid="${esc(x.user_id)}">삭제</button></td></tr>`).join("")}</table>` : `<p class="muted small">비어 있어요.</p>`}
      </details>`;
    const decide = (ok) => async (e) => {
      const { error } = await sb.rpc("vb_note_req_decide", { gid: G(), rid: e.target.dataset[ok ? "ok" : "no"], ok });
      if (error) return toast(error.message);
      toast(ok ? "수락했어요 — 데스노트에서 뺐어요" : "거절했어요"); vbLists(box);
    };
    box.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = decide(true)));
    box.querySelectorAll("[data-no]").forEach((b) => (b.onclick = decide(false)));
    const logBtn = box.querySelector("#note-log-btn");
    if (logBtn) logBtn.onclick = async () => {
      const rows = (await sb.rpc("vb_note_log_list", { gid: G() })).data || [];
      const label = { add: "등록", alias: "다른 표기 추가", del: "삭제", req: "제외 신청", approve: "제외 수락", reject: "제외 거절" };
      box.querySelector("#note-log").innerHTML = `<table class="tbl"><tr><th>시각</th><th>이름</th><th>무엇</th><th>누가</th><th>내용</th></tr>${rows.map((l) => `<tr>
        <td class="small">${fmtDate(l.at)}</td><td>${esc(l.name)}</td><td>${label[l.action] || esc(l.action)}</td>
        <td>${esc(l.user_name || l.user_id || "")}</td><td class="small">${esc(l.detail || "")}</td></tr>`).join("")}</table>`;
    };
    box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`데스노트에서 '${b.dataset.del}' 을(를) 지울까요?`)) return;
      const { error } = await sb.rpc("vb_note_staff_del", { gid: G(), nm: b.dataset.del });
      if (error) return toast(error.message);
      toast("지웠어요"); vbLists(box);
    }));
    box.querySelectorAll("[data-wdel]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`화이트리스트에서 '${b.dataset.wdel}' 을(를) 지울까요?`)) return;
      const { error } = await sb.rpc("vb_white_staff_del", { gid: G(), uid: b.dataset.uid, nm: b.dataset.wdel });
      if (error) return toast(error.message);
      toast("지웠어요"); vbLists(box);
    }));
  }

  // ---------- 알림 멘션 ----------
  // 오른쪽 팔레트(@everyone · @here · 서버 역할)를 왼쪽 알림 칸에 끌어다 놓기. 휴대폰은 칩 누르고 → 칸 누르기.
  // 저장은 boss_settings.mentions (JSON: 알림 종류 → ["everyone" | "here" | 역할 ID]). 봇의 boss.py MENTION_SLOTS 와 같은 키.
  const MENTION_SLOTS = [
    ["boss_pre", "보스 출현 n분 전", "출현 알림 (설정한 몇 분 전)"],
    ["boss_spawn", "보스 출현 시각", "출현 시각 알림 + 음성"],
    ["raid_open", "레이드 등록 알림", "출현 n분 전 알림 · /레이드등록"],
    ["war_1h", "길드전 1시간 전", "일요일 19:00"],
    ["war_5m", "길드전 5분 전 · 레기온 모집", "일요일 19:55"],
    ["reserve", "예약 전투", "아카디아 등 예약 전투 알림 · 모집"],
  ];
  async function mentionCard() {
    const card = $("#m-card"); if (!card) return;
    const gid = G();
    const [roles, rows, gs] = await Promise.all([
      q(sb.from("web_roles").select("role_id::text,name,color,position,mentionable").eq("guild_id", gid).order("position", { ascending: false })),
      q(sb.from("boss_settings").select("mentions").eq("guild_id", gid)),
      q(sb.from("web_guilds").select("can_everyone").eq("guild_id", gid)),
    ]);
    if (G() !== gid || !$("#m-card")) return;
    const canAll = !!(gs[0] && gs[0].can_everyone);
    let map = {};
    try { map = JSON.parse((rows[0] && rows[0].mentions) || "{}") || {}; } catch (e) { map = {}; }
    MENTION_SLOTS.forEach(([k]) => (map[k] = (map[k] || []).map(String)));
    const hex = (c) => (c ? "#" + Number(c).toString(16).padStart(6, "0") : "#99aab5");
    const PAL = [
      { id: "everyone", name: "@everyone", color: "#fbbf24", special: true, ok: canAll },
      { id: "here", name: "@here", color: "#fb923c", special: true, ok: canAll },
      ...roles.map((r) => ({ id: r.role_id, name: "@" + r.name, color: hex(r.color), ok: canAll || !!r.mentionable })),
    ];
    const byId = (id) => PAL.find((r) => r.id === id);
    let picked = null, dirty = false;

    card.innerHTML = `
      <h2>📣 알림 멘션</h2>
      <p class="muted small">오른쪽 칩을 왼쪽 알림 칸에 끌어다 놓으세요. 휴대폰은 칩을 누르고 → 알림 칸을 누르면 돼요. 칩에 마우스를 올리면 연결된 칸이 표시돼요.
        역할을 새로 만들었으면 디스코드 관리판 [🔄 새로고침]을 누르면 바로 보여요.</p>
      <div class="mx">
        <div class="mx-slots" id="mx-slots"></div>
        <aside class="mx-palette">
          <h3>멘션 팔레트</h3>
          <div class="chips" id="mx-pal"></div>
          <p class="legend">⚠️ = 지금은 불러도 알림이 안 울려요 (역할의 '누구나 멘션 가능'이 꺼져 있고, 봇에게 '@everyone 멘션' 권한도 없음).
            아무것도 안 놓은 알림은 🔕 조용히 올라가요.</p>
        </aside>
      </div>
      <p style="margin-top:12px"><button class="primary" id="mx-save">멘션 저장</button> <span class="muted small" id="mx-sum"></span></p>`;

    function pal() {
      $("#mx-pal").innerHTML = PAL.map((r) => `<span class="pchip ${r.special ? "special" : ""} ${picked === r.id ? "sel" : ""}" draggable="true" data-role="${esc(r.id)}" style="--rc:${r.color}">
        <span class="dot"></span>${esc(r.name)}${r.ok ? "" : ` <span class="warn" title="지금은 안 울려요">⚠️</span>`}</span>`).join("")
        || `<span class="muted small">역할 정보가 아직 없어요. 관리판 [🔄 새로고침]을 눌러 주세요.</span>`;
    }
    function slots() {
      $("#mx-slots").innerHTML = MENTION_SLOTS.map(([k, name, note]) => `
        <div class="slot" data-slot="${k}">
          <div class="slot-head"><b>${name}</b><span class="muted">${note}</span></div>
          <div class="slot-drop">${map[k].filter(byId).map((id) => { const r = byId(id); return `<span class="tag ${r.ok ? "" : "warned"}" style="--rc:${r.color}">${esc(r.name)}<button data-rm="${esc(id)}" aria-label="빼기">✕</button></span>`; }).join("")}</div>
        </div>`).join("");
      const n = MENTION_SLOTS.filter(([k]) => map[k].some(byId)).length;
      $("#mx-sum").textContent = `알림 ${MENTION_SLOTS.length}개 중 ${n}개에 멘션 연결됨` + (dirty ? " · 저장 안 됨" : "");
    }
    function add(k, id) {
      if (!map[k].includes(id)) { map[k].push(id); dirty = true; }
      const r = byId(id);
      if (r && !r.ok) toast(`${r.name}: 지금은 불러도 알림이 안 울려요 (⚠️ 설명 참고)`);
      slots();
    }
    pal(); slots();
    const S = $("#mx-slots"), P = $("#mx-pal");
    P.addEventListener("dragstart", (e) => { const c = e.target.closest("[data-role]"); if (c) e.dataTransfer.setData("text/plain", c.dataset.role); });
    S.addEventListener("dragover", (e) => { const s = e.target.closest(".slot"); if (s) { e.preventDefault(); s.classList.add("over"); } });
    S.addEventListener("dragleave", (e) => { const s = e.target.closest(".slot"); if (s && !s.contains(e.relatedTarget)) s.classList.remove("over"); });
    S.addEventListener("drop", (e) => {
      const s = e.target.closest(".slot"); if (!s) return;
      e.preventDefault(); s.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain"); if (id && byId(id)) add(s.dataset.slot, id);
    });
    P.addEventListener("click", (e) => {
      const c = e.target.closest("[data-role]"); if (!c) return;
      picked = picked === c.dataset.role ? null : c.dataset.role;
      pal();
      S.querySelectorAll(".slot").forEach((s) => s.classList.toggle("pick", !!picked));
      if (picked) toast("이제 연결할 알림 칸을 누르세요");
    });
    S.addEventListener("click", (e) => {
      const rm = e.target.closest("button[data-rm]");
      if (rm) { const k = rm.closest(".slot").dataset.slot; map[k] = map[k].filter((x) => x !== rm.dataset.rm); dirty = true; slots(); return; }
      const s = e.target.closest(".slot");
      if (s && picked) { add(s.dataset.slot, picked); picked = null; pal(); S.querySelectorAll(".slot").forEach((x) => x.classList.remove("pick")); }
    });
    P.addEventListener("mouseover", (e) => {
      const c = e.target.closest("[data-role]");
      S.querySelectorAll(".slot").forEach((s) => s.classList.toggle("lit", !!c && map[s.dataset.slot].includes(c.dataset.role)));
    });
    P.addEventListener("mouseleave", () => S.querySelectorAll(".slot").forEach((s) => s.classList.remove("lit")));
    $("#mx-save").onclick = async () => {
      const clean = {};
      MENTION_SLOTS.forEach(([k]) => { const v = map[k].filter(byId); if (v.length) clean[k] = v; });
      await q(sb.from("boss_settings").upsert({ guild_id: G(), mentions: JSON.stringify(clean) }, { onConflict: "guild_id" }));
      dirty = false; slots(); toast("알림 멘션을 저장했어요");
    };
  }

  // ---------- 구글 시트 ----------
  // 연결: google_begin() 으로 state 를 받아 구글 허용 팝업 → google.html 이 코드를 넘김 → 봇이 시트를 만듦
  const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
  const googleRedirect = () => cfg.GOOGLE_REDIRECT;
  async function sheetCard() {
    const card = $("#g-card"); if (!card) return;
    const gid = G();
    const [rows, bks] = await Promise.all([
      q(sb.from("google_links").select("sheet_url,synced_at,error").eq("guild_id", gid)),
      q(sb.rpc("google_backup_info", { gid })),
    ]);
    if (G() !== gid || !$("#g-card")) return;
    const l = rows[0], bk = bks[0];
    const backup = `<h3 style="margin-top:16px">💾 백업 드라이브 ${bk ? `<span class="badge ${bk.error ? "off" : "boss"}">${bk.error ? "확인 필요" : "연결됨"}</span>` : ""}</h3>
      <p class="muted small">게시판 청소 때 첨부 파일(스샷 등)을 보관할 구글 계정이에요. 따로 연결 안 하면 구글 시트 계정 드라이브에 보관해요.</p>
      ${bk ? `${bk.error ? `<p style="color:var(--bad)">⚠️ ${esc(bk.error)}</p>` : ""}<div class="row">${bk.folder_url ? `<a href="${esc(bk.folder_url)}" target="_blank" rel="noopener"><button>백업 폴더 열기</button></a>` : ""}
        <button id="b-relink">다시 연결</button><button class="danger ghost" id="b-unlink">연결 끊기</button></div>`
        : `<button id="b-link">백업 드라이브 연결</button>`}`;
    const wireBackup = () => {
      const c = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
      c("#b-link", () => connectGoogle("backup")); c("#b-relink", () => connectGoogle("backup"));
      c("#b-unlink", async () => {
        if (!confirm("백업 드라이브 연결을 끊을까요? 이미 보관한 파일은 드라이브에 그대로 남아요.")) return;
        await q(sb.rpc("google_unlink_backup", { gid: G() }));
        toast("백업 드라이브 연결을 끊었어요"); sheetCard();
      });
    };
    const howto = `<p class="muted small">구글 계정으로 허용하면 그 계정 드라이브에 <b>'벨라꼬붕 출석 기록'</b> 시트를 만들고, 10분마다 요약 · 주간 순위 · 참여 상세 · 보스 컷 기록을 채워요.
      봇은 자기가 만든 시트만 다룰 수 있어요. 기존 시트에서 쓰려면 <code>=IMPORTRANGE("시트 주소", "주간 순위!A1:G300")</code> 로 끌어가세요.</p>`;
    if (!l) {
      card.innerHTML = `<h2>📊 구글 시트</h2>${howto}<button class="primary" id="g-link">구글 시트 연결</button>${backup}`;
      $("#g-link").onclick = () => connectGoogle("sheet");
      wireBackup();
      return;
    }
    const when = l.synced_at ? fmtDate(l.synced_at) : "아직";
    card.innerHTML = `<h2>📊 구글 시트 <span class="badge ${l.error ? "off" : "boss"}">${l.error ? "확인 필요" : "연결됨"}</span></h2>
      ${l.error ? `<p style="color:var(--bad)">⚠️ ${esc(l.error)}</p>` : `<p class="muted small">마지막 갱신: ${when} · 10분마다 갱신돼요</p>`}
      <div class="row"><a href="${esc(l.sheet_url)}" target="_blank" rel="noopener"><button class="primary">시트 열기</button></a>
      <button id="g-relink">다시 연결</button><button class="danger ghost" id="g-unlink">연결 끊기</button></div>${backup}`;
    $("#g-relink").onclick = () => connectGoogle("sheet");
    wireBackup();
    $("#g-unlink").onclick = async () => {
      if (!confirm("구글 시트 연결을 끊을까요? 시트 파일은 드라이브에 그대로 남아요.")) return;
      await q(sb.rpc("google_unlink", { gid: G() }));
      toast("연결을 끊었어요"); sheetCard();
    };
  }
  async function connectGoogle(purpose = "sheet") {
    const popup = window.open("about:blank", "google-link", "width=520,height=680");
    let st;
    try { st = await q(sb.rpc("google_begin", { gid: G(), purpose })); }
    catch (e) { popup && popup.close(); return; }
    const url = GOOGLE_AUTH + "?" + new URLSearchParams({
      client_id: cfg.GOOGLE_CLIENT_ID, redirect_uri: googleRedirect(), response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file", access_type: "offline", prompt: "consent", state: st,
    });
    if (popup) popup.location = url; else location.href = url;
    toast("구글 창에서 허용해 주세요");
  }
  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.data === "google-linked") { toast("구글 계정을 연결했어요"); sheetCard(); }
  });

  // ---------- 레기온 ----------
  function nextSunday() {
    const p = kstParts(new Date().toISOString());
    const add = (6 - p.wd + 7) % 7;
    const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + add));
    return { key: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`, label: `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}(일)` };
  }
  async function battlesTab(v) {
    const sun = nextSunday();
    const [choice, res] = await Promise.all([
      q(sb.from("war_choice").select("name").eq("guild_id", G()).eq("day", sun.key)),
      q(sb.from("battle_reservations").select("id::text,name,at,open_before,close_after,kind").eq("guild_id", G()).eq("canceled", 0).gte("at", kstIso(new Date())).order("at")),
    ]);
    const cur = choice[0]?.name || "엘리시움";
    v.innerHTML = `
      <div class="card">
        <h2>🛡️ ${sun.label} 20:00 길드전</h2>
        <p class="muted small">레기온 모집: 엘리시움 19:55~21:05 · 공성/요새전 19:55~20:35. 해당없음(이전하는 날 등)이면 모집 · 알림을 안 열어요. 고르지 않으면 엘리시움. 당일 오전 10시엔 디스코드 매뉴얼 채널에서도 물어봐요.</p>
        <div class="row">${[["엘리시움", "엘리시움"], ["공성/요새전", "공성/요새전"], ["해당없음", "해당없음 (이전·기타)"]].map(([n, t]) => `<button data-war="${n}" class="${n === cur ? "primary" : ""}">${t}</button>`).join("")}</div>
      </div>
      <div class="card">
        <h2>예약 전투</h2>
        ${res.length ? `<table><thead><tr><th>일시</th><th>이름</th><th>종류</th><th>레기온 모집</th><th></th></tr></thead><tbody>
          ${res.map((r) => `<tr><td>${fmtDate(r.at)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.kind || BATTLE_DEFAULT)}</td><td>시작 ${r.open_before}분 전 ~ 시작 후 ${r.close_after}분</td>
            <td><button class="danger ghost" data-cancel="${r.id}">취소</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted">예약된 전투가 없어요.</p>`}
      </div>
      <div class="card">
        <h2>전투 예약하기</h2>
        <div class="grid">
          <label class="field">이름<input id="r-name" value="아카디아 제전"></label>
          <label class="field">종류 (출석표)<select id="r-kind">${BATTLE_TYPES.map((t) => `<option ${t === BATTLE_DEFAULT ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label class="field">시작 일시 (한국 시간)<input id="r-at" type="datetime-local"></label>
          <label class="field">모집: 시작 몇 분 전<input id="r-open" type="number" min="0" value="5"></label>
          <label class="field">마감: 시작 후 몇 분<input id="r-close" type="number" min="1" value="30"></label>
        </div>
        <p><button class="primary" id="r-add">예약</button></p>
      </div>`;
    v.querySelectorAll("[data-war]").forEach((b) => (b.onclick = async () => {
      await q(sb.from("war_choice").upsert({ guild_id: G(), day: sun.key, name: b.dataset.war }, { onConflict: "guild_id,day" }));
      toast(`${sun.label} 길드전: ${b.dataset.war}`); render();
    }));
    v.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => {
      if (!confirm("이 예약을 취소할까요?")) return;
      await q(sb.from("battle_reservations").update({ canceled: 1 }).eq("guild_id", G()).eq("id", b.dataset.cancel));
      toast("예약을 취소했어요"); render();
    }));
    $("#r-add").onclick = async () => {
      const at = $("#r-at").value;
      if (!at) return toast("시작 일시를 골라 주세요", true);
      await q(sb.from("battle_reservations").insert({
        guild_id: G(), name: $("#r-name").value.trim() || "전투", at: `${at.length === 16 ? at + ":00" : at}+09:00`,
        open_before: +$("#r-open").value || 0, close_after: Math.max(1, +$("#r-close").value || 30), created_by: state.me.id,
        kind: $("#r-kind").value,
      }));
      toast("예약했어요"); render();
    };
  }

  // ---------- 출석 ----------
  // 출석 구간 (체크포인트): 자동 주기(시작일 + N일마다 0시) ∪ 수동 체크포인트. 봇의 checkpoints.py 와 같은 계산
  async function segmentsOf(gid) {
    const [st, cps] = await Promise.all([
      q(sb.from("boss_settings").select("cp_start,cp_days,att_from").eq("guild_id", gid)),
      q(sb.from("checkpoints").select("at,name").eq("guild_id", gid)),
    ]);
    const segs = segmentsFrom(st[0]?.cp_start, st[0]?.cp_days, cps, st[0]?.att_from);
    segs.attFrom = st[0]?.att_from || null;
    return segs;
  }
  // 보관 기준(att_from) 이전 기록은 보관: 그 시각이 첫 경계, 그 전 구간은 안 보임
  function segmentsFrom(cpStart, cpDays, cps, attFrom) {
    const nowMs = Date.now(), b = new Map();
    const s0 = { cp_start: cpStart, cp_days: cpDays };
    if (s0.cp_start && s0.cp_days > 0) {
      let t = Date.parse(`${s0.cp_start}T00:00:00+09:00`);
      while (t <= nowMs + (s0.cp_days + 1) * 864e5) { b.set(t, ""); t += s0.cp_days * 864e5; }
    }
    for (const c of cps) b.set(Date.parse(c.at), c.name || "");
    if (attFrom) {
      const f = Date.parse(attFrom);
      for (const t of [...b.keys()]) if (t < f) b.delete(t);
      if (!b.has(f)) b.set(f, "");
    }
    const ts = [...b.keys()].sort((a, c) => a - c);
    const md = (ms) => { const p = kstParts(new Date(ms).toISOString()); return `${pad(p.mo)}/${pad(p.d)}`; };
    const out = [];
    ts.forEach((t, i) => {
      if (t > nowMs) return;
      const e = ts[i + 1];
      const name = b.get(t);
      out.push({ start: kstIso(new Date(t)), end: e ? kstIso(new Date(e)) : null,
                 label: `${name ? name + " · " : ""}${md(t)}~${e ? md(e - 6e4) : "지금"}` });
    });
    return out.reverse();
  }

  async function attendanceTab(v) {
    const now = kstParts(new Date().toISOString());
    const segs = await segmentsOf(G());
    // 기본: 지금 구간 (체크포인트가 없으면 이번 달)
    if (state.period === undefined) state.period = segs.length ? "seg:0" : "month";
    const month = state.month || `${now.y}-${pad(now.mo)}`;
    const [y, mo] = month.split("-").map(Number);
    let start = `${y}-${pad(mo)}-01T00:00:00+09:00`;
    let end = mo === 12 ? `${y + 1}-01-01T00:00:00+09:00` : `${y}-${pad(mo + 1)}-01T00:00:00+09:00`;
    let periodLabel = `${y}년 ${mo}월`;
    const af = segs.attFrom, afMd = af ? af.slice(5, 10).replace("-", "/") : "";
    if (state.period === "archive" && !(state.botOwner && af)) state.period = segs.length ? "seg:0" : "month";
    if (state.period.startsWith("seg:") && segs[+state.period.slice(4)]) {
      const sg = segs[+state.period.slice(4)];
      start = sg.start; end = sg.end || "2999-01-01T00:00:00+09:00"; periodLabel = sg.label;
    } else if (state.period === "archive") {      // 봇 주인만: 보관 기준 이전 기록
      start = "2000-01-01T00:00:00+09:00"; end = af; periodLabel = `🗄️ 보관 기록 (~${afMd} 전)`;
    } else if (af && start < af) {               // 월별: 보관 기준 이전은 빠짐
      if (end <= af) { start = end; periodLabel += " (보관 기간 — 기록 안 보임)"; }
      else { start = af; periodLabel += ` (${afMd}부터)`; }
    }
    const [raids, bosses, stRows, anyBattle] = await Promise.all([
      q(sb.from("raids").select("id::text,boss,killed_at,category,battle_type,kill_id::text,closed,canceled").eq("guild_id", G()).eq("canceled", 0).gte("killed_at", start).lt("killed_at", end).order("killed_at", { ascending: false })),
      q(sb.from("bosses").select("name,display,kind").eq("guild_id", G()).order("name")),
      q(sb.from("boss_settings").select("att_boss_view,att_battle_view,att_farm,att_war_off,att_practice,att_cats,att_score").eq("guild_id", G())),
      q(sb.from("raids").select("id").eq("guild_id", G()).eq("category", "battle").limit(1)),   // 출석 분류 추천: 전투 기록이 있는지
    ]);
    const label = Object.fromEntries(bosses.map((b) => [b.name, b.display || b.name]));
    // 출석 보기 (길드 전체): 봇 att_view.py · DB att_in_view 와 같은 계산
    const av = attView(stRows[0]);
    const inView = attFilter(av);
    const btype = (r) => r.battle_type || BATTLE_DEFAULT;
    const counted = raids.filter((r) => (r.kill_id || r.category === "battle") && inView(r));
    // 기록 목록은 전부 (출석 보기에서 빠진 것도) — '출석 제외' 표시. 콘텐츠 참여는 목록에만 (순위 대상 아님)
    const shown = raids.filter((r) => r.kill_id || r.category === "battle" || r.category === "event");
    const excluded = (r) => r.category !== "event" && !inView(r);
    const KIND = { battle: ["battle", "🛡️ 전투", "전투"], event: ["event", "📋 콘텐츠", "콘텐츠"] };
    const kind = (r) => r.category === "battle" ? ["battle", `🛡️ ${btype(r)}`, `전투 · ${btype(r)}`] : KIND[r.category] || ["boss", "⚔️ 보스", "보스레이드"];
    let members = [];
    for (let i = 0; i < shown.length; i += 100) {
      const ids = shown.slice(i, i + 100).map((r) => r.id);
      members = members.concat(await q(sb.from("web_raid_attend").select("raid_id,user_id,display_name,joined_at").in("raid_id", ids)));
    }
    const byRaid = {}, people = {};
    for (const m of members) {
      (byRaid[m.raid_id] ||= []).push(m);
    }
    // 순위: 시트 '주간 순위'와 같은 두 블록 — [출석] = 출석 보기 기준, [전체] = 빠진 보스 · 전투까지. 블록 안 순서 = 합계 · 보스 · 전투 · 종류별 · 보류분
    const types = av.battle_view === "practice" ? BATTLE_TYPES.filter((t) => av.practice.includes(t)) : BATTLE_TYPES;
    const inT = (t) => types.includes(t);
    const blk = () => ({ total: 0, boss: 0, battle: 0, t: {} });
    for (const r of raids.filter((x) => x.kill_id || x.category === "battle")) {
      for (const m of byRaid[r.id] || []) {
        const p = (people[m.user_id] ||= { id: m.user_id, name: m.display_name, sel: blk(), all: blk() });
        p.name = m.display_name;
        for (const b of inView(r) ? [p.sel, p.all] : [p.all]) {
          b.total++;
          if (r.category === "battle") { b.battle++; b.t[btype(r)] = (b.t[btype(r)] || 0) + 1; } else b.boss++;
        }
      }
    }
    const rank = Object.values(people).sort((a, b) => b.sel.total - a.sel.total || b.all.total - a.all.total || a.name.localeCompare(b.name));
    // 출석 보류분: 공격대 스샷에서 디스코드와 못 맞춘 게임 닉 (순위 번호 없이 맨 아래). [출석] · [전체] 따로. 맞춰지면 자동으로 사라지고 위로 올라감.
    const pending = await q(sb.rpc("web_pending_attend", { gid: G(), s: start, e: end })).catch(() => []);
    const pendingAll = await q(sb.rpc("web_pending_attend_all", { gid: G(), s: start, e: end })).catch(() => pending);
    const pSel = Object.fromEntries(pending.map((x) => [x.nick, x.cnt]));
    const pNicks = pendingAll.map((x) => ({ nick: x.nick, all: x.cnt, sel: pSel[x.nick] || 0 })).sort((a, b) => b.sel - a.sel || b.all - a.all);
    const nb = counted.filter((r) => r.category !== "battle").length;
    const nt = (t) => counted.filter((r) => r.category === "battle" && btype(r) === t).length;
    const ranked = rank.filter((p) => p.sel.total);
    const cells = (b, pend, sel) => [b.total, b.boss, b.battle, ...BATTLE_TYPES.map((t) => (sel && !inT(t) ? "-" : b.t[t] || 0)), pend];
    const HEAD = ["합계", "보스", "전투", ...BATTLE_TYPES, "보류분"];
    const ncol = 3 + HEAD.length * 2;
    const chk = (cls, val, on) => `<label class="chk"><input type="checkbox" class="${cls}" value="${esc(val)}" ${on ? "checked" : ""}> ${esc(label[val] || val)}</label>`;
    const extra = av.boss_view === "farmers" ? av.farm.filter((n) => !label[n]) : [];   // 목록에 없는 이름(지운 보스 등)도 보이게
    v.innerHTML = `
      <div class="card">
        <h2>👁️ 출석 보기 <span class="muted small">(길드 전체 적용)</span></h2>
        <p class="muted small">여기서 고른 대로 웹 출석 · 디스코드 /참여통계 · /내참여 · 구글 시트가 모두 같이 바뀌어요. 기록은 그대로 있고, 세는 범위만 바뀌어요.</p>
        <div class="row"><b>보스</b>
          ${Object.entries(BOSS_VIEWS).map(([k, t]) => `<button data-bview="${k}" class="${av.boss_view === k ? "primary" : ""}">${t}</button>`).join("")}
          <b style="margin-left:16px">전투</b>
          ${Object.entries(BATTLE_VIEWS).map(([k, t]) => `<button data-tview="${k}" class="${av.battle_view === k ? "primary" : ""}">${t}</button>`).join("")}</div>
        ${av.boss_view === "farmers"
          ? `<details open><summary><b>🌾 파머스에 넣을 보스</b> <span class="muted small">${av.farm.length}종 · 기본은 인터보스 5종</span></summary>
              <div class="members">${bosses.map((b) => chk("farm-b", b.name, av.farm.includes(b.name))).join("")}${extra.map((n) => chk("farm-b", n, true)).join("")}</div>
              <p><button id="farm-reset">기본으로 (인터보스 5종)</button></p></details>`
          : `<details open><summary><b>⚔️ 워페어에 넣을 보스</b> <span class="muted small">${bosses.length - bosses.filter((b) => av.war_off.includes(b.name)).length}/${bosses.length}종 · 기본은 전부, 새 보스는 자동으로 들어가요</span></summary>
              <div class="members">${bosses.map((b) => chk("war-b", b.name, !av.war_off.includes(b.name))).join("")}</div>
              <p><button id="war-reset">전부 넣기</button></p></details>`}
        ${av.battle_view === "practice"
          ? `<details open><summary><b>🎯 프랙티스에 넣을 전투</b> <span class="muted small">${types.length}/${BATTLE_TYPES.length}종</span></summary>
              <div class="members">${BATTLE_TYPES.map((t) => chk("prac-t", t, av.practice.includes(t))).join("")}</div></details>`
          : `<p class="muted small">🛡️ 베이직: 전투 ${BATTLE_TYPES.join(" · ")} 전부 들어가요.</p>`}
      </div>
      <div class="card" id="cats-box"></div>
      <div class="card" id="score-box"></div>
      <div class="card">
        <div class="row"><h2 style="margin:0">출석 <span class="muted small">${BOSS_VIEWS[av.boss_view]} + ${BATTLE_VIEWS[av.battle_view]}</span></h2>
          <select id="a-period"><option value="month" ${state.period === "month" ? "selected" : ""}>월별</option>
            ${segs.map((sg, i) => `<option value="seg:${i}" ${state.period === `seg:${i}` ? "selected" : ""}>📍 ${esc(sg.label)}</option>`).join("")}
            ${state.botOwner && af ? `<option value="archive" ${state.period === "archive" ? "selected" : ""}>🗄️ 보관 기록 (${esc(afMd)} 전 · 봇 주인만)</option>` : ""}</select>
          <input type="month" id="a-month" value="${month}" ${state.period === "month" ? "" : "hidden"}>
          <button id="a-csv1">명단 CSV</button><button id="a-csv2">순위 CSV</button></div>
        <p class="muted">${esc(periodLabel)} · ⚔️ 보스레이드 ${nb}회${types.map((t) => ` · 🛡️ ${esc(t)} ${nt(t)}회`).join("")} · 참여한 사람 ${rank.length}명${pNicks.length ? ` · 디스코드 미확인 ${pNicks.length}명` : ""}${shown.filter(excluded).length ? ` · 출석 제외 ${shown.filter(excluded).length}회` : ""}${shown.some((r) => r.category === "event") ? ` · 📋 콘텐츠 참여 ${shown.filter((r) => r.category === "event").length}회 (순위엔 안 넣음)` : ""}</p>
        <p class="muted small">시트 '주간 순위'와 같은 순서예요. <b class="blk-sel">[출석]</b> = 위 출석 보기로 센 출석(순위 기준, '-' = 이 보기에서 안 세는 종류) · <b class="blk-all">[전체]</b> = 빠진 보스 · 전투까지 다 센 참여. 보류분 = 공격대 사진에 있었는데 디스코드와 아직 못 맞춘 횟수.</p>
        <div class="table-wrap"><table class="rank two-blk"><thead>
          <tr><th rowspan="2">#</th><th rowspan="2">이름</th><th colspan="${HEAD.length}" class="blk-sel">[출석]</th><th colspan="${HEAD.length}" class="blk-all">[전체]</th><th rowspan="2">디스코드</th></tr>
          <tr>${HEAD.map((h) => `<th class="blk-sel">${esc(h)}</th>`).join("")}${HEAD.map((h) => `<th class="blk-all">${esc(h)}</th>`).join("")}</tr></thead><tbody>
          ${rank.map((p) => `<tr><td>${p.sel.total ? ranked.indexOf(p) + 1 : ""}</td><td>${esc(p.name)}</td>${cells(p.sel, 0, true).map((c, j) => `<td class="blk-sel">${j === 0 ? `<b>${c}</b>` : c}</td>`).join("")}${cells(p.all, 0, false).map((c) => `<td class="blk-all">${c}</td>`).join("")}<td>${esc(p.name)}</td></tr>`).join("") || (pNicks.length ? "" : `<tr><td colspan="${ncol}" class="muted">기록 없음</td></tr>`)}
          ${pNicks.map((p) => `<tr class="pending-row"><td></td><td>${esc(p.nick)}</td>${cells(blk(), p.sel, true).map((c) => `<td class="blk-sel">${c}</td>`).join("")}${cells(blk(), p.all, false).map((c) => `<td class="blk-all">${c}</td>`).join("")}<td class="muted">(미확인)</td></tr>`).join("")}
        </tbody></table></div>
      </div>
      <div class="card">
        <h2>레이드·전투·콘텐츠 기록</h2>
        <p class="muted small">기록은 전부 보여요. '출석 제외'는 지금 출석 보기에서 빠져 순위에 안 세는 기록이에요. 이름 옆 ×로 명단에서 빼고, 아래 칸에서 이번 달 참여자 중 골라 넣을 수 있어요. 전투는 종류(출석표)를 바꿀 수 있어요. 디스코드 메시지의 명단은 다음에 그 메시지가 갱신될 때 맞춰져요.</p>
        ${shown.map((r) => {
          const ms = byRaid[r.id] || [];
          return `<details data-raid="${r.id}"><summary>
              <span class="badge ${kind(r)[0]}">${esc(kind(r)[1])}</span>
              <b>${esc(label[r.boss] || r.boss)}</b> <span class="muted">${fmtDate(r.killed_at)} · ${ms.length}명</span>${excluded(r) ? ` <span class="badge off" title="지금 출석 보기에서 빠진 기록 — 순위에 안 셈">출석 제외</span>` : ""}</summary>
            ${r.category === "battle" ? `<div class="row" style="padding-left:22px">종류 <select class="set-type">${BATTLE_TYPES.map((t) => `<option ${t === btype(r) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>` : ""}
            <div class="members">${ms.map((m) => `<span class="member">${esc(m.display_name)}<button title="빼기" data-rm="${m.user_id}">×</button></span>`).join("")}</div>
            <div class="row" style="padding-left:22px"><select class="add-who"><option value="">+ 추가할 사람</option>
              ${rank.filter((p) => !ms.some((m) => m.user_id === p.id)).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
          </details>`;
        }).join("") || `<p class="muted">기록 없음</p>`}
      </div>`;
    // 출석 보기 저장 (boss_settings, 길드 전체)
    const saveView = async (patch, msg) => {
      await q(sb.from("boss_settings").upsert({ guild_id: G(), ...patch }, { onConflict: "guild_id" }));
      toast(msg); render();
    };
    v.querySelectorAll("[data-bview]").forEach((b) => (b.onclick = () => saveView({ att_boss_view: b.dataset.bview }, `보스: ${BOSS_VIEWS[b.dataset.bview]}`)));
    v.querySelectorAll("[data-tview]").forEach((b) => (b.onclick = () => saveView({ att_battle_view: b.dataset.tview }, `전투: ${BATTLE_VIEWS[b.dataset.tview]}`)));
    const picked = (cls) => [...v.querySelectorAll(`.${cls}`)].filter((x) => x.checked).map((x) => x.value);
    v.querySelectorAll(".farm-b").forEach((x) => (x.onchange = () => saveView({ att_farm: JSON.stringify(picked("farm-b")) }, "파머스 보스를 바꿨어요")));
    v.querySelectorAll(".war-b").forEach((x) => (x.onchange = () =>
      saveView({ att_war_off: JSON.stringify([...v.querySelectorAll(".war-b")].filter((c) => !c.checked).map((c) => c.value)) }, "워페어 보스를 바꿨어요")));
    v.querySelectorAll(".prac-t").forEach((x) => (x.onchange = () => saveView({ att_practice: JSON.stringify(picked("prac-t")) }, "프랙티스 전투를 바꿨어요")));
    const fr = $("#farm-reset"); if (fr) fr.onclick = () => saveView({ att_farm: null }, "파머스: 기본(인터보스 5종)");
    const wr = $("#war-reset"); if (wr) wr.onclick = () => saveView({ att_war_off: null }, "워페어: 전체 보스");
    catsEditor($("#cats-box"), bosses, stRows[0], label, saveView, anyBattle.length > 0);
    scoreEditor($("#score-box"), bosses, stRows[0], label);
    $("#a-month").onchange = (e) => { state.month = e.target.value; render(); };
    $("#a-period").onchange = (e) => { state.period = e.target.value; render(); };
    v.querySelectorAll("details[data-raid]").forEach((d) => {
      const rid = d.dataset.raid;
      const st = d.querySelector(".set-type");
      if (st) st.onchange = async () => {
        await q(sb.rpc("web_set_battle_type", { rid, t: st.value }));
        toast(`종류: ${st.value}`); render();
      };
      d.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
        await q(sb.from("raid_members").delete().eq("raid_id", rid).eq("user_id", b.dataset.rm));
        toast("명단에서 뺐어요"); render();
      }));
      d.querySelector(".add-who").onchange = async (e) => {
        const p = people[e.target.value]; if (!p) return;
        await q(sb.from("raid_members").insert({ raid_id: rid, user_id: p.id, display_name: p.name, joined_at: kstIso(new Date()), added_by: state.me.id }));
        toast(`${p.name} 추가했어요`); render();
      };
    });
    const download = (name, rows) => {
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name; a.click();
    };
    const fname = (what) => `${what}_${periodLabel.replace(/[^0-9가-힣a-zA-Z~]+/g, "_")}.csv`;
    $("#a-csv1").onclick = () => download(fname("출석명단"), [["날짜", "종류", "보스·전투", "인원", "참여자", "출석 포함"],
      ...shown.map((r) => [fmtDate(r.killed_at), kind(r)[2], label[r.boss] || r.boss,
        (byRaid[r.id] || []).length, (byRaid[r.id] || []).map((m) => m.display_name).join(", "),
        r.category === "event" ? "-" : excluded(r) ? "X" : "O"])]);
    // 순위 CSV: 시트 '주간 순위'와 같은 열 (월 · 디스코드 ID 대신 순위 · 이름부터)
    const csvHead = ["순위", "이름", ...HEAD.map((h) => `[출석] ${h}`), ...HEAD.map((h) => `[전체] ${h}`), "디스코드"];
    $("#a-csv2").onclick = () => download(fname("출석순위"), [csvHead,
      ...rank.map((p) => [p.sel.total ? ranked.indexOf(p) + 1 : "", p.name, ...cells(p.sel, 0, true), ...cells(p.all, 0, false), p.name]),
      ...pNicks.map((p) => ["", p.nick, ...cells(blk(), p.sel, true), ...cells(blk(), p.all, false), "(미확인)"])]);
  }

  // 출석 분류 (봇 att_view.py 의 suggest_cats · clean_cats 와 같은 값) — 구글 시트 '요약' 보기 칸 · '주간 순위' 기준
  // 관리자가 입력 · 편집. 비어 있으면 분류 없음 (시트엔 보스 · 전투 출석만). 추천은 [추천 적용] 해야 들어감.
  const CAT_SCOPES = { boss: "보스", battle: "전투", any: "전부" };
  const GUILD_WAR = ["공성/요새전", "점령전", "엘리시움", "길드레이드"];
  const CAT_MAX = 12;
  const CAT_RESERVED = ["합계", "보스", "전투", "합계 출석", "보스 출석", "전투 출석"];
  const KIND_LABEL = { inter: "인터서버 보스", main: "본토 보스" };
  const catLabel = (n) => (n.endsWith("출석") ? n : `${n} 출석`);
  const isRest = (c) => c.scope === "any" && !c.kinds.length && !c.bosses.length && !c.types.length;
  function suggestCats(bosses, hasBattle) {
    const out = [], kinds = new Set(bosses.map((b) => b.kind || "main"));
    if (kinds.has("inter")) out.push({ name: "인터보스", scope: "boss", kinds: ["inter"], bosses: [], types: [] });
    if ([...kinds].some((k) => k !== "inter")) out.push({ name: "일반보스", scope: "boss", kinds: [], bosses: [], types: [] });
    if (hasBattle) out.push({ name: "길드전투", scope: "battle", kinds: [], bosses: [], types: [...GUILD_WAR] });
    out.push({ name: "기타", scope: "any", kinds: [], bosses: [], types: [] });
    return out;
  }
  function cleanCats(v) {
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
    if (!Array.isArray(v)) return null;
    const out = [], seen = new Set();
    const strs = (x) => (Array.isArray(x) ? x.map((y) => String(y).slice(0, 60)).slice(0, 200) : []);
    for (const c of v.slice(0, CAT_MAX)) {
      if (!c || typeof c !== "object") continue;
      const name = String(c.name || "").replace(/\s+/g, " ").trim().replace(/^[=+\-@']+/, "").trim().slice(0, 20);
      if (!name || seen.has(name) || CAT_RESERVED.includes(name) || CAT_RESERVED.includes(catLabel(name))) continue;
      seen.add(name);
      out.push({ name, scope: CAT_SCOPES[c.scope] ? c.scope : "any", kinds: strs(c.kinds), bosses: strs(c.bosses), types: strs(c.types) });
    }
    return out;
  }
  function catsEditor(box, bosses, st, label, saveView, hasBattle) {
    const saved = cleanCats(st?.att_cats) || [];
    // 편집용: 보통 분류 목록 + 맨 끝 '나머지 전부' 칸(켜고 끔)
    let cats, rest;
    const split = (list) => {
      const l = JSON.parse(JSON.stringify(list));
      const last = l[l.length - 1];
      rest = last && isRest(last) ? { on: true, name: l.pop().name } : { on: false, name: "기타" };
      cats = l;
    };
    split(saved);
    const kinds = [...new Set(bosses.map((b) => b.kind || "main"))];
    const ck = (cls, i, val, on, text) => `<label class="chk"><input type="checkbox" class="${cls}" data-i="${i}" value="${esc(val)}" ${on ? "checked" : ""}> ${esc(text)}</label>`;
    const restOf = { boss: "나머지 보스 전부", battle: "나머지 전투 전부", any: "나머지 전부 (보스 · 전투)" };
    const open = new Set();
    let dirty = false;
    const draw = (msg) => {
      const sug = suggestCats(bosses, hasBattle);
      box.innerHTML = `
        <h2>🗂️ 출석 분류 <span class="muted small">(구글 시트 '요약' 보기 칸 · '주간 순위' 기준 · 길드 전체)</span></h2>
        <p class="muted small">출석 보기로 센 기록을 <b>위에서부터</b> 보고 처음 맞는 분류 하나에만 넣어요 (두 번 안 셈). 규칙을 하나도 안 고른 분류 = 앞 분류에 안 든 나머지(그 범위 전부).
          ${saved.length ? "" : "<b>지금은 분류가 없어요</b> — 시트엔 보스 · 전투 출석만 나와요."}</p>
        <p class="muted small">추천: ${sug.map((c) => esc(c.name)).join(" · ")} <button id="cat-suggest">추천 적용</button> <span class="muted small">(채워 넣기만 — 고친 뒤 저장)</span></p>
        ${cats.map((c, i) => `<div class="cat-row" style="border-top:1px solid var(--line, #ddd);padding:8px 0">
          <div class="row"><b>${i + 1}.</b> <input class="cat-name" data-i="${i}" value="${esc(c.name)}" maxlength="20" style="width:9em">
            <select class="cat-scope" data-i="${i}">${Object.entries(CAT_SCOPES).map(([k, t]) => `<option value="${k}" ${c.scope === k ? "selected" : ""}>${t}</option>`).join("")}</select>
            <button class="cat-up" data-i="${i}" ${i ? "" : "disabled"}>↑</button><button class="cat-down" data-i="${i}" ${i < cats.length - 1 ? "" : "disabled"}>↓</button>
            <button class="cat-del" data-i="${i}">빼기</button>
            <span class="muted small">시트 칸: ${esc(catLabel(c.name || "?"))}${c.kinds.length || c.bosses.length || c.types.length ? "" : ` · <b>${restOf[c.scope]}</b>`}</span></div>
          <details data-i="${i}" ${open.has(i) ? "open" : ""}><summary class="muted small">규칙 고르기 (보스 구분 · 보스 · 전투 종류 중 하나라도 맞으면)</summary>
            ${c.scope !== "battle" ? `<div class="members"><span class="muted small">보스 구분</span> ${kinds.map((k) => ck("cat-kind", i, k, c.kinds.includes(k), KIND_LABEL[k] || k)).join("")}</div>
              <div class="members"><span class="muted small">보스</span> ${bosses.map((b) => ck("cat-boss", i, b.name, c.bosses.includes(b.name), label[b.name] || b.name)).join("")}</div>` : ""}
            ${c.scope !== "boss" ? `<div class="members"><span class="muted small">전투 종류</span> ${BATTLE_TYPES.map((t) => ck("cat-type", i, t, c.types.includes(t), t)).join("")}</div>` : ""}
          </details></div>`).join("") || `<p class="muted small">분류 없음</p>`}
        <div class="row" style="border-top:1px solid var(--line, #ddd);padding:8px 0">
          <label class="chk"><input type="checkbox" id="cat-rest" ${rest.on ? "checked" : ""}> 맨 끝에 <b>나머지 전부</b> 칸 넣기</label>
          <input id="cat-rest-name" value="${esc(rest.name)}" maxlength="20" style="width:7em" ${rest.on ? "" : "disabled"}>
          <span class="muted small">위 분류 어디에도 안 든 보스 · 전투</span></div>
        <p class="row">${cats.length + (rest.on ? 1 : 0) < CAT_MAX ? `<button id="cat-add">+ 분류 추가</button>` : ""}<button id="cat-save" class="primary">저장</button>
          ${saved.length ? `<button id="cat-clear">분류 없애기</button>` : ""}
          <span class="muted small">${esc(msg || (dirty ? "바꾼 것이 있어요 — 저장해야 들어가요" : ""))}</span></p>`;
      const I = (e) => +e.target.dataset.i;
      const ch = (fn) => (e) => { fn(e); dirty = true; draw(); };
      box.querySelectorAll("details[data-i]").forEach((d) => (d.ontoggle = () => (d.open ? open.add(+d.dataset.i) : open.delete(+d.dataset.i))));
      box.querySelectorAll(".cat-name").forEach((x) => { x.oninput = (e) => { cats[I(e)].name = e.target.value; dirty = true; }; x.onchange = () => draw(); });
      box.querySelectorAll(".cat-scope").forEach((x) => (x.onchange = ch((e) => {
        const c = cats[I(e)]; c.scope = e.target.value;
        if (c.scope === "boss") c.types = [];
        if (c.scope === "battle") { c.kinds = []; c.bosses = []; }
      })));
      const tog = (cls, key) => box.querySelectorAll(`.${cls}`).forEach((x) => (x.onchange = ch((e) => {
        const c = cats[I(e)], v = e.target.value;
        c[key] = e.target.checked ? [...new Set([...c[key], v])] : c[key].filter((y) => y !== v);
      })));
      tog("cat-kind", "kinds"); tog("cat-boss", "bosses"); tog("cat-type", "types");
      box.querySelectorAll(".cat-up").forEach((x) => (x.onclick = ch((e) => { const i = I(e); [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; open.clear(); })));
      box.querySelectorAll(".cat-down").forEach((x) => (x.onclick = ch((e) => { const i = I(e); [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]]; open.clear(); })));
      box.querySelectorAll(".cat-del").forEach((x) => (x.onclick = ch((e) => { cats.splice(I(e), 1); open.clear(); })));
      const add = box.querySelector("#cat-add");
      if (add) add.onclick = ch(() => { cats.push({ name: `분류${cats.length + 1}`, scope: "boss", kinds: [], bosses: [], types: [] }); open.add(cats.length - 1); });
      box.querySelector("#cat-rest").onchange = ch((e) => { rest.on = e.target.checked; });
      box.querySelector("#cat-rest-name").oninput = (e) => { rest.name = e.target.value; dirty = true; };
      box.querySelector("#cat-suggest").onclick = () => { split(sug); open.clear(); dirty = true; draw("추천을 채웠어요 — 고친 뒤 저장하세요"); };
      const clr = box.querySelector("#cat-clear");
      if (clr) clr.onclick = () => { if (confirm("출석 분류를 모두 없앨까요? (시트엔 보스 · 전투 출석만 남아요)")) saveView({ att_cats: "[]" }, "출석 분류를 없앴어요"); };
      box.querySelector("#cat-save").onclick = () => {
        const all = [...cats, ...(rest.on ? [{ name: rest.name, scope: "any", kinds: [], bosses: [], types: [] }] : [])];
        const names = all.map((c) => String(c.name || "").trim());
        const bad = names.find((n, i) => !n || names.indexOf(n) !== i || CAT_RESERVED.includes(n) || CAT_RESERVED.includes(catLabel(n)));
        if (bad !== undefined) return draw(bad ? `'${bad}' 은(는) 쓸 수 없어요 (이름이 겹치거나 시트 기본 칸 이름)` : "이름이 빈 분류가 있어요");
        const rule = cats.find((c) => isRest(c));
        if (rule) return draw(`'${rule.name}' 은(는) 범위 '전부' · 규칙 없음이라 나머지 전부와 같아요 — 아래 '나머지 전부' 칸을 쓰거나 규칙을 고르세요`);
        saveView({ att_cats: JSON.stringify(cleanCats(all)) }, "출석 분류를 저장했어요 — 시트는 다음 갱신(최대 10분) 때 바뀌어요");
      };
    };
    draw();
  }

  // 평점 (봇 att_view.clean_score · score_of 와 같은 규칙) — 구글 시트 '주간 순위' 평점. 저장은 SQL web_set_att_score(서버에서 숫자 범위 검사)
  //   mode 'cat' = 분류마다 점수 (분류 없으면 '보스' · '전투') · 'item' = 보스 · 전투 종류마다 점수. 비운 칸 = 1점 → 처음엔 출석 합과 같음
  const SCORE_MIN = 0, SCORE_MAX = 100;
  function cleanScore(v) {
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
    v = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    const nums = (d) => Object.fromEntries(Object.entries(d && typeof d === "object" ? d : {})
      .filter(([k, x]) => typeof x === "number" && x >= SCORE_MIN && x <= SCORE_MAX && String(k).length <= 60)
      .map(([k, x]) => [String(k), Math.round(x * 100) / 100]).slice(0, 300));
    return { mode: v.mode === "item" ? "item" : "cat", cat: nums(v.cat), boss: nums(v.boss), battle: nums(v.battle) };
  }
  // 다른 화면(설정 도우미 등)에서도 부르는 저장 함수: cfg = {mode, cat, boss, battle} → 정리된 값 (실패하면 throw)
  async function saveAttScore(cfg) {
    return await q(sb.rpc("web_set_att_score", { gid: G(), cfg }));
  }
  window.bellaSaveAttScore = saveAttScore;
  function scoreEditor(box, bosses, st, label) {
    const saved = cleanScore(st?.att_score);
    const cur = JSON.parse(JSON.stringify(saved));
    const cats = cleanCats(st?.att_cats) || [];
    const boxes = cats.length ? cats.map((c) => c.name) : ["보스", "전투"];
    const inp = (part, key) => `<label class="chk" style="min-width:12em">${esc(part === "boss" ? (label[key] || key) : key)}
        <input type="number" class="sc-in" data-part="${part}" data-key="${esc(key)}" min="${SCORE_MIN}" max="${SCORE_MAX}" step="0.5"
          placeholder="1" value="${cur[part][key] ?? ""}" style="width:5em"> 점</label>`;
    const draw = (msg) => {
      box.innerHTML = `<h2>⭐ 평점 <span class="muted small">(구글 시트 '주간 순위' 평점 · 길드 전체)</span></h2>
        <p class="muted small">평점 = 주간 순위에서 체크한 칸의 <b>출석 × 점수</b> 합. 비운 칸은 1점이라, 다 비우면 출석 횟수 합과 같아요. 점수는 0~100 숫자만.</p>
        <div class="row"><b>점수 방식</b>
          <button data-mode="cat" class="${cur.mode === "cat" ? "primary" : ""}">분류별</button>
          <button data-mode="item" class="${cur.mode === "item" ? "primary" : ""}">보스 · 전투 종류별</button></div>
        ${cur.mode === "cat"
          ? `<p class="muted small">${cats.length ? "출석 분류마다 한 출석의 점수." : "출석 분류가 없어서 보스 · 전투 두 칸이에요."}</p>
             <div class="members">${boxes.map((n) => inp("cat", n)).join("")}</div>`
          : `<p class="muted small">기록 한 줄(보스 한 번 · 전투 한 번)마다 점수. 분류는 주간 순위 체크박스로 고른 칸만 더해요.</p>
             <div class="members"><span class="muted small">보스</span> ${bosses.map((b) => inp("boss", b.name)).join("")}</div>
             <div class="members"><span class="muted small">전투</span> ${BATTLE_TYPES.map((t) => inp("battle", t)).join("")}</div>`}
        <p class="row"><button id="sc-save" class="primary">저장</button><button id="sc-reset">전부 1점으로</button>
          <span class="muted small">${esc(msg || "")}</span></p>`;
      box.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { cur.mode = b.dataset.mode; draw("바꾼 것이 있어요 — 저장해야 들어가요"); }));
      box.querySelectorAll(".sc-in").forEach((x) => (x.onchange = () => {
        const v = x.value.trim(), part = x.dataset.part, key = x.dataset.key;
        if (v === "") delete cur[part][key]; else cur[part][key] = Number(v);
      }));
      box.querySelector("#sc-reset").onclick = async () => {
        if (!confirm("평점을 전부 1점으로 되돌릴까요?")) return;
        try { await saveAttScore({ mode: cur.mode, cat: {}, boss: {}, battle: {} }); toast("평점: 전부 1점"); render(); }
        catch (e) { draw(`저장 못 했어요: ${e.message || e}`); }
      };
      box.querySelector("#sc-save").onclick = async () => {
        const bad = ["cat", "boss", "battle"].flatMap((p) => Object.entries(cur[p])).find(([, x]) => !Number.isFinite(x) || x < SCORE_MIN || x > SCORE_MAX);
        if (bad) return draw(`'${bad[0]}' 점수는 ${SCORE_MIN}~${SCORE_MAX} 숫자만`);
        try { await saveAttScore(cur); toast("평점을 저장했어요 — 시트는 다음 갱신(최대 10분) 때 바뀌어요"); render(); }
        catch (e) { draw(`저장 못 했어요: ${e.message || e}`); }
      };
    };
    draw();
  }

  // 출석 보기 (봇 att_view.py 와 같은 값 · 같은 계산)
  const BATTLE_TYPES = ["공성/요새전", "점령전", "엘리시움", "길드레이드", "소집"];
  const BATTLE_DEFAULT = "소집";
  const FARM_DEFAULT = ["저주의 메데이아", "키메라", "복수의 메데이아", "케르베로스", "봉인된 아모르포스"];
  const BOSS_VIEWS = { farmers: "🌾 파머스", warfare: "⚔️ 워페어" };
  const BATTLE_VIEWS = { basic: "🛡️ 베이직", practice: "🎯 프랙티스" };
  function attView(s) {
    const list = (t) => { if (t == null) return null; try { const v = JSON.parse(t); return Array.isArray(v) ? v.map(String) : null; } catch { return null; } };
    s = s || {};
    return {
      boss_view: s.att_boss_view === "farmers" ? "farmers" : "warfare",
      battle_view: s.att_battle_view === "practice" ? "practice" : "basic",
      farm: list(s.att_farm) ?? FARM_DEFAULT,
      war_off: list(s.att_war_off) ?? [],
      practice: list(s.att_practice) ?? BATTLE_TYPES,
    };
  }
  function attFilter(av) {
    return (r) => {
      const c = r.category || "boss";
      if (c === "boss") return av.boss_view === "farmers" ? av.farm.includes(r.boss) : !av.war_off.includes(r.boss);
      if (c === "battle") return av.battle_view !== "practice" || av.practice.includes(r.battle_type || BATTLE_DEFAULT);
      return true;
    };
  }

  // ---------- 관리자 ----------
  async function adminsTab(v) {
    const [admins, users] = await Promise.all([
      q(sb.from("bot_admins").select("user_id::text").eq("guild_id", G())),
      q(sb.from("web_users").select("user_id::text,display_name").eq("guild_id", G())),
    ]);
    const name = Object.fromEntries(users.map((u) => [u.user_id, u.display_name]));
    const g = state.guilds.find((x) => x.guild_id === G());
    v.innerHTML = `
      <div class="card">
        <h2>관리자</h2>
        <p class="muted small">봇 주인 · 서버 주인은 항상 관리자예요. 서버 주인: <b>${esc(name[g.owner_id] || g.owner_id)}</b>
          ${state.owner ? "" : "<br>관리자 지정·해제는 봇 주인 · 서버 주인만 할 수 있어요."}</p>
        <table><tbody>${admins.map((a) => `<tr><td>${esc(name[a.user_id] || "(이름 갱신 대기)")}</td><td class="muted small">${a.user_id}</td>
          <td>${state.owner ? `<button class="danger ghost" data-rm="${a.user_id}">해제</button>` : ""}</td></tr>`).join("") || `<tr><td class="muted">지정된 관리자가 없어요</td></tr>`}</tbody></table>
      </div>
      ${state.owner ? `<div class="card"><h2>관리자 지정</h2>
        <p class="muted small">디스코드 개발자 모드에서 사람을 우클릭 → <b>사용자 ID 복사</b>. 이름은 10분 안에 표시돼요.</p>
        <div class="row"><input id="ad-id" placeholder="디스코드 사용자 ID (숫자)" inputmode="numeric"><button class="primary" id="ad-add">지정</button></div></div>` : ""}`;
    v.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
      if (!confirm("관리자에서 해제할까요?")) return;
      await q(sb.from("bot_admins").delete().eq("guild_id", G()).eq("user_id", b.dataset.rm));
      toast("해제했어요"); render();
    }));
    const add = $("#ad-add");
    if (add) add.onclick = async () => {
      const id = $("#ad-id").value.trim();
      if (!/^\d{15,21}$/.test(id)) return toast("디스코드 사용자 ID(숫자 17~20자리)를 넣어 주세요", true);
      await q(sb.from("bot_admins").insert({ guild_id: G(), user_id: id }));
      toast("관리자로 지정했어요"); render();
    };
  }

  // ---------- 서버 (봇 주인 전용): 봇이 들어갔던 서버 목록 · 차단 ----------
  async function serversTab(v) {
    if (!state.botOwner) { v.innerHTML = `<div class="card muted">봇 주인만 볼 수 있어요.</div>`; return; }
    const [guilds, blocks] = await Promise.all([
      q(sb.from("web_guilds").select("guild_id::text,name,owner_id::text,owner_name,member_count,joined_at,left_at").order("left_at", { nullsFirst: true }).order("name")),
      q(sb.from("bot_blocklist").select("kind,target_id::text,note,created_at").order("created_at", { ascending: false })),
    ]);
    const blocked = new Set(blocks.map((b) => `${b.kind}:${b.target_id}`));
    const knownGuild = Object.fromEntries(guilds.map((g) => [g.guild_id, g.name]));
    const knownOwner = Object.fromEntries(guilds.map((g) => [g.owner_id, g.owner_name || g.owner_id]));
    v.innerHTML = `
      <div class="card">
        <h2>봇이 들어갔던 서버 (${guilds.length})</h2>
        <p class="muted small">차단하면 봇이 1분 안에 그 서버에서 나가고, 다시 초대돼도 바로 나가요. <b>주인 차단</b>은 그 사람이 주인인 서버라면 어디든 막아요.</p>
        <div class="table-wrap"><table><thead><tr><th>서버</th><th>서버 주인</th><th>인원</th><th>들어간 날</th><th>상태</th><th></th></tr></thead><tbody>
          ${guilds.map((g) => {
            const gb = blocked.has(`guild:${g.guild_id}`), ob = blocked.has(`owner:${g.owner_id}`);
            return `<tr>
              <td><b>${esc(g.name)}</b><div class="muted small">${g.guild_id}</div></td>
              <td>${esc(g.owner_name || "-")}<div class="muted small">${g.owner_id || ""}</div></td>
              <td>${g.member_count ?? "-"}</td>
              <td>${g.joined_at ? fmtDate(g.joined_at) : "-"}</td>
              <td>${g.left_at ? `<span class="badge off">나감 ${fmtDate(g.left_at)}</span>` : `<span class="badge">사용 중</span>`}
                  ${gb ? `<span class="badge off">서버 차단</span>` : ""}${ob ? `<span class="badge off">주인 차단</span>` : ""}</td>
              <td class="row">
                ${gb ? "" : `<button class="danger" data-block="guild" data-id="${g.guild_id}">서버 차단</button>`}
                ${ob || !g.owner_id ? "" : `<button class="danger ghost" data-block="owner" data-id="${g.owner_id}">주인 차단</button>`}
              </td></tr>`;
          }).join("")}
        </tbody></table></div>
      </div>
      <div class="card">
        <h2>차단 목록 (${blocks.length})</h2>
        ${blocks.length ? `<table><tbody>${blocks.map((b) => `<tr>
            <td><span class="badge off">${b.kind === "guild" ? "서버" : "서버 주인"}</span></td>
            <td><b>${esc(b.kind === "guild" ? (knownGuild[b.target_id] || b.target_id) : (knownOwner[b.target_id] || b.target_id))}</b>
              <div class="muted small">${b.target_id}${b.note ? " · " + esc(b.note) : ""}</div></td>
            <td class="muted small">${fmtDate(b.created_at)}</td>
            <td><button data-unblock="${b.kind}" data-id="${b.target_id}">차단 해제</button></td></tr>`).join("")}</tbody></table>`
          : `<p class="muted">차단한 곳이 없어요.</p>`}
        <div class="row" style="margin-top:12px">
          <select id="bl-kind"><option value="guild">서버 ID</option><option value="owner">서버 주인 ID</option></select>
          <input id="bl-id" placeholder="디스코드 ID (숫자)" inputmode="numeric">
          <input id="bl-note" placeholder="메모 (선택)">
          <button class="danger" id="bl-add">ID로 차단</button>
        </div>
      </div>`;
    const block = async (kind, id, note) => {
      await q(sb.from("bot_blocklist").insert({ kind, target_id: id, note: note || null, created_at: kstIso(new Date()), created_by: state.me.id }));
      toast("차단했어요. 봇이 1분 안에 나가요."); render();
    };
    v.querySelectorAll("[data-block]").forEach((b) => (b.onclick = async () => {
      const what = b.dataset.block === "guild" ? "이 서버" : "이 사람이 주인인 모든 서버";
      const note = prompt(`${what}를 차단할까요? 메모(선택)를 남길 수 있어요.`);
      if (note === null) return;
      await block(b.dataset.block, b.dataset.id, note.trim());
    }));
    v.querySelectorAll("[data-unblock]").forEach((b) => (b.onclick = async () => {
      if (!confirm("차단을 해제할까요? (봇을 다시 초대해야 들어가요)")) return;
      await q(sb.from("bot_blocklist").delete().eq("kind", b.dataset.unblock).eq("target_id", b.dataset.id));
      toast("차단을 해제했어요"); render();
    }));
    $("#bl-add").onclick = async () => {
      const id = $("#bl-id").value.trim();
      if (!/^\d{15,21}$/.test(id)) return toast("디스코드 ID(숫자 17~20자리)를 넣어 주세요", true);
      if (!confirm("이 ID를 차단할까요?")) return;
      await block($("#bl-kind").value, id, $("#bl-note").value.trim());
    };
  }

  // ---------- 길드원 화면 ----------
  async function memberBoardTab(v) {
    const rows = await q(sb.rpc("web_board", { gid: G() }));
    const nowMs = Date.now();
    const when = (at) => {
      const p = kstParts(at), t = kstParts(new Date().toISOString());
      const day = p.y === t.y && p.mo === t.mo && p.d === t.d ? "" : `${pad(p.mo)}/${pad(p.d)} `;
      return `${day}${pad(p.h)}:${pad(p.mi)}`;
    };
    const left = (at) => {
      const m = Math.round((Date.parse(at) - nowMs) / 6e4);
      if (m <= 0) return "";
      return m >= 60 ? ` (${Math.floor(m / 60)}시간 ${m % 60}분 후)` : ` (${m}분 후)`;
    };
    const line = (r) => r.alive ? `🟢 <b>${esc(r.label)}</b> — 출현 중`
      : !r.at ? `⚪ <b>${esc(r.label)}</b> — 시간 모름`
      : Date.parse(r.at) <= nowMs ? `🔴 <b>${esc(r.label)}</b> — 출현 가능 (${when(r.at)}부터)`
      : `${r.kind === "schedule" ? "🗓️" : "⏳"} <b>${esc(r.label)}</b> — <b>${when(r.at)}</b> 출현${left(r.at)}`;
    v.innerHTML = `<div class="card"><h2>⚔️ 보스 현황</h2>
      <p class="muted small">읽기 전용이에요. 컷 · 보스 설정은 디스코드에서 해요. 30초마다 갱신돼요.</p>
      <div class="board-list">${rows.map((r) => `<div>${line(r)}</div>`).join("") || `<p class="muted">등록된 보스가 없어요.</p>`}</div></div>`;
  }

  async function memberAttendanceTab(v) {
    const cp = (await q(sb.rpc("web_cp", { gid: G() }))) || {};
    const segs = segmentsFrom(cp.cp_start, cp.cp_days, cp.checkpoints || [], cp.att_from);
    const now = kstParts(new Date().toISOString());
    if (state.period === undefined) state.period = segs.length ? "seg:0" : "month";
    const month = state.month || `${now.y}-${pad(now.mo)}`;
    const [y, mo] = month.split("-").map(Number);
    let start = `${y}-${pad(mo)}-01T00:00:00+09:00`;
    let end = mo === 12 ? `${y + 1}-01-01T00:00:00+09:00` : `${y}-${pad(mo + 1)}-01T00:00:00+09:00`;
    let label = `${y}년 ${mo}월`;
    if (state.period === "archive") state.period = segs.length ? "seg:0" : "month";   // 보관 보기는 관리자 탭(봇 주인)만
    if (state.period.startsWith("seg:") && segs[+state.period.slice(4)]) {
      const sg = segs[+state.period.slice(4)];
      start = sg.start; end = sg.end || "2999-01-01T00:00:00+09:00"; label = sg.label;
    } else if (cp.att_from && start < cp.att_from) {   // 월별: 보관 기준 이전은 서버가 안 줌 — 제목만 맞춤
      const md = cp.att_from.slice(5, 10).replace("-", "/");
      label += end <= cp.att_from ? " (보관 기간 — 기록 안 보임)" : ` (${md}부터)`;
    }
    // 기록은 전부, counted = 서버 출석 보기(관리자가 정함: 파머스/워페어 + 베이직/프랙티스)에 드는지 — 시트 · 봇과 같게 출석 / 전체 둘 다
    const rows = await q(sb.rpc("web_my_attendance", { gid: G(), s: start, e: end }));
    const all = rows.filter((r) => r.category !== "event");
    const counted = all.filter((r) => r.counted !== false);
    const nb = counted.filter((r) => r.category === "battle").length;
    const icon = { battle: "🛡️", event: "📋" };
    v.innerHTML = `<div class="card">
      <div class="row"><h2 style="margin:0">내 출석</h2>
        <select id="a-period"><option value="month" ${state.period === "month" ? "selected" : ""}>월별</option>
          ${segs.map((sg, i) => `<option value="seg:${i}" ${state.period === `seg:${i}` ? "selected" : ""}>📍 ${esc(sg.label)}</option>`).join("")}</select>
        <input type="month" id="a-month" value="${month}" ${state.period === "month" ? "" : "hidden"}></div>
      <p class="muted">${esc(label)} · 출석 <b>${counted.length}회</b> (⚔️ 보스레이드 ${counted.length - nb} · 🛡️ 전투 ${nb}) · 전체 ${all.length}회${rows.length > all.length ? ` · 📋 콘텐츠 ${rows.length - all.length}회` : ""}</p>
      <p class="muted small">출석 = 서버 출석 보기에 든 것 · 전체 = 빠진 보스 · 전투까지. '출석 제외'는 기록은 있지만 출석에는 안 세는 거예요.</p>
      <div class="board-list">${rows.map((r) => `<div><span class="muted">${fmtDate(r.at)}</span> ${icon[r.category] || "⚔️"} ${esc(r.label)}${r.category !== "event" && r.counted === false ? ` <span class="badge off">출석 제외</span>` : ""}</div>`).join("") || `<p class="muted">기록 없음</p>`}</div></div>`;
    $("#a-month").onchange = (e) => { state.month = e.target.value; render(); };
    $("#a-period").onchange = (e) => { state.period = e.target.value; render(); };
  }

  async function memberVbellaTab(v) {
    const pm = (await q(sb.rpc("web_vb_perms", { gid: G() }))) || {};
    const whites = pm.white ? await q(sb.rpc("web_white_list", { gid: G() })) : [];
    v.innerHTML = `
      <div class="card">
        <h2>✒️ 버추얼 벨라 (게임 화면 위 도우미 앱)</h2>
        ${pm.on ? "" : `<p style="color:var(--warn)">이 서버는 아직 버추얼 벨라를 켜지 않았어요. 관리자에게 물어보세요.</p>`}
        <ul class="vb-steps">
          <li><a href="vb-install.html" target="_blank" rel="noopener"><b>윈도우 설치 안내</b></a> — 폴더 준비 · 신뢰 등록 파일(bella_cert) · 백신 예외 · 되돌리기</li>
          <li><b>로그인</b> — 디스코드에서 <code>/벨라봇 인증</code> → 받은 코드를 앱 로그인 화면에 입력</li>
          <li><b>게임 닉네임 등록</b> — 디스코드에서 <code>/닉등록 게임닉</code></li>
        </ul>
        <div id="vb-dl"><p class="muted small">받기 파일 확인 중…</p></div>
      </div>
      <div class="card"><h2>☠️ 내가 등록한 데스노트</h2>
        <p class="muted small">잘못 등록한 이름은 [제외 신청]을 누르면 운영진이 확인하고 빼 줘요.</p>
        <div id="my-notes" class="board-list"><span class="muted small">불러오는 중…</span></div>
      </div>
      <div class="card"><h2>🤍 내 화이트리스트 (우리 쪽 부캐)</h2>
        ${pm.white ? `<p class="muted small">여기 넣은 닉네임은 데스노트에 있어도 적대 알림이 안 떠요. 나만 보여요.</p>
          <div class="members">${whites.map((w) => `<span class="member">${esc(w.name)}<button title="빼기" data-wdel="${esc(w.name)}">×</button></span>`).join("") || `<span class="muted small">비어 있어요</span>`}</div>
          <div class="row"><input id="w-new" placeholder="게임 닉네임"><button id="w-add">넣기</button></div>`
          : `<p class="muted small">🔒 이 서버는 관리자만 화이트리스트를 등록할 수 있어요.</p>`}
      </div>`;
    vbDownload($("#vb-dl"), pm);
    myNotes($("#my-notes"));
    const add = $("#w-add");
    if (add) add.onclick = async () => {
      const nm = $("#w-new").value.trim(); if (!nm) return;
      await q(sb.rpc("web_white_add", { gid: G(), nm })); toast(`${nm} 넣었어요`); render();
    };
    v.querySelectorAll("[data-wdel]").forEach((b) => (b.onclick = async () => {
      await q(sb.rpc("web_white_del", { gid: G(), nm: b.dataset.wdel })); toast("뺐어요"); render();
    }));
  }

  // ---------- 버추얼 벨라 앱 받기 (윈도우 · 모바일) ----------
  // 파일은 Supabase Storage 비공개 버킷 'vb-builds' (공개 주소 없음). 받기 = 로그인 + 권한 → 2분짜리 서명 주소로 바로 내려받음.
  const VB_BUCKET = "vb-builds";
  const PLAT = { win: ["🖥️", "윈도우 앱", "Windows 10 · 11 (zip)"], mobile: ["📱", "모바일 앱", "안드로이드 10 이상 (apk)"] };
  const buildTag = (path) => (path.match(/-((?:test-)?[am]\d+)\./) || [])[1] || path.split("/").pop();
  const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
  async function vbFetch(path) {
    const name = path.split("/").pop();
    const { data, error } = await sb.storage.from(VB_BUCKET).createSignedUrl(path, 120, { download: name });
    if (error || !data?.signedUrl) { toast(`받기 실패: ${error?.message || "권한이 없어요"}`, "red"); return; }
    location.href = data.signedUrl;
  }
  // 플랫폼마다 한 줄: 🔒 권한 없음 / 아직 안 내보냄 / 받기 버튼 (한쪽만 될 때도 다른 쪽 상태가 보이게). pm = 내 받기 권한
  async function vbDownload(box, pm) {
    if (!box) return;
    let rows;
    try { rows = await q(sb.rpc("web_vb_download", { gid: G() })); }
    catch { box.innerHTML = `<p class="muted small">⚠️ 앱 받기 정보를 불러오지 못했어요. 새로고침해 주세요.</p>`; return; }
    const by = Object.fromEntries((rows || []).map((r) => [r.platform, r]));
    const guide = { win: `<a href="vb-install.html" target="_blank" rel="noopener">윈도우 설치 안내</a>`,
                    mobile: `<a href="vb-install-mobile.html" target="_blank" rel="noopener">모바일 설치 안내</a>` };
    box.innerHTML = Object.entries(PLAT).map(([k, [ic, nm, os]]) => {
      const r = by[k];
      if (!pm?.["download_" + k]) return `<div class="row" style="margin:8px 0"><b>${ic} ${nm}</b>
          <span class="muted small">🔒 받기 권한이 없어요 — 관리자에게 받기 권한을 켜 달라고 해 주세요.</span></div>`;
      if (!r) return `<div class="row" style="margin:8px 0"><b>${ic} ${nm}</b>
          <span class="muted small">아직 이 서버에 내보낸 ${nm}이 없어요.</span></div>`;
      return `<div class="row" style="margin:8px 0"><button class="primary" data-get="${esc(r.path)}">${ic} ${nm} 받기 (${esc(buildTag(r.path))})</button>
          <span class="muted small">${os} · ${mb(r.size)} · 올린 날 ${fmtDate(r.uploaded_at)} · ${guide[k]}</span></div>
        ${k === "win" ? `<p class="muted small">받은 zip 을 풀어 윈도우 설치 안내대로 해 주세요.</p>`
          : `<p class="muted small">폰에서 받아 열어요. '출처를 알 수 없는 앱'은 설치할 때만 허용하고 끝나면 다시 꺼 주세요. 막히면 모바일 설치 안내를 봐 주세요. 로그인은 디스코드 <code>/벨라봇 인증</code> 코드로 해요 (PC 하나 · 폰 하나까지).</p>`}`;
    }).join("") + (rows && rows.length ? `<p class="muted small">받기 주소는 2분 동안만 열려요. 파일은 남에게 넘기지 마세요.</p>` : "");
    box.querySelectorAll("[data-get]").forEach((b) => (b.onclick = () => vbFetch(b.dataset.get)));
  }
  // 관리자: 길드원에게 내보낼 빌드를 윈도우 · 모바일 따로 고름. 봇 주인: 빌드 올리기 · 지우기
  async function vbBuilds(box, st, after) {
    if (!box) return;
    const list = await q(sb.rpc("web_vb_builds", { gid: G() })).catch(() => []);
    const of = (k) => list.filter((b) => b.path.startsWith(k + "/"));
    const cur = { win: st.vb_win_build || "", mobile: st.vb_mobile_build || "" };
    box.innerHTML = `<h2>📦 길드원에게 내보낼 앱</h2>
      <p class="muted small">고른 빌드만 길드원에게 보여요 (위 길드원 권한에서 윈도우 · 모바일 받기를 켠 경우). 관리자는 권한과 상관없이 받을 수 있어요.</p>
      ${Object.entries(PLAT).map(([k, [ic, nm]]) => `<div class="row"><b>${ic} ${nm}</b>
        <select class="vb-pick" data-k="${k}"><option value="">내보내지 않음</option>
          ${of(k).map((b) => `<option value="${esc(b.path)}" ${b.path === cur[k] ? "selected" : ""}>${esc(buildTag(b.path))} · ${mb(b.size)} · ${fmtDate(b.uploaded_at)}</option>`).join("")}
          ${cur[k] && !of(k).some((b) => b.path === cur[k]) ? `<option value="${esc(cur[k])}" selected>${esc(buildTag(cur[k]))} (파일 없음)</option>` : ""}</select>
        ${cur[k] ? `<button class="ghost small" data-try="${esc(cur[k])}">받아 보기</button>` : ""}</div>`).join("")}
      ${state.botOwner ? `<details><summary><b>⬆️ 빌드 올리기 · 지우기</b> <span class="muted small">(봇 주인만 · 파일 50MB까지)</span></summary>
        <div class="row"><select id="vb-up-k"><option value="win">🖥️ 윈도우 (VirtualBella-aNN.zip)</option><option value="mobile">📱 모바일 (VBLite-mNN.apk)</option></select>
          <input type="file" id="vb-up-f" accept=".zip,.apk"><button id="vb-up">올리기</button></div>
        <div class="board-list">${list.map((b) => `<div>${esc(b.path)} <span class="muted small">${mb(b.size)} · ${fmtDate(b.uploaded_at)}</span>
          <button class="ghost small" data-del="${esc(b.path)}">지우기</button></div>`).join("") || `<p class="muted small">올린 빌드 없음</p>`}</div></details>` : ""}`;
    box.querySelectorAll(".vb-pick").forEach((x) => (x.onchange = async () => {
      await q(sb.from("boss_settings").upsert({ guild_id: G(), [x.dataset.k === "win" ? "vb_win_build" : "vb_mobile_build"]: x.value || null }, { onConflict: "guild_id" }));
      st[x.dataset.k === "win" ? "vb_win_build" : "vb_mobile_build"] = x.value || null;
      toast(`${PLAT[x.dataset.k][1]}: ${x.value ? buildTag(x.value) : "내보내지 않음"}`); vbBuilds(box, st, after); after();
    }));
    box.querySelectorAll("[data-try]").forEach((b) => (b.onclick = () => vbFetch(b.dataset.try)));
    const up = box.querySelector("#vb-up");
    if (up) up.onclick = async () => {
      const k = box.querySelector("#vb-up-k").value, f = box.querySelector("#vb-up-f").files[0];
      if (!f) return toast("파일을 골라 주세요", "red");
      const ext = k === "win" ? ".zip" : ".apk";
      if (!f.name.toLowerCase().endsWith(ext)) return toast(`${PLAT[k][1]}은(는) ${ext} 파일이에요`, "red");
      if (!/^[\w.\-]+$/.test(f.name)) return toast("파일 이름은 영문 · 숫자 · - . _ 만 (예: VBLite-m15.apk)", "red");
      up.disabled = true; up.textContent = "올리는 중…";
      const { error } = await sb.storage.from(VB_BUCKET).upload(`${k}/${f.name}`, f,
        { upsert: false, contentType: k === "win" ? "application/zip" : "application/vnd.android.package-archive" });
      if (error) { up.disabled = false; up.textContent = "올리기"; return toast(`올리기 실패: ${error.message}`, "red"); }
      toast(`${f.name} 올렸어요 — 위에서 골라야 길드원에게 보여요`); vbBuilds(box, st, after);
    };
    box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`${b.dataset.del} 을(를) 지울까요? 이 빌드를 고른 서버는 받기가 안 보여요.`)) return;
      const { error } = await sb.storage.from(VB_BUCKET).remove([b.dataset.del]);
      if (error) return toast(`지우기 실패: ${error.message}`, "red");
      toast("지웠어요"); vbBuilds(box, st, after); after();
    }));
  }

  async function myNotes(box) {
    if (!box) return;
    const rows = await q(sb.rpc("web_my_notes", { gid: G() }));
    box.innerHTML = rows.map((n) => `<div><b>${esc(n.name)}</b>
        <span class="muted small">${esc((n.aliases || "").split("\n").filter(Boolean).join(", "))} · ${fmtDate(n.created_at)}</span>
        ${n.pending ? `<span class="badge off">제외 신청 중</span>` : `<button class="ghost small" data-req="${esc(n.name)}">제외 신청</button>`}</div>`).join("")
      || `<span class="muted small">내가 등록한 이름이 없어요.</span>`;
    box.querySelectorAll("[data-req]").forEach((b) => (b.onclick = async () => {
      const why = prompt(`'${b.dataset.req}' 제외 신청 — 이유를 적어 주세요 (예: 잘못 찍음, 우리 쪽 사람)`, "");
      if (why === null) return;
      await q(sb.rpc("web_note_request", { gid: G(), nm: b.dataset.req, reason: why }));
      toast("제외 신청했어요. 운영진이 확인하면 빠져요"); myNotes(box);
    }));
  }

  const MEMBER_TABS = { bosses: memberBoardTab, attendance: memberAttendanceTab, vbella: memberVbellaTab };

  const TABS = { bosses: bossesTab, settings: settingsTab, battles: battlesTab, attendance: attendanceTab, admins: adminsTab, servers: serversTab, vbella: vbellaTab };
  // 설정 도우미(setup-helper.js)가 각 카드와 같은 함수 · 상수로 읽고 저장하게 빌려줌
  window.BELLA_WEB = { sb, q, G, state, toast, render, kstParts, fmtDate, suggestCats, cleanCats, BATTLE_TYPES, FARM_DEFAULT, FB_GROUPS, FB_REC, FB_MAX, buildTag, mb };
  start();
})();
