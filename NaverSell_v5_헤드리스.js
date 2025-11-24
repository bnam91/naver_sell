const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { processOrderModification } = require('./orderModification');
const { upsertStore, upsertProduct, setSessionTimestamp, clearSessionTimestamp } = require('./dbModule');

// readline 인터페이스 생성
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 사용자 입력을 Promise로 변환하는 헬퍼 함수
function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

// 타임아웃이 있는 입력 함수 (밀리초 단위)
function questionWithTimeout(prompt, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve(null); // 타임아웃 시 null 반환
        }, timeoutMs);
        
        rl.question(prompt, (answer) => {
            clearTimeout(timer);
            resolve(answer);
        });
    });
}

// 0_naver_login.txt 파일에서 프로필 이름 읽기
async function readDefaultProfile() {
    try {
        const currentFile = __filename;
        const currentDir = path.dirname(currentFile);
        const loginFilePath = path.join(currentDir, "0_naver_login.txt");
        
        const content = await fs.readFile(loginFilePath, 'utf-8');
        return content.trim();
    } catch (e) {
        return null; // 파일이 없거나 읽을 수 없으면 null 반환
    }
}

async function clearChromeData(userDataDir, keepLogin = true) {
    const defaultDir = path.join(userDataDir, 'Default');
    
    try {
        await fs.access(defaultDir);
    } catch {
        console.log("Default 디렉토리가 존재하지 않습니다.");
        return;
    }

    // Lock 파일 삭제 (Chrome이 실행 중이 아닐 때 프로필을 사용할 수 있도록)
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const lockFile of lockFiles) {
        const lockPath = path.join(userDataDir, lockFile);
        try {
            await fs.access(lockPath);
            await fs.unlink(lockPath);
            console.log(`${lockFile} 파일을 삭제했습니다.`);
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.log(`${lockFile} 파일 삭제 중 오류: ${e.message}`);
            }
        }
    }

    // 로그인 정보를 유지하기 위해 최소한의 파일만 삭제
    const dirsToClear = ['Cache', 'Code Cache', 'GPUCache'];
    // History와 Visited Links는 삭제하지 않음 (로그인 세션 유지에 필요할 수 있음)
    const filesToClear = [];
    
    for (const dirName of dirsToClear) {
        const dirPath = path.join(defaultDir, dirName);
        try {
            const stats = await fs.stat(dirPath);
            if (stats.isDirectory()) {
                await fs.rm(dirPath, { recursive: true, force: true });
                console.log(`${dirName} 디렉토리를 삭제했습니다.`);
            }
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.log(`${dirName} 디렉토리 삭제 중 오류: ${e.message}`);
            }
        }
    }

    // keep_login이 False일 때만 로그인 관련 파일 삭제
    if (!keepLogin) {
        filesToClear.push('Cookies', 'Login Data', 'History', 'Visited Links', 'Web Data');
    }

    for (const fileName of filesToClear) {
        const filePath = path.join(defaultDir, fileName);
        try {
            await fs.unlink(filePath);
            console.log(`${fileName} 파일을 삭제했습니다.`);
        } catch (e) {
            if (e.code !== 'ENOENT') {
                console.log(`${fileName} 파일 삭제 중 오류: ${e.message}`);
            }
        }
    }
}

async function getAvailableProfiles(userDataParent) {
    /** 사용 가능한 프로필 목록을 가져옴 */
    const profiles = [];
    
    try {
        await fs.access(userDataParent);
    } catch {
        await fs.mkdir(userDataParent, { recursive: true });
        return profiles;
    }
    
    try {
        const items = await fs.readdir(userDataParent);
        for (const item of items) {
            const itemPath = path.join(userDataParent, item);
            try {
                const stats = await fs.stat(itemPath);
                if (stats.isDirectory()) {
                    const defaultPath = path.join(itemPath, 'Default');
                    let hasDefault = false;
                    try {
                        await fs.access(defaultPath);
                        hasDefault = true;
                    } catch {}
                    
                    let hasProfile = false;
                    if (!hasDefault) {
                        const subItems = await fs.readdir(itemPath);
                        for (const subItem of subItems) {
                            const subItemPath = path.join(itemPath, subItem);
                            try {
                                const subStats = await fs.stat(subItemPath);
                                if (subStats.isDirectory() && subItem.startsWith('Profile')) {
                                    hasProfile = true;
                                    break;
                                }
                            } catch {}
                        }
                    }
                    
                    if (hasDefault || hasProfile) {
                        profiles.push(item);
                    }
                }
            } catch {}
        }
    } catch (e) {
        console.log(`프로필 목록 읽기 중 오류: ${e.message}`);
    }
    
    return profiles;
}

