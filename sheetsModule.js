const { google } = require('googleapis');
const path = require('path');
const dotenv = require('dotenv');

// .env 파일 경로 설정
const envPath = path.join(process.env.USERPROFILE, 'Documents', 'github_cloud', 'module_api_key', '.env');

// .env 파일을 먼저 로드 (auth.js가 dotenv.config()를 호출하기 전에)
dotenv.config({ path: envPath });
// 현재 디렉토리의 .env도 시도 (없어도 무방)
dotenv.config();

// auth.js 경로
const authPath = path.join(process.env.USERPROFILE, 'Documents', 'github_cloud', 'module_auth', 'auth.js');
const { getCredentials } = require(authPath);

// 스프레드시트 ID (URL에서 추출)
const SPREADSHEET_ID = '1rd5hkf7oMm8IVgGbISm6ZjHshZ74VmHor9I0VXVWNiM';
const SHEET_NAME = 'daily_stock_';

// 컬럼 인덱스 (0부터 시작)
const COL_INDEX = 0;           // A열
// B열: 빈 칼럼 (gg_id 등 기존 데이터 유지용)
const COL_STORE_ID = 2;        // C열
const COL_PRODUCT_ID = 3;      // D열
const COL_STORE_NAME = 5;      // F열
const COL_PRODUCT_NAME = 6;    // G열
const COL_PRICE = 7;           // H열
const COL_OPTION_NAME = 8;     // I열
const COL_ADDITIONAL_PRICE = 9; // J열
const COL_STOCK_START = 11;    // L열 (인덱스 11)

let sheets = null;
let authClient = null;
let sheetIdCache = null;

// 재시도 설정
const MAX_RETRIES = 10; // 최대 재시도 횟수
const INITIAL_RETRY_DELAY = 1000; // 초기 재시도 대기 시간 (밀리초)
const MAX_RETRY_DELAY = 60000; // 최대 재시도 대기 시간 (60초)

/**
 * 할당량 초과 에러인지 확인
 */
function isQuotaExceededError(error) {
    const errorMessage = error?.message || '';
    return errorMessage.includes('Quota exceeded') || 
           errorMessage.includes('quota metric') ||
           error?.code === 429; // HTTP 429 Too Many Requests
}

/**
 * 지수 백오프를 사용한 재시도 로직
 * @param {Function} apiCall - 실행할 API 호출 함수
 * @param {string} operationName - 작업 이름 (로깅용)
 * @returns {Promise} - API 호출 결과
 */
async function retryWithBackoff(apiCall, operationName = 'API 호출') {
    let lastError = null;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await apiCall();
        } catch (error) {
            lastError = error;
            
            // 할당량 초과 에러가 아니면 즉시 에러 반환
            if (!isQuotaExceededError(error)) {
                throw error;
            }
            
            // 마지막 시도면 에러 반환
            if (attempt === MAX_RETRIES) {
                console.error(`${operationName} 재시도 실패 (${MAX_RETRIES + 1}회 시도): ${error.message}`);
                throw error;
            }
            
            // 지수 백오프 계산 (최대 대기 시간 제한)
            const delay = Math.min(
                INITIAL_RETRY_DELAY * Math.pow(2, attempt),
                MAX_RETRY_DELAY
            );
            
            console.log(`${operationName} 할당량 초과 에러 발생. ${delay / 1000}초 후 재시도... (${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

/**
 * Google Sheets API 클라이언트 초기화
 */
async function initSheets() {
    if (sheets && authClient) {
        return sheets;
    }
    
    try {
        authClient = await getCredentials();
        sheets = google.sheets({ version: 'v4', auth: authClient });
        return sheets;
    } catch (e) {
        console.error(`Google Sheets 초기화 중 오류: ${e.message}`);
        throw e;
    }
}

/**
 * 시트 ID 가져오기
 */
async function getSheetId(sheetsClient) {
    if (sheetIdCache !== null) {
        return sheetIdCache;
    }
    
    try {
        const response = await retryWithBackoff(async () => {
            return await sheetsClient.spreadsheets.get({
                spreadsheetId: SPREADSHEET_ID
            });
        }, '시트 ID 가져오기');
        
        const sheet = response.data.sheets.find(s => s.properties.title === SHEET_NAME);
        if (sheet) {
            sheetIdCache = sheet.properties.sheetId;
            return sheetIdCache;
        }
        
        throw new Error(`시트 '${SHEET_NAME}'를 찾을 수 없습니다.`);
    } catch (e) {
        console.error(`시트 ID 가져오기 중 오류: ${e.message}`);
        throw e;
    }
}

/**
 * 시트에서 모든 데이터 읽기
 */
async function readSheetData() {
    try {
        const sheetsClient = await initSheets();
        const response = await retryWithBackoff(async () => {
            return await sheetsClient.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A:ZZ`,
            });
        }, '시트 데이터 읽기');
        
        return response.data.values || [];
    } catch (e) {
        console.error(`시트 데이터 읽기 중 오류: ${e.message}`);
        return [];
    }
}

/**
 * 시트의 컬럼 수 확장 (필요한 경우)
 */
