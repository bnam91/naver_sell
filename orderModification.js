const { By, until, Key } = require('selenium-webdriver');
const { addOption, updateStock } = require('./dbModule');

/**
 * 옵션 텍스트에서 추가 가격 추출
 * 예: "매트블랙 (Matt-Black) (+1,800원)" -> 1800
 * 예: "🙋‍♂️럭슨 수동초점(신상/블랙) (-5,220원)" -> -5220
 */
function parseAdditionalPrice(optionText) {
    if (!optionText) return 0;
    
    // (+1,800원) 또는 (-5,220원) 형식 찾기
    const priceMatch = optionText.match(/\(([+-]?[\d,]+)원\)/);
    if (priceMatch) {
        const priceStr = priceMatch[1].replace(/,/g, '');
        return parseInt(priceStr, 10);
    }
    return 0;
}

/**
 * 옵션 텍스트에서 옵션명만 추출 (가격 정보 및 품절 정보 제거)
 * 예: "13번 A35 A161 (바퀴2개) W068 (+6,500원) (품절)" -> "13번 A35 A161 (바퀴2개) W068"
 */
function parseOptionName(optionText) {
    if (!optionText) return '';
    
    let result = optionText;
    
    // (+1,800원) 또는 (-5,220원) 형식 제거
    result = result.replace(/\s*\([+-]?[\d,]+원\)\s*/g, '').trim();
    
    // (품절) 제거
    result = result.replace(/\s*\(품절\)\s*/g, '').trim();
    
    return result;
}

/**
 * Alert 텍스트에서 재고 수 추출
 * 예: "색상: 미드그레이 (Mid-Grey)의 재고가 부족합니다. 332개 이하로 구매해 주세요." -> 332
 */
function parseStockFromAlert(alertText) {
    if (!alertText) return null;
    
    // "332개 이하로" 형식 찾기
    const match = alertText.match(/(\d+)개\s*이하로/);
    if (match) {
        return parseInt(match[1], 10);
    }
    
    // 품절 관련 문구가 있으면 0 반환
    if (alertText.includes('품절') || alertText.includes('재고 없음')) {
        return 0;
    }
    
    return null;
}

/**
 * Alert 텍스트에서 옵션명 추출
 * 예: "색상: 미드그레이 (Mid-Grey)의 재고가 부족합니다. 332개 이하로 구매해 주세요." -> "미드그레이 (Mid-Grey)"
 */
function parseOptionNameFromAlert(alertText) {
    if (!alertText) return '';
    
    // "색상: 미드그레이 (Mid-Grey)의" 형식에서 옵션명 추출
    const match = alertText.match(/색상:\s*([^의]+)의/);
    if (match) {
        return match[1].trim();
    }
    
    // 다른 형식도 시도
    const match2 = alertText.match(/([^:]+):\s*([^의]+)의/);
    if (match2) {
        return match2[2].trim();
    }
    
    return '';
}

/**
 * 주문수정 버튼 클릭 후 전체 프로세스를 처리하는 함수
 * (주문수정 버튼은 이미 클릭된 상태로 호출되어야 함)
 * @param {WebDriver} driver - Selenium WebDriver 객체
 * @param {string} storeId - 스토어 ID
 * @param {string} productId - 상품 ID
 * @param {string} storeName - 스토어명 (옵션, 크롤링한 정보)
 * @param {string} productName - 상품명 (옵션, 크롤링한 정보)
 * @param {number} price - 가격 (옵션, 크롤링한 정보)
 * @returns {Promise<boolean>} - 성공 여부
 */
