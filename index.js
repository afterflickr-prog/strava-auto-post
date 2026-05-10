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
        // 1. 抓取排行榜 ( week_offset=-1 )
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.waitForTimeout(5000);

        const leaderboard = await page.evaluate(() => {
            const names = Array.from(document.querySelectorAll('.athlete-name'));
            const dists = Array.from(document.querySelectorAll('.distance'));
            
            let data = [];
            for (let i = 0; i < names.length; i++) {
                const nameText = names[i].innerText.trim();
                const distText = dists[i] ? dists[i].innerText.trim() : "0 km";
                
                // 💡 數據清洗：徹底排除 "Distance" 等標題
                if (nameText && !["Distance", "Athlete", "Rank", "Time"].includes(nameText) && distText !== "Distance") {
                    data.push(`${nameText} - ${distText}`);
                }
            }
            // 去重並取前三
            return [...new Set(data)].slice(0, 3).map((item, index) => `${index + 1}️⃣ ${item}`).join('\n');
        });

        if (!leaderboard) throw new Error("抓不到排行榜數據");

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 成功產出內容：\n", postContent);

        // --- 2. 核心邏輯：先按 Post 頁籤 ---
        console.log("正在前往俱樂部主頁...");
        await page.goto('https://www.strava.com/clubs/2090529', { waitUntil: 'networkidle' });

        console.log("正在尋找並點擊『Posts』頁籤...");
        const postsTab = page.locator('nav a, .club-tabs a').filter({ hasText: /Posts/i }).first();
        await postsTab.waitFor({ state: 'visible' });
        await postsTab.click({ force: true });
        await page.waitForTimeout(3000); // 等待分頁切換完成

        // --- 3. 再按 Create a Post 按鈕 ---
        console.log("正在點擊『Create a Post』按鈕...");
        const createBtn = page.locator('a:has-text("Create a Post"), button:has-text("Create a Post"), .btn-primary:has-text("Post")').first();
        await createBtn.scrollIntoViewIfNeeded();
        await createBtn.click({ force: true });
        
        // 4. 填寫並發布
        console.log("等待輸入框出現...");
        const postBox = page.locator('textarea[name="post[text]"], [contenteditable="true"], .post-text-area').first();
        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        
        // 點擊並模擬鍵盤輸入 (這對 Strava 的編輯器比較有效)
        await postBox.click();
        await page.keyboard.type(postContent);
        
        console.log("提交發布...");
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post")').first();
        await submitBtn.click({ force: true });

        await page.waitForTimeout(5000);
        console.log("🎉 終於大功告成！全自動發文已成功送到 Strava Club！");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'final_error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
