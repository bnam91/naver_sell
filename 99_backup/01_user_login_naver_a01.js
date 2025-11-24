const { Builder, By, until, Key } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { processOrderModification } = require('./orderModification');

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

async function main() {
    try {
        // 사용자 프로필 경로 설정 - 상위 디렉토리(프로젝트 루트)에 user_data 폴더 생성
        const currentFile = __filename;
        const currentDir = path.dirname(currentFile);
        const parentDir = path.dirname(currentDir);
        const userDataParent = path.join(parentDir, "user_data");
        
        // 프로필 선택
        const selectedProfile = await selectProfile(userDataParent);
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
        options.addArguments('--start-maximized');
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

        // Chrome 드라이버 변수 선언 (함수 레벨)
        let driver = null;

        // Chrome 드라이버 생성 및 네이버 열기
        try {
            driver = await new Builder()
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
            
            console.log(`\n선택된 프로필: ${selectedProfile}`);
            console.log("장바구니 페이지가 열렸습니다.");
            
            // 5초 대기
            console.log("5초 대기 중...");
            await driver.sleep(5000);
            
            // '주문수정' 버튼들 찾기 및 순차 처리
            try {
                // 여러 선택자로 전체 '주문수정' 버튼 목록 수집
                let modifyButtons = [];
                
                // 방법 1: 클래스명으로 찾기
                try {
                    const buttons = await driver.findElements(By.css('button.btn_modify--3dB-BgyPu5'));
                    if (buttons.length > 0) {
                        modifyButtons = buttons;
                        console.log(`클래스명으로 '주문수정' 버튼을 ${buttons.length}개 찾았습니다.`);
                    }
                } catch (e) {
                    // 다음 방법 시도
                }
                
                // 방법 2: data 속성으로 찾기
                if (modifyButtons.length === 0) {
                    try {
                        const buttons = await driver.findElements(By.css('button[data-shp-area-id="pdedit"]'));
                        if (buttons.length > 0) {
                            modifyButtons = buttons;
                            console.log(`data 속성으로 '주문수정' 버튼을 ${buttons.length}개 찾았습니다.`);
                        }
                    } catch (e) {
                        // 다음 방법 시도
                    }
                }
                
                // 방법 3: 텍스트로 찾기
                if (modifyButtons.length === 0) {
                    try {
                        const buttons = await driver.findElements(By.xpath("//button[contains(text(), '주문수정')]"));
                        if (buttons.length > 0) {
                            modifyButtons = buttons;
                            console.log(`텍스트로 '주문수정' 버튼을 ${buttons.length}개 찾았습니다.`);
                        }
                    } catch (e) {
                        // 버튼을 찾지 못함
                    }
                }
                
                if (modifyButtons.length === 0) {
                    console.log("'주문수정' 버튼을 찾을 수 없습니다.");
                } else {
                    console.log(`총 ${modifyButtons.length}개의 '주문수정' 버튼을 찾았습니다.`);
                }

                // 스토어별로 그룹화
                const storeGroups = new Map(); // key: storeId, value: { storeName, buttons: [] }
                
                for (let i = 0; i < modifyButtons.length; i++) {
                    const modifyButton = modifyButtons[i];
                    if (!modifyButton) continue;
                    
                    try {
                        const storeInfo = await driver.executeScript(function (btn) {
                            function getDataAttr(el, name) {
                                if (!el) return null;
                                if (el.dataset && Object.prototype.hasOwnProperty.call(el.dataset, name)) {
                                    return el.dataset[name];
                                }
                                const attrName = 'data-' + name.replace(/[A-Z]/g, function (m) {
                                    return '-' + m.toLowerCase();
                                });
                                return el.getAttribute(attrName);
                            }

                            var productCard = btn.closest('div.product--BPAxWCQbvE');
                            if (!productCard) {
                                productCard = btn.closest('div[class*="product--"]');
                            }
                            if (!productCard) return null;

                            var storeCard =
                                productCard.closest('div.store_card--EAQK-9jWb0') ||
                                productCard.closest('div[class*="store_card"]');

                            var storeName = null;
                            var storeId = null;
                            if (storeCard) {
                                var storeLink =
                                    storeCard.querySelector('h2.mall--1iPWamYR2w a') ||
                                    storeCard.querySelector('h2.mall a') ||
                                    storeCard.querySelector('a[data-shp-contents-grp="store"]');

                                if (storeLink) {
                                    var firstNode = storeLink.childNodes[0];
                                    var text = firstNode && firstNode.nodeType === 3
                                        ? firstNode.textContent
                                        : storeLink.textContent;
                                    storeName = (text || '').trim();
                                    storeId =
                                        getDataAttr(storeLink, 'shpContentsProviderId') ||
                                        getDataAttr(storeLink, 'shp-contents-provider-id');
                                }
                            }

                            return {
                                storeName: storeName,
                                storeId: storeId || 'unknown',
                            };
                        }, modifyButton);
                        
                        const storeId = storeInfo?.storeId || 'unknown';
                        if (!storeGroups.has(storeId)) {
                            storeGroups.set(storeId, {
                                storeName: storeInfo?.storeName || '알 수 없는 스토어',
                                storeId: storeId,
                                buttons: []
                            });
                        }
                        storeGroups.get(storeId).buttons.push(modifyButton);
                    } catch (e) {
                        console.log(`스토어 정보 수집 중 오류 (버튼 ${i + 1}): ${e.message}`);
                        // 오류가 발생한 버튼은 'unknown' 그룹에 추가
                        if (!storeGroups.has('unknown')) {
                            storeGroups.set('unknown', {
                                storeName: '알 수 없는 스토어',
                                storeId: 'unknown',
                                buttons: []
                            });
                        }
                        storeGroups.get('unknown').buttons.push(modifyButton);
                    }
                }
                
                console.log(`\n총 ${storeGroups.size}개의 스토어를 찾았습니다.`);
                
                // 스토어별로 순차 처리
                let storeIndex = 0;
                for (const [storeId, storeGroup] of storeGroups) {
                    storeIndex++;
                    console.log(`\n\n╔════════════════════════════════════════════════════════════╗`);
                    console.log(`║  ${storeIndex}번째 스토어: ${storeGroup.storeName} (ID: ${storeGroup.storeId})`);
                    console.log(`║  상품 개수: ${storeGroup.buttons.length}개`);
                    console.log(`╚════════════════════════════════════════════════════════════╝\n`);
                    
                    // 해당 스토어의 모든 상품 처리
                    for (let modifyIndex = 0; modifyIndex < storeGroup.buttons.length; modifyIndex++) {
                        const modifyButton = storeGroup.buttons[modifyIndex];
                        if (!modifyButton) continue;

                        console.log(`\n===== ${modifyIndex + 1}번째 상품 주문수정 시작 =====`);

                    // 어떤 스토어/상품의 주문수정을 하는지 출력
                    try {
                        const cartInfo = await driver.executeScript(function (btn) {
                            function getDataAttr(el, name) {
                                if (!el) return null;
                                if (el.dataset && Object.prototype.hasOwnProperty.call(el.dataset, name)) {
                                    return el.dataset[name];
                                }
                                const attrName = 'data-' + name.replace(/[A-Z]/g, function (m) {
                                    return '-' + m.toLowerCase();
                                });
                                return el.getAttribute(attrName);
                            }

                            var productCard = btn.closest('div.product--BPAxWCQbvE');
                            if (!productCard) {
                                productCard = btn.closest('div[class*="product--"]');
                            }
                            if (!productCard) return null;

                            var storeCard =
                                productCard.closest('div.store_card--EAQK-9jWb0') ||
                                productCard.closest('div[class*="store_card"]');

                            var storeName = null;
                            var storeId = null;
                            if (storeCard) {
                                var storeLink =
                                    storeCard.querySelector('h2.mall--1iPWamYR2w a') ||
                                    storeCard.querySelector('h2.mall a') ||
                                    storeCard.querySelector('a[data-shp-contents-grp="store"]');

                                if (storeLink) {
                                    var firstNode = storeLink.childNodes[0];
                                    var text = firstNode && firstNode.nodeType === 3
                                        ? firstNode.textContent
                                        : storeLink.textContent;
                                    storeName = (text || '').trim();
                                    storeId =
                                        getDataAttr(storeLink, 'shpContentsProviderId') ||
                                        getDataAttr(storeLink, 'shp-contents-provider-id');
                                }
                            }

                            var productBlocks = storeCard
                                ? Array.prototype.slice.call(
                                      storeCard.querySelectorAll(
                                          'div.product--BPAxWCQbvE, div[class*="product--"]'
                                      )
                                  )
                                : [productCard];

                            var products = [];
                            productBlocks.forEach(function (block) {
                                var titleEl =
                                    block.querySelector('div.title--2r7IrJqWav') ||
                                    block.querySelector('div[class*="title--"]');
                                var name = titleEl ? titleEl.textContent.trim() : null;
                                
                                // '네이버플러스멤버십' 제거
                                if (name && name.startsWith('네이버플러스멤버십')) {
                                    name = name.substring('네이버플러스멤버십'.length).trim();
                                }

                                var prodLink =
                                    block.querySelector('a.link_product--2T3uBuQSUL') ||
                                    block.querySelector('a[data-shp-contents-type="chnl_prod_no"]');
                                var prodId =
                                    getDataAttr(prodLink, 'shpContentsId') ||
                                    getDataAttr(prodLink, 'shp-contents-id');
                                
                                // 판매가 정보 수집
                                var price = null;
                                
                                // 방법 1: data-shp-contents-dtl 속성에서 가격 추출
                                if (prodLink) {
                                    var contentsDtl = getDataAttr(prodLink, 'shpContentsDtl') ||
                                                      getDataAttr(prodLink, 'shp-contents-dtl');
                                    if (contentsDtl) {
                                        try {
                                            var dtlArray = JSON.parse(contentsDtl);
                                            if (Array.isArray(dtlArray)) {
                                                for (var i = 0; i < dtlArray.length; i++) {
                                                    if (dtlArray[i] && dtlArray[i].key === 'price') {
                                                        price = dtlArray[i].value;
                                                        break;
                                                    }
                                                }
                                            }
                                        } catch (e) {
                                            // JSON 파싱 실패 시 무시
                                        }
                                    }
                                }
                                
                                // 방법 2: 가격 요소에서 직접 가져오기
                                if (!price) {
                                    var priceEl =
                                        block.querySelector('div.price--2Uv-07hf78 span.num--3M3ai7peWI') ||
                                        block.querySelector('div[class*="price--"] span[class*="num--"]');
                                    if (priceEl) {
                                        var priceText = priceEl.textContent.trim();
                                        // 숫자만 추출 (콤마 제거)
                                        price = priceText.replace(/[^0-9]/g, '');
                                    }
                                }

                                products.push({
                                    name: name,
                                    id: prodId,
                                    price: price,
                                    isTarget: block.contains(btn),
                                });
                            });

                            return {
                                storeName: storeName,
                                storeId: storeId,
                                products: products,
                            };
                        }, modifyButton);

                        if (cartInfo) {
                            console.log("\n=== 이번에 주문수정 할 장바구니 정보 ===");
                            if (cartInfo.storeName) {
                                console.log(`스토어: ${cartInfo.storeName}`);
                            }
                            if (cartInfo.storeId) {
                                console.log(`스토어 ID: ${cartInfo.storeId}`);
                            }
                            if (Array.isArray(cartInfo.products)) {
                                cartInfo.products.forEach((p, idx) => {
                                    const index = idx + 1;
                                    const flag = p.isTarget ? " (이번에 주문수정)" : "";
                                    console.log(`\n📌 상품 ${index}${flag}:`);
                                    if (p.name) {
                                        console.log(`   상품명: ${p.name}`);
                                    }
                                    if (p.id) {
                                        console.log(`   상품 ID: ${p.id}`);
                                    }
                                    if (p.price) {
                                        // 가격에 콤마 추가하여 표시
                                        const formattedPrice = parseInt(p.price).toLocaleString('ko-KR');
                                        console.log(`   판매가: ${formattedPrice}원`);
                                    }
                                });
                            }
                            console.log("====================================\n");
                        } else {
                            console.log("장바구니 정보를 읽어오지 못했습니다.");
                        }
                    } catch (e) {
                        console.log(`장바구니 정보 출력 중 오류: ${e.message}`);
                    }
                    
                    // 버튼 위치를 화면 중앙으로 스크롤
                    try {
                        await driver.executeScript(function (el) {
                            if (!el) return;
                            const desiredViewportPosition = window.innerHeight * 0.2; // 화면 상단에서 1/5 지점
                            const rect = el.getBoundingClientRect();
                            const currentScroll =
                                window.pageYOffset ||
                                document.documentElement.scrollTop ||
                                document.body.scrollTop ||
                                0;
                            let targetScroll = currentScroll + rect.top - desiredViewportPosition;
                            if (targetScroll < 0) {
                                targetScroll = 0;
                            }
                            window.scrollTo({ top: targetScroll, behavior: 'smooth' });
                        }, modifyButton);
                        await driver.sleep(800); // 스크롤 애니메이션 대기
                    } catch (e) {
                        console.log(`주문수정 버튼 스크롤 중 오류: ${e.message}`);
                    }

                    // 주문수정 프로세스 실행
                    await processOrderModification(driver, modifyButton);

                    console.log(`===== ${modifyIndex + 1}번째 상품 주문수정 완료 =====\n`);
                    }
                    
                    // 해당 스토어의 모든 상품 처리 완료
                    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
                    console.log(`║  ${storeIndex}번째 스토어 '${storeGroup.storeName}'의 모든 상품 처리 완료`);
                    console.log(`╚════════════════════════════════════════════════════════════╝\n`);
                    
                    // 마지막 스토어가 아니면 다음 스토어 진행 여부 물어보기
                    if (storeIndex < storeGroups.size) {
                        const answer = await question(`\n다음 스토어로 진행하시겠습니까? (y/n): `);
                        if (answer.toLowerCase() !== 'y') {
                            console.log("\n사용자가 다음 스토어 진행을 취소했습니다. 작업을 종료합니다.");
                            break;
                        }
                        console.log("\n다음 스토어로 진행합니다...\n");
                    }
                }
            } catch (e) {
                console.log(`'주문수정' 버튼 클릭 중 오류 발생: ${e.message}`);
            }
            
            console.log("\n모든 스토어의 작업을 완료했습니다.");
            
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

