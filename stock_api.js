/**
 * 네이버 장바구니 실재고 조회 - 순수 HTTP (브라우저 없음)
 * 사용법: node stock_api.js [프로필명]
 * 예시:  node stock_api.js naver_bnam91
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { batchUpdateStocks, setSessionTimestamp, clearSessionTimestamp } = require('./dbModule');

const GRAPHQL_URL = 'https://shopping.naver.com/cart/graphql';
const CDP_PORT = 9222;
const IS_WIN = process.platform === 'win32';

// OS별 Chrome 실행 경로
function getChromePath() {
    if (!IS_WIN) return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return candidates[0]; // 기본값
}
const CHROME_PATH = getChromePath();

// OS별 Chrome 종료 명령어
const CHROME_KILL_CMD = IS_WIN
    ? 'taskkill /F /IM chrome.exe'
    : 'pkill -a "Google Chrome"';

// OS별 기본 user_data 루트
const USER_DATA_ROOT = IS_WIN
    ? path.join(process.env.USERPROFILE || 'C:\\Users\\user', 'Documents', 'github_cloud', 'user_data')
    : path.join('/Users/a1/Documents/github_cloud/user_data');

// 프로필명 → CDP용 Chrome 프로필 경로 매핑
const CDP_PROFILE_MAP = {
    naver_bnam91: path.join(USER_DATA_ROOT, 'naver_bnam91_cdp'),
};

// 브라우저에서 캡처한 실제 쿼리 로드 (갱신 후 재로드 가능하도록 함수로)
function loadQueries() {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'queries.json'), 'utf-8'));
}
let QUERIES = loadQueries();

// ─── 세션 자동 갱신 (CDP) ───────────────────────────────────────

async function refreshSession(profile) {
    const cdpProfileDir = CDP_PROFILE_MAP[profile];
    if (!cdpProfileDir) {
        throw new Error(`[${profile}] CDP 프로필 없음. 수동으로 쿠키를 갱신해주세요.`);
    }

    console.log(`\n[${profile}] 세션 만료 감지 → Chrome CDP로 자동 갱신 시작...`);

    // 기존 Chrome 종료
    try { execSync(CHROME_KILL_CMD, { stdio: 'ignore' }); } catch(e) {}
    await new Promise(r => setTimeout(r, 2000));

    // Chrome CDP 실행
    const chromeProc = spawn(CHROME_PATH, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${cdpProfileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
    ], { detached: true, stdio: 'ignore' });
    chromeProc.unref();

    // CDP 준비 대기
    await new Promise(r => setTimeout(r, 4000));

    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.connect({ browserURL: `http://localhost:${CDP_PORT}`, defaultViewport: null });
    const page = await browser.newPage();

    let captured = null;
    await page.setRequestInterception(true);
    page.on('request', req => {
        const url = req.url();
        if (url.includes('shopping.naver.com/cart/graphql') && req.method() === 'POST') {
            try {
                const parsed = JSON.parse(req.postData());
                if (parsed.operationName === 'getGeneralCartCacheView') {
                    captured = { headers: req.headers() };
                }
            } catch(e) {}
        }
        req.continue();
    });

    console.log(`[${profile}] 장바구니 페이지 접속 중...`);
    await page.goto('https://shopping.naver.com/cart', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // 쿠키 저장
    const cookies = await page.cookies();
    const naverCookies = cookies.filter(c => c.domain.includes('naver.com'));
    fs.writeFileSync(path.join(__dirname, `cookies_${profile}.json`), JSON.stringify(naverCookies, null, 2));
    console.log(`[${profile}] 쿠키 갱신 완료 (${naverCookies.length}개)`);

    // queries.json 헤더 갱신
    if (captured) {
        const queries = loadQueries();
        queries.getGeneralCartCacheView = queries.getGeneralCartCacheView || {};
        queries.getGeneralCartCacheView.headers = captured.headers;
        fs.writeFileSync(path.join(__dirname, 'queries.json'), JSON.stringify(queries, null, 2));
        console.log(`[${profile}] request_session 갱신 완료`);
    } else {
        console.warn(`[${profile}] GraphQL 요청 캡처 실패 (장바구니가 비어있을 수 있음)`);
    }

    await page.close();
    await browser.disconnect();

    // Chrome 종료
    try { execSync('pkill -a "Google Chrome"', { stdio: 'ignore' }); } catch(e) {}
    await new Promise(r => setTimeout(r, 1000));

    // QUERIES 재로드
    QUERIES = loadQueries();
    console.log(`[${profile}] 세션 갱신 완료 → 재시도\n`);
}

// 쿠키 파일 경로 (CDP 세션에서 저장된 쿠키 사용)
function getCookieFilePath(profile) {
    return path.join(__dirname, `cookies_${profile}.json`);
}

function loadCookies(profile) {
    const filePath = getCookieFilePath(profile);
    if (!fs.existsSync(filePath)) {
        throw new Error(`쿠키 파일 없음: ${filePath}\n먼저 Chrome으로 로그인 후 쿠키를 저장해주세요.`);
    }
    const cookies = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function makeHeaders(cookieStr, extraHeaders = {}) {
    return {
        'content-type': 'application/json',
        'accept': '*/*',
        'origin': 'https://shopping.naver.com',
        'referer': 'https://shopping.naver.com/cart',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'cookie': cookieStr,
        ...extraHeaders
    };
}