async function ensureSheetColumns(sheetsClient, requiredColumnCount) {
    try {
        const sheetId = await getSheetId(sheetsClient);
        const response = await retryWithBackoff(async () => {
            return await sheetsClient.spreadsheets.get({
                spreadsheetId: SPREADSHEET_ID,
                ranges: [`${SHEET_NAME}!A1`],
                includeGridData: false
            });
        }, '시트 컬럼 확인');
        
        const sheet = response.data.sheets.find(s => s.properties.sheetId === sheetId);
        if (!sheet) {
            return;
        }
        
        // Google Sheets의 기본 컬럼 수는 26개 (A-Z, 인덱스 0-25)
        // gridProperties가 없거나 columnCount가 0이면 기본값 26으로 간주
        const currentColumnCount = sheet.properties.gridProperties?.columnCount || 26;
        
        // requiredColumnCount는 이미 실제 필요한 컬럼 수 (1-based)입니다
        // 예: L열(인덱스 11)이면 requiredColumnCount = 12, M열(인덱스 12)이면 requiredColumnCount = 13
        if (requiredColumnCount > currentColumnCount) {
            // 여유 있게 확장 (최소 10개, 최대 50개씩 확장)
            const newColumnCount = Math.max(requiredColumnCount + 10, currentColumnCount + 50);
            
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        requests: [{
                            updateSheetProperties: {
                                properties: {
                                    sheetId: sheetId,
                                    gridProperties: {
                                        columnCount: newColumnCount
                                    }
                                },
                                fields: 'gridProperties.columnCount'
                            }
                        }]
                    }
                });
            }, '시트 컬럼 확장');
            console.log(`시트 컬럼 수를 ${currentColumnCount}개에서 ${newColumnCount}개로 확장했습니다. (필요한 컬럼: ${requiredColumnCount}개)`);
        }
    } catch (e) {
        console.error(`시트 컬럼 확장 중 오류: ${e.message}`);
        // 오류가 발생해도 계속 진행
    }
}

/**
 * 시트에 헤더가 있는지 확인하고 없으면 추가
 */
