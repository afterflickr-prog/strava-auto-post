const { chromium } = require('playwright');

(async () => {
    // 1. 啟動瀏覽器並模擬大螢幕解析度 (確保頁籤不被隱藏)
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1200 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    try {
        let cookies = JSON.parse(process.env.STRAVA_COOKIES);
        cookies = cookies.map(cookie => {
            const { sameSite, ...rest } = cookie;
            if (!['Strict', 'Lax', 'None'].includes(sameSite)) {
                return { ...rest, sameSite: 'Lax' }; 
            }
            return cookie;
        });
        await context.addCookies(cookies);
    } catch (e) {
        console.error("❌ Cookie 載入失敗");
        process.exit(1);
    }

    const page = await context.newPage();

    try {
        // 2. 獲取排行榜數據 (強制鎖定 week_offset=-1 抓取上週)
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        // 模擬滾動並等待數據載入
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(8000);

        // 拍下調試截圖
        await page.screenshot({ path: 'leaderboard_debug.png', fullPage: true });
        console.log("✅ 已保存調試截圖 leaderboard_debug.png");

        const leaderboard = await page.evaluate(() => {
            let data = [];
            
            // 🎯 根據 Strava 表格結構提取數據
            
            // 方法 1: 查找所有 <h3> 標籤，找到包含「Last Week's Leaders」的
            const headings = Array.from(document.querySelectorAll('h3'));
            const lastWeekHeading = headings.find(h => h.textContent.includes("Last Week's Leaders"));
            
            if (lastWeekHeading) {
                console.log("✅ 找到 'Last Week's Leaders' 區塊");
                // 從標題開始，往下查找所有行 (tr 或其他行容器)
                let currentElement = lastWeekHeading.nextElementSibling;
                const rows = [];
                
                while (currentElement && !currentElement.textContent.includes("This Week")) {
                    if (currentElement.tagName === 'TABLE') {
                        rows.push(...Array.from(currentElement.querySelectorAll('tbody tr')));
                    } else if (currentElement.tagName === 'TR') {
                        rows.push(currentElement);
                    } else if (currentElement.querySelectorAll('tr').length > 0) {
                        rows.push(...Array.from(currentElement.querySelectorAll('tr')));
                    }
                    currentElement = currentElement.nextElementSibling;
                }
                
                console.log(`Found ${rows.length} rows in Last Week's Leaders`);
                
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length >= 2) {
                        let name = '';
                        let dist = '';
                        
                        // 從所有 cell 中提取數據
                        cells.forEach(cell => {
                            const text = cell.innerText?.trim();
                            const link = cell.querySelector('a');
                            
                            // 優先從連結獲取名稱
                            if (link && link.href.includes('/athletes/')) {
                                name = link.innerText?.trim() || '';
                            }
                            
                            // 查找距離數據 (包含 km)
                            if (text && text.match(/\d+\.?\d*\s*km/i)) {
                                dist = text;
                            }
                        });
                        
                        // 如果沒有從連結獲取名稱，從第一個有文本的 cell 獲取
                        if (!name && cells.length > 0) {
                            name = cells[1]?.innerText?.trim() || cells[0]?.innerText?.trim() || '';
                        }
                        
                        if (name && dist && !name.match(/^(\d+|Rank|Distance|Athlete|Time)$/i)) {
                            data.push({ name, dist });
                        }
                    }
                });
            }
            
            // 方法 2: 如果方法 1 失敗，嘗試通用表格查詢
            if (data.length === 0) {
                console.log("⚠️ 方法 1 失敗，嘗試通用表格查詢...");
                const tables = document.querySelectorAll('table');
                
                tables.forEach(table => {
                    const rows = table.querySelectorAll('tbody tr');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            let name = '';
                            let dist = '';
                            
                            cells.forEach(cell => {
                                const text = cell.innerText?.trim();
                                const link = cell.querySelector('a[href*="/athletes/"]');
                                
                                if (link) {
                                    name = link.innerText?.trim() || '';
                                }
                                
                                if (text && text.match(/\d+\.?\d*\s*km/i)) {
                                    dist = text;
                                }
                            });
                            
                            if (!name && cells[1]) {
                                name = cells[1].innerText?.trim() || '';
                            }
                            
                            if (name && dist && !name.match(/^(\d+|Rank|Distance|Athlete|Time)$/i)) {
                                data.push({ name, dist });
                            }
                        }
                    });
                });
            }
            
            // 方法 3: 最後的備選方案 - 查找所有包含 km 的元素
            if (data.length === 0) {
                console.log("⚠️ 方法 2 失敗，嘗試最後方案...");
                const allElements = document.querySelectorAll('*');
                const kmElements = Array.from(allElements).filter(el => 
                    el.innerText && el.innerText.match(/\d+\.?\d*\s*km/i) && el.children.length === 0
                );
                
                console.log(`Found ${kmElements.length} elements with km`);
                
                kmElements.slice(0, 10).forEach(el => {
                    const parentRow = el.closest('tr, [class*="row"], [class*="item"]');
                    if (parentRow) {
                        const nameEl = parentRow.querySelector('a, [class*="name"]');
                        if (nameEl) {
                            data.push({
                                name: nameEl.innerText?.trim() || '',
                                dist: el.innerText?.trim() || ''
                            });
                        }
                    }
                });
            }

            console.log(`Total found: ${data.length} leaderboard entries`);
            
            // 去重並取前三
            const seen = new Set();
            const uniqueData = data.filter(item => {
                if (seen.has(item.name)) return false;
                seen.add(item.name);
                return true;
            });

            return uniqueData.slice(0, 3).map((item, index) => {
                return `${index + 1}️⃣ ${item.name} - ${item.dist}`;
            }).join('\n');
        });

        if (!leaderboard || leaderboard.trim() === '') {
            console.error("❌ 無法解析排行榜");
            console.error("請查看 leaderboard_debug.png 以了解 HTML 結構");
            throw new Error("抓不到排行榜數據");
        }

        console.log("✅ 成功提取排行榜數據：\n", leaderboard);

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪\n\n#夜繽Run #跑步 #Strava`;
        console.log("✅ 成功產出貼文內容：\n", postContent);

        // 3. 直接前往俱樂部新發文頁面 (跳過查找按鈕)
        const newPostUrl = 'https://www.strava.com/clubs/2090529/posts/new';
        console.log("正在前往新發文頁面...");
        await page.goto(newPostUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(8000);  // 給充足時間讓頁面加載

        // 拍下新發文頁面的調試截圖
        await page.screenshot({ path: 'new_post_page.png', fullPage: true });
        console.log("✅ 已保存新發文頁面截圖");

        // 4. 檢查頁面上所有 textarea 和 input
        console.log("正在掃描頁面元素...");
        const pageInfo = await page.evaluate(() => {
            const textareas = document.querySelectorAll('textarea');
            const inputs = document.querySelectorAll('input[type="text"]');
            const contentEditable = document.querySelectorAll('[contenteditable="true"]');
            
            return {
                textareaCount: textareas.length,
                textareaList: Array.from(textareas).map((el, idx) => ({
                    idx,
                    name: el.name,
                    id: el.id,
                    className: el.className,
                    placeholder: el.placeholder,
                    visible: el.offsetHeight > 0,
                    value: el.value,
                })),
                inputCount: inputs.length,
                contentEditableCount: contentEditable.length,
            };
        });
        console.log("Page info:", JSON.stringify(pageInfo, null, 2));

        // 5. 嘗試填充標題 (第一個 textarea 或 input)
        console.log("正在填充標題...");
        const titleSelectors = [
            'input[placeholder*="標題"]',
            'input[placeholder*="Title"]',
            'input[type="text"]',
        ];

        for (const selector of titleSelectors) {
            try {
                const titleInput = page.locator(selector).first();
                if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                    console.log(`✅ 找到標題框: ${selector}`);
                    await titleInput.fill('【夜繽Run 本週戰報】🏃‍♂️💨');
                    await page.waitForTimeout(500);
                    break;
                }
            } catch (e) {
                // 繼續嘗試
            }
        }

        // 6. 填充內容 (主要 textarea)
        console.log("正在填充內容框...");
        const contentSelectors = [
            'textarea[placeholder*="新鮮"]',
            'textarea[placeholder*="Fresh"]',
            'textarea[placeholder*="想"]',
            'textarea:last-of-type',  // 取最後一個 textarea（通常是內容框）
            'textarea',
        ];

        let contentFilled = false;
        for (const selector of contentSelectors) {
            try {
                const contentBox = page.locator(selector).first();
                const isVisible = await contentBox.isVisible({ timeout: 2000 }).catch(() => false);
                
                if (isVisible) {
                    console.log(`✅ 找到內容框: ${selector}`);
                    await contentBox.scrollIntoViewIfNeeded();
                    await contentBox.click();
                    await page.waitForTimeout(500);
                    await contentBox.fill(postContent);
                    console.log("✅ 已填充發文內容");
                    contentFilled = true;
                    await page.waitForTimeout(1000);
                    break;
                }
            } catch (e) {
                console.log(`⚠️ 選擇器失敗: ${selector}`);
            }
        }

        if (!contentFilled) {
            console.log("❌ 無法填充內容框");
            await page.screenshot({ path: 'content_box_not_found.png', fullPage: true });
            throw new Error("找不到內容框");
        }

        // 拍下填充後的截圖
        await page.screenshot({ path: 'after_fill.png', fullPage: true });
        console.log("✅ 已保存填充後的截圖");

        // 7. 尋找並點擊發布按鈕
        console.log("正在尋找發布按鈕...");
        const publishSelectors = [
            'button:has-text("發布")',
            'button:has-text("Publish")',
            'button:has-text("Share")',
            'button[type="submit"]',
            'button[class*="primary"]',
        ];

        let published = false;
        for (const selector of publishSelectors) {
            try {
                const publishBtn = page.locator(selector).first();
                if (await publishBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    console.log(`✅ 找到發布按鈕: ${selector}`);
                    await publishBtn.scrollIntoViewIfNeeded();
                    await publishBtn.click({ force: true });
                    published = true;
                    await page.waitForTimeout(5000);
                    break;
                }
            } catch (e) {
                console.log(`⚠️ 選擇器失敗: ${selector}`);
            }
        }

        // 拍下最終結果截圖
        await page.screenshot({ path: 'final_result.png', fullPage: true });
        console.log("✅ 已保存最終結果截圖");

        if (published) {
            console.log("🎉 任務完成！自動貼文已成功發布。");
        } else {
            console.log("⚠️ 無法找到發布按鈕，請查看 final_result.png");
        }

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        // 如果失敗，拍下全頁截圖供參考
        await page.screenshot({ path: 'error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