async function processOrderModification(driver, storeId = '', productId = '', storeName = '', productName = '', price = null) {
    try {
        // 세션 타임스탬프는 scrapeCartItems 시작 시점에 이미 설정되어 있음
        // 여기서는 설정하지 않음 (전체 실행 시점의 타임스탬프를 유지)
        
        // 1. 레이어 창이 나타날 때까지 대기
        console.log("주문수정 레이어 창이 나타날 때까지 대기 중...");
        await driver.sleep(2000);
        
        // 3. '옵션 추가' 드롭다운 찾기 및 클릭
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
                
                // 4. 옵션 목록 찾기 및 프린트
                try {
                    // 옵션 버튼들 찾기 (ul.layer_option 안의 버튼들)
                    const optionButtons = await driver.findElements(By.css('ul.layer_option--3zSn7PQh_Y button.btn_option--32kuYZhMUW'));
                    
                    if (optionButtons.length > 0) {
                        console.log("\n=== 옵션 목록 ===");
                        const optionList = [];
                        for (let i = 0; i < optionButtons.length; i++) {
                            try {
                                const optionText = await optionButtons[i].getText();
                                console.log(`${i + 1}. ${optionText}`);
                                
                                // "선택 없음"은 제외하고 옵션 정보 저장
                                if (optionText && !optionText.includes('선택 없음')) {
                                    const optionName = parseOptionName(optionText);
                                    const additionalPrice = parseAdditionalPrice(optionText);
                                    
                                    optionList.push({
                                        option_id: "",
                                        option_name: optionName,
                                        additional_price: additionalPrice,
                                        memo: "",
                                        stock: {}
                                    });
                                    
                                    // DB에 옵션 정보 저장
                                    if (storeId && productId) {
                                        try {
                                            await addOption(storeId, productId, {
                                                option_id: "",
                                                option_name: optionName,
                                                additional_price: additionalPrice,
                                                memo: "",
                                                stock: {}
                                            });
                                        } catch (e) {
                                            console.error(`옵션 저장 중 오류: ${e.message}`);
                                        }
                                    }
                                }
                            } catch (e) {
                                console.log(`${i + 1}. (텍스트를 가져올 수 없음)`);
                            }
                        }
                        console.log("================\n");
                        
                        // 반복할 횟수 결정 ('선택 없음' 제외하고 모든 옵션 처리)
                        const maxIterations = optionButtons.length - 1;
                        console.log(`전체 ${maxIterations}개 옵션에 대해 반복 작업을 시작합니다.\n`);
                        
                        // 5. 모든 옵션 반복 ('선택 없음' 제외)
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
                                    
                                    // 옵션 목록이 이미 열려있는지 확인
                                    let isOptionListOpen = false;
                                    try {
                                        const existingButtons = await driver.findElements(By.css('ul.layer_option--3zSn7PQh_Y button.btn_option--32kuYZhMUW'));
                                        isOptionListOpen = existingButtons.length > 0;
                                        if (isOptionListOpen) {
                                            console.log(`옵션 목록이 이미 열려있습니다. (${existingButtons.length}개 옵션)`);
                                        }
                                    } catch (e) {
                                        // 옵션 목록이 없는 것으로 간주
                                    }
                                    
                                    // 옵션 목록이 열려있지 않으면 드롭다운 클릭
                                    if (!isOptionListOpen) {
                                        await currentOptionDropdown.click();
                                        console.log(`옵션 드롭다운을 클릭했습니다.`);
                                        
                                        // 옵션 목록이 나타날 때까지 대기 (요소가 보일 때까지)
                                        try {
                                            await driver.wait(async () => {
                                                const buttons = await driver.findElements(By.css('ul.layer_option--3zSn7PQh_Y button.btn_option--32kuYZhMUW'));
                                                return buttons.length > 0;
                                            }, 5000);
                                        } catch (e) {
                                            console.log(`옵션 목록 로딩 대기 중 오류: ${e.message}`);
                                        }
                                    }
                                    
                                    // 추가 대기 시간
                                    await driver.sleep(500);
                                    
                                    // 5-1. 해당 인덱스의 옵션 선택
                                    try {
                                        const currentOptionButtons = await driver.findElements(By.css('ul.layer_option--3zSn7PQh_Y button.btn_option--32kuYZhMUW'));
                                        
                                        console.log(`[디버깅] 찾은 옵션 버튼 개수: ${currentOptionButtons.length}, 찾으려는 인덱스: ${optionIndex}`);
                                        
                                        if (currentOptionButtons.length > optionIndex) {
                                            const selectedOption = currentOptionButtons[optionIndex];
                                            await driver.wait(until.elementIsVisible(selectedOption), 5000);
                                            const optionText = await selectedOption.getText();
                                            console.log(`[디버깅] 선택할 옵션 텍스트: '${optionText}'`);
                                            await selectedOption.click();
                                            console.log(`'${optionText}' 옵션을 클릭했습니다.`);
                                            
                                            // 옵션 클릭 후 품절 Alert 확인 및 처리
                                            await driver.sleep(800);
                                            try {
                                                // Alert가 나타났는지 확인 (최대 3초)
                                                await driver.wait(async () => {
                                                    try {
                                                        await driver.switchTo().alert();
                                                        return true;
                                                    } catch {
                                                        return false;
                                                    }
                                                }, 3000);
                                                
                                                const alert = await driver.switchTo().alert();
                                                const alertText = await alert.getText();
                                                
                                                // 품절 Alert인 경우 처리
                                                if (alertText.includes('품절') || alertText.includes('구매하실 수 없습니다')) {
                                                    console.log(`\n=== [${optionIndex}번째 반복] 품절 Alert 팝업 ===`);
                                                    console.log(alertText);
                                                    console.log("==========================================\n");
                                                    
                                                    // 옵션명 추출
                                                    const optionName = parseOptionName(optionText);
                                                    
                                                    // 재고 0을 stock에 저장
                                                    if (storeId && productId && optionName) {
                                                        try {
                                                            await updateStock(storeId, productId, optionName, 0, storeName, productName, price);
                                                            console.log(`품절 옵션 '${optionName}'의 재고를 0으로 저장했습니다.`);
                                                        } catch (e) {
                                                            console.error(`품절 재고 정보 저장 중 오류: ${e.message}`);
                                                        }
                                                    }
                                                    
                                                    // Alert 확인 버튼 클릭
                                                    await alert.accept();
                                                    console.log("품절 Alert 확인 버튼을 클릭했습니다.");
                                                    
                                                    // 품절이므로 이 옵션은 더 이상 처리하지 않음
                                                    console.log(`========== ${optionIndex}번째 반복 완료 (품절) ==========\n`);
                                                    continue;
                                                }
                                                
                                                // 품절이 아닌 다른 Alert인 경우도 처리
                                                await alert.accept();
                                            } catch (e) {
                                                // Alert가 없거나 타임아웃된 경우 정상 진행
                                            }
                                            
                                            // 드롭다운이 닫히고 옵션이 추가될 때까지 대기
                                            await driver.sleep(1000);
                                            
                                            // 5-2. 선택한 옵션이 아닌 다른 옵션들 삭제
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
                                                    
                                                    // 5-3. 선택한 옵션의 주문수량을 10000개로 변경
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
                                                            await driver.sleep(500);
                                                            
                                                            // 입력된 값 확인
                                                            const inputValue = await quantityInput.getAttribute('value');
                                                            console.log(`  -> 주문수량을 ${inputValue}개로 변경했습니다.`);
                                                            
                                                            // 5-4. 확인 버튼 클릭
                                                            await driver.sleep(1200);
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
                                                                    
                                                                    // 5-5. alert 처리
                                                                    let hasAlert = false;
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
                                                                        
                                                                        hasAlert = true;
                                                                        
                                                                        // Alert 텍스트에서 재고 정보 추출 및 저장
                                                                        if (storeId && productId) {
                                                                            try {
                                                                                const stock = parseStockFromAlert(alertText);
                                                                                const optionName = parseOptionNameFromAlert(alertText);
                                                                                
                                                                                if (stock !== null && optionName) {
                                                                                    await updateStock(storeId, productId, optionName, stock, storeName, productName, price);
                                                                                }
                                                                            } catch (e) {
                                                                                console.error(`재고 정보 저장 중 오류: ${e.message}`);
                                                                            }
                                                                        }
                                                                        
                                                                        // alert 확인 버튼 클릭
                                                                        await alert.accept();
                                                                        console.log("Alert 확인 버튼을 클릭했습니다.");
                                                                        
                                                                        // Alert 확인 후 다음 반복을 위해 대기
                                                                        await driver.sleep(1500);
                                                                    } catch (e) {
                                                                        // Alert가 없는 경우 = 재고가 충분한 경우
                                                                        console.log(`Alert가 나타나지 않았습니다. 재고가 충분한 것으로 판단됩니다.`);
                                                                        
                                                                        // 옵션명 추출 (optionText에서)
                                                                        const optionName = parseOptionName(optionText);
                                                                        
                                                                        // 재고 9999로 저장
                                                                        if (storeId && productId && optionName) {
                                                                            try {
                                                                                await updateStock(storeId, productId, optionName, 9999, storeName, productName, price);
                                                                                console.log(`옵션 '${optionName}'의 재고를 9999로 저장했습니다.`);
                                                                            } catch (e) {
                                                                                console.error(`재고 정보 저장 중 오류: ${e.message}`);
                                                                            }
                                                                        }
                                                                        
                                                                        // 레이어 창이 닫혔는지 확인하고 대기
                                                                        await driver.sleep(1500);
                                                                        
                                                                        // 레이어 창이 닫혔으므로 다시 주문수정 버튼을 눌러야 함
                                                                        console.log(`레이어 창이 닫혔습니다. 다음 옵션 처리를 위해 주문수정 버튼을 다시 클릭합니다.`);
                                                                        
                                                                        // 주문수정 버튼 다시 찾기 및 클릭
                                                                        try {
                                                                            // 주문수정 버튼 찾기
                                                                            let modifyButton = null;
                                                                            
                                                                            // 방법 1: 클래스명으로 찾기
                                                                            try {
                                                                                const buttons = await driver.findElements(By.css('button.btn_modify--3dB-BgyPu5'));
                                                                                if (buttons.length > 0) {
                                                                                    modifyButton = buttons[0];
                                                                                }
                                                                            } catch (e) {
                                                                                // 다음 방법 시도
                                                                            }
                                                                            
                                                                            // 방법 2: data 속성으로 찾기
                                                                            if (!modifyButton) {
                                                                                try {
                                                                                    const buttons = await driver.findElements(By.css('button[data-shp-area-id="pdedit"]'));
                                                                                    if (buttons.length > 0) {
                                                                                        modifyButton = buttons[0];
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
                                                                                        modifyButton = buttons[0];
                                                                                    }
                                                                                } catch (e) {
                                                                                    // 버튼을 찾지 못함
                                                                                }
                                                                            }
                                                                            
                                                                            if (modifyButton) {
                                                                                // 버튼이 보이도록 스크롤
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
                                                                                console.log("주문수정 버튼을 다시 클릭했습니다.");
                                                                                
                                                                                // 레이어 창이 나타날 때까지 대기
                                                                                await driver.sleep(1800);
                                                                                
                                                                                // 드롭다운 다시 찾기 및 클릭
                                                                                let optionDropdown = null;
                                                                                try {
                                                                                    const dropdowns = await driver.findElements(By.css('button[data-shp-area-id="optselect"]'));
                                                                                    if (dropdowns.length > 0) {
                                                                                        optionDropdown = dropdowns[0];
                                                                                    }
                                                                                } catch (e) {
                                                                                    // 다음 방법 시도
                                                                                }
                                                                                
                                                                                if (!optionDropdown) {
                                                                                    try {
                                                                                        const dropdowns = await driver.findElements(By.css('div.section_option--hFDfyl08Oc button.btn_select--3QhA_dLbai'));
                                                                                        if (dropdowns.length > 0) {
                                                                                            optionDropdown = dropdowns[0];
                                                                                        }
                                                                                } catch (e) {
                                                                                    // 버튼을 찾지 못함
                                                                                }
                                                                            }
                                                                            
                                                                                if (optionDropdown) {
                                                                                    await driver.wait(until.elementIsVisible(optionDropdown), 10000);
                                                                                    await optionDropdown.click();
                                                                                    console.log("옵션 드롭다운을 다시 클릭했습니다.");
                                                                                    
                                                                                    // 옵션 목록이 나타날 때까지 대기
                                                                                    await driver.sleep(1000);
                                                                                    
                                                                                    // 다음 옵션 인덱스로 이어서 처리하기 위해 반복문을 계속 진행
                                                                                    console.log(`다음 옵션(${optionIndex + 1}번째)으로 이어서 처리합니다.`);
                                                                                } else {
                                                                                    console.log("옵션 드롭다운을 찾을 수 없습니다.");
                                                                                }
                                                                            } else {
                                                                                console.log("주문수정 버튼을 찾을 수 없습니다.");
                                                                            }
                                                                        } catch (e) {
                                                                            console.log(`주문수정 버튼 다시 클릭 중 오류 발생: ${e.message}`);
                                                                        }
                                                                        
                                                                        console.log(`========== ${optionIndex}번째 반복 완료 (재고 충분) ==========\n`);
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
                                            console.log(`[오류] 인덱스 ${optionIndex}의 옵션을 찾을 수 없습니다. (현재 옵션 버튼 개수: ${currentOptionButtons.length})`);
                                            // 디버깅: 현재 옵션 목록 출력
                                            if (currentOptionButtons.length > 0) {
                                                console.log(`[디버깅] 현재 옵션 목록:`);
                                                for (let i = 0; i < Math.min(currentOptionButtons.length, 5); i++) {
                                                    try {
                                                        const text = await currentOptionButtons[i].getText();
                                                        console.log(`  [${i}]: ${text}`);
                                                    } catch (e) {
                                                        console.log(`  [${i}]: (텍스트 가져오기 실패)`);
                                                    }
                                                }
                                            }
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
                // 옵션 드롭다운이 없는 경우 = 옵션이 없는 상품
                console.log("'옵션 추가' 드롭다운을 찾을 수 없습니다. 옵션이 없는 상품으로 판단합니다.");
                
                // option_name을 "null"로 저장
                if (storeId && productId) {
                    try {
                        // 옵션 정보 저장
                        await addOption(storeId, productId, {
                            option_id: "",
                            option_name: "null",
                            additional_price: 0,
                            memo: "",
                            stock: {}
                        });
                        
                        // 재고 정보도 저장 (9999로)
                        await updateStock(storeId, productId, "null", 9999, storeName, productName, price);
                        console.log("옵션이 없는 상품으로 option_name 'null'과 재고 9999를 저장했습니다.");
                    } catch (e) {
                        console.error(`옵션 없는 상품 정보 저장 중 오류: ${e.message}`);
                    }
                }
                
                // 계속 진행 (레이어 창 닫기로 이동)
            }
        } catch (e) {
            console.log(`'옵션 추가' 드롭다운 클릭 중 오류 발생: ${e.message}`);
        }

        // 6. 주문수정 레이어 X 버튼으로 닫기
        try {
            await driver.sleep(1200);
            let closeButton = null;

            // 클래스명으로 닫기 버튼 찾기
            try {
                const closeButtons = await driver.findElements(By.css('button.btn_close--oP6EO7PIxz'));
                if (closeButtons.length > 0) {
                    closeButton = closeButtons[0];
                }
            } catch (e) {
                // 다음 방법 시도
            }

            // data 속성으로 닫기 버튼 찾기 (예상 값)
            if (!closeButton) {
                try {
                    const closeButtons = await driver.findElements(By.css('button[data-shp-area-id="editclose"]'));
                    if (closeButtons.length > 0) {
                        closeButton = closeButtons[0];
                    }
                } catch (e) {
                    // 버튼을 찾지 못함
                }
            }

            if (closeButton) {
                await driver.wait(until.elementIsVisible(closeButton), 5000);
                await closeButton.click();
                console.log("주문수정 레이어를 X 버튼으로 닫았습니다.");
            } else {
                console.log("주문수정 레이어 닫기 버튼을 찾지 못했습니다.");
            }

            await driver.sleep(1500);
        } catch (e) {
            console.log(`주문수정 레이어 닫기 중 오류 발생: ${e.message}`);
        }

        // 세션 타임스탬프는 scrapeCartItems에서 관리하므로 여기서는 초기화하지 않음
        // (전체 실행 시작 시점의 타임스탬프를 모든 스토어/상품이 공유)
        
        return true;
    } catch (e) {
        console.log(`주문수정 프로세스 중 오류 발생: ${e.message}`);
        return false;
    }
}

module.exports = { processOrderModification };

