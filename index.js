const { chromium } = require('playwright');

// 💡 計算目前是今年的「第幾週」的函式
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
}

(async () => {
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
        // 1. 星期日 23:31 執行，抓取當前排行榜 (無 week_offset)
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(8000);

        await page.screenshot({ path: 'leaderboard_debug.png', fullPage: true });
        console.log("✅ 已保存調試截圖 leaderboard_debug.png");

        const leaderboard = await page.evaluate(() => {
            let data = [];
            
            // 🎯 方法 1：因為是週日晚上，直接抓取標準的 .table-leaderboard
            console.log("嘗試方法 1: 抓取標準排行榜表格...");
            const tables = document.querySelectorAll('.table-leaderboard, table');
            
            tables.forEach(table => {
                const rows = table.querySelectorAll('tbody tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length >= 2) {
                        let name = '';
                        let dist = '';
                        
                        cells.forEach(cell => {
                            const text = cell.innerText?.trim();
                            const link = cell.querySelector('a[href*="/athletes/"]');
                            if (link) name = link.innerText?.trim() || '';
                            if (text && text.match(/\d+\.?\d*\s*km/i)) dist = text;
                        });
                        
                        if (!name && cells.length > 0) {
                            name = cells[1]?.innerText?.trim() || cells[0]?.innerText?.trim() || '';
                        }
                        
                        if (name && dist && !name.match(/^(\d+|Rank|Distance|Athlete|Time|Elevation Gain)$/i)) {
                            data.push({ name, dist });
                        }
                    }
                });
            });

            // 🎯 方法 2：備用盲搜 (保留你最愛的地毯式搜索)
            if (data.length === 0) {
                console.log("⚠️ 方法 1 失敗，啟動地毯式盲搜...");
                const kmElements = Array.from(document.querySelectorAll('*')).filter(el => 
                    el.innerText && el.innerText.match(/\d+\.?\d*\s*km/i) && el.children.length === 0
                );
                
                kmElements.slice(0, 10).forEach(el => {
                    const parentRow = el.closest('tr, [class*="row"], [class*="item"]');
                    if (parentRow) {
                        const nameEl = parentRow.querySelector('a, [class*="name"]');
                        if (nameEl) {
                            data.push({ name: nameEl.innerText?.trim() || '', dist: el.innerText?.trim() || '' });
                        }
                    }
                });
            }

            console.log(`共找到 ${data.length} 筆資料`);
            
            // 去重並取前三
            const seen = new Set();
            return data.filter(item => {
                if (seen.has(item.name)) return false;
                seen.add(item.name);
                return true;
            }).slice(0, 3).map((item, index) => `${index + 1}️⃣ ${item.name} - ${item.dist}`).join('\n');
        });

        if (!leaderboard || leaderboard.trim() === '') {
            throw new Error("抓不到排行榜數據");
        }

        // 💡 計算週數並生成標題
        const currentYear = new Date().getFullYear();
        const currentWeek = getWeekNumber(new Date());
        const postTitle = `【夜繽Run ${currentYear} 第 ${currentWeek} 週戰報】🏃‍♂️💨`;
        const postContent = `${postTitle}\n大家這週辛苦了！本週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪\n\n#夜繽Run #跑步 #Strava`;
        
        console.log("✅ 成功產出內容：\n", postContent);

        // 3. 前往新發文頁面 (保留你的跳轉與完整截圖邏輯)
        const newPostUrl = 'https://www.strava.com/clubs/2090529/posts/new';
        console.log("正在前往新發文頁面...");
        await page.goto(newPostUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(8000); 

        await page.screenshot({ path: 'new_post_page.png', fullPage: true });
        console.log("✅ 已保存新發文頁面截圖");

        // 4. 填充標題 (保留你的輪詢測試)
        console.log("正在填充標題...");
        const titleSelectors = ['input[placeholder*="標題"]', 'input[placeholder*="Title"]', 'input[type="text"]'];
        for (const selector of titleSelectors) {
            try {
                const titleInput = page.locator(selector).first();
                if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await titleInput.fill(postTitle); // 填入動態標題
                    await page.waitForTimeout(500);
                    break;
                }
            } catch (e) {}
        }

        // 5. 填充內容
        console.log("正在填充內容框...");
        const contentSelectors = ['textarea[placeholder*="新鮮"]', 'textarea[placeholder*="Fresh"]', 'textarea[placeholder*="想"]', 'textarea:last-of-type', 'textarea'];
        let contentFilled = false;
        for (const selector of contentSelectors) {
            try {
                const contentBox = page.locator(selector).first();
                if (await contentBox.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await contentBox.scrollIntoViewIfNeeded();
                    await contentBox.click();
                    await page.waitForTimeout(500);
                    await contentBox.fill(postContent); // 填入完整內文
                    contentFilled = true;
                    await page.waitForTimeout(1000);
                    break;
                }
            } catch (e) {}
        }

        if (!contentFilled) {
            await page.screenshot({ path: 'content_box_not_found.png', fullPage: true });
            throw new Error("找不到內容框");
        }

        await page.screenshot({ path: 'after_fill.png', fullPage: true });

        // 6. 尋找並點擊發布按鈕
        console.log("正在尋找發布按鈕...");
        const publishSelectors = ['button:has-text("發布")', 'button:has-text("Publish")', 'button:has-text("Share")', 'button[type="submit"]', 'button[class*="primary"]'];
        let published = false;
        for (const selector of publishSelectors) {
            try {
                const publishBtn = page.locator(selector).first();
                if (await publishBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await publishBtn.scrollIntoViewIfNeeded();
                    await publishBtn.click({ force: true });
                    published = true;
                    await page.waitForTimeout(5000);
                    break;
                }
            } catch (e) {}
        }

        await page.screenshot({ path: 'final_result.png', fullPage: true });

        if (published) {
            console.log("🎉 任務完成！自動貼文已成功發布。");
        } else {
            console.log("⚠️ 無法找到發布按鈕，請查看 final_result.png");
        }

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
