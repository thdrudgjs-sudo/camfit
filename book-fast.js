// 사용법: node book-fast.js <체크인> <체크아웃>
// 예시:   node book-fast.js 2026-08-26 2026-08-28
//
// ★ 타이밍: 15:05 실행 → 준비 완료 → 15:10:00.000 정각에 예약 시작

// ── 타이밍 설정 ───────────────────────────────────────────────────
const OPEN_TIME = { h: 21, m:  0, s: 0 };  // 예약 시작 시각 (21:00:00)

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

// ── 존 ID ────────────────────────────────────────────────────────
const ZONES = {
  C:  "67e28462f111bc001df0fc81",
  B:  "67e28471cec395001d676fb4",
  잔디: "67e283fdfc138f001df8c68f",
};

// ── 예약 우선순위 (위에서부터 순서대로 시도) ─────────────────────
//    key: 존, name: 사이트 이름에 포함된 문자열
const PRIORITY = [
    { zone: "잔디", name: "잔디 10" },
  { zone: "잔디", name: "잔디 11" },
  { zone: "C",  name: "C09" },
  { zone: "C",  name: "C01" },
  { zone: "C",  name: "C02" },
  { zone: "C",  name: "C03" },
  { zone: "C",  name: "C07" },
  { zone: "B",  name: "B09" },
  { zone: "B",  name: "B10" },
  // ── 나머지 ──
  { zone: "C",  name: "C04" },
  { zone: "C",  name: "C05" },
  { zone: "C",  name: "C06" },
  { zone: "C",  name: "C08" },
  { zone: "B",  name: "B11" },
  { zone: "잔디", name: "잔디 07" },
  { zone: "잔디", name: "잔디 08" },
  { zone: "잔디", name: "잔디 09" },
  { zone: "B",  name: "B08" }, 
  { zone: "B",  name: "B07" },
  { zone: "B",  name: "B01" },
  { zone: "B",  name: "B02" },
  { zone: "B",  name: "B03" },
  { zone: "B",  name: "B04" },
  { zone: "B",  name: "B05" },
  { zone: "B",  name: "B06" },
  { zone: "A",  name: "A02" },
];

// ── 고정 예약자 정보 ──────────────────────────────────────────────
const BOOKER = {
  name:          "송경헌",
  contact:       "01049063852",
  request:       "",
  numOfAdults:   2,
  numOfTeens:    0,
  numOfChildren: 0,
  numOfBaby:     0,
  numOfCars:     1,
  carInfo:       [{ type: "rentCar", carNumber: "렌트카" }],
  paymentMethod:     "bank",
  paymentGateway:    "TOSS",
  paymentMethodType: "basic",
};

// ── 인수 파싱 ─────────────────────────────────────────────────────
const [,, checkInArg, checkOutArg] = process.argv;
if (!checkInArg || !checkOutArg) {
  console.log("사용법: node book-fast.js <체크인> <체크아웃>");
  console.log("예시:   node book-fast.js 2026-08-26 2026-08-28");
  process.exit(1);
}
function parseDate(s) {
  const [year, month, day] = s.split("-").map(Number);
  return { year, month, day };
}
const checkInDate  = parseDate(checkInArg);
const checkoutDate = parseDate(checkOutArg);

// ── API 헬퍼 ─────────────────────────────────────────────────────
async function apiFetch(page, url, body) {
  return page.evaluate(async ({ url, body }) => {
    const opts = {
      method: body ? "POST" : "GET",
      headers: { "Accept": "application/json, text/plain, */*", "Cache-Control": "no-cache" },
    };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    return r.json();
  }, { url, body: body || null });
}

