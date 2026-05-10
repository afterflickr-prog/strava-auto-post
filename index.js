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
        await page.waitForTimeout(5000);

        const leaderboard = await page.evaluate(() => {
            // 嘗試多種可能的數據源 (圖卡或是表格)
            let items = Array.from(document.querySelectorAll('.ranking, .table-leaderboard tbody tr'));
            
            let data = [];
            items.forEach(el => {
                const nameText = el.querySelector('.athlete-name')?.innerText.trim().split('\n')[0];
                const distText = el.querySelector('.distance')?.innerText.trim();
                
                // 💡 數據清洗：排除掉標題文字，確保抓到的是真實人名與公里數
                if (nameText && distText && !["Distance", "Athlete", "Rank", "Time"].includes(nameText) && distText !== "Distance") {
                    data.push({ name: nameText, dist: distText });
                }
            });

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

        if (!leaderboard) throw new Error("抓不到排行榜數據");

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
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
