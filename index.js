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

        // 3. 繞道發文：先進入俱樂部首頁
        console.log("正在前往俱樂部首頁...");
        await page.goto('https://www.strava.com/clubs/2090529', { waitUntil: 'networkidle' });

        // 4. 模擬真人點擊「Posts」頁籤
        console.log("正在尋找並點擊『Posts』頁籤...");
        const postsTab = page.locator('a').filter({ hasText: /^Posts/i }).first();
        await postsTab.scrollIntoViewIfNeeded();
        await postsTab.click({ force: true });
        await page.waitForTimeout(3000);

        // 5. 點擊發文按鈕並填寫
        console.log("正在開啟發文框...");
        const createBtn = page.locator('a:has-text("Create a Post"), button:has-text("Create a Post"), .btn-primary:has-text("Post")').first();
        if (await createBtn.isVisible()) {
            await createBtn.click({ force: true });
            await page.waitForTimeout(2000);
        }

        const postBox = page.locator('textarea[name="post[text]"], [contenteditable="true"], .post-text-area').first();
        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        
        // 點擊並模擬打字 (對 Strava 的編輯器最穩定)
        await postBox.click();
        await page.keyboard.type(postContent);
        
        console.log("提交發布...");
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post")').first();
        await submitBtn.click({ force: true });

        await page.waitForTimeout(5000);
        console.log("🎉 任務完成！自動貼文已成功發布。");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        // 如果失敗，拍下全頁截圖供參考
        await page.screenshot({ path: 'final_error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
