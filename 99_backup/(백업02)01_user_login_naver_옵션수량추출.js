const { Builder, By, until, Key } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

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
            
            // '주문수정' 버튼 찾기 및 클릭
            try {
                // 여러 선택자로 시도
                let modifyButton = null;
                
                // 방법 1: 클래스명으로 찾기
                try {
                    const buttons = await driver.findElements(By.css('button.btn_modify--3dB-BgyPu5'));
                    if (buttons.length > 0) {
                        modifyButton = buttons[0]; // 첫 번째 버튼
                        console.log("클래스명으로 '주문수정' 버튼을 찾았습니다.");
                    }
                } catch (e) {
                    // 다음 방법 시도
                }
                
                // 방법 2: data 속성으로 찾기
                if (!modifyButton) {
                    try {
                        const buttons = await driver.findElements(By.css('button[data-shp-area-id="pdedit"]'));
                        if (buttons.length > 0) {
                            modifyButton = buttons[0]; // 첫 번째 버튼
                            console.log("data 속성으로 '주문수정' 버튼을 찾았습니다.");
                        }
                    } catch (e) {
                        // 다음 방법 시도
                    }
                }
                
                // 방법 3: 텍스트로 찾기
                if (!modifyButton) {
                    try {
                        const buttons = await driver.findElements(By.xpath("//button[contains(text(), '주문수정')]"));
                        if (buttons.length > 0) {
                            modifyButton = buttons[0]; // 첫 번째 버튼
                            console.log("텍스트로 '주문수정' 버튼을 찾았습니다.");
                        }
                    } catch (e) {
                        // 버튼을 찾지 못함
                    }
                }
                
                if (modifyButton) {
                    // 버튼이 보일 때까지 대기
                    await driver.wait(until.elementIsVisible(modifyButton), 10000);
                    // 버튼 클릭
                    await modifyButton.click();
                    console.log("'주문수정' 버튼을 클릭했습니다.");
                    
                    // 레이어 창이 나타날 때까지 대기
                    console.log("주문수정 레이어 창이 나타날 때까지 대기 중...");
                    await driver.sleep(2000);
                    
                    // '옵션 추가' 드롭다운 찾기 및 클릭
                    try {
                        let optionDropdown = null;
                        
                        // 방법 1: data 속성으로 찾기 (optselect)
                        try {
                            const dropdowns = await driver.findElements(By.css('button[data-shp-area-id="optselect"]'));
                            if (dropdowns.length > 0) {
                                optionDropdown = dropdowns[0]; // 첫 번째 드롭다운
                                console.log("data 속성으로 '옵션 추가' 드롭다운을 찾았습니다.");
                            }
                        } catch (e) {
                            // 다음 방법 시도
                        }
                        
                        // 방법 2: "옵션 추가" 제목 다음에 오는 드롭다운 찾기
                        if (!optionDropdown) {
                            try {
                                // "옵션 추가" 제목을 찾고, 그 다음 형제 요소인 select_area 안의 버튼 찾기
                                const optionTitle = await driver.findElement(By.xpath("//div[contains(@class, 'title') and contains(text(), '옵션 추가')]"));
                                if (optionTitle) {
                                    // 부모 요소의 다음 형제 요소에서 드롭다운 찾기
                                    const dropdowns = await driver.findElements(By.xpath("//div[contains(@class, 'title') and contains(text(), '옵션 추가')]/following-sibling::div[contains(@class, 'select_area')]//button[contains(@class, 'btn_select')]"));
                                    if (dropdowns.length > 0) {
                                        optionDropdown = dropdowns[0];
                                        console.log("제목 기준으로 '옵션 추가' 드롭다운을 찾았습니다.");
                                    }
                                }
                            } catch (e) {
                                // 버튼을 찾지 못함
                            }
                        }
                        
                        // 방법 3: section_option 클래스 내의 첫 번째 드롭다운 찾기
                        if (!optionDropdown) {
                            try {
                                const dropdowns = await driver.findElements(By.css('div.section_option--hFDfyl08Oc button.btn_select--3QhA_dLbai'));
                                if (dropdowns.length > 0) {
                                    optionDropdown = dropdowns[0];
                                    console.log("섹션 클래스로 '옵션 추가' 드롭다운을 찾았습니다.");
                                }
                            } catch (e) {
                                // 버튼을 찾지 못함
                            }
                        }
                        
                        if (optionDropdown) {
                            // 드롭다운이 보일 때까지 대기
                            await driver.wait(until.elementIsVisible(optionDropdown), 10000);
                            // 드롭다운 클릭
                            await optionDropdown.click();
                            console.log("'옵션 추가' 드롭다운을 클릭했습니다.");
                            
                            // 옵션 목록이 나타날 때까지 대기
                            await driver.sleep(1000);
                            
                            // 옵션 목록 찾기 및 프린트
                            try {
                                // 옵션 버튼들 찾기 (ul.layer_option 안의 버튼들)
                                const optionButtons = await driver.findElements(By.css('ul.layer_option--3zSn7PQh_Y button.btn_option--32kuYZhMUW'));
                                
                                if (optionButtons.length > 0) {
                                    console.log("\n=== 옵션 목록 ===");
                                    for (let i = 0; i < optionButtons.length; i++) {
                                        try {
                                            const optionText = await optionButtons[i].getText();
                                            console.log(`${i + 1}. ${optionText}`);
                                        } catch (e) {
                                            console.log(`${i + 1}. (텍스트를 가져올 수 없음)`);
                                        }
                                    }
                                    console.log("================\n");
                                    
                                    // 반복할 횟수 결정 (최대 5개, 또는 옵션 수만큼, '선택 없음' 제외)
                                    const maxIterations = Math.min(5, optionButtons.length - 1);
                                    console.log(`상위 ${maxIterations}개 옵션에 대해 반복 작업을 시작합니다.\n`);
                                    
                                    // 상위 5개 옵션(또는 존재하는 옵션 수만큼) 반복
                                    for (let optionIndex = 1; optionIndex <= maxIterations; optionIndex++) {
                                        console.log(`\n========== ${optionIndex}번째 반복 시작 ==========`);
                                        
                                        try {
                                            // 옵션 드롭다운 다시 찾기 및 클릭
                                            let currentOptionDropdown = null;
                                            
                                            // 방법 1: data 속성으로 찾기 (optselect)
                                            try {
                                                const dropdowns = await driver.findElements(By.css('button[data-shp-area-id="optselect"]'));
                                                if (dropdowns.length > 0) {
                                                    currentOptionDropdown = dropdowns[0];
                                                }
                                            } catch (e) {
                                                // 다음 방법 시도
                                            }
                                            
                                            // 방법 2: section_option 클래스 내의 첫 번째 드롭다운 찾기
                                            if (!currentOptionDropdown) {
                                                try {
                                                    const dropdowns = await driver.findElements(By.css('div.section_option--hFDfyl08Oc button.btn_select--3QhA_dLbai'));
                                                    if (dropdowns.length > 0) {
                                                        currentOptionDropdown = dropdowns[0];
                                                    }
                                                } catch (e) {
                                                    // 버튼을 찾지 못함
                                                }
                                            }
                                            
                                            if (currentOptionDropdown) {
                                                await driver.wait(until.elementIsVisible(currentOptionDropdown), 10000);
                                                await currentOptionDropdown.click();
                                                console.log(`옵션 드롭다운을 클릭했습니다.`);
                                                
                                                // 옵션 목록이 나타날 때까지 대기
                                                await driver.sleep(1500);
                                                
                                                // 해당 인덱스의 옵션 선택
                                                try {
                                                    const currentOptionButtons = await driver.findElements(By.css('ul.layer_option--3zSn7PQh_Y button.btn_option--32kuYZhMUW'));
                                                    
                                                    if (currentOptionButtons.length > optionIndex) {
                                                        const selectedOption = currentOptionButtons[optionIndex];
                                                        await driver.wait(until.elementIsVisible(selectedOption), 5000);
                                                        const optionText = await selectedOption.getText();
                                                        await selectedOption.click();
                                                        console.log(`'${optionText}' 옵션을 클릭했습니다.`);
                                                        
                                                        // 드롭다운이 닫히고 옵션이 추가될 때까지 대기
                                                        await driver.sleep(2000);
                                                        
                                                        // 선택한 옵션이 아닌 다른 옵션들 삭제
                                                        try {
                                                            // 모든 product_item 찾기
                                                            const productItems = await driver.findElements(By.css('div.product_item--2Pee8t5uGw'));
                                                            
                                                            if (productItems.length > 0) {
                                                                console.log(`총 ${productItems.length}개의 옵션이 있습니다.`);
                                                                
                                                                // 각 옵션의 정보를 수집
                                                                const optionInfos = [];
                                                                for (let i = 0; i < productItems.length; i++) {
                                                                    try {
                                                                        const optionElement = await productItems[i].findElement(By.css('div.option--2d7XvSWthq'));
                                                                        const optionInfoText = await optionElement.getText();
                                                                        optionInfos.push({
                                                                            index: i,
                                                                            text: optionInfoText,
                                                                            element: productItems[i]
                                                                        });
                                                                    } catch (e) {
                                                                        // 옵션 정보를 가져올 수 없는 경우 스킵
                                                                    }
                                                                }
                                                                
                                                                // 옵션 정보 출력
                                                                optionInfos.forEach((info, idx) => {
                                                                    console.log(`옵션 ${idx + 1}: ${info.text}`);
                                                                });
                                                                
                                                                // 선택한 옵션 찾기
                                                                // 옵션을 클릭하면 가장 마지막(최근에 추가된) 옵션이 선택한 옵션이므로
                                                                // 가장 마지막 옵션을 선택한 옵션으로 간주
                                                                let selectedOptionInfo = null;
                                                                
                                                                if (optionInfos.length > 0) {
                                                                    // 가장 마지막 옵션을 선택한 옵션으로 간주
                                                                    selectedOptionInfo = optionInfos[optionInfos.length - 1];
                                                                    console.log(`가장 최근에 추가된 옵션을 선택한 옵션으로 간주합니다.`);
                                                                }
                                                                
                                                                // 선택한 옵션이 아닌 다른 옵션들 삭제
                                                                for (const info of optionInfos) {
                                                                    if (info.index !== selectedOptionInfo?.index) {
                                                                        try {
                                                                            const deleteButton = await info.element.findElement(By.css('button.btn_delete--3CIK4Aa9LM'));
                                                                            await driver.wait(until.elementIsVisible(deleteButton), 3000);
                                                                            await deleteButton.click();
                                                                            console.log(`  -> 삭제했습니다: ${info.text}`);
                                                                            await driver.sleep(800); // 삭제 후 대기
                                                                        } catch (e) {
                                                                            console.log(`  -> 삭제 버튼을 찾을 수 없습니다: ${info.text}`);
                                                                        }
                                                                    } else {
                                                                        console.log(`  -> 선택한 옵션이므로 유지합니다: ${info.text}`);
                                                                    }
                                                                }
                                                                
                                                                // 선택한 옵션의 주문수량을 10000개로 변경
                                                                if (selectedOptionInfo) {
                                                                    try {
                                                                        const quantityInput = await selectedOptionInfo.element.findElement(By.css('input.number--1g-qRSYcjs'));
                                                                        await driver.wait(until.elementIsVisible(quantityInput), 3000);
                                                                        
                                                                        // 기존 값(1)에 9를 입력하여 19로 만들고, 1을 지운 후 나머지 9를 입력하여 9999로 만들기
                                                                        await quantityInput.sendKeys('9'); // "1" + "9" = "19"
                                                                        await driver.sleep(200); // 입력 반영 대기
                                                                        await quantityInput.sendKeys(Key.HOME); // 커서를 맨 앞으로 이동
                                                                        await driver.sleep(200);
                                                                        await quantityInput.sendKeys(Key.DELETE); // 맨 앞의 "1" 삭제
                                                                        await driver.sleep(200);
                                                                        await quantityInput.sendKeys('999'); // 나머지 "999" 입력 → "9999"
                                                                        
                                                                        // 입력 후 잠시 대기 (값이 반영될 때까지)
                                                                        await driver.sleep(1000);
                                                                        
                                                                        // 입력된 값 확인
                                                                        const inputValue = await quantityInput.getAttribute('value');
                                                                        console.log(`  -> 주문수량을 ${inputValue}개로 변경했습니다.`);
                                                                        
                                                                        // 확인 버튼 클릭
                                                                        await driver.sleep(1500);
                                                                        try {
                                                                            // 확인 버튼 찾기
                                                                            let confirmButton = null;
                                                                            
                                                                            // 방법 1: 클래스명으로 찾기
                                                                            try {
                                                                                const buttons = await driver.findElements(By.css('button.btn_confirm--38uPVGg2tB'));
                                                                                if (buttons.length > 0) {
                                                                                    confirmButton = buttons[0];
                                                                                    console.log("확인 버튼을 찾았습니다.");
                                                                                }
                                                                            } catch (e) {
                                                                                // 다음 방법 시도
                                                                            }
                                                                            
                                                                            // 방법 2: data 속성으로 찾기
                                                                            if (!confirmButton) {
                                                                                try {
                                                                                    const buttons = await driver.findElements(By.css('button[data-shp-area-id="editconfirm"]'));
                                                                                    if (buttons.length > 0) {
                                                                                        confirmButton = buttons[0];
                                                                                        console.log("data 속성으로 확인 버튼을 찾았습니다.");
                                                                                    }
                                                                                } catch (e) {
                                                                                    // 다음 방법 시도
                                                                                }
                                                                            }
                                                                            
                                                                            // 방법 3: 텍스트로 찾기
                                                                            if (!confirmButton) {
                                                                                try {
                                                                                    const buttons = await driver.findElements(By.xpath("//button[contains(text(), '확인')]"));
                                                                                    if (buttons.length > 0) {
                                                                                        // '확인' 버튼이 여러 개일 수 있으므로, 주문수정 레이어 내의 확인 버튼 찾기
                                                                                        for (const btn of buttons) {
                                                                                            try {
                                                                                                const parent = await btn.findElement(By.xpath("./ancestor::div[contains(@class, 'inner--ERxaT-A3D5')]"));
                                                                                                if (parent) {
                                                                                                    confirmButton = btn;
                                                                                                    console.log("텍스트로 확인 버튼을 찾았습니다.");
                                                                                                    break;
                                                                                                }
                                                                                            } catch {
                                                                                                // 다음 버튼 시도
                                                                                            }
                                                                                        }
                                                                                    }
                                                                                } catch (e) {
                                                                                    // 버튼을 찾지 못함
                                                                                }
                                                                            }
                                                                            
                                                                            if (confirmButton) {
                                                                                await driver.wait(until.elementIsVisible(confirmButton), 5000);
                                                                                await confirmButton.click();
                                                                                console.log("확인 버튼을 클릭했습니다.");
                                                                                
                                                                                // alert 팝업이 나타날 때까지 대기
                                                                                await driver.sleep(2000);
                                                                                
                                                                                // alert 처리
                                                                                try {
                                                                                    // alert가 나타날 때까지 대기 (최대 5초)
                                                                                    await driver.wait(async () => {
                                                                                        try {
                                                                                            await driver.switchTo().alert();
                                                                                            return true;
                                                                                        } catch {
                                                                                            return false;
                                                                                        }
                                                                                    }, 5000);
                                                                                    
                                                                                    const alert = await driver.switchTo().alert();
                                                                                    const alertText = await alert.getText();
                                                                                    console.log(`\n=== [${optionIndex}번째 반복] Alert 팝업 문구 ===`);
                                                                                    console.log(alertText);
                                                                                    console.log("==========================================\n");
                                                                                    
                                                                                    // alert 확인 버튼 클릭
                                                                                    await alert.accept();
                                                                                    console.log("Alert 확인 버튼을 클릭했습니다.");
                                                                                    
                                                                                    // Alert 확인 후 다음 반복을 위해 대기
                                                                                    await driver.sleep(2000);
                                                                                } catch (e) {
                                                                                    console.log(`Alert 처리 중 오류 발생: ${e.message}`);
                                                                                }
                                                                            } else {
                                                                                console.log("확인 버튼을 찾을 수 없습니다.");
                                                                            }
                                                                        } catch (e) {
                                                                            console.log(`확인 버튼 클릭 중 오류 발생: ${e.message}`);
                                                                        }
                                                                    } catch (e) {
                                                                        console.log(`  -> 주문수량 변경 중 오류 발생: ${e.message}`);
                                                                    }
                                                                }
                                                            } else {
                                                                console.log("옵션이 없습니다.");
                                                            }
                                                        } catch (e) {
                                                            console.log(`옵션 정리 중 오류 발생: ${e.message}`);
                                                        }
                                                    } else {
                                                        console.log(`인덱스 ${optionIndex}의 옵션을 찾을 수 없습니다.`);
                                                    }
                                                } catch (e) {
                                                    console.log(`옵션 선택 중 오류 발생: ${e.message}`);
                                                }
                                            } else {
                                                console.log("옵션 드롭다운을 찾을 수 없습니다.");
                                            }
                                        } catch (e) {
                                            console.log(`${optionIndex}번째 반복 중 오류 발생: ${e.message}`);
                                        }
                                        
                                        console.log(`========== ${optionIndex}번째 반복 완료 ==========\n`);
                                    }
                                    
                                    console.log("모든 반복 작업이 완료되었습니다.");
                                } else {
                                    console.log("옵션 목록을 찾을 수 없습니다.");
                                }
                            } catch (e) {
                                console.log(`옵션 목록 처리 중 오류 발생: ${e.message}`);
                            }
                        } else {
                            console.log("'옵션 추가' 드롭다운을 찾을 수 없습니다.");
                        }
                    } catch (e) {
                        console.log(`'옵션 추가' 드롭다운 클릭 중 오류 발생: ${e.message}`);
                    }
                } else {
                    console.log("'주문수정' 버튼을 찾을 수 없습니다.");
                }
            } catch (e) {
                console.log(`'주문수정' 버튼 클릭 중 오류 발생: ${e.message}`);
            }
            
            console.log("작업을 완료했습니다.");
            
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

