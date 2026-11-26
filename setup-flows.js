// 설정 도우미 질문 흐름 (객관식 · 단답형, AI 아님). 웹(setup-helper.js)이 이 목록을 그대로 돌린다.
// 화면 · 저장 코드가 없는 순수 데이터라 나중에 디스코드(버튼 · 모달) · 카톡 봇도 같은 목록을 읽어 같은 흐름을 돌릴 수 있다.
//
// 흐름(flow) = { title, tab(자세히 고치는 웹 탭), load(읽을 boss_settings 칸), done(적용 뒤 한마디), target?, steps[] }
// 층 구분(docs/OWNERS.md): 도우미는 프론트 — 서버(표 · SQL 함수)로만 읽고 쓰고, 끝말은 '저장했어요 · 보냈어요'(자기 일)만. 디스코드 · 시트에 언제 어떻게 보이는지는 말하지 않음
//   target 'suggest' = 문의하기: {kind, body} 를 bellaSendSuggestion 으로 보냄 (설정 아님). member = 길드원도 씀
//   target 'att_score' = 평점 JSON 을 mode · cat · boss · battle 로 풀어 묻고, 저장은 SQL web_set_att_score 로만 (boss_settings 직접 저장 아님)
// 메뉴 needs = 그 저장 함수가 페이지에 있을 때만 열림
// 단계(step) — 위에서부터 차례로, when 이 안 맞으면 건너뜀:
//   id    : 이름 (when 에서 씀)
//   type  : choice(버튼 하나) · multi(여러 개 고르기) · text(짧게 적기) · numbers(항목마다 숫자: from · min · max · blank(빈칸 값) · unit)
//   ask   : 벨라 질문 (줄바꿈 \n)
//   cur   : '지금: …' 표시 { field, map?, def?, list?(JSON 목록), names?(출석 분류 이름) }
//   when  : { step, in:[값…] } — 그 단계 답이 이 중 하나일 때만 물음
//   field : 답을 넣을 boss_settings 칸,  as : str · int · json · date · cats · map(숫자 묶음 그대로) (값 바꾸는 규칙, 엔진이 검사)
//   sum   : 요약 줄 앞말 ('이렇게 바꿀게요' 에 보임). 없으면 요약에 안 나옴
//   choice options : [{ label, value?, route?(다음 질문 고르기만, 저장 안 함), set?(여러 칸 한꺼번에), input?(직접 입력: valid·min·max·hint), go?(탭으로 보내고 끝), end?(여기서 끝) }]
//                    step 에 field 가 없으면 value 는 다음 질문 고르기(when)에만 쓰임
//                    value 가 없으면 '그대로' (아무것도 안 바꿈). "$이름" = 엔진이 주는 값(아래 소스)
//   from  : 버튼 목록을 소스에서 (bosses · battle_types · board_items · builds_win · builds_mobile)
//   multi : pick(처음 체크 = 지금 값 칸), def(지금 값이 없을 때), min · max, ordered(고른 순서 = 순서), quick:[{label, pick:"$이름"}]
//   text  : valid(date · int · names), def(처음 값: 칸 이름 또는 "$이름"), quick:[{label, value}], long(여러 줄) · maxlen
// 소스 · "$이름" (플랫폼마다 같은 뜻으로 채워야 함):
//   bosses(이 서버 보스: 값=이름, 글=표시 이름) · battle_types · board_items(관리판 버튼) · builds_win/builds_mobile(올린 앱 빌드)
//   $farm_default(인터보스 5종) · $battle_all · $board_rec(추천 10개) · $board_grouped(지금 보드를 묶음 순서로) · $cat_suggest(추천 분류 이름, 쉼표) · $today
window.SETUP_FLOWS = {
  version: 1,
  hello: "안녕하세요, 설정 도우미 벨라예요! 몇 가지 물어보고, 끝에 바꿀 내용을 보여 드릴게요.\n**[적용]** 을 누르기 전에는 아무것도 안 바뀌어요.",
  helloMember: "안녕하세요, 벨라예요! 건의할 게 있으면 여기서 바로 보내 주세요.",
  // 왼쪽 벨라 머리 위 한 줄 말풍선 (번갈아). member = 길드원에게도, needs = 그 저장 함수가 있을 때만, flow = 누르면 바로 그 흐름
  bubble: [
    { text: "설정 도와드릴까요?" },
    { text: "건의할 게 있으면 말해 주세요", member: true, needs: "bellaSendSuggestion", flow: "suggest" },
  ],
  menu: {
    ask: "무엇을 바꿀까요?",
    items: [
      { flow: "att_view", label: "👁️ 출석 보기 (파머스 · 워페어 / 베이직 · 프랙티스)" },
      { flow: "att_cats", label: "🗂️ 출석 분류" },
      { flow: "cp", label: "📍 출석 구간 · 마일스톤" },
      { flow: "board", label: "⭐ 관리판 보드" },
      { flow: "app", label: "📦 앱 받기 (길드원)" },
      { flow: "score", label: "⭐ 평점", needs: "bellaSaveAttScore" },
      // 문의하기: 디스코드 /건의하기와 같은 저장. 웹에서 부를 함수(bellaSendSuggestion)가 생기기 전엔 메뉴에 안 보임
      { flow: "suggest", label: "📨 문의하기 (건의 · 오류)", member: true, needs: "bellaSendSuggestion" },
    ],
  },
  flows: {
    // ---------- 출석 보기 (봇 att_view.py · 웹 출석 탭과 같은 칸) ----------
    att_view: {
      title: "출석 보기", tab: "attendance",
      load: ["att_boss_view", "att_battle_view", "att_farm", "att_war_off", "att_practice"],
      done: "기록은 그대로고, 세는 범위만 바뀌어요.",
      steps: [
        { id: "boss", type: "choice", ask: "보스 출석은 어떻게 셀까요?",
          cur: { field: "att_boss_view", map: { farmers: "🌾 파머스", warfare: "⚔️ 워페어" }, def: "warfare" },
          field: "att_boss_view", sum: "보스 출석",
          options: [
            { label: "🌾 파머스 — 고른 보스만 세기", value: "farmers" },
            { label: "⚔️ 워페어 — 전부 세고, 뺄 것만 빼기", value: "warfare" },
            { label: "그대로" },
          ] },
        { id: "farm", type: "multi", when: { step: "boss", in: ["farmers"] },
          ask: "파머스에 넣을 보스를 골라 주세요.", from: "bosses", pick: "att_farm", def: "$farm_default", min: 1,
          quick: [{ label: "기본 (인터보스 5종)", pick: "$farm_default" }],
          field: "att_farm", as: "json", sum: "🌾 파머스 보스" },
        { id: "war", type: "multi", when: { step: "boss", in: ["warfare"] },
          ask: "워페어에서 **뺄** 보스가 있으면 골라 주세요. 없으면 그냥 [다 골랐어요].\n새 보스는 자동으로 들어가요.", from: "bosses", pick: "att_war_off", def: [],
          quick: [{ label: "하나도 안 빼기", pick: [] }],
          field: "att_war_off", as: "json", sum: "⚔️ 워페어에서 뺄 보스" },
        { id: "battle", type: "choice", ask: "전투 출석은 어떻게 셀까요?",
          cur: { field: "att_battle_view", map: { basic: "🛡️ 베이직", practice: "🎯 프랙티스" }, def: "basic" },
          field: "att_battle_view", sum: "전투 출석",
          options: [
            { label: "🛡️ 베이직 — 전투 5종 전부", value: "basic" },
            { label: "🎯 프랙티스 — 고른 전투만", value: "practice" },
            { label: "그대로" },
          ] },
        { id: "prac", type: "multi", when: { step: "battle", in: ["practice"] },
          ask: "프랙티스에 넣을 전투를 골라 주세요.", from: "battle_types", pick: "att_practice", def: "$battle_all", min: 1,
          field: "att_practice", as: "json", sum: "🎯 프랙티스 전투" },
      ],
    },

    // ---------- 출석 분류 (boss_settings.att_cats, 봇 att_view.py suggest_cats · clean_cats) ----------
    att_cats: {
      title: "출석 분류", tab: "attendance",
      load: ["att_cats"],
      done: "",
      steps: [
        { id: "how", type: "choice",
          ask: "출석 분류는 시트 '요약' 보기 칸 · '주간 순위' 기준이에요. 어떻게 할까요?\n추천: $cat_suggest",
          cur: { field: "att_cats", names: true },
          options: [
            { label: "추천으로 정하기 (이름은 바꿀 수 있어요)", value: "suggest" },
            { label: "분류 없애기 (시트엔 보스 · 전투 출석만)", value: "clear", set: { att_cats: "[]" } },
            { label: "규칙까지 자세히 고치기 → 출석 탭", go: "attendance" },
            { label: "그대로" },
          ], sum: "출석 분류" },
        { id: "names", type: "text", when: { step: "how", in: ["suggest"] },
          ask: "추천 분류 이름이에요. 바꾸려면 **같은 순서 · 같은 개수**로 쉼표를 넣어 적어 주세요. (이름은 20자까지)\n분류 규칙(어느 보스 · 전투가 드는지)은 추천 그대로 들어가요.",
          valid: "names", def: "$cat_suggest", hint: "$cat_suggest",
          quick: [{ label: "추천 이름 그대로", value: "$cat_suggest" }],
          field: "att_cats", as: "cats", sum: "분류 (위에서부터)" },
      ],
    },

    // ---------- 출석 구간 (체크포인트) · 마일스톤 (설정 탭 '📍 출석 구간' 칸) ----------
    cp: {
      title: "출석 구간 · 마일스톤", tab: "settings",
      load: ["cp_start", "cp_days", "ms_days"],
      done: "지난 기록은 그대로예요.",
      steps: [
        { id: "mode", type: "choice", ask: "출석 구간(체크포인트)을 시작일부터 N일마다 자동으로 나눠요. 무엇을 할까요?",
          cur: { field: "cp_start", fmt: "cp" },
          options: [
            { label: "자동 주기 켜기 · 바꾸기", value: "on" },
            { label: "자동 주기 끄기", value: "off", set: { cp_start: null, cp_days: 0 } },
            { label: "마일스톤 알림만 바꾸기", value: "ms" },
            { label: "그대로", end: true },
          ], sum: "구간 자동 주기" },
        { id: "start", type: "text", when: { step: "mode", in: ["on"] },
          ask: "구간 시작일을 적어 주세요. 그날 0시부터 나뉘어요. (예: 2026-11-24 또는 11/24)",
          valid: "date", def: "cp_start", quick: [{ label: "오늘", value: "$today" }],
          field: "cp_start", as: "date", sum: "시작일" },
        { id: "days", type: "choice", when: { step: "mode", in: ["on"] }, ask: "며칠마다 나눌까요?",
          cur: { field: "cp_days", fmt: "days", def: 14 },
          field: "cp_days", as: "int", sum: "주기",
          options: [
            { label: "7일 (매주)", value: 7 },
            { label: "14일", value: 14 },
            { label: "직접 적기", input: { valid: "int", min: 1, max: 366, hint: "1 ~ 366 (일)" } },
          ] },
        { id: "ms", type: "choice", when: { step: "mode", in: ["on", "ms"] },
          ask: "📍 마일스톤 알림: 구간 시작부터 N일마다, 그리고 구간이 끝날 때 알림 채널에 그때까지의 출석 순위를 올려요. 며칠마다 할까요?",
          cur: { field: "ms_days", fmt: "days0", def: 0 },
          field: "ms_days", as: "int", sum: "마일스톤 알림",
          options: [
            { label: "끄기", value: 0 },
            { label: "7일마다", value: 7 },
            { label: "직접 적기", input: { valid: "int", min: 0, max: 366, hint: "0 ~ 366 (일, 0 = 끔)" } },
            { label: "그대로" },
          ] },
      ],
    },

    // ---------- 관리판 즐겨찾기 보드 (boss_settings.panel_board, 봇 fav_board.py) ----------
    board: {
      title: "관리판 보드", tab: "settings",
      load: ["panel_board"],
      done: "",
      steps: [
        { id: "how", type: "choice", ask: "디스코드 관리판에 보일 버튼(최대 10개)을 어떻게 할까요?",
          cur: { field: "panel_board", fmt: "board" },
          field: "panel_board", as: "json", sum: "관리판 보드",
          options: [
            { label: "추천 10개로", value: "$board_rec" },
            { label: "직접 고르기", value: "pick", route: true },
            { label: "지금 버튼을 묶음 순서로 정리", value: "$board_grouped" },
            { label: "그대로" },
          ] },
        { id: "pick", type: "multi", when: { step: "how", in: ["pick"] },
          ask: "보드에 넣을 버튼을 **놓을 순서대로** 눌러 주세요. (최대 10개)\n순서는 나중에 설정 탭에서 ↑↓ 로도 바꿀 수 있어요.",
          from: "board_items", pick: "panel_board", def: "$board_rec", min: 1, max: 10, ordered: true,
          quick: [{ label: "추천 10개", pick: "$board_rec" }, { label: "모두 해제", pick: [] }],
          field: "panel_board", as: "json", sum: "관리판 보드 (순서대로)" },
      ],
    },

    // ---------- 평점 (boss_settings.att_score, 봇 att_view.clean_score) — 저장은 SQL web_set_att_score 로만 (target) ----------
    // 점수 0~100 (소수 2자리), 비운 칸 = 1점. mode cat 인데 분류가 없으면 칸 = 보스 · 전투
    score: {
      title: "평점", tab: "attendance", target: "att_score",
      load: ["att_score", "att_cats"],
      done: "출석 기록은 그대로예요.",
      steps: [
        { id: "mode", type: "choice", ask: "평점 = 주간 순위 **출석 × 점수** 합이에요. 점수를 어떻게 매길까요?\n비운 칸은 1점이라, 다 비우면 출석 횟수 합과 같아요.",
          cur: { field: "mode", map: { cat: "분류별", item: "보스 · 전투 종류별" }, def: "cat" },
          field: "mode", sum: "점수 방식",
          options: [
            { label: "분류별", value: "cat" },
            { label: "보스 · 전투 종류별", value: "item" },
            { label: "방식은 그대로, 점수만", value: "$score_mode", route: true },
          ] },
        { id: "cat", type: "numbers", when: { step: "mode", in: ["cat"] },
          ask: "분류마다 점수를 적어 주세요. (0 ~ 100, 비우면 1점)", from: "score_cats", min: 0, max: 100, blank: 1, unit: "점",
          field: "cat", as: "map", sum: "분류별 점수" },
        { id: "boss", type: "numbers", when: { step: "mode", in: ["item"] },
          ask: "보스마다 점수를 적어 주세요. (0 ~ 100, 비우면 1점)", from: "bosses", min: 0, max: 100, blank: 1, unit: "점",
          field: "boss", as: "map", sum: "보스 점수" },
        { id: "battle", type: "numbers", when: { step: "mode", in: ["item"] },
          ask: "전투 종류마다 점수를 적어 주세요. (0 ~ 100, 비우면 1점)", from: "battle_types", min: 0, max: 100, blank: 1, unit: "점",
          field: "battle", as: "map", sum: "전투 점수" },
      ],
    },

    // ---------- 문의하기 (= 디스코드 /건의하기, 봇 suggest.py: suggestions 표 · 봇 주인에게만 · 종류 feature/bug/etc · 1500자) ----------
    // 저장 함수 bellaSendSuggestion({kind, body}) 는 아직 없음 → 브랜치4(suggest.py) · 브랜치5(SQL/app.js)가 정해 주면 꽂힘
    suggest: {
      title: "문의하기", target: "suggest", member: true,
      load: [],
      sumTitle: "이렇게 보낼게요", sumNote: "봇 주인에게만 보여요", applyLabel: "📨 보내기", applyHint: "[보내기] 를 눌러야 보내져요.",
      done: "보냈어요! 봇 주인에게만 보여요.",
      steps: [
        { id: "kind", type: "choice", ask: "어떤 이야기인가요?", field: "kind", sum: "종류",
          options: [
            { label: "기능 제안", value: "feature" },
            { label: "오류 · 불편", value: "bug" },
            { label: "기타", value: "etc" },
          ] },
        { id: "body", type: "text", long: true, maxlen: 1500, ask: "내용을 자유롭게 적어 주세요. (1500자까지)\n봇 주인에게만 보이고, 다른 길드원 · 관리자에겐 안 보여요.",
          hint: "예: 출석 순위에 지난주 것도 같이 보고 싶어요", field: "body", sum: "내용" },
      ],
    },

    // ---------- 앱 받기 (버추얼 벨라 탭 '📦 길드원에게 내보낼 앱' · 길드원 권한) ----------
    app: {
      title: "앱 받기", tab: "vbella",
      load: ["vb_win_build", "vb_mobile_build", "vb_member_download_win", "vb_member_download_mobile"],
      done: "",
      steps: [
        { id: "plat", type: "choice", ask: "어느 앱을 정할까요?",
          options: [
            { label: "🖥️ 윈도우 앱", value: "win" },
            { label: "📱 모바일 앱", value: "mobile" },
            { label: "둘 다", value: "both" },
          ] },
        { id: "win", type: "choice", when: { step: "plat", in: ["win", "both"] },
          ask: "🖥️ 길드원에게 내보낼 윈도우 앱 빌드를 골라 주세요.", from: "builds_win",
          cur: { field: "vb_win_build", fmt: "build", def: "" },
          field: "vb_win_build", as: "str", sum: "🖥️ 내보낼 윈도우 앱",
          options: [{ label: "내보내지 않음", value: null }, { label: "그대로" }] },
        { id: "win_perm", type: "choice", when: { step: "plat", in: ["win", "both"] },
          ask: "🖥️ 길드원이 웹에서 윈도우 앱을 직접 받게 할까요?",
          cur: { field: "vb_member_download_win", map: { 1: "켜짐", 0: "꺼짐" }, def: 0 },
          field: "vb_member_download_win", as: "int", sum: "🖥️ 길드원 받기 권한",
          options: [{ label: "켜기", value: 1 }, { label: "끄기", value: 0 }, { label: "그대로" }] },
        { id: "mobile", type: "choice", when: { step: "plat", in: ["mobile", "both"] },
          ask: "📱 길드원에게 내보낼 모바일 앱 빌드를 골라 주세요.", from: "builds_mobile",
          cur: { field: "vb_mobile_build", fmt: "build", def: "" },
          field: "vb_mobile_build", as: "str", sum: "📱 내보낼 모바일 앱",
          options: [{ label: "내보내지 않음", value: null }, { label: "그대로" }] },
        { id: "mobile_perm", type: "choice", when: { step: "plat", in: ["mobile", "both"] },
          ask: "📱 길드원이 웹에서 모바일 앱을 직접 받게 할까요?",
          cur: { field: "vb_member_download_mobile", map: { 1: "켜짐", 0: "꺼짐" }, def: 0 },
          field: "vb_member_download_mobile", as: "int", sum: "📱 길드원 받기 권한",
          options: [{ label: "켜기", value: 1 }, { label: "끄기", value: 0 }, { label: "그대로" }] },
      ],
    },
  },
};