async function ensureHeaders() {
    try {
        const sheetsClient = await initSheets();
        const data = await readSheetData();
        
        // 헤더가 없거나 비어있으면 헤더 추가
        if (data.length === 0 || !data[0] || data[0].length === 0) {
            const headers = [
                '', '', 'store_id', 'product_id', '', 'store_name',
                'product_name', 'price', 'option_name', 'additional_price', '', ''
            ];
            
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${SHEET_NAME}!A1:L1`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: [headers]
                    }
                });
            }, '헤더 추가');
        }
    } catch (e) {
        console.error(`헤더 확인 중 오류: ${e.message}`);
    }
}

/**
 * 시트에서 특정 행 찾기 (store_id, product_id, option_name으로)
 */
function findRowIndex(data, storeId, productId, optionName) {
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row && 
            row[COL_STORE_ID] === String(storeId) &&
            row[COL_PRODUCT_ID] === String(productId) &&
            row[COL_OPTION_NAME] === String(optionName)) {
            return i;
        }
    }
    return -1;
}

/**
 * 시트에서 스토어/상품 정보가 있는 행 찾기 (option_name 무시)
 */
function findStoreProductRow(data, storeId, productId) {
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row && 
            row[COL_STORE_ID] === String(storeId) &&
            row[COL_PRODUCT_ID] === String(productId)) {
            return i;
        }
    }
    return -1;
}

/**
 * 타임스탬프 컬럼 찾기 (없으면 다음 빈 컬럼 반환)
 */
function findTimestampColumn(data, timestamp) {
    if (data.length === 0) {
        return COL_STOCK_START;
    }
    
    // 헤더 행에서 타임스탬프 찾기
    const headerRow = data[0] || [];
    
    // L열(COL_STOCK_START)부터 검색하여 타임스탬프 찾기
    for (let col = COL_STOCK_START; col < headerRow.length; col++) {
        if (headerRow[col] === timestamp) {
            return col;
        }
    }
    
    // 타임스탬프가 없으면 다음 빈 컬럼 반환
    // L열부터 시작해서 빈 컬럼 찾기
    let nextCol = COL_STOCK_START;
    while (nextCol < headerRow.length && headerRow[nextCol]) {
        nextCol++;
    }
    return nextCol;
}

/**
 * 숫자를 Excel 컬럼 문자로 변환 (A, B, ..., Z, AA, AB, ...)
 */
function numberToColumnLetter(num) {
    let result = '';
    while (num >= 0) {
        result = String.fromCharCode(65 + (num % 26)) + result;
        num = Math.floor(num / 26) - 1;
    }
    return result;
}

/**
 * stock 값에서 증감률 추출 및 색상 결정
 * @param {string} value - stock 값 (예: "3715 (-)", "3715 (-3)", "3715 (+11)")
 * @returns {object|null} - 색상 정보 {red, green, blue} 또는 null (기본 색상)
 */
function getColorFromStockValue(value) {
    if (!value || typeof value !== 'string') {
        return null;
    }
    
    // 증감률 패턴 찾기: (+11), (-3), (-) 등
    const changeMatch = value.match(/\(([+-]?\d+)\)/);
    
    if (!changeMatch) {
        // (-) 패턴이면 기본 색상
        return null;
    }
    
    const changeValue = parseInt(changeMatch[1], 10);
    
    if (changeValue > 0) {
        // 양수: 빨간색
        return { red: 1.0, green: 0.0, blue: 0.0 };
    } else if (changeValue < 0) {
        // 음수: 파란색
        return { red: 0.0, green: 0.0, blue: 1.0 };
    }
    
    // 0이거나 (-) 패턴: 기본 색상
    return null;
}

/**
 * 한국 시간 형식 문자열을 Date 객체로 변환
 * @param {string} koreaTimeStr - '2025-11-24 18:02:13' 형식
 * @returns {Date} - Date 객체
 */
function parseKoreaTime(koreaTimeStr) {
    // '2025-11-24 18:02:13' 형식을 파싱
    const match = koreaTimeStr.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!match) {
        // ISO 형식도 지원 (하위 호환성)
        return new Date(koreaTimeStr);
    }
    
    const [, year, month, day, hours, minutes, seconds] = match;
    // 한국 시간이므로 UTC로 변환 (9시간 빼기)
    const date = new Date(Date.UTC(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hours, 10) - 9, // 한국 시간에서 9시간 빼서 UTC로
        parseInt(minutes, 10),
        parseInt(seconds, 10)
    ));
    return date;
}

/**
 * 두 타임스탬프 간 시간 차이 계산 (분 단위)
 * 한국 시간 형식과 ISO 형식 모두 지원
 */
function getTimeDifferenceInMinutes(timestamp1, timestamp2) {
    const date1 = parseKoreaTime(timestamp1);
    const date2 = parseKoreaTime(timestamp2);
    return Math.abs((date2 - date1) / (1000 * 60)); // 밀리초를 분으로 변환
}

/**
 * 시트의 현재 마지막 열 확인 및 필요한 열 미리 확장
 * 15분 이내면 최근 열 재사용
 */
async function ensureColumnsBeforeUpdate(sheetsClient, stockData) {
    try {
        // stockData가 없으면 스킵
        const stockEntries = Object.entries(stockData || {});
        if (stockEntries.length === 0) {
            return;
        }
        
        // 먼저 현재 시트 상태 확인 (데이터 읽기 전)
        const sheetId = await getSheetId(sheetsClient);
        const response = await retryWithBackoff(async () => {
            return await sheetsClient.spreadsheets.get({
                spreadsheetId: SPREADSHEET_ID,
                ranges: [`${SHEET_NAME}!A1:ZZ1`], // 헤더만 읽기
                includeGridData: false
            });
        }, '열 확장 확인');
        
        const sheet = response.data.sheets.find(s => s.properties.sheetId === sheetId);
        if (!sheet) {
            return;
        }
        
        // 현재 시트의 컬럼 수 확인
        const currentColumnCount = sheet.properties.gridProperties?.columnCount || 26;
        
        // 헤더 데이터 읽기
        const headerData = await readSheetData();
        const headerRow = headerData[0] || [];
        
        // L열부터 사용된 마지막 컬럼과 타임스탬프 찾기
        let lastUsedColumn = COL_STOCK_START - 1; // L열 이전
        let lastTimestamp = null;
        for (let i = COL_STOCK_START; i < headerRow.length; i++) {
            if (headerRow[i]) {
                lastUsedColumn = i;
                lastTimestamp = headerRow[i];
            }
        }
        
        // 새로 추가할 타임스탬프 확인 (가장 최근 타임스탬프 사용)
        const sortedEntries = Object.entries(stockData).sort((a, b) => {
            const dateA = parseKoreaTime(a[0]);
            const dateB = parseKoreaTime(b[0]);
            return dateA - dateB;
        });
        const latestTimestamp = sortedEntries[sortedEntries.length - 1][0];
        
        // 15분 이내인지 확인
        let shouldReuseColumn = false;
        if (lastTimestamp) {
            const timeDiff = getTimeDifferenceInMinutes(lastTimestamp, latestTimestamp);
            if (timeDiff <= 15) {
                shouldReuseColumn = true;
                console.log(`[열 재사용] 최근 타임스탬프(${lastTimestamp})와 새 타임스탬프(${latestTimestamp})의 차이가 ${timeDiff.toFixed(1)}분이므로 같은 열을 재사용합니다.`);
            }
        }
        
        // 필요한 컬럼 수 계산
        let maxRequiredColumn = lastUsedColumn + 1;
        if (!shouldReuseColumn && lastTimestamp) {
            // 15분 초과면 새 열 필요
            maxRequiredColumn = lastUsedColumn + 1;
        }
        
        // 필요한 컬럼 수 계산 (1-based)
        const requiredColumnCount = maxRequiredColumn + 1;
        
        // 필요한 열이 부족하면 먼저 확장
        if (requiredColumnCount > currentColumnCount) {
            const newColumnCount = Math.max(requiredColumnCount + 10, currentColumnCount + 50);
            
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        requests: [{
                            updateSheetProperties: {
                                properties: {
                                    sheetId: sheetId,
                                    gridProperties: {
                                        columnCount: newColumnCount
                                    }
                                },
                                fields: 'gridProperties.columnCount'
                            }
                        }]
                    }
                });
            }, '열 확장');
            console.log(`[열 확장] 시트 컬럼 수를 ${currentColumnCount}개에서 ${newColumnCount}개로 확장했습니다. (필요한 컬럼: ${requiredColumnCount}개)`);
        }
        
        // 15분 이내면 재사용할 열 정보 반환
        return {
            shouldReuseColumn,
            reuseColumnIndex: shouldReuseColumn ? lastUsedColumn : null,
            latestTimestamp
        };
    } catch (e) {
        console.error(`열 확장 확인 중 오류: ${e.message}`);
        // 오류가 발생해도 계속 진행
        return { shouldReuseColumn: false, reuseColumnIndex: null, latestTimestamp: null };
    }
}

/**
 * 시트에 데이터 업데이트 또는 추가
 */
async function upsertToSheet(storeId, storeName, productId, productName, price, optionName, additionalPrice, stockData) {
    try {
        const sheetsClient = await initSheets();
        
        // 헤더 확인
        await ensureHeaders();
        
        // stockData가 있으면 먼저 필요한 열 확장 및 15분 이내 열 재사용 확인 (데이터 읽기 전에)
        const columnInfo = await ensureColumnsBeforeUpdate(sheetsClient, stockData);
        
        // 기존 데이터 읽기
        const data = await readSheetData();
        
        // 행 찾기
        let rowIndex = findRowIndex(data, storeId, productId, optionName);
        
        // stockData는 { timestamp: "value" } 형식
        const stockEntries = Object.entries(stockData);
        if (stockEntries.length === 0) {
            return; // stock 데이터가 없으면 업데이트하지 않음
        }
        
        // 모든 타임스탬프를 정렬하여 처리 (가장 최근 타임스탬프 사용)
        const sortedEntries = stockEntries.sort((a, b) => {
            const dateA = parseKoreaTime(a[0]);
            const dateB = parseKoreaTime(b[0]);
            return dateA - dateB;
        });
        const latestEntry = sortedEntries[sortedEntries.length - 1];
        const latestTimestamp = latestEntry[0];
        const latestValue = latestEntry[1];
        
        const updates = [];
        let headerRow = data[0] || [];
        
        // 타임스탬프별 컬럼 매핑 생성
        const timestampToCol = {};
        let targetCol = -1;
        
        // 15분 이내면 최근 열 재사용
        if (columnInfo.shouldReuseColumn && columnInfo.reuseColumnIndex !== null) {
            targetCol = columnInfo.reuseColumnIndex;
            // 15분 이내면 헤더를 변경하지 않음 (기존 헤더 유지)
            console.log(`[열 재사용] ${numberToColumnLetter(targetCol)}열을 재사용합니다. 헤더는 변경하지 않습니다.`);
        } else {
            // 새 열 찾기
            // 헤더에서 타임스탬프 찾기
            let foundCol = -1;
            for (let i = COL_STOCK_START; i < headerRow.length; i++) {
                if (headerRow[i] === latestTimestamp) {
                    foundCol = i;
                    break;
                }
            }
            
            if (foundCol === -1) {
                // 타임스탬프가 없으면 다음 빈 컬럼 찾기
                let nextCol = COL_STOCK_START;
                while (nextCol < headerRow.length && headerRow[nextCol]) {
                    nextCol++;
                }
                targetCol = nextCol;
                
                // 헤더 확장 및 타임스탬프 추가
                while (headerRow.length <= targetCol) {
                    headerRow.push('');
                }
                headerRow[targetCol] = latestTimestamp;
                
                const colLetter = numberToColumnLetter(targetCol);
                updates.push({
                    range: `${SHEET_NAME}!${colLetter}1`,
                    values: [[latestTimestamp]]
                });
            } else {
                targetCol = foundCol;
            }
        }
        
        // 모든 타임스탬프를 같은 열에 매핑 (가장 최근 값만 사용)
        for (const [timestamp] of sortedEntries) {
            timestampToCol[timestamp] = targetCol;
        }
        
        if (rowIndex === -1) {
            // 새 행 추가
            // 최대 컬럼 인덱스 찾기
            const maxCol = Math.max(...Object.values(timestampToCol), COL_STOCK_START);
            const newRow = new Array(Math.max(maxCol + 1, COL_STOCK_START + 1)).fill('');
            
            newRow[COL_INDEX] = ''; // A열 비움
            newRow[COL_STORE_ID] = String(storeId);
            newRow[COL_PRODUCT_ID] = String(productId);
            newRow[COL_STORE_NAME] = String(storeName || '');
            newRow[COL_PRODUCT_NAME] = String(productName || '');
            newRow[COL_PRICE] = price !== null ? String(price) : '';
            newRow[COL_OPTION_NAME] = String(optionName || '');
            newRow[COL_ADDITIONAL_PRICE] = additionalPrice !== null ? String(additionalPrice) : '';
            
            // 가장 최근 stock 값만 행에 추가 (15분 이내 열 재사용 시 덮어쓰기)
            const stockCol = timestampToCol[latestTimestamp];
            if (stockCol >= newRow.length) {
                while (newRow.length <= stockCol) {
                    newRow.push('');
                }
            }
            newRow[stockCol] = String(latestValue);
            
            // 새 행 추가
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${SHEET_NAME}!A:ZZ`,
                    valueInputOption: 'RAW',
                    insertDataOption: 'INSERT_ROWS',
                    resource: {
                        values: [newRow]
                    }
                });
            }, '행 추가');
            
            // 추가된 행의 인덱스 (헤더 제외, 0부터 시작하므로 data.length - 1)
            const appendedRowIndex = data.length - 1;
            
            // stock 값에 대한 색상 서식 적용 (가장 최근 값만)
            const formatRequests = [];
            const color = getColorFromStockValue(latestValue);
            
            if (color) {
                formatRequests.push({
                    repeatCell: {
                        range: {
                            sheetId: await getSheetId(sheetsClient),
                            startRowIndex: appendedRowIndex,
                            endRowIndex: appendedRowIndex + 1,
                            startColumnIndex: stockCol,
                            endColumnIndex: stockCol + 1
                        },
                        cell: {
                            userEnteredFormat: {
                                textFormat: {
                                    foregroundColor: color
                                }
                            }
                        },
                        fields: 'userEnteredFormat.textFormat.foregroundColor'
                    }
                });
            }
            
            if (formatRequests.length > 0) {
                await retryWithBackoff(async () => {
                    return await sheetsClient.spreadsheets.batchUpdate({
                        spreadsheetId: SPREADSHEET_ID,
                        resource: {
                            requests: formatRequests
                        }
                    });
                }, '색상 서식 적용');
            }
        } else {
            // 기존 행 업데이트
            const row = data[rowIndex];
            
            // 기본 정보 업데이트 (크롤링한 정보가 있으면 항상 업데이트)
            if (storeName) {
                const colLetter = numberToColumnLetter(COL_STORE_NAME);
                updates.push({
                    range: `${SHEET_NAME}!${colLetter}${rowIndex + 1}`,
                    values: [[String(storeName)]]
                });
            }
            if (productName) {
                const colLetter = numberToColumnLetter(COL_PRODUCT_NAME);
                updates.push({
                    range: `${SHEET_NAME}!${colLetter}${rowIndex + 1}`,
                    values: [[String(productName)]]
                });
            }
            if (price !== null) {
                const colLetter = numberToColumnLetter(COL_PRICE);
                updates.push({
                    range: `${SHEET_NAME}!${colLetter}${rowIndex + 1}`,
                    values: [[String(price)]]
                });
            }
            if (!row[COL_ADDITIONAL_PRICE] && additionalPrice !== null) {
                const colLetter = numberToColumnLetter(COL_ADDITIONAL_PRICE);
                updates.push({
                    range: `${SHEET_NAME}!${colLetter}${rowIndex + 1}`,
                    values: [[String(additionalPrice)]]
                });
            }
            
            // 가장 최근 stock 값만 업데이트 (15분 이내 열 재사용 시 덮어쓰기)
            const stockCol = timestampToCol[latestTimestamp];
            const colLetter = numberToColumnLetter(stockCol);
            updates.push({
                range: `${SHEET_NAME}!${colLetter}${rowIndex + 1}`,
                values: [[String(latestValue)]]
            });
        }
        
        // 배치 업데이트 (값 업데이트)
        if (updates.length > 0) {
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        valueInputOption: 'RAW',
                        data: updates
                    }
                });
            }, '값 업데이트');
        }
        
        // stock 값에 대한 색상 서식 적용 (기존 행 업데이트인 경우, 가장 최근 값만)
        if (rowIndex !== -1) {
            const formatRequests = [];
            const stockCol = timestampToCol[latestTimestamp];
            const color = getColorFromStockValue(latestValue);
                
                if (color) {
                    formatRequests.push({
                        repeatCell: {
                            range: {
                                sheetId: await getSheetId(sheetsClient),
                                startRowIndex: rowIndex,
                                endRowIndex: rowIndex + 1,
                                startColumnIndex: stockCol,
                                endColumnIndex: stockCol + 1
                            },
                            cell: {
                                userEnteredFormat: {
                                    textFormat: {
                                        foregroundColor: color
                                    }
                                }
                            },
                            fields: 'userEnteredFormat.textFormat.foregroundColor'
                        }
                    });
                }
                
                if (formatRequests.length > 0) {
                    await retryWithBackoff(async () => {
                        return await sheetsClient.spreadsheets.batchUpdate({
                            spreadsheetId: SPREADSHEET_ID,
                            resource: {
                                requests: formatRequests
                            }
                        });
                    }, '색상 서식 적용');
                }
            }
    } catch (e) {
        console.error(`Google Sheets 업데이트 중 오류: ${e.message}`);
        // 오류가 발생해도 JSON 저장은 계속 진행되도록 예외를 던지지 않음
    }
}