// queries.json에서 헤더 추출 (request_session, x-schema-version 등)
function loadQueryHeaders() {
    try {
        const queries = QUERIES;
        const h = queries.getGeneralCartCacheView?.headers || {};
        const extra = {};
        if (h['request_session']) extra['request_session'] = h['request_session'];
        if (h['x-schema-version']) extra['x-schema-version'] = h['x-schema-version'];
        return extra;
    } catch(e) {
        return {};
    }
}

async function graphql(operationName, query, variables, headers) {
    const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ operationName, variables, query })
    });
    const data = await res.json();
    if (data.errors) {
        throw new Error(`GraphQL 오류 [${operationName}]: ${JSON.stringify(data.errors[0]?.message)}`);
    }
    return data.data;
}

// ─── 쿼리 문자열 ──────────────────────────────────────────────

const QUERY_GET_CART = `
query getGeneralCartCacheView($channelNo: BigInt, $nudgeProdId: BigInt) {
  getGeneralCartCacheView: getGeneralCartCacheViewShopperGW(
    channelNo: $channelNo
    nudgeProdId: $nudgeProdId
  ) {
    itemsCount
    productsCount
    memberId
    stores {
      products {
        cartProductId
        name
        productId
        channelServiceType
        channel {
          channelName
          channelNo
          naverPaySellerNo
          __typename
        }
        items {
          cartProductItemId
          itemNo
          contentNames
          quantity
          price
          optionAdditionalFee
          type
          elements {
            elementId
            groupNames
            values
            type
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

const QUERY_GET_MODIFY_VIEW = `
query getCartProductModifyView($cartProductId: String!, $deviceType: DeviceType!) {
  getCartProductModifyView: getCartProductModifyViewShopperGW(
    cartProductId: $cartProductId
    deviceType: $deviceType
  ) {
    cartProductId
    name
    productId
    stockQuantity
    salePrice
    productCombinationOptions {
      id
      productId
      groupNames
      names
      stockQuantity
      salePrice
      price
      optionAdditionalFee
      status
      todayDispatch
      __typename
    }
    productOptions {
      groupName
      id
      optionType
      __typename
    }
    items {
      cartProductItemId
      itemNo
      contentNames
      quantity
      price
      optionAdditionalFee
      type
      elements {
        elementId
        groupNames
        values
        type
        __typename
      }
      __typename
    }
    channel {
      channelName
      channelNo
      naverPaySellerNo
      __typename
    }
    __typename
  }
}`;

// ─── 메인 ──────────────────────────────────────────────────────

async function getStockForAllProducts(profile = 'naver_bnam91', sharedTimestamp = null) {
    console.log(`\n[${profile}] 재고 조회 시작`);

    const cookieStr = loadCookies(profile);
    const extraHeaders = loadQueryHeaders();
    const headers = makeHeaders(cookieStr, extraHeaders);

    // 1. 장바구니 전체 조회
    console.log('장바구니 로드 중...');
    const cartData = await graphql('getGeneralCartCacheView', QUERIES.getGeneralCartCacheView.query, {}, headers);
    const cart = cartData.getGeneralCartCacheView;

    const totalProducts = cart?.stores?.reduce((sum, s) => sum + (s.products?.length || 0), 0) || 0;
    if (!cart || totalProducts === 0) {
        console.log('장바구니가 비어있습니다.');
        return;
    }
    console.log(`총 ${cart.productsCount}개 상품 발견\n`);

    const timestamp = setSessionTimestamp(sharedTimestamp);
    const collected = []; // 시트 쓰기 없이 결과만 수집

    // 2. 상품별 재고 조회 (API 호출만, 시트 쓰기 없음)
    for (const store of cart.stores) {
        for (const product of store.products) {
            const { cartProductId, name, channel } = product;
            const storeName = channel?.channelName || '';
            const storeId = String(channel?.naverPaySellerNo || channel?.channelNo || '');

            try {
                const modifyData = await graphql(
                    'getCartProductModifyView',
                    QUERIES.getCartProductModifyView.query,
                    { cartProductId, deviceType: 'PC' },
                    headers
                );
                const view = modifyData.getCartProductModifyView;
                const productId = String(view.productId || '');
                const productName = view.name || name || '';
                const resolvedStoreName = view.channel?.channelName || storeName;
                const resolvedStoreId = String(view.channel?.naverPaySellerNo || view.channel?.channelNo || storeId);
                const options = view.productCombinationOptions || [];

                console.log(`\n[스토어] ${resolvedStoreName}`);
                console.log(`[상품] ${productName}`);

                if (options.length === 0) {
                    console.log(`  재고: ${view.stockQuantity}개 (단일상품)`);
                    collected.push({ storeId: resolvedStoreId, storeName: resolvedStoreName, productId, productName, optionName: '', stock: view.stockQuantity, price: view.salePrice, additionalPrice: 0 });
                } else {
                    for (const opt of options) {
                        const optionName = opt.names.join(' / ');
                        const status = opt.status === 'SALE' ? '' : ` [${opt.status}]`;
                        console.log(`  └─ ${optionName}: ${opt.stockQuantity}개${status}`);
                        collected.push({ storeId: resolvedStoreId, storeName: resolvedStoreName, productId, productName, optionName, stock: opt.stockQuantity, price: view.salePrice, additionalPrice: opt.optionAdditionalFee });
                    }
                }
            } catch (e) {
                console.log(`  재고 조회 실패: ${e.message}`);
            }

            // 랜덤 딜레이 (500~1500ms)
            const delay = Math.floor(Math.random() * 1000) + 500;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // 3. 시트에 한 번에 배치 기록
    console.log(`\n시트에 ${collected.length}개 옵션 배치 기록 중...`);
    await batchUpdateStocks(collected, timestamp);

    clearSessionTimestamp();

    console.log('\n=== 완료 ===');
    console.log(`총 ${collected.length}개 옵션 조회 완료`);
    return collected;
}

// CLI 실행 (세션 만료 시 1회 자동 갱신 후 재시도)
async function run() {
    const profile = process.argv[2] || 'naver_bnam91';
    const sharedTimestamp = process.argv[3] || null;
    try {
        await getStockForAllProducts(profile, sharedTimestamp);
    } catch (e) {
        const isAuthError = e.message.includes('Internal server error') || e.message.includes('Unauthorized') || e.message.includes('쿠키 파일 없음');
        if (isAuthError && CDP_PROFILE_MAP[profile]) {
            await refreshSession(profile);
            await getStockForAllProducts(profile, sharedTimestamp);
        } else {
            throw e;
        }
    }
}

run().catch(console.error);
