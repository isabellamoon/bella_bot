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

    state.guilds = await q(sb.from("web_guilds").select("guild_id::text,name,icon_url,owner_id::text").order("name"));
    if (!state.guilds.length) { $("#noguild").hidden = false; return; }
    const ownerRows = await q(sb.from("web_owners").select("user_id::text"));
    state.botOwner = ownerRows.length > 0;
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
    const rows = await q(sb.from("bosses").select("name,respawn_min,aliases,hidden_until,schedule,display").eq("guild_id", G()).order("respawn_min").order("name"));
    const now = kstIso(new Date());
    v.innerHTML = `
      <div class="card">
        <h2>보스 목록 (${rows.length})</h2>
        <p class="muted small">리젠: <code>8시간</code> <code>1시간 30분</code> <code>미정</code> · 요일·시각 보스: <code>화 21시</code> <code>매일 0시, 12시, 18시</code>.
          표시 이름은 메시지에 보일 이름, 별명은 <code>/컷</code>·음성·스크린샷 인식용(쉼표로 구분).</p>
        <div class="table-wrap"><table>
          <thead><tr><th>보스</th><th>표시 이름</th><th>리젠 / 일정</th><th>별명</th><th>상태</th><th></th></tr></thead>
          <tbody>${rows.map((b) => {
            const hidden = b.hidden_until && b.hidden_until > now;
            return `<tr data-name="${esc(b.name)}" class="${hidden ? "hidden-boss" : ""}">
              <td><b>${esc(b.name)}</b></td>
              <td><input name="display" value="${esc(b.display || "")}" placeholder="${esc(b.name)}"></td>
              <td><input name="rule" value="${esc(fmtRule(b))}"></td>
              <td><input name="aliases" value="${esc((b.aliases || "").split(",").filter(Boolean).join(", "))}"></td>
              <td>${hidden ? `<span class="badge off">제외 ~${fmtDate(b.hidden_until)}</span>` : `<span class="badge">활성</span>`}</td>
              <td class="row">
                <button data-act="save" class="primary">저장</button>
                <button data-act="${hidden ? "unhide" : "hide"}">${hidden ? "제외 해제" : "30일 제외"}</button>
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
        await q(where(sb.from("bosses").update({ hidden_until: null })));
        toast(`${name} 제외 해제`); render();
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
      q(sb.from("web_channels").select("channel_id::text,name,kind,position").eq("guild_id", G()).order("position")),
    ]);
    const s = rows[0] || {};
    const text = chans.filter((c) => c.kind === "text"), voice = chans.filter((c) => c.kind === "voice");
    const opts = (list, cur) => `<option value="">— 지정 안 함 —</option>` + list.map((c) => `<option value="${c.channel_id}" ${c.channel_id === cur ? "selected" : ""}>${c.kind === "voice" ? "🔊" : "#"} ${esc(c.name)}</option>`).join("");
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
          <label class="field">보스레이드 모집을 출현 몇 분 전에 (0 = 안 함)<input id="s-lead" type="number" min="0" max="120" value="${s.recruit_lead ?? 5}"></label>
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
        <div class="chips" style="margin-top:10px">${voice.map((c) => `<label><input type="checkbox" class="g-ch" value="${c.channel_id}" ${greetSet.has(c.channel_id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("") || `<span class="muted small">음성 채널 정보가 아직 없어요</span>`}</div>
      </div>
      <p><button class="primary" id="s-save">설정 저장</button></p>`;
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

  const TABS = { bosses: bossesTab, settings: settingsTab, battles: battlesTab, attendance: attendanceTab, admins: adminsTab };
  start();
})();