// ── 카운트다운 대기 ───────────────────────────────────────────────
async function waitUntilOpen() {
  const now = new Date();
  const target = new Date();
  target.setHours(OPEN_TIME.h, OPEN_TIME.m, OPEN_TIME.s, 0);

  if (now >= target) {
    console.log("(이미 오픈 시각 경과 → 즉시 시작)");
    return;
  }

  console.log(`\n⏰ ${OPEN_TIME.h}:${String(OPEN_TIME.m).padStart(2,"0")}:${String(OPEN_TIME.s).padStart(2,"0")} 정각에 예약을 시작합니다.`);

  // 1초 단위 카운트다운
  while (true) {
    const diff = target - new Date();
    if (diff <= 100) break;               // 100ms 전부터 tight loop
    const sec = Math.ceil(diff / 1000);
    process.stdout.write(`\r남은 시간: ${sec}초   `);
    await new Promise(r => setTimeout(r, diff > 1100 ? 500 : 50));
  }

  // 정각까지 1ms 단위 대기
  while (new Date() < target) {
    await new Promise(r => setTimeout(r, 1));
  }
  console.log(`\n🚀 ${new Date().toLocaleTimeString("ko-KR", { hour12: false })} 예약 시작!\n`);
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  console.log(`날짜: ${checkInArg} ~ ${checkOutArg}\n`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-position=-10000,-10000", "--window-size=1,1"],
  });

  try {
    const [page] = await browser.pages();
    process.stdout.write("연결 중... ");
    await page.goto("https://camfit.co.kr/", { waitUntil: "domcontentloaded", timeout: 20000 });
    console.log("완료\n");

    // 체크인~체크아웃 전날까지 날짜 배열
    const targetDates = [];
    for (let d = new Date(`${checkInArg}T00:00:00`); d < new Date(`${checkOutArg}T00:00:00`); d.setDate(d.getDate() + 1)) {
      targetDates.push(d.toISOString().slice(0, 10));
    }

    // ── 전체 존 사이트 목록 한 번에 가져오기 ───────────────────────
    process.stdout.write("사이트 조회 중... ");
    const siteMap = {};  // name keyword → site object

    for (const [zoneKey, zoneId] of Object.entries(ZONES)) {
      const cal = await apiFetch(page,
        `https://api.camfit.co.kr/v1/vacancy-calendars/zones/${zoneId}/sites?startDate=${checkInArg}&endDate=${checkOutArg}`
      );
      for (const site of cal?.data?.sites ?? []) {
        for (const p of PRIORITY) {
          if (p.zone === zoneKey && site.name.includes(p.name)) {
            siteMap[`${p.zone}|${p.name}`] = site;
          }
        }
      }
    }
    console.log("완료\n");

    // ── 우선순위 순서 출력 ─────────────────────────────────────────
    console.log("── 예약 시도 순서 ──────────────────────────────");
    for (let i = 0; i < PRIORITY.length; i++) {
      const p = PRIORITY[i];
      const site = siteMap[`${p.zone}|${p.name}`];
      if (!site) { console.log(`  ${String(i+1).padStart(2)}. [${p.zone}] ${p.name}  (사이트 없음)`); continue; }

      const st = targetDates.map(date => {
        const d = site.availability.find(a => a.date === date);
        if (!d) return "?";
        return d.status === "available" ? "○" : d.status === "sold_out" ? "✗" : "-";
      }).join("");
      const skip = targetDates.some(date => {
        const d = site.availability.find(a => a.date === date);
        return d && d.status === "sold_out";
      });
      console.log(`  ${String(i+1).padStart(2)}. [${p.zone}] ${p.name}  [${st}]${skip ? "  → 매진 건너뜀" : ""}`);
    }
    console.log("────────────────────────────────────────────────");

    // ── 오픈 시각까지 대기 ─────────────────────────────────────────
    await waitUntilOpen();  // 테스트 시 이 줄을 주석처리

    // ── 우선순위대로 예약 시도 ─────────────────────────────────────
    for (const p of PRIORITY) {
      const site = siteMap[`${p.zone}|${p.name}`];
      if (!site) continue;

      // sold_out 건너뜀
      const isSoldOut = targetDates.some(date => {
        const d = site.availability.find(a => a.date === date);
        return d && d.status === "sold_out";
      });
      if (isSoldOut) continue;

      // 금액 계산
      process.stdout.write(`[${p.zone} ${p.name}] 금액 계산... `);
      const calc = await apiFetch(page, "https://api.camfit.co.kr/v1/booking/calculate", {
        siteId: site.id, checkInDate, checkoutDate,
        numOfAdults: BOOKER.numOfAdults, numOfTeens: BOOKER.numOfTeens,
        numOfChildren: BOOKER.numOfChildren, numOfCars: BOOKER.numOfCars,
        services: [], hasTrailer: false, hasCampingCar: false, pets: [],
      });

      if (calc?.status !== "success") {
        console.log(`실패 (${calc?.message ?? "오류"}), 다음으로`);
        continue;
      }
      const accommodationPrice = calc.accommodationCharge ?? 0;
      const parkingPrice       = calc.extraCarCharge      ?? 0;
      process.stdout.write(`${(accommodationPrice + parkingPrice).toLocaleString()}원  `);

      // 예약
      process.stdout.write("예약 중... ");
      const book = await apiFetch(page, "https://api.camfit.co.kr/v1/book", {
        siteId: site.id, checkInDate, checkoutDate,
        ...BOOKER,
        numOfAdultsGuest: 0, numOfTeensGuest: 0, numOfChildrenGuest: 0,
        services: [],
        coupon: null, couponDiscount: 0, usePoint: 0, campingPass: null,
        carNumbers: [],
        accommodationPrice, parkingPrice, servicePrice: 0,
        hasTrailer: false, hasCampingCar: false,
        petCharge: 0, pets: [],
        provider: null, paymentMethodId: null,
      });

      if (book?.status === "success") {
        const bi = book.bankInformation;
        console.log("완료!\n");
        console.log("════════════════════════════════════════");
        console.log(`사이트   : ${site.name}`);
        console.log(`예약 ID  : ${book.bookingId}`);
        if (bi) {
          console.log(`은  행   : ${bi.bank}`);
          console.log(`계좌번호 : ${bi.accountNumber} (${bi.accountHolder})`);
          console.log(`입금액   : ${bi.amount.toLocaleString()}원`);
          console.log(`입금자명 : ${bi.depositorName}`);
        }
        console.log(`결과 URL : https://camfit.co.kr/reservation/result/${book.bookingId}?token=${book.token}&isNew=1`);
        console.log("════════════════════════════════════════");
        return;
      } else {
        console.log(`실패 (${book?.message ?? "오류"}), 다음으로`);
      }
    }

    console.error("\n모든 사이트 예약 실패.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