/**
 * 스토어 정보를 시트에 저장
 */
async function upsertStoreToSheet(storeId, storeName) {
    try {
        const sheetsClient = await initSheets();
        await ensureHeaders();
        
        const data = await readSheetData();
        
        // 해당 스토어의 모든 행 찾기 (첫 번째 행 사용)
        let rowIndex = -1;
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row && row[COL_STORE_ID] === String(storeId)) {
                rowIndex = i;
                break;
            }
        }
        
        if (rowIndex === -1) {
            // 새 스토어는 상품이 추가될 때 함께 저장되므로 여기서는 스킵
            return;
        } else {
            // 기존 행의 스토어명 업데이트 (모든 행에 업데이트)
            const updates = [];
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row && row[COL_STORE_ID] === String(storeId)) {
                    if (!row[COL_STORE_NAME] && storeName) {
                        const colLetter = numberToColumnLetter(COL_STORE_NAME);
                        updates.push({
                            range: `${SHEET_NAME}!${colLetter}${i + 1}`,
                            values: [[String(storeName)]]
                        });
                    }
                }
            }
            
            if (updates.length > 0) {
                await retryWithBackoff(async () => {
                    return await sheetsClient.spreadsheets.values.batchUpdate({
                        spreadsheetId: SPREADSHEET_ID,
                        resource: {
                            valueInputOption: 'RAW',
                            data: updates
                        }
                    });
                }, '스토어 정보 업데이트');
            }
        }
    } catch (e) {
        console.error(`스토어 저장 중 오류: ${e.message}`);
    }
}

