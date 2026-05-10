const { chromium } = require('playwright');

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
        // 1. 抓取排行榜 ( week_offset=-1 鎖定上週)
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面抓取數據...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(5000);

        const leaderboard = await page.evaluate(() => {
            // 💡 強化數據清洗：過濾掉表格標題字眼
            const rows = Array.from(document.querySelectorAll('.table-leaderboard tbody tr, .leaderboard .ranking'));
            let results = [];
            
            rows.forEach(row => {
                const name = row.querySelector('.athlete-name')?.innerText.trim().split('\n')[0];
                const dist = row.querySelector('.distance')?.innerText.trim();
                
                // 排除 "Distance"、"Athlete" 等標題，且必須有里程數據
                if (name && dist && !["Distance", "Athlete", "Rank"].includes(name) && dist !== "Distance") {
                    results.push({ name, dist });
                }
            });

            // 去重並取前三
            const unique = [];
            const seen = new Set();
            for (const item of results) {
                if (!seen.has(item.name)) {
                    seen.add(item.name);
                    unique.push(item);
                }
            }

            return unique.slice(0, 3).map((item, index) => `${index + 1}️⃣ ${item.name} - ${item.dist}`).join('\n');
        });

        if (!leaderboard) throw new Error("抓不到排行榜數據，請確認頁面是否有數據。");

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 成功產出內容：\n", postContent);

        // 2. 前往俱樂部主頁 (避免直接去 /posts 導致 404)
        console.log("正在前往俱樂部首頁...");
        await page.goto('https://www.strava.com/clubs/2090529', { waitUntil: 'networkidle' });

        // 3. 點擊「Posts」頁籤 (使用模糊匹配，因為可能帶有 "Posts 1 NEW" 等字眼)
        console.log("尋找並點擊 Posts 頁籤...");
        const postsTab = page.locator('nav.club-nav a, .club-tabs a').filter({ hasText: /Posts/i }).first();
        await postsTab.scrollIntoViewIfNeeded();
        await postsTab.click({ force: true });
        await page.waitForTimeout(3000);

        // 4. 點擊發文按鈕並填寫
        console.log("尋找發文框...");
        const createBtn = page.locator('a:has-text("Create a Post"), button:has-text("Create a Post")').first();
        if (await createBtn.isVisible()) {
            await createBtn.click({ force: true });
            await page.waitForTimeout(2000);
        }

        const postBox = page.locator('textarea[name="post[text]"], [contenteditable="true"], .post-text-area').first();
        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        
        // 嘗試填寫內容
        await postBox.click();
        await page.keyboard.type(postContent);
        
        console.log("正在提交...");
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post")').first();
        await submitBtn.click({ force: true });

        await page.waitForTimeout(5000);
        console.log("🎉 終於大功告成了！自動發文任務已圓滿完成！");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'final_error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
