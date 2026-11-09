// jeju-bus-proxy — Cloudflare Workers 프록시
//
// 역할
//  1) CORS 우회 — bus.jeju.go.kr API는 자기 홈페이지에서만 부르도록 되어 있어 브라우저 직접 호출이 막힌다
//  2) 키 은닉 — 카카오/TAGO 인증키를 클라이언트에 내리지 않고 여기서 붙인다
//
// 배포: Cloudflare 계정 nolzenstudio@gmail.com → Worker `jeju-bus-proxy`
//       (대시보드 붙여넣기 또는 `wrangler deploy`)
//
// Secrets (Settings → Variables and Secrets)
//  - KAKAO_REST_KEY     카카오 로컬 API REST 키          [등록됨·동작 확인 2026-07-24]
//  - JEJU_DATAHUB_KEY   제주데이터허브 appkey            [등록됨·현재 미사용]
//  - TAGO_KEY           공공데이터포털 serviceKey(디코딩)  [전국 확장용 — 신규]
//
// 라우팅
//  /kakao/{keyword|address}?query=…   → dapi.kakao.com   (장소 검색)
//  /tago/{op}?…                       → apis.data.go.kr  (전국 버스정보, 아래 TAGO_OPS만 허용)
//  /jejudata/…                        → open.jejudatahub.net
//  /schedule/list?keyword=434         → bus.jeju.go.kr 시간표 검색(HTML)을 JSON으로 정리
//  /schedule/table?id=1916            → bus.jeju.go.kr 시간표 표 + 안내문(평일만 운행 등)
//  /*.do?…                            → bus.jeju.go.kr/api  (제주 BIS, 기본 경로)

// 전국 확장용 TAGO 오퍼레이션 화이트리스트.
// 여기 없는 경로는 404 — TAGO_KEY가 붙는 분기라서 임의 호출을 허용하면 일 쿼터가 그대로 샌다.
const TAGO_OPS = {
  "citycode":     "BusSttnInfoInqireService/getCtyCodeList",              // 도시코드 목록(커버리지 실측용)
  "sttn/near":    "BusSttnInfoInqireService/getCrdntPrxmtSttnList",       // 좌표기반 근접정류소(반경 500m)
  "sttn/routes":  "BusSttnInfoInqireService/getSttnThrghRouteList",       // 정류소별 경유노선
  "route/sttns":  "BusRouteInfoInqireService/getRouteAcctoSttnList",      // 노선별 경유정류소
  "route/info":   "BusRouteInfoInqireService/getRouteInfoIem",            // 노선정보항목(기점/종점 — 방면 보강용)
  "arrival":      "ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList" // 정류소별 실시간 도착
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    let targetUrl;

    // 카카오 로컬 검색 (목적지 필터) — 키를 노출하지 않도록 프록시에서 헤더로 붙인다
    //  /kakao/keyword?query=카멜리아힐  -> 상호·명소 검색
    //  /kakao/address?query=아라일동    -> 주소·행정동 검색
    if (url.pathname.startsWith("/kakao/")) {
      const kind = url.pathname.slice("/kakao/".length);
      if (!["keyword", "address"].includes(kind)) return notFound();
      const kakaoUrl =
        `https://dapi.kakao.com/v2/local/search/${kind}.json?size=10&query=` +
        encodeURIComponent(url.searchParams.get("query") || "");
      const kres = await fetch(kakaoUrl, {
        headers: { Authorization: "KakaoAK " + env.KAKAO_REST_KEY }
      });
      return new Response(await kres.text(), {
        status: kres.status,
        headers: { "content-type": "application/json;charset=UTF-8", ...corsHeaders() }
      });
    }

    // 버스 시간표 (막차 표시용) — 실시간 API(/api/*.do)에는 시간표가 없고 웹사이트 화면에만 있다.
    // 화면용 HTML/POST라 앱이 직접 다루기 번거로워 여기서 JSON으로 정리해 내린다.
    // 시간표는 개편 때만 바뀌므로 6시간 캐시한다(상류 부하·응답 속도 모두 이득).
    if (url.pathname.startsWith("/schedule/")) {
      return cached(request, 21600, () => schedule(url));
    }

    // 국토부 TAGO (전국 버스정보) — serviceKey를 여기서 붙인다
    //  예: /tago/sttn/near?gpsLati=33.4996&gpsLong=126.5312&numOfRows=10
    //      /tago/arrival?cityCode=25&nodeId=DJB8001793
    if (url.pathname.startsWith("/tago/")) {
      const op = url.pathname.slice("/tago/".length);
      if (!TAGO_OPS[op]) return notFound();
      const params = new URLSearchParams(url.search);
      params.set("serviceKey", env.TAGO_KEY);   // 디코딩된 키를 넣는다(URLSearchParams가 다시 인코딩)
      params.set("_type", "json");
      targetUrl = `https://apis.data.go.kr/1613000/${TAGO_OPS[op]}?${params}`;

    } else if (url.pathname.startsWith("/jejudata/")) {
      // 예: /jejudata/station?stationName=한국병원
      //  -> open.jejudatahub.net/api/proxy/{데이터셋ID}/{appkey}?stationName=한국병원
      const datasetId = "DD11ab6a6t11D16baaa1a2tD26ata161";
      targetUrl = `https://open.jejudatahub.net/api/proxy/${datasetId}/${env.JEJU_DATAHUB_KEY}${url.search}`;

    } else {
      // 예: /searchArrivalInfoList.do?station_id=405000155
      //  -> bus.jeju.go.kr/api/searchArrivalInfoList.do?station_id=405000155
      // 제주 API는 인증키가 없어 남용 위험이 낮지만, 아무 경로나 중계하지 않도록 확장자만 제한한다.
      // 앱이 쓰는 호출은 전부 `.do`로 끝나므로 기존 동작에는 영향이 없다.
      if (!url.pathname.endsWith(".do")) return notFound();
      targetUrl = "https://bus.jeju.go.kr/api" + url.pathname + url.search;
    }

    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers: { "Referer": "https://bus.jeju.go.kr/" }
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": "application/json;charset=UTF-8",
        ...corsHeaders()
      }
    });
  }
};