/**
 * 상품 정보를 시트에 저장
 */
async function upsertProductToSheet(storeId, productId, productName, price) {
    try {
        const sheetsClient = await initSheets();
        await ensureHeaders();
        
        const data = await readSheetData();
        
        // 해당 상품의 모든 행 찾기 (모든 옵션 행에 업데이트)
        const updates = [];
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row && 
                row[COL_STORE_ID] === String(storeId) &&
                row[COL_PRODUCT_ID] === String(productId)) {
                
                if (!row[COL_PRODUCT_NAME] && productName) {
                    const colLetter = numberToColumnLetter(COL_PRODUCT_NAME);
                    updates.push({
                        range: `${SHEET_NAME}!${colLetter}${i + 1}`,
                        values: [[String(productName)]]
                    });
                }
                if (!row[COL_PRICE] && price !== null) {
                    const colLetter = numberToColumnLetter(COL_PRICE);
                    updates.push({
                        range: `${SHEET_NAME}!${colLetter}${i + 1}`,
                        values: [[String(price)]]
                    });
                }
            }
        }
        
        if (updates.length > 0) {
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        valueInputOption: 'RAW',
                        data: updates
                    }
                });
            }, '상품 정보 업데이트');
        }
    } catch (e) {
        console.error(`상품 저장 중 오류: ${e.message}`);
    }
}

