const { By, until, Key } = require('selenium-webdriver');

/**
 * 주문수정 버튼 클릭 후 전체 프로세스를 처리하는 함수
 * @param {WebDriver} driver - Selenium WebDriver 객체
 * @param {WebElement} modifyButton - 주문수정 버튼 요소
 * @returns {Promise<boolean>} - 성공 여부
 */
async function processOrderModification(driver, modifyButton) {
    try {
        // 1. 버튼이 보일 때까지 대기 후 클릭
        await driver.wait(until.elementIsVisible(modifyButton), 10000);
        await modifyButton.click();
        console.log("'주문수정' 버튼을 클릭했습니다.");
        
        // 2. 레이어 창이 나타날 때까지 대기
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
                        for (let i = 0; i < optionButtons.length; i++) {
                            try {
                                const optionText = await optionButtons[i].getText();
                                console.log(`${i + 1}. ${optionText}`);
                            } catch (e) {
                                console.log(`${i + 1}. (텍스트를 가져올 수 없음)`);
                            }
                        }
                        console.log("================\n");
                        
                        // 반복할 횟수 결정 (최대 2개, 또는 옵션 수만큼, '선택 없음' 제외)
                        const maxIterations = Math.min(2, optionButtons.length - 1);
                        console.log(`상위 ${maxIterations}개 옵션에 대해 반복 작업을 시작합니다.\n`);
                        
                        // 5. 상위 2개 옵션(또는 존재하는 옵션 수만큼) 반복
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
                                            
                                            // 드롭다운이 닫히고 옵션이 추가될 때까지 대기
                                            await driver.sleep(2000);
                                            
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
                                                            await driver.sleep(1000);
                                                            
                                                            // 입력된 값 확인
                                                            const inputValue = await quantityInput.getAttribute('value');
                                                            console.log(`  -> 주문수량을 ${inputValue}개로 변경했습니다.`);
                                                            
                                                            // 5-4. 확인 버튼 클릭
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
                                                                    
                                                                    // 5-5. alert 처리
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
                console.log("'옵션 추가' 드롭다운을 찾을 수 없습니다.");
            }
        } catch (e) {
            console.log(`'옵션 추가' 드롭다운 클릭 중 오류 발생: ${e.message}`);
        }

        // 6. 주문수정 레이어 X 버튼으로 닫기
        try {
            await driver.sleep(1500);
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

        return true;
    } catch (e) {
        console.log(`주문수정 프로세스 중 오류 발생: ${e.message}`);
        return false;
    }
}

module.exports = { processOrderModification };