const BIS = "https://bus.jeju.go.kr";
const FORM = { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": BIS + "/" };

async function schedule(url) {
  const op = url.pathname.slice("/schedule/".length);

  // 노선번호 → 시간표 목록. 같은 번호에 방향별(또는 임시운행) 표가 여럿일 수 있다.
  //  [{ id: 1916, num: "434", title: "434 순환(한라도서관-오등동-중앙로-한라도서관)" }, …]
  if (op === "list") {
    const keyword = url.searchParams.get("keyword") || "";
    if (!/^[0-9-]{1,9}$/.test(keyword)) return notFound();
    const res = await fetch(`${BIS}/mobile/schedule/listSchedule`, {
      method: "POST", headers: FORM, body: "keyword=" + encodeURIComponent(keyword)
    });
    const html = await res.text();
    const items = [];
    const re = /scheduleId=(\d+)"[\s\S]*?class="span_one">([^<]*)<[\s\S]*?class="text_dest">([^<]*)</g;
    for (let m; (m = re.exec(html));) {
      items.push({ id: Number(m[1]), num: text(m[2]).replace(/번$/, ""), title: text(m[3]) });
    }
    return json(items, res.ok ? 200 : 502);
  }

  // 시간표 표 + 안내문
  //  { id, via: "…※ 평일만 운행, 토,일,공휴일 운행하지 않음", since: "2024.8.12.", rows: [[머리행], [시각…], …] }
  //  rows[0]은 정류장 이름(첫 칸은 빈 칸), 이후 행은 운행 회차별 시각 — 'X'(미정차)·'중앙마을 회차'·'5:50 (출발)'·비고도 섞여 온다
  if (op === "table") {
    const id = url.searchParams.get("id") || "";
    if (!/^\d{1,6}$/.test(id)) return notFound();
    const [tres, dres] = await Promise.all([
      fetch(`${BIS}/data/schedule/getScheduleTableInfo`, { method: "POST", headers: FORM, body: "scheduleId=" + id }),
      fetch(`${BIS}/mobile/schedule/detailSchedule?scheduleId=${id}`, { headers: { "Referer": BIS + "/" } })
    ]);
    if (!tres.ok) return json({ error: "upstream" }, 502);
    const cells = await tres.json();
    const html = dres.ok ? await dres.text() : "";
    const rows = [];
    (cells || []).forEach(c => {
      (rows[c.ROW_SEQ] = rows[c.ROW_SEQ] || [])[c.COLUMN_SEQ] = text(c.COLUMN_NM || "");
    });
    const via = (html.match(/class="rotue-via[^"]*"[^>]*>([\s\S]*?)<\/td>/) || [])[1] || "";
    const since = (html.match(/시행일\s*:\s*([^)<]*)/) || [])[1] || "";
    return json({
      id: Number(id), via: text(via), since: since.trim(),
      rows: rows.filter(Boolean).map(r => Array.from(r, v => v || ""))
    });
  }
  return notFound();
}

// HTML 조각 → 한 줄 텍스트 (<br>은 공백으로)
function text(s) {
  return String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8", ...corsHeaders() }
  });
}

// 성공 응답만 Cloudflare 엣지 캐시에 담는다
async function cached(request, ttl, make) {
  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200) {
    const copy = new Response(res.body, res);
    copy.headers.set("Cache-Control", `public, max-age=${ttl}`);
    await cache.put(key, copy.clone());
    return copy;
  }
  return res;
}

function notFound() {
  return new Response('{"error":"unsupported"}', { status: 404, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
}
