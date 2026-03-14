const { syncOptionToSheet, upsertStoreToSheet, upsertProductToSheet, batchUpsertToSheet, markDeletedOptions } = require('./sheetsModule');

// 세션 타임스탬프 (코드 실행 시작 시간으로 통일)
let currentSessionTimestamp = null;

/**
 * 한국 시간(KST, UTC+9)으로 타임스탬프 변환
 * @param {string|Date} date - ISO 문자열 또는 Date 객체
 * @returns {string} - 한국 시간 형식: '2025-11-24 18:02:13'
 */
function toKoreaTime(date = null) {
    const d = date ? new Date(date) : new Date();
    // 한국 시간으로 변환 (UTC+9)
    const koreaTime = new Date(d.getTime() + (9 * 60 * 60 * 1000));
    
    const year = koreaTime.getUTCFullYear();
    const month = String(koreaTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(koreaTime.getUTCDate()).padStart(2, '0');
    const hours = String(koreaTime.getUTCHours()).padStart(2, '0');
    const minutes = String(koreaTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(koreaTime.getUTCSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 가격 문자열을 숫자로 변환
 * 예: "36,800원" -> 36800
 */
function parsePrice(priceStr) {
    if (!priceStr) return null;
    if (typeof priceStr === 'number') return priceStr;
    
    // 숫자와 쉼표만 추출
    const match = priceStr.toString().match(/[\d,]+/);
    if (match) {
        return parseInt(match[0].replace(/,/g, ''), 10);
    }
    return null;
}

/**
 * 스토어 추가 또는 업데이트 (구글 시트만 사용)
 */
async function upsertStore(storeId, storeName) {
    try {
        await upsertStoreToSheet(storeId, storeName);
        return { store_id: storeId, store_name: storeName };
    } catch (e) {
        console.error(`스토어 저장 중 오류: ${e.message}`);
        return { store_id: storeId, store_name: storeName };
    }
}

/**
 * 상품 추가 또는 업데이트 (구글 시트만 사용)
 */
async function upsertProduct(storeId, productId, productName, price = null) {
    try {
        const priceNum = parsePrice(price);
        await upsertProductToSheet(storeId, productId, productName, priceNum);
        return {
            product_id: productId,
            product_name: productName,
            price: priceNum
        };
    } catch (e) {
        console.error(`상품 저장 중 오류: ${e.message}`);
        return {
            product_id: productId,
            product_name: productName,
            price: parsePrice(price)
        };
    }
}

/**
 * 옵션 추가 (구글 시트만 사용)
 */
async function addOption(storeId, productId, optionData) {
    // 옵션은 재고 업데이트 시 함께 저장되므로 여기서는 별도 처리 불필요
    return optionData;
}

/**
 * 주문수정 프로세스 정보 저장 (구글 시트만 사용)
 */
async function addOrderModificationInfo(storeId, productId, info) {
    // 주문수정 정보는 구글 시트에 저장하지 않음
    return null;
}

/**
 * 재고 정보 업데이트 (구글 시트만 사용)
 * @param {string} storeId - 스토어 ID
 * @param {string} productId - 상품 ID
 * @param {string} optionName - 옵션명
 * @param {number} stock - 재고 수
 * @param {string} storeName - 스토어명 (옵션, 크롤링한 정보)
 * @param {string} productName - 상품명 (옵션, 크롤링한 정보)
 * @param {number} price - 가격 (옵션, 크롤링한 정보)
 * @param {number} additionalPrice - 추가 가격 (옵션, 크롤링한 정보)
 */
async function updateStock(storeId, productId, optionName, stock, storeName = null, productName = null, price = null, additionalPrice = null) {
    try {
        // 타임스탬프 생성 (세션 타임스탬프가 있으면 사용, 없으면 새로 생성, 한국 시간 형식)
        const timestamp = currentSessionTimestamp || toKoreaTime();
        
        // 구글 시트에서 이전 재고 정보 읽기 (현재 타임스탬프 전달하여 15분 이내 재사용 여부 확인)
        const { readStockFromSheet } = require('./sheetsModule');
        const previousStockInfo = await readStockFromSheet(storeId, productId, optionName, timestamp);
        
        // 증감량 계산
        let stockChange = '(-)';
        if (previousStockInfo && previousStockInfo.previousStock !== null) {
            const diff = stock - previousStockInfo.previousStock;
            if (diff > 0) {
                stockChange = `(+${diff})`;
            } else if (diff < 0) {
                stockChange = `(-${Math.abs(diff)})`;
            }
        }
        
        // 크롤링한 정보를 우선 사용하고, 없으면 시트에서 읽은 정보 사용
        const finalStoreName = storeName || previousStockInfo?.storeName || '';
        const finalProductName = productName || previousStockInfo?.productName || '';
        const finalPrice = price !== null ? price : (previousStockInfo?.price !== null ? previousStockInfo.price : null);
        const finalAdditionalPrice = additionalPrice !== null ? additionalPrice : (previousStockInfo?.additionalPrice !== null ? previousStockInfo.additionalPrice : 0);
        
        // 구글 시트에 저장
        await syncOptionToSheet(
            storeId,
            finalStoreName,
            productId,
            finalProductName,
            finalPrice,
            {
                option_name: optionName,
                additional_price: finalAdditionalPrice,
                stock: {
                    [timestamp]: `${stock} ${stockChange}`
                }
            }
        );
        
        return {
            option_name: optionName,
            stock: {
                [timestamp]: `${stock} ${stockChange}`
            }
        };
    } catch (e) {
        console.error(`재고 정보 저장 중 오류: ${e.message}`);
        throw e;
    }
}

/**
 * 세션 타임스탬프 설정 (코드 실행 시작 시간으로 통일, 한국 시간 형식)
 * @returns {string} 설정된 타임스탬프
 */
function setSessionTimestamp(timestamp = null) {
    currentSessionTimestamp = timestamp || toKoreaTime();
    return currentSessionTimestamp;
}

/**
 * 여러 옵션을 시트에 한 번에 배치 기록
 * @param {Array} items - [{storeId, storeName, productId, productName, optionName, stock, price, additionalPrice}]
 * @param {string} timestamp - 공통 타임스탬프
 */
async function batchUpdateStocks(items, timestamp) {
    try {
        if (!items || items.length === 0) return;

        const ts = timestamp || currentSessionTimestamp || toKoreaTime();

        // 시트에서 이전 재고 읽기 (1번만)
        const { readAllStockFromSheet } = require('./sheetsModule');
        const previousStockMap = await readAllStockFromSheet(ts);

        // 증감량 계산 후 배치 데이터 구성
        const batchItems = items.map(item => {
            const key = `${item.storeId}__${item.productId}__${item.optionName}`;
            const prevStock = previousStockMap[key] ?? null;

            let stockChange = '(-)';
            if (prevStock !== null) {
                const diff = item.stock - prevStock;
                if (diff > 0) stockChange = `(+${diff})`;
                else if (diff < 0) stockChange = `(-${Math.abs(diff)})`;
            }

            return {
                ...item,
                stockValue: `${item.stock} ${stockChange}`,
                timestamp: ts
            };
        });

        await batchUpsertToSheet(batchItems);

        // 고아행 처리: 이번 실행에서 업데이트 안 된 행에 DELETED 표기
        const storeIds = new Set(batchItems.map(i => String(i.storeId)));
        const updatedKeys = new Set(batchItems.map(i => `${i.storeId}__${i.productId}__${i.optionName}`));
        await markDeletedOptions(storeIds, updatedKeys, ts);
    } catch (e) {
        console.error(`배치 재고 저장 중 오류: ${e.message}`);
        throw e;
    }
}

/**
 * 세션 타임스탬프 초기화
 */
function clearSessionTimestamp() {
    currentSessionTimestamp = null;
}

module.exports = {
    upsertStore,
    upsertProduct,
    addOption,
    addOrderModificationInfo,
    updateStock,
    batchUpdateStocks,
    setSessionTimestamp,
    clearSessionTimestamp
};