/**
 * 시트에서 특정 옵션의 이전 재고 정보 읽기
 */
async function readStockFromSheet(storeId, productId, optionName, currentTimestamp = null) {
    try {
        const sheetsClient = await initSheets();
        const data = await readSheetData();
        
        const rowIndex = findRowIndex(data, storeId, productId, optionName);
        if (rowIndex === -1) {
            return {
                previousStock: null,
                storeName: '',
                productName: '',
                price: null,
                additionalPrice: 0
            };
        }
        
        const row = data[rowIndex];
        const headerRow = data[0] || [];
        
        // 헤더의 타임스탬프와 값을 쌍으로 저장하고 정렬
        const stockEntries = [];
        for (let i = COL_STOCK_START; i < row.length && i < headerRow.length; i++) {
            if (row[i] && headerRow[i]) {
                const stockValue = row[i].toString();
                const timestamp = headerRow[i].toString();
                stockEntries.push({
                    index: i,
                    timestamp: timestamp,
                    value: stockValue
                });
            }
        }
        
        if (stockEntries.length === 0) {
            return {
                previousStock: null,
                storeName: row[COL_STORE_NAME] || '',
                productName: row[COL_PRODUCT_NAME] || '',
                price: row[COL_PRICE] ? parseInt(row[COL_PRICE].toString().replace(/[^\d]/g, ''), 10) : null,
                additionalPrice: row[COL_ADDITIONAL_PRICE] ? parseInt(row[COL_ADDITIONAL_PRICE].toString().replace(/[^\d]/g, ''), 10) : 0
            };
        }
        
        // 타임스탬프로 정렬 (내림차순: 가장 최근 것부터)
        stockEntries.sort((a, b) => {
            const dateA = parseKoreaTime(a.timestamp);
            const dateB = parseKoreaTime(b.timestamp);
            return dateB - dateA;
        });
        
        // 현재 타임스탬프가 있고, 15분 이내로 재사용하는 열이 있는지 확인
        let previousStock = null;
        if (currentTimestamp) {
            const latestEntry = stockEntries[0];
            const timeDiff = getTimeDifferenceInMinutes(latestEntry.timestamp, currentTimestamp);
            
            if (timeDiff <= 15) {
                // 15분 이내로 재사용하는 경우, 직전 열의 재고를 찾기
                // stockEntries는 이미 정렬되어 있으므로, 두 번째 항목이 직전 열
                if (stockEntries.length > 1) {
                    const previousEntry = stockEntries[1];
                    const stockMatch = previousEntry.value.match(/^(\d+)/);
                    if (stockMatch) {
                        previousStock = parseInt(stockMatch[1], 10);
                        console.log(`[재고 계산] 15분 이내 열 재사용 감지. 직전 열(${numberToColumnLetter(previousEntry.index)})의 재고(${previousStock})를 기준으로 계산합니다.`);
                    }
                } else {
                    // 직전 열이 없으면 가장 최근 열의 재고 사용
                    const stockMatch = latestEntry.value.match(/^(\d+)/);
                    if (stockMatch) {
                        previousStock = parseInt(stockMatch[1], 10);
                    }
                }
            } else {
                // 15분 초과면 가장 최근 열의 재고 사용
                const stockMatch = latestEntry.value.match(/^(\d+)/);
                if (stockMatch) {
                    previousStock = parseInt(stockMatch[1], 10);
                }
            }
        } else {
            // 현재 타임스탬프가 없으면 가장 최근 열의 재고 사용
            const latestEntry = stockEntries[0];
            const stockMatch = latestEntry.value.match(/^(\d+)/);
            if (stockMatch) {
                previousStock = parseInt(stockMatch[1], 10);
            }
        }
        
        return {
            previousStock,
            storeName: row[COL_STORE_NAME] || '',
            productName: row[COL_PRODUCT_NAME] || '',
            price: row[COL_PRICE] ? parseInt(row[COL_PRICE].toString().replace(/[^\d]/g, ''), 10) : null,
            additionalPrice: row[COL_ADDITIONAL_PRICE] ? parseInt(row[COL_ADDITIONAL_PRICE].toString().replace(/[^\d]/g, ''), 10) : 0
        };
    } catch (e) {
        console.error(`시트에서 재고 정보 읽기 중 오류: ${e.message}`);
        return {
            previousStock: null,
            storeName: '',
            productName: '',
            price: null,
            additionalPrice: 0
        };
    }
}

/**
 * 옵션의 모든 stock 데이터를 시트에 동기화
 */
async function syncOptionToSheet(storeId, storeName, productId, productName, price, option) {
    if (!option || !option.stock || Object.keys(option.stock).length === 0) {
        return;
    }
    
    await upsertToSheet(
        storeId,
        storeName,
        productId,
        productName,
        price,
        option.option_name || '',
        option.additional_price || 0,
        option.stock
    );
}