async function selectProfile(userDataParent) {
    /** 사용자에게 프로필을 선택하도록 함 */
    const profiles = await getAvailableProfiles(userDataParent);
    
    if (profiles.length === 0) {
        console.log("\n사용 가능한 프로필이 없습니다.");
        const createNew = (await question("새 프로필을 생성하시겠습니까? (y/n): ")).toLowerCase();
        if (createNew === 'y') {
            while (true) {
                const name = await question("새 프로필 이름을 입력하세요: ");
                if (!name) {
                    console.log("프로필 이름을 입력해주세요.");
                    continue;
                }
                
                if (/[\\/:*?"<>|]/.test(name)) {
                    console.log("프로필 이름에 다음 문자를 사용할 수 없습니다: \\ / : * ? \" < > |");
                    continue;
                }
                
                const newProfilePath = path.join(userDataParent, name);
                try {
                    await fs.access(newProfilePath);
                    console.log(`'${name}' 프로필이 이미 존재합니다.`);
                    continue;
                } catch {}
                
                try {
                    await fs.mkdir(newProfilePath, { recursive: true });
                    await fs.mkdir(path.join(newProfilePath, 'Default'), { recursive: true });
                    console.log(`'${name}' 프로필이 생성되었습니다.`);
                    return name;
                } catch (e) {
                    console.log(`프로필 생성 중 오류가 발생했습니다: ${e.message}`);
                    const retry = (await question("다시 시도하시겠습니까? (y/n): ")).toLowerCase();
                    if (retry !== 'y') {
                        return null;
                    }
                }
            }
        }
        return null;
    }
    
    console.log("\n사용 가능한 프로필 목록:");
    profiles.forEach((profile, idx) => {
        console.log(`${idx + 1}. ${profile}`);
    });
    console.log(`${profiles.length + 1}. 새 프로필 생성`);
    
    while (true) {
        try {
            const choiceStr = await questionWithTimeout("\n사용할 프로필 번호를 선택하세요 (5초 이내 입력하지 않으면 자동 선택): ", 5000);
            
            // 타임아웃된 경우 (5초 이내 입력하지 않음)
            if (choiceStr === null || choiceStr.trim() === '') {
                const defaultProfileName = await readDefaultProfile();
                if (defaultProfileName) {
                    const profileIndex = profiles.indexOf(defaultProfileName);
                    if (profileIndex !== -1) {
                        const selectedProfile = profiles[profileIndex];
                        console.log(`\n5초 이내 입력이 없어 '0_naver_login.txt'에 저장된 프로필을 자동 선택했습니다.`);
                        console.log(`선택된 프로필: ${selectedProfile}`);
                        return selectedProfile;
                    } else {
                        console.log(`\n'0_naver_login.txt'에 저장된 프로필 '${defaultProfileName}'이 목록에 없습니다.`);
                        console.log("수동으로 프로필을 선택해주세요.");
                        // continue로 루프를 다시 시작하여 수동 입력 받기
                        continue;
                    }
                } else {
                    console.log("\n5초 이내 입력이 없었지만 '0_naver_login.txt' 파일이 없거나 읽을 수 없습니다.");
                    console.log("수동으로 프로필을 선택해주세요.");
                    // continue로 루프를 다시 시작하여 수동 입력 받기
                    continue;
                }
            }
            
            const choice = parseInt(choiceStr);
            
            if (1 <= choice && choice <= profiles.length) {
                const selectedProfile = profiles[choice - 1];
                console.log(`\n선택된 프로필: ${selectedProfile}`);
                return selectedProfile;
            } else if (choice === profiles.length + 1) {
                // 새 프로필 생성
                while (true) {
                    const name = await question("새 프로필 이름을 입력하세요: ");
                    if (!name) {
                        console.log("프로필 이름을 입력해주세요.");
                        continue;
                    }
                    
                    if (/[\\/:*?"<>|]/.test(name)) {
                        console.log("프로필 이름에 다음 문자를 사용할 수 없습니다: \\ / : * ? \" < > |");
                        continue;
                    }
                    
                    const newProfilePath = path.join(userDataParent, name);
                    try {
                        await fs.access(newProfilePath);
                        console.log(`'${name}' 프로필이 이미 존재합니다.`);
                        continue;
                    } catch {}
                    
                    try {
                        await fs.mkdir(newProfilePath, { recursive: true });
                        await fs.mkdir(path.join(newProfilePath, 'Default'), { recursive: true });
                        console.log(`'${name}' 프로필이 생성되었습니다.`);
                        return name;
                    } catch (e) {
                        console.log(`프로필 생성 중 오류가 발생했습니다: ${e.message}`);
                        const retry = (await question("다시 시도하시겠습니까? (y/n): ")).toLowerCase();
                        if (retry !== 'y') {
                            break;
                        }
                    }
                }
            } else {
                console.log("유효하지 않은 번호입니다. 다시 선택해주세요.");
            }
        } catch (e) {
            console.log("숫자를 입력해주세요.");
        }
    }
}

function normalizeWhitespace(text) {
    if (!text) {
        return '';
    }
    return text.replace(/\s+/g, ' ').trim();
}

async function logNewEntries(stores, seenStores) {
    let hasNewEntry = false;
    const newStores = []; // 새로 발견된 스토어 목록
    
    for (const store of stores) {
        const key = store.storeId || store.storeName;
        if (!key) {
            continue;
        }
        let entry = seenStores.get(key);
        const isNewStore = !entry;
        
        if (!entry) {
            entry = {
                id: store.storeId,
                name: store.storeName,
                products: new Map(),
                processed: false // 주문수정 프로세스 처리 여부
            };
            seenStores.set(key, entry);
            newStores.push({ store, entry, key });
        } else {
            if (!entry.id && store.storeId) {
                entry.id = store.storeId;
            }
            if (!entry.name && store.storeName) {
                entry.name = store.storeName;
            }
        }
        let printedHeader = false;
        for (const product of store.products) {
            const productKey = `${product.id || product.name || ''}:::${product.price || ''}`;
            if (!product.name || entry.products.has(productKey)) {
                continue;
            }
            if (!printedHeader) {
                const storeLabel = entry.name || store.storeName || '이름없음';
                const storeIdLabel = entry.id ? ` (ID: ${entry.id})` : '';
                console.log(`\n[스토어] ${storeLabel}${storeIdLabel}`);
                printedHeader = true;
                
                // DB에 스토어 정보 저장
                try {
                    await upsertStore(entry.id || key, entry.name || store.storeName);
                } catch (e) {
                    console.error(`스토어 저장 중 오류: ${e.message}`);
                }
            }
            const idLabel = product.id ? ` (ID: ${product.id})` : '';
            const priceLabel = product.price ? ` / 판매가 ${product.price}` : '';
            console.log(`  └─ 상품: ${product.name}${idLabel}${priceLabel}`);
            entry.products.set(productKey, {
                name: product.name,
                id: product.id,
                price: product.price
            });
            
            // DB에 상품 정보 저장
            try {
                await upsertProduct(entry.id || key, product.id || '', product.name, product.price || null);
            } catch (e) {
                console.error(`상품 저장 중 오류: ${e.message}`);
            }
            
            hasNewEntry = true;
        }
    }
    
    return { hasNewEntry, newStores };
}

// 컨테이너 내에서 주문수정 버튼 찾기 헬퍼 함수
async function findModifyButtonsInContainer(container) {
    let foundButtons = [];
    
    // 방법 1: 클래스명으로 찾기
    try {
        const buttons = await container.findElements(By.css('button.btn_modify--3dB-BgyPu5'));
        if (buttons.length > 0) {
            foundButtons = buttons;
        }
    } catch (e) {
        // 다음 방법 시도
    }
    
    // 방법 2: data 속성으로 찾기
    if (foundButtons.length === 0) {
        try {
            const buttons = await container.findElements(By.css('button[data-shp-area-id="pdedit"]'));
            if (buttons.length > 0) {
                foundButtons = buttons;
            }
        } catch (e) {
            // 다음 방법 시도
        }
    }
    
    // 방법 3: 텍스트로 찾기
    if (foundButtons.length === 0) {
        try {
            const buttons = await container.findElements(By.xpath(".//button[contains(text(), '주문수정')]"));
            if (buttons.length > 0) {
                foundButtons = buttons;
            }
        } catch (e) {
            // 버튼을 찾지 못함
        }
    }
    
    return foundButtons;
}

function printCartSummary(seenStores) {
    if (seenStores.size === 0) {
        console.log("\n표시할 스토어를 찾지 못했습니다. 장바구니에 담긴 상품이 있는지 혹은 로그인 상태인지 확인해주세요.");
        return { storeCount: 0, productCount: 0, seenStores: seenStores };
    }
    let totalProducts = 0;
    for (const entry of seenStores.values()) {
        totalProducts += entry.products.size;
    }
    console.log(`\n총 ${seenStores.size}개 스토어, ${totalProducts}개 상품을 수집했습니다.`);
    return {
        storeCount: seenStores.size,
        productCount: totalProducts,
        seenStores: seenStores
    };
}

async function getInitialCartCount(driver) {
    try {
        return await driver.executeScript(() => {
            const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
            const parseNumber = (text) => {
                if (!text) {
                    return null;
                }
                const onlyDigits = text.replace(/[^\d]/g, '');
                return onlyDigits ? parseInt(onlyDigits, 10) : null;
            };
            
            const activeTabNumber = document.querySelector('.tab_menu--39NnuUqXAb button[aria-selected="true"] span[class*="num"]');
            const tabLabelCount = parseNumber(activeTabNumber?.textContent || activeTabNumber?.innerText || '');
            
            const productCards = Array.from(document.querySelectorAll('div[class*="store_container"] div[class*="product_description"]'));
            const visibleProducts = new Set();
            productCards.forEach((card) => {
                const titleNode = card.querySelector('div[class*="title"], span[class*="title"]');
                const title = normalize((titleNode?.textContent || titleNode?.innerText || '').replace(/네이버플러스멤버십/gi, ''));
                if (title) {
                    visibleProducts.add(title);
                }
            });
            
            return {
                tabLabelCount,
                visibleProductCount: visibleProducts.size
            };
        });
    } catch (e) {
        console.log(`초기 상품 수를 확인하지 못했습니다: ${e.message}`);
        return {
            tabLabelCount: null,
            visibleProductCount: 0
        };
    }
}

async function scrapeCartItems(driver, options = {}) {
    const {
        waitSelector = 'div[class*="store_container"]',
        waitTimeoutMs = 15000,
        scrollPauseMs = 1500,
        maxIdleScrolls = 4,
        maxLoops = 80,
        scrollStepPx = 600
    } = options;
    
    // 전체 실행 시작 시점의 타임스탬프 설정 (모든 스토어/상품이 같은 타임스탬프 사용)
    setSessionTimestamp();
    console.log("전체 실행 시작 타임스탬프가 설정되었습니다.");
    
    try {
        await driver.wait(until.elementLocated(By.css(waitSelector)), waitTimeoutMs);
        console.log("장바구니 첫 화면이 로드되었습니다. 무한 스크롤을 진행하면서 스토어/상품명을 수집합니다.");
    } catch (e) {
        console.log(`장바구니 요소를 찾지 못했습니다: ${e.message}`);
        clearSessionTimestamp();
        return null;
    }
    
    const seenStores = new Map();
    let idleScrolls = 0;
    let loops = 0;
    let lastHeight = 0;
    
    while (loops < maxLoops && idleScrolls < maxIdleScrolls) {
        const { stores, scrollHeight, scrollTop, viewportHeight } = await driver.executeScript(() => {
            const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
            const cleanProductName = (text) => normalize(text).replace(/네이버플러스멤버십/gi, '').trim();
            const formatPrice = (raw) => {
                const normalized = normalize(raw);
                if (!normalized) {
                    return '';
                }
                const match = normalized.match(/\d[\d,]*/);
                return match ? `${match[0]}원` : normalized;
            };
            const containers = Array.from(document.querySelectorAll('div[class*="store_container"]'));
            const storePayload = [];
            
            containers.forEach((container) => {
                const anchor = container.querySelector('h2 a');
                const storeName = normalize(anchor?.textContent || anchor?.innerText || '');
                const storeId = anchor?.getAttribute('data-shp-contents-provider-id')
                    || anchor?.getAttribute('data-shp-page-key')
                    || storeName;
                
                if (!storeName) {
                    return;
                }
                
                const productDescriptions = container.querySelectorAll('div[class*="product_description"]');
                const productMap = new Map();
                
                productDescriptions.forEach((desc) => {
                    const titleNode = desc.querySelector('div[class*="title"], span[class*="title"]');
                    const title = cleanProductName(titleNode?.textContent || titleNode?.innerText || '');
                    if (!title) {
                        return;
                    }
                    
                    const infoRoot = desc.closest('div[class*="product_info"]') || desc.parentElement;
                    let priceText = '';
                    if (infoRoot) {
                        const priceBlock = infoRoot.querySelector('div[class*="price"]');
                        if (priceBlock) {
                            const numSpans = priceBlock.querySelectorAll('span[class*="num"]');
                            if (numSpans.length > 0) {
                                priceText = formatPrice(numSpans[numSpans.length - 1].textContent || '');
                            } else {
                                priceText = formatPrice(priceBlock.textContent || '');
                            }
                        }
                    }
                    
                    const productAnchor = desc.querySelector('a[data-shp-contents-id]')
                        || desc.closest('div[class*="product--"]')?.querySelector('a[data-shp-contents-id]');
                    const productId = productAnchor?.getAttribute('data-shp-contents-id') || '';
                    
                    const key = `${productId || title}:::${priceText}`;
                    if (!productMap.has(key)) {
                        productMap.set(key, {
                            name: title,
                            id: productId,
                            price: priceText
                        });
                    }
                });
                
                if (productMap.size > 0) {
                    storePayload.push({
                        storeId,
                        storeName,
                        products: Array.from(productMap.values())
                    });
                }
            });
            
            return {
                stores: storePayload,
                scrollHeight: document.body.scrollHeight,
                scrollTop: document.scrollingElement?.scrollTop ?? window.pageYOffset ?? 0,
                viewportHeight: window.innerHeight
            };
        });
        
        const { hasNewEntry, newStores } = await logNewEntries(stores, seenStores);
        
        // 새로 발견된 스토어에 대해 주문수정 프로세스 진행
        for (const { store, entry, key } of newStores) {
            if (entry.processed) continue; // 이미 처리된 스토어는 건너뛰기
            
            try {
                console.log(`\n[${entry.name}] 스토어의 주문수정 프로세스를 시작합니다...`);
                
                // 해당 스토어의 컨테이너 인덱스 찾기
                const containerIndex = await driver.executeScript(function (targetStoreId, targetStoreName) {
                    function normalize(text) {
                        return (text || '').replace(/\s+/g, ' ').trim();
                    }
                    
                    const containers = Array.from(document.querySelectorAll('div[class*="store_container"]'));
                    
                    for (let i = 0; i < containers.length; i++) {
                        const container = containers[i];
                        const anchor = container.querySelector('h2 a');
                        const containerStoreName = normalize(anchor?.textContent || anchor?.innerText || '');
                        const containerStoreId = anchor?.getAttribute('data-shp-contents-provider-id')
                            || anchor?.getAttribute('data-shp-page-key')
                            || containerStoreName;
                        
                        if ((containerStoreId && targetStoreId && containerStoreId.toString() === targetStoreId.toString()) ||
                            (containerStoreName && targetStoreName && containerStoreName === targetStoreName)) {
                            return i;
                        }
                    }
                    
                    return -1;
                }, entry.id || key, entry.name || key);
                
                if (containerIndex >= 0) {
                    // 컨테이너를 찾았으므로 해당 컨테이너 내에서 버튼 찾기
                    const allContainers = await driver.findElements(By.css('div[class*="store_container"]'));
                    if (containerIndex < allContainers.length) {
                        const container = allContainers[containerIndex];
                        
                        // 컨테이너가 보이도록 스크롤
                        await driver.executeScript('arguments[0].scrollIntoView({ behavior: "smooth", block: "center" });', container);
                        await driver.sleep(500);
                        
                        const foundButtons = await findModifyButtonsInContainer(container);
                        
                        if (foundButtons.length > 0) {
                            entry.buttons = foundButtons;
                            entry.processed = true;
                            console.log(`  -> ${foundButtons.length}개의 주문수정 버튼을 찾았습니다.`);
                            
                            // 각 버튼에 대해 주문수정 프로세스 진행
                            // entry.products를 배열로 변환하여 인덱스로 접근 가능하도록 함
                            const productsArray = Array.from(entry.products.values());
                            
                            for (let btnIndex = 0; btnIndex < foundButtons.length; btnIndex++) {
                                const modifyButton = foundButtons[btnIndex];
                                
                                console.log(`\n===== ${entry.name} 스토어의 ${btnIndex + 1}번째 상품 주문수정 시작 =====`);
                                
                                // 현재 처리 중인 상품 ID 찾기
                                let currentProductId = '';
                                
                                // 방법 1: entry.products에서 상품 ID 가져오기
                                if (btnIndex < productsArray.length && productsArray[btnIndex].id) {
                                    currentProductId = productsArray[btnIndex].id;
                                }
                                
                                // 방법 2: 버튼 근처에서 상품 ID 찾기 시도 (방법 1이 실패한 경우)
                                if (!currentProductId) {
                                    try {
                                        const productInfo = await driver.executeScript(function(btn) {
                                            const container = btn.closest('div[class*="product"]');
                                            if (container) {
                                                const anchor = container.querySelector('a[data-shp-contents-id]');
                                                return anchor ? anchor.getAttribute('data-shp-contents-id') : '';
                                            }
                                            return '';
                                        }, modifyButton);
                                        currentProductId = productInfo || '';
                                    } catch (e) {
                                        // 상품 ID를 찾지 못해도 계속 진행
                                    }
                                }
                                
                                try {
                                    // 버튼 위치를 화면 중앙으로 스크롤
                                    await driver.executeScript(function (el) {
                                        if (!el) return;
                                        const desiredViewportPosition = window.innerHeight * 0.2;
                                        const rect = el.getBoundingClientRect();
                                        const currentScroll = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
                                        let targetScroll = currentScroll + rect.top - desiredViewportPosition;
                                        if (targetScroll < 0) targetScroll = 0;
                                        window.scrollTo({ top: targetScroll, behavior: 'smooth' });
                                    }, modifyButton);
                                    await driver.sleep(800);
                                    
                                    // 버튼 클릭
                                    await driver.wait(until.elementIsVisible(modifyButton), 10000);
                                    await modifyButton.click();
                                    console.log(`${btnIndex + 1}번째 상품의 '주문수정' 버튼을 클릭했습니다.`);
                                    
                                    // 현재 처리 중인 상품 정보 찾기
                                    let currentProductName = '';
                                    let currentPrice = null;
                                    if (btnIndex < productsArray.length) {
                                        currentProductName = productsArray[btnIndex].name || '';
                                        const priceStr = productsArray[btnIndex].price || '';
                                        if (priceStr) {
                                            // "4,500원" 형식에서 숫자만 추출
                                            const priceMatch = priceStr.match(/[\d,]+/);
                                            if (priceMatch) {
                                                currentPrice = parseInt(priceMatch[0].replace(/,/g, ''), 10);
                                            }
                                        }
                                    }
                                    
                                    // orderModification 모듈을 사용하여 주문수정 프로세스 진행
                                    console.log("\n주문수정 프로세스를 시작합니다...");
                                    const success = await processOrderModification(
                                        driver, 
                                        entry.id || key, 
                                        currentProductId,
                                        entry.name || '',
                                        currentProductName,
                                        currentPrice
                                    );
                                    if (success) {
                                        console.log(`${btnIndex + 1}번째 상품의 주문수정 프로세스가 완료되었습니다.`);
                                    } else {
                                        console.log(`${btnIndex + 1}번째 상품의 주문수정 프로세스 중 오류가 발생했습니다.`);
                                    }
                                } catch (e) {
                                    console.log(`${btnIndex + 1}번째 상품의 주문수정 버튼 클릭 중 오류 발생: ${e.message}`);
                                }
                                
                                console.log(`===== ${entry.name} 스토어의 ${btnIndex + 1}번째 상품 주문수정 완료 =====\n`);
                            }
                            
                            console.log(`\n[${entry.name}] 스토어의 모든 상품 처리 완료\n`);
                        } else {
                            console.log(`  -> 주문수정 버튼을 찾지 못했습니다.`);
                        }
                    }
                } else {
                    console.log(`  -> 스토어 컨테이너를 찾지 못했습니다.`);
                }
            } catch (e) {
                console.log(`[${entry.name}] 스토어 처리 중 오류: ${e.message}`);
            }
        }
        
        loops += 1;
        
        const currentHeight = typeof scrollHeight === 'number' ? scrollHeight : 0;
        const reachedBottom = (scrollTop + (viewportHeight || 0)) >= currentHeight - 5;
        
        if (hasNewEntry || currentHeight > lastHeight) {
            idleScrolls = 0;
        } else if (reachedBottom) {
            idleScrolls += 1;
        }
        lastHeight = Math.max(lastHeight, currentHeight);
        
        await driver.executeScript('window.scrollBy(0, arguments[0]);', scrollStepPx);
        await driver.sleep(scrollPauseMs);
    }
    
    if (idleScrolls >= maxIdleScrolls) {
        console.log("\n더 이상 새로운 스토어나 상품이 감지되지 않아 스크롤을 중단했습니다.");
    }
    
    // 모든 처리가 완료되면 세션 타임스탬프 초기화
    clearSessionTimestamp();
    console.log("전체 실행이 완료되어 세션 타임스탬프를 초기화했습니다.");
    
    return printCartSummary(seenStores);
}

async function main() {
    try {
        // CLI 인자 파싱
        const args = process.argv;
        
        // 프로필
        const profileArg = args.find(a => a.startsWith("--profile="));
        const cliProfile = profileArg ? profileArg.replace("--profile=", "") : null;
        
        // 헤드리스 모드 강제 옵션
        const isHeadlessCli = args.includes("--headless");
        
        // 헤드리스 모드 선택
        let isHeadless = false;
        
        if (isHeadlessCli) {
            console.log("CLI 옵션(--headless) 감지: 헤드리스 모드 자동 실행합니다.");
            isHeadless = true;
        } else {
            const headlessAnswer = await question("헤드리스 모드로 진행하시겠습니까? (Y/n): ");
            isHeadless = headlessAnswer.trim().toLowerCase() === "y";
            
            if (isHeadless) {
                console.log("헤드리스 모드로 실행합니다.");
            } else {
                console.log("일반 모드로 실행합니다.");
            }
        }
        
        // 사용자 프로필 경로 설정 - 상위 디렉토리(프로젝트 루트)에 user_data 폴더 생성
        const currentFile = __filename;
        const currentDir = path.dirname(currentFile);
        const parentDir = path.dirname(currentDir);
        const userDataParent = path.join(parentDir, "user_data");
        
        // 프로필 선택
        let selectedProfile = null;
        
        if (cliProfile) {
            console.log(`CLI 옵션(--profile) 감지: '${cliProfile}' 프로필 자동 선택합니다.`);
            const profiles = await getAvailableProfiles(userDataParent);
            if (profiles.includes(cliProfile)) {
                selectedProfile = cliProfile;
            } else {
                console.log(`프로필 '${cliProfile}'를 찾을 수 없습니다. 사용 가능한 프로필 목록에서 선택합니다.`);
                selectedProfile = await selectProfile(userDataParent);
            }
        } else {
            // 기존의 사용자 입력 + 5초 제한 로직
            selectedProfile = await selectProfile(userDataParent);
        }
        if (!selectedProfile) {
            console.log("프로필을 선택할 수 없습니다. 프로그램을 종료합니다.");
            rl.close();
            return;
        }
        
        const userDataDir = path.join(userDataParent, selectedProfile);
        
        try {
            await fs.access(userDataDir);
        } catch {
            await fs.mkdir(userDataDir, { recursive: true });
            await fs.mkdir(path.join(userDataDir, 'Default'), { recursive: true });
        }

        // Chrome 옵션 설정
        const options = new chrome.Options();
        
        // 헤드리스 모드 설정
        if (isHeadless) {
            options.addArguments('--headless=new');
            options.addArguments('--window-size=1920,1080');
        } else {
            options.addArguments('--start-maximized');
        }
        
        options.addArguments('disable-blink-features=AutomationControlled');
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--disable-gpu');
        options.addArguments(`--user-data-dir=${userDataDir}`);
        
        // experimental options
        options.excludeSwitches('enable-logging');
        // detach 옵션은 Node.js selenium-webdriver에서 직접 지원하지 않으므로
        // 드라이버를 종료하지 않는 방식으로 처리

        // 캐시와 임시 파일 정리 (로그인 정보 유지)
        await clearChromeData(userDataDir);

        // Chrome 드라이버 생성 및 네이버 열기
        try {
            const driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .build();
            
            console.log("Chrome 브라우저가 시작되었습니다.");
            
            // 네이버 메인 페이지로 이동
            console.log("네이버로 이동합니다...");
            await driver.get("https://www.naver.com/");
            
            // 새 탭 열기
            console.log("새 탭을 열어 장바구니 페이지로 이동합니다...");
            await driver.executeScript("window.open('');");
            
            // 모든 탭 핸들 가져오기
            const handles = await driver.getAllWindowHandles();
            
            // 새로 열린 탭(마지막 탭)으로 전환
            await driver.switchTo().window(handles[handles.length - 1]);
            
            // 장바구니 페이지로 이동
            await driver.get("https://shopping.naver.com/cart");

            // 초기 콘텐츠 로딩 여유 시간
            await driver.sleep(5000);
            
            const initialCounts = await getInitialCartCount(driver);
            if (initialCounts.tabLabelCount !== null) {
                console.log(`탭에 표시된 예상 상품 수: ${initialCounts.tabLabelCount}개`);
            } else {
                console.log("탭에 표시된 상품 수를 확인할 수 없습니다.");
            }
            console.log(`초기 DOM에서 감지된 상품 수: ${initialCounts.visibleProductCount}개`);

            // 장바구니의 스토어/상품 정보 추출
            const scrapeSummary = await scrapeCartItems(driver);
            
            if (scrapeSummary) {
                console.log(`\n실제 수집 결과 - 스토어: ${scrapeSummary.storeCount}개, 상품: ${scrapeSummary.productCount}개`);
                
                if (initialCounts.tabLabelCount !== null) {
                    if (initialCounts.tabLabelCount === scrapeSummary.productCount) {
                        console.log("탭 표시 상품 수와 실수집 상품 수가 일치합니다.");
                    } else {
                        console.log(`탭 표시 상품 수(${initialCounts.tabLabelCount}개)와 실수집 상품 수(${scrapeSummary.productCount}개)가 다릅니다.`);
                    }
                }
                
                if (initialCounts.visibleProductCount !== scrapeSummary.productCount) {
                    console.log(`초기 DOM 상품 수(${initialCounts.visibleProductCount}개)와 실수집 상품 수(${scrapeSummary.productCount}개)를 비교했습니다.`);
                } else {
                    console.log("초기 DOM 상품 수와 실수집 상품 수가 동일합니다.");
                }
            }
            
            // 스크롤 수집 중에 이미 모든 스토어의 주문수정 프로세스가 완료되었습니다.
            console.log("\n모든 스토어의 주문수정 프로세스가 완료되었습니다.");
            
            console.log(`\n선택된 프로필: ${selectedProfile}`);
            console.log("네이버와 장바구니 페이지가 열렸습니다. 프로그램을 종료합니다.");
            
            // detach 옵션이 있으므로 드라이버를 종료하지 않음
            // await driver.quit();
            
        } catch (e) {
            console.log(`Chrome 드라이버 생성 중 오류 발생: ${e.message}`);
            console.log("\n가능한 해결 방법:");
            console.log("1. Chrome 브라우저가 실행 중인지 확인하고 모두 종료하세요.");
            console.log("2. 프로필 디렉토리가 손상되었을 수 있습니다. 새 프로필을 생성해보세요.");
            console.log("3. ChromeDriver 버전이 Chrome 브라우저 버전과 호환되는지 확인하세요.");
            console.log("프로그램을 종료합니다.");
        }
    } catch (e) {
        console.error(`오류 발생: ${e.message}`);
    } finally {
        rl.close();
    }
}

// 프로그램 실행
if (require.main === module) {
    main().catch(console.error);
}


