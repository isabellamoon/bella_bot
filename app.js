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
    $("#btn-login").onclick = () => sb.auth.signInWithOAuth({
      provider: "discord", options: { redirectTo: location.origin + location.pathname },
    });
    const { data } = await sb.auth.getSession();
    sb.auth.onAuthStateChange((_e, session) => { if (!!session !== !!state.me) location.reload(); });
    if (!data.session) { $("#login").hidden = false; return; }
    const u = data.session.user.user_metadata || {};
    state.me = { id: String(u.provider_id || ""), name: u.custom_claims?.global_name || u.full_name || u.name || "나", avatar: u.avatar_url };
    $("#me").innerHTML = `${state.me.avatar ? `<img src="${esc(state.me.avatar)}" alt="">` : ""}<span>${esc(state.me.name)}</span>
      <span class="badge" id="my-role" hidden></span>
      <button class="ghost small" id="btn-logout">로그아웃</button>`;
    $("#btn-logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

    state.allGuilds = await q(sb.from("web_guilds").select("guild_id::text,name,icon_url,owner_id::text,owner_name,member_count,joined_at,left_at").order("name"));
    state.guilds = state.allGuilds.filter((g) => !g.left_at);   // 지금 봇이 들어가 있는 서버만 고를 수 있음
    if (!state.guilds.length) { $("#noguild").hidden = false; return; }
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
    $("#main").hidden = false;
    selectGuild(sel.value);
  }
  async function selectGuild(gid) {
    state.gid = gid;
    const g = state.guilds.find((x) => x.guild_id === gid);
    state.owner = state.botOwner || (g && g.owner_id === state.me.id);
    // 우상단에 이 서버에서의 내 역할 표시
    let role = state.botOwner ? "👑 봇 주인" : g && g.owner_id === state.me.id ? "🏰 서버 주인" : null;
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
    try { await TABS[state.tab](v); } catch (e) { console.error(e); v.innerHTML = `<div class="card">불러오지 못했어요: ${esc(e.message)}</div>`; }
  }
  const G = () => state.gid;

  // ---------- 보스 ----------
  async function bossesTab(v) {
    const rows = await q(sb.from("bosses").select("name,respawn_min,aliases,hidden_until,schedule,display,wait_first").eq("guild_id", G()).order("respawn_min").order("name"));
    const now = kstIso(new Date());
    v.innerHTML = `
      <div class="card">
        <h2>보스 목록 (${rows.length})</h2>
        <p class="muted small">리젠: <code>8시간</code> <code>1시간 30분</code> <code>미정</code> · 요일·시각 보스: <code>화 21시</code> <code>매일 0시, 12시, 18시</code>.
          표시 이름은 메시지에 보일 이름, 별명은 <code>/컷</code>·음성·스크린샷 인식용(쉼표로 구분).</p>
        <div class="table-wrap"><table>
          <thead><tr><th>보스</th><th>표시 이름</th><th>리젠 / 일정</th><th>별명</th><th>상태</th><th></th></tr></thead>
          <tbody>${rows.map((b) => {
            const waiting = !!b.wait_first, hidden = !waiting && b.hidden_until && b.hidden_until > now;
            return `<tr data-name="${esc(b.name)}" class="${hidden || waiting ? "hidden-boss" : ""}">
              <td><b>${esc(b.name)}</b></td>
              <td><input name="display" value="${esc(b.display || "")}" placeholder="${esc(b.name)}"></td>
              <td><input name="rule" value="${esc(fmtRule(b))}"></td>
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
        await q(where(sb.from("bosses").update({
          ...rule, display: tr.querySelector("[name=display]").value.trim() || null,
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
    $("#nb-add").onclick = async () => {
      const name = $("#nb-name").value.trim();
      const rule = parseRule($("#nb-rule").value);
      if (!name || !rule) return toast("이름과 리젠/일정을 넣어 주세요", true);
      await q(sb.from("bosses").insert({ guild_id: G(), name, ...rule, display: $("#nb-display").value.trim() || null, aliases: aliasList($("#nb-aliases").value) }));
      toast(`${name} 추가했어요`); render();
    };
  }

  // ---------- 설정 ----------
  async function settingsTab(v) {
    const [rows, chans] = await Promise.all([
      q(sb.from("boss_settings").select("alert_channel_id::text,raid_channel_id::text,board_channel_id::text,shot_channel_id::text,voice_channel_id::text,alert_offsets,raid_minutes,recruit_lead,greet_channels,game").eq("guild_id", G())),
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
        <h2>알림 · 참여</h2>
        <div class="grid">
          <label class="field">모집 알림을 출현 몇 분 전에 (0 = 안 함 · 참여는 컷 후)<input id="s-lead" type="number" min="0" max="120" value="${s.recruit_lead ?? 5}"></label>
          <label class="field">출현 알림 (분 전, 쉼표)<input id="s-alerts" value="${esc(s.alert_offsets ?? "5,1")}"></label>
          <label class="field">컷 후 참여 받는 시간 (분)<input id="s-raid" type="number" min="1" max="120" value="${s.raid_minutes ?? 5}"></label>
        </div>
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
      <div class="card" id="g-card"><h2>📊 구글 시트</h2><p class="muted small">불러오는 중…</p></div>`;
    mentionCard();
    sheetCard();
    $("#s-save").onclick = async () => {
      const offs = [...new Set(($("#s-alerts").value.match(/\d+/g) || []).map(Number))].sort((a, b) => b - a);
      const mode = v.querySelector("input[name=greet]:checked").value;
      const picked = [...v.querySelectorAll(".g-ch:checked")].map((x) => x.value);
      const val = (id) => $(id).value || null;
      await q(sb.from("boss_settings").upsert({
        guild_id: G(), game: $("#s-game").value || null, recruit_lead: +$("#s-lead").value || 0, alert_offsets: offs.join(","), raid_minutes: Math.max(1, +$("#s-raid").value || 5),
        alert_channel_id: val("#c-alert"), raid_channel_id: val("#c-raid"), board_channel_id: val("#c-board"),
        shot_channel_id: val("#c-shot"), voice_channel_id: val("#c-voice"),
        greet_channels: mode === "all" ? null : mode === "off" ? "" : picked.join(","),
      }, { onConflict: "guild_id" }));
      toast("설정을 저장했어요");
    };
  }

  // ---------- 알림 멘션 ----------
  // 오른쪽 팔레트(@everyone · @here · 서버 역할)를 왼쪽 알림 칸에 끌어다 놓기. 휴대폰은 칩 누르고 → 칸 누르기.
  // 저장은 boss_settings.mentions (JSON: 알림 종류 → ["everyone" | "here" | 역할 ID]). 봇의 boss.py MENTION_SLOTS 와 같은 키.
  const MENTION_SLOTS = [
    ["boss_pre", "보스 출현 n분 전", "출현 알림 (설정한 몇 분 전)"],
    ["boss_spawn", "보스 출현 시각", "출현 시각 알림 + 음성"],
    ["raid_open", "보스레이드 모집 알림", "출현 n분 전 알림 · /레이드모집"],
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
    const rows = await q(sb.from("google_links").select("sheet_url,synced_at,error").eq("guild_id", gid));
    if (G() !== gid || !$("#g-card")) return;
    const l = rows[0];
    const howto = `<p class="muted small">구글 계정으로 허용하면 그 계정 드라이브에 <b>'벨라꼬붕 출석 기록'</b> 시트를 만들고, 10분마다 월간 순위 · 참여 상세 · 보스 컷 기록을 채워요.
      봇은 자기가 만든 시트만 다룰 수 있어요. 기존 시트에서 쓰려면 <code>=IMPORTRANGE("시트 주소", "월간 순위!A1:G300")</code> 로 끌어가세요.</p>`;
    if (!l) {
      card.innerHTML = `<h2>📊 구글 시트</h2>${howto}<button class="primary" id="g-link">구글 시트 연결</button>`;
      $("#g-link").onclick = connectGoogle;
      return;
    }
    const when = l.synced_at ? fmtDate(l.synced_at) : "아직";
    card.innerHTML = `<h2>📊 구글 시트 <span class="badge ${l.error ? "off" : "boss"}">${l.error ? "확인 필요" : "연결됨"}</span></h2>
      ${l.error ? `<p style="color:var(--bad)">⚠️ ${esc(l.error)}</p>` : `<p class="muted small">마지막 갱신: ${when} · 10분마다 갱신돼요</p>`}
      <div class="row"><a href="${esc(l.sheet_url)}" target="_blank" rel="noopener"><button class="primary">시트 열기</button></a>
      <button id="g-relink">다시 연결</button><button class="danger ghost" id="g-unlink">연결 끊기</button></div>`;
    $("#g-relink").onclick = connectGoogle;
    $("#g-unlink").onclick = async () => {
      if (!confirm("구글 시트 연결을 끊을까요? 시트 파일은 드라이브에 그대로 남아요.")) return;
      await q(sb.rpc("google_unlink", { gid: G() }));
      toast("연결을 끊었어요"); sheetCard();
    };
  }
  async function connectGoogle() {
    const popup = window.open("about:blank", "google-link", "width=520,height=680");
    let st;
    try { st = await q(sb.rpc("google_begin", { gid: G() })); }
    catch (e) { popup && popup.close(); return; }
    const url = GOOGLE_AUTH + "?" + new URLSearchParams({
      client_id: cfg.GOOGLE_CLIENT_ID, redirect_uri: googleRedirect(), response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file", access_type: "offline", prompt: "consent", state: st,
    });
    if (popup) popup.location = url; else location.href = url;
    toast("구글 창에서 허용해 주세요");
  }
  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.data === "google-linked") { toast("구글 시트를 연결했어요"); sheetCard(); }
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
      q(sb.from("battle_reservations").select("id::text,name,at,open_before,close_after").eq("guild_id", G()).eq("canceled", 0).gte("at", kstIso(new Date())).order("at")),
    ]);
    const cur = choice[0]?.name || "엘리시움";
    v.innerHTML = `
      <div class="card">
        <h2>🛡️ ${sun.label} 20:00 길드전</h2>
        <p class="muted small">레기온 모집: 엘리시움 19:55~21:05 · 공성/요새전 19:55~20:35. 고르지 않으면 엘리시움. 당일 오전 10시엔 디스코드 매뉴얼 채널에서도 물어봐요.</p>
        <div class="row">${["엘리시움", "공성/요새전"].map((n) => `<button data-war="${n}" class="${n === cur ? "primary" : ""}">${n}</button>`).join("")}</div>
      </div>
      <div class="card">
        <h2>예약 전투</h2>
        ${res.length ? `<table><thead><tr><th>일시</th><th>이름</th><th>레기온 모집</th><th></th></tr></thead><tbody>
          ${res.map((r) => `<tr><td>${fmtDate(r.at)}</td><td><b>${esc(r.name)}</b></td><td>시작 ${r.open_before}분 전 ~ 시작 후 ${r.close_after}분</td>
            <td><button class="danger ghost" data-cancel="${r.id}">취소</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted">예약된 전투가 없어요.</p>`}
      </div>
      <div class="card">
        <h2>전투 예약하기</h2>
        <div class="grid">
          <label class="field">이름<input id="r-name" value="아카디아 제전"></label>
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
      }));
      toast("예약했어요"); render();
    };
  }

  // ---------- 출석 ----------
  async function attendanceTab(v) {
    const now = kstParts(new Date().toISOString());
    const month = state.month || `${now.y}-${pad(now.mo)}`;
    const [y, mo] = month.split("-").map(Number);
    const start = `${y}-${pad(mo)}-01T00:00:00+09:00`;
    const end = mo === 12 ? `${y + 1}-01-01T00:00:00+09:00` : `${y}-${pad(mo + 1)}-01T00:00:00+09:00`;
    const [raids, bosses] = await Promise.all([
      q(sb.from("raids").select("id::text,boss,killed_at,category,kill_id::text,closed,canceled").eq("guild_id", G()).eq("canceled", 0).gte("killed_at", start).lt("killed_at", end).order("killed_at", { ascending: false })),
      q(sb.from("bosses").select("name,display").eq("guild_id", G())),
    ]);
    const label = Object.fromEntries(bosses.map((b) => [b.name, b.display || b.name]));
    const counted = raids.filter((r) => r.kill_id || r.category === "battle");
    let members = [];
    for (let i = 0; i < counted.length; i += 100) {
      const ids = counted.slice(i, i + 100).map((r) => r.id);
      members = members.concat(await q(sb.from("raid_members").select("raid_id::text,user_id::text,display_name,joined_at").in("raid_id", ids)));
    }
    const byRaid = {}, people = {};
    for (const m of members) {
      (byRaid[m.raid_id] ||= []).push(m);
    }
    for (const r of counted) {
      for (const m of byRaid[r.id] || []) {
        const p = (people[m.user_id] ||= { id: m.user_id, name: m.display_name, total: 0, boss: 0, battle: 0 });
        p.name = m.display_name; p.total++; r.category === "battle" ? p.battle++ : p.boss++;
      }
    }
    const rank = Object.values(people).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const nb = counted.filter((r) => r.category !== "battle").length;
    v.innerHTML = `
      <div class="card">
        <div class="row"><h2 style="margin:0">출석 (레이드·레기온 참여)</h2>
          <input type="month" id="a-month" value="${month}">
          <button id="a-csv1">명단 CSV</button><button id="a-csv2">순위 CSV</button></div>
        <p class="muted">이번 달 ⚔️ 보스레이드 ${nb}회 · 🛡️ 레기온 ${counted.length - nb}회 · 참여한 사람 ${rank.length}명</p>
        <div class="table-wrap"><table class="rank"><thead><tr><th>#</th><th>이름</th><th>합계</th><th>⚔️ 보스</th><th>🛡️ 레기온</th></tr></thead><tbody>
          ${rank.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td><b>${p.total}</b></td><td>${p.boss}</td><td>${p.battle}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">기록 없음</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="card">
        <h2>레이드·레기온 기록</h2>
        <p class="muted small">이름 옆 ×로 명단에서 빼고, 아래 칸에서 이번 달 참여자 중 골라 넣을 수 있어요. 디스코드 메시지의 명단은 다음에 그 메시지가 갱신될 때 맞춰져요.</p>
        ${counted.map((r) => {
          const ms = byRaid[r.id] || [];
          return `<details data-raid="${r.id}"><summary>
              <span class="badge ${r.category === "battle" ? "battle" : "boss"}">${r.category === "battle" ? "🛡️ 레기온" : "⚔️ 보스"}</span>
              <b>${esc(label[r.boss] || r.boss)}</b> <span class="muted">${fmtDate(r.killed_at)} · ${ms.length}명</span></summary>
            <div class="members">${ms.map((m) => `<span class="member">${esc(m.display_name)}<button title="빼기" data-rm="${m.user_id}">×</button></span>`).join("")}</div>
            <div class="row" style="padding-left:22px"><select class="add-who"><option value="">+ 추가할 사람</option>
              ${rank.filter((p) => !ms.some((m) => m.user_id === p.id)).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
          </details>`;
        }).join("") || `<p class="muted">기록 없음</p>`}
      </div>`;
    $("#a-month").onchange = (e) => { state.month = e.target.value; render(); };
    v.querySelectorAll("details[data-raid]").forEach((d) => {
      const rid = d.dataset.raid;
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
    $("#a-csv1").onclick = () => download(`출석명단_${month}.csv`, [["날짜", "종류", "보스·전투", "인원", "참여자"],
      ...counted.map((r) => [fmtDate(r.killed_at), r.category === "battle" ? "레기온" : "보스레이드", label[r.boss] || r.boss,
        (byRaid[r.id] || []).length, (byRaid[r.id] || []).map((m) => m.display_name).join(", ")])]);
    $("#a-csv2").onclick = () => download(`출석순위_${month}.csv`, [["순위", "이름", "합계", "보스레이드", "레기온"],
      ...rank.map((p, i) => [i + 1, p.name, p.total, p.boss, p.battle])]);
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

  const TABS = { bosses: bossesTab, settings: settingsTab, battles: battlesTab, attendance: attendanceTab, admins: adminsTab, servers: serversTab };
  start();
})();
