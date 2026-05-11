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
            // 查找所有表格列表項（包括 Last Week's Leaders 和 This Week's Leaderboard）
            
            // 方法 1: 查找「Last Week's Leaders」區塊中的排行榜
            const lastWeekSection = document.querySelector('h3:contains("Last Week\'s Leaders")')?.parentElement;
            if (lastWeekSection) {
                const rows = lastWeekSection.querySelectorAll('div[class*="leader"], tr, [class*="leaderboard"]');
                rows.forEach(row => {
                    const nameEl = row.querySelector('[class*="name"], .athlete-name, a[href*="/athletes"]');
                    const distEl = row.querySelector('[class*="distance"], [class*="km"]');
                    
                    if (nameEl && distEl) {
                        const name = nameEl.innerText?.trim();
                        const dist = distEl.innerText?.trim();
                        if (name && dist && !name.includes("Distance") && !name.includes("Athlete")) {
                            data.push({ name, dist });
                        }
                    }
                });
            }
            
            // 方法 2: 更通用的查詢 - 直接查找包含排行數據的容器
            if (data.length === 0) {
                // 查找所有可能包含排行榜的容器
                const leaderboardContainers = document.querySelectorAll(
                    '[class*="leaderboard"], [class*="ranking"], tbody, [data-testid*="leaderboard"]'
                );
                
                leaderboardContainers.forEach(container => {
                    const rows = container.querySelectorAll('tr, [class*="row"], [class*="item"]');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td, [class*="cell"], [class*="value"]');
                        if (cells.length >= 2) {
                            // 通常結構是 [排名] [運動員名稱] [距離] 或類似
                            let nameText = '';
                            let distText = '';
                            
                            // 嘗試從多個位置提取
                            cells.forEach((cell, idx) => {
                                const text = cell.innerText?.trim();
                                if (text && text.match(/km|[0-9]+\.[0-9]/)) {
                                    distText = text;
                                }
                                if (text && !text.match(/^\d+$|km|Rank|Distance|Athlete|Time/) && !nameText) {
                                    nameText = text;
                                }
                            });
                            
                            // 也可以從連結提取名稱
                            const nameLink = row.querySelector('a[href*="/athletes"]');
                            if (nameLink) {
                                nameText = nameLink.innerText?.trim();
                            }
                            
                            if (nameText && distText && !["Distance", "Athlete", "Rank", "Time"].includes(nameText)) {
                                data.push({ name: nameText, dist: distText });
                            }
                        }
                    });
                });
            }
            
            // 方法 3: 最後的備選方案 - 查找所有包含運動員信息的 div
            if (data.length === 0) {
                // 查找所有帶有運動員頭像和信息的元素
                const athleteElements = document.querySelectorAll('[class*="athlete"], [class*="user"], [class*="member"]');
                athleteElements.forEach(el => {
                    const nameEl = el.querySelector('a, [class*="name"], strong');
                    const distEl = el.querySelector('[class*="distance"], [class*="km"], [class*="stat"]');
                    
                    if (nameEl && distEl) {
                        const name = nameEl.innerText?.trim();
                        const dist = distEl.innerText?.trim();
                        if (name && dist && name.length > 0 && dist.includes('km')) {
                            data.push({ name, dist });
                        }
                    }
                });
            }

            console.log(`Found ${data.length} leaderboard entries`);
            
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