/**
 * 전체 시트에서 최근 재고 값을 한 번에 읽어 map으로 반환
 * key: "storeId__productId__optionName", value: 숫자 재고
 * @param {string} currentTimestamp - 현재 타임스탬프 (15분 이내 열 판별용)
 */
async function readAllStockFromSheet(currentTimestamp = null) {
    try {
        const data = await readSheetData();
        if (data.length < 2) return {};

        const headerRow = data[0] || [];
        const result = {};

        // L열 이후 타임스탬프 목록 수집 (내림차순 정렬)
        const timestampCols = [];
        for (let col = COL_STOCK_START; col < headerRow.length; col++) {
            if (headerRow[col]) timestampCols.push({ col, ts: headerRow[col] });
        }
        timestampCols.sort((a, b) => parseKoreaTime(b.ts) - parseKoreaTime(a.ts));

        if (timestampCols.length === 0) return {};

        // 현재 타임스탬프 기준 이전 열 결정
        let prevCol = null;
        if (currentTimestamp && timestampCols.length > 0) {
            const latest = timestampCols[0];
            const diff = getTimeDifferenceInMinutes(latest.ts, currentTimestamp);
            // 15분 이내면 그 열이 덮어씌워질 예정이므로 두 번째 열이 이전 기준
            if (diff <= 15 && timestampCols.length > 1) {
                prevCol = timestampCols[1].col;
            } else {
                prevCol = timestampCols[0].col;
            }
        } else if (timestampCols.length > 0) {
            prevCol = timestampCols[0].col;
        }

        if (prevCol === null) return {};

        for (let row = 1; row < data.length; row++) {
            const r = data[row];
            if (!r) continue;
            const storeId = r[COL_STORE_ID] || '';
            const productId = r[COL_PRODUCT_ID] || '';
            const optionName = r[COL_OPTION_NAME] || '';
            const stockStr = r[prevCol] || '';
            const match = stockStr.toString().match(/^(\d+)/);
            if (match) {
                const key = `${storeId}__${productId}__${optionName}`;
                result[key] = parseInt(match[1], 10);
            }
        }

        return result;
    } catch (e) {
        console.error(`전체 재고 읽기 중 오류: ${e.message}`);
        return {};
    }
}

/**
 * 여러 옵션을 시트에 한 번에 배치 기록
 * @param {Array} items - [{storeId, storeName, productId, productName, optionName, additionalPrice, price, stockValue, timestamp}]
 */
async function batchUpsertToSheet(items) {
    if (!items || items.length === 0) return;

    try {
        const sheetsClient = await initSheets();
        await ensureHeaders();

        const data = await readSheetData();
        const headerRow = data[0] || [];
        const timestamp = items[0].timestamp;

        // 타겟 열 결정 (1번만)
        let targetCol = null;
        let lastTimestamp = null;
        for (let i = COL_STOCK_START; i < headerRow.length; i++) {
            if (headerRow[i]) { targetCol = i; lastTimestamp = headerRow[i]; }
        }

        let reuseColumn = false;
        if (lastTimestamp) {
            const diff = getTimeDifferenceInMinutes(lastTimestamp, timestamp);
            if (diff <= 15) { reuseColumn = true; }
        }

        if (!reuseColumn) {
            // 새 열: 빈 열 찾기
            let nextCol = COL_STOCK_START;
            while (nextCol < headerRow.length && headerRow[nextCol]) nextCol++;
            targetCol = nextCol;
            // 열 확장 여부 확인
            await ensureSheetColumns(sheetsClient, targetCol + 1);
        }

        const colLetter = numberToColumnLetter(targetCol);
        const valueUpdates = [];
        const formatRequests = [];
        const sheetId = await getSheetId(sheetsClient);
        const newRows = [];

        // 헤더에 타임스탬프 기록 (새 열인 경우)
        if (!reuseColumn) {
            valueUpdates.push({
                range: `${SHEET_NAME}!${colLetter}1`,
                values: [[timestamp]]
            });
        }

        for (const item of items) {
            const { storeId, storeName, productId, productName, optionName, additionalPrice, price, stockValue } = item;
            let rowIndex = findRowIndex(data, storeId, productId, optionName);

            if (rowIndex === -1) {
                // 새 행 준비
                const newRow = new Array(targetCol + 1).fill('');
                newRow[COL_INDEX] = ''; // A열 비움
                newRow[COL_STORE_ID] = String(storeId);
                newRow[COL_PRODUCT_ID] = String(productId);
                newRow[COL_STORE_NAME] = String(storeName || '');
                newRow[COL_PRODUCT_NAME] = String(productName || '');
                newRow[COL_PRICE] = price !== null ? String(price) : '';
                newRow[COL_OPTION_NAME] = String(optionName || '');
                newRow[COL_ADDITIONAL_PRICE] = additionalPrice !== null ? String(additionalPrice) : '';
                newRow[targetCol] = String(stockValue);
                newRows.push(newRow);

                const appendedRow = data.length + newRows.length - 1;
                const color = getColorFromStockValue(stockValue);
                if (color) {
                    formatRequests.push({ repeatCell: { range: { sheetId, startRowIndex: appendedRow, endRowIndex: appendedRow + 1, startColumnIndex: targetCol, endColumnIndex: targetCol + 1 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: color } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } });
                }
            } else {
                // 기존 행 업데이트
                valueUpdates.push({ range: `${SHEET_NAME}!${colLetter}${rowIndex + 1}`, values: [[String(stockValue)]] });
                if (storeName) valueUpdates.push({ range: `${SHEET_NAME}!${numberToColumnLetter(COL_STORE_NAME)}${rowIndex + 1}`, values: [[String(storeName)]] });
                if (productName) valueUpdates.push({ range: `${SHEET_NAME}!${numberToColumnLetter(COL_PRODUCT_NAME)}${rowIndex + 1}`, values: [[String(productName)]] });
                if (price !== null) valueUpdates.push({ range: `${SHEET_NAME}!${numberToColumnLetter(COL_PRICE)}${rowIndex + 1}`, values: [[String(price)]] });

                const color = getColorFromStockValue(stockValue);
                if (color) {
                    formatRequests.push({ repeatCell: { range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: targetCol, endColumnIndex: targetCol + 1 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: color } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } });
                }
            }
        }

        // 새 행 일괄 append
        if (newRows.length > 0) {
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.values.append({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${SHEET_NAME}!A:ZZ`,
                    valueInputOption: 'RAW',
                    insertDataOption: 'INSERT_ROWS',
                    resource: { values: newRows }
                });
            }, '새 행 배치 추가');
        }

        // 기존 행 값 일괄 업데이트
        if (valueUpdates.length > 0) {
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: { valueInputOption: 'RAW', data: valueUpdates }
                });
            }, '값 배치 업데이트');
        }

        // 색상 서식 일괄 적용
        if (formatRequests.length > 0) {
            await retryWithBackoff(async () => {
                return await sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: { requests: formatRequests }
                });
            }, '색상 배치 적용');
        }

        console.log(`[배치 완료] ${colLetter}열에 ${items.length}개 기록 (${reuseColumn ? '열 재사용' : '새 열'})`);
    } catch (e) {
        console.error(`배치 시트 기록 중 오류: ${e.message}`);
        throw e;
    }
}

const ORPHAN_LOG_SHEET = 'orphan_log';
const ORPHAN_LOG_HEADERS = ['발견일시', 'storeId', 'storeName', 'productId', 'productName', 'optionName', '메모'];

/**
 * orphan_log 시트가 없으면 생성하고 헤더 기록
 */
async function ensureOrphanLogSheet(sheetsClient) {
    const response = await retryWithBackoff(async () => {
        return await sheetsClient.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    }, 'orphan_log 시트 확인');

    const exists = response.data.sheets.some(s => s.properties.title === ORPHAN_LOG_SHEET);
    if (exists) return;

    // 시트 생성
    await retryWithBackoff(async () => {
        return await sheetsClient.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: [{ addSheet: { properties: { title: ORPHAN_LOG_SHEET } } }] }
        });
    }, 'orphan_log 시트 생성');

    // 헤더 + 안내 메모 기록
    await retryWithBackoff(async () => {
        return await sheetsClient.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'RAW',
                data: [
                    { range: `${ORPHAN_LOG_SHEET}!A1:G1`, values: [ORPHAN_LOG_HEADERS] },
                    { range: `${ORPHAN_LOG_SHEET}!I1`, values: [['⚠️ daily_stock_ 시트 정리 필요: 아래 기록된 옵션 행은 더 이상 존재하지 않는 고아행입니다. daily_stock_ 시트에서 해당 행을 삭제해주세요.']] }
                ]
            }
        });
    }, 'orphan_log 헤더 기록');

    console.log('[고아행] orphan_log 시트 생성 완료');
}

/**
 * 이번 실행에서 업데이트 안 된 행을 orphan_log 시트에 로그 기록
 * @param {Set<string>} storeIds - 이번 실행에서 처리한 storeId 집합
 * @param {Set<string>} updatedKeys - 업데이트된 "storeId__productId__optionName" 집합
 * @param {string} timestamp - 현재 타임스탬프
 */
async function markDeletedOptions(storeIds, updatedKeys, timestamp) {
    if (!storeIds || storeIds.size === 0) return;

    try {
        const sheetsClient = await initSheets();
        const data = await readSheetData();
        if (data.length < 2) return;

        const orphanRows = [];

        for (let row = 1; row < data.length; row++) {
            const r = data[row];
            if (!r) continue;
            const storeId = r[COL_STORE_ID] || '';
            if (!storeIds.has(storeId)) continue;

            const productId = r[COL_PRODUCT_ID] || '';
            const optionName = r[COL_OPTION_NAME] || '';
            const key = `${storeId}__${productId}__${optionName}`;

            if (!updatedKeys.has(key)) {
                const storeName = r[COL_STORE_NAME] || '';
                const productName = r[COL_PRODUCT_NAME] || '';
                orphanRows.push([
                    timestamp,
                    storeId,
                    storeName,
                    productId,
                    productName,
                    optionName,
                    `daily_stock_ ${row + 1}행 정리 필요`
                ]);
            }
        }

        if (orphanRows.length === 0) {
            console.log('[고아행] 해당 없음');
            return;
        }

        await ensureOrphanLogSheet(sheetsClient);

        await retryWithBackoff(async () => {
            return await sheetsClient.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ORPHAN_LOG_SHEET}!A:G`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: orphanRows }
            });
        }, 'orphan_log 기록');

        console.log(`[고아행] ${orphanRows.length}개 행을 orphan_log에 기록 완료`);
    } catch (e) {
        console.error(`고아행 로그 기록 중 오류: ${e.message}`);
    }
}

module.exports = {
    upsertToSheet,
    syncOptionToSheet,
    upsertStoreToSheet,
    upsertProductToSheet,
    readStockFromSheet,
    readAllStockFromSheet,
    batchUpsertToSheet,
    markDeletedOptions,
    initSheets
};
