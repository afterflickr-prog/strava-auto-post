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
        // 1. 前往排行榜 (強制鎖定上週)
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        // 模擬滾動確保內容跑出來
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(5000);

        // 💡 終極抓取邏輯：全網頁掃描
        const leaderboard = await page.evaluate(() => {
            const results = [];
            // 找出所有看起來像里程的文字 (例如 "40.1 km")
            const allElements = Array.from(document.querySelectorAll('.athlete-name, .distance, td, div'));
            
            // 遍歷頁面尋找人名和里程的配對
            const athletes = Array.from(document.querySelectorAll('.athlete-name'));
            const distances = Array.from(document.querySelectorAll('.distance'));
            
            for (let i = 0; i < athletes.length; i++) {
                const name = athletes[i].innerText.trim().split('\n')[0];
                const dist = distances[i] ? distances[i].innerText.trim() : "";
                
                // 排除標題字眼並確保有里程數據
                if (name && dist && !["Distance", "Athlete", "Rank", "Time"].includes(name) && dist.includes('km')) {
                    results.push({ name, dist });
                }
            }

            // 移除重複並取前三
            const seen = new Set();
            const finalData = [];
            for (const item of results) {
                if (!seen.has(item.name)) {
                    seen.add(item.name);
                    finalData.push(item);
                }
            }
            return finalData.slice(0, 3).map((it, idx) => `${idx + 1}️⃣ ${it.name} - ${it.dist}`).join('\n');
        });

        if (!leaderboard || leaderboard === "") {
            throw new Error("抓不到排行榜數據，可能是頁面結構大幅改變。");
        }

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n各位隊友辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 成功抓取數據：\n", postContent);

        // 2. 繞道發文：先去首頁，再點頁籤 (避開 404)
        console.log("正在前往俱樂部主頁...");
        await page.goto('https://www.strava.com/clubs/2090529', { waitUntil: 'networkidle' });

        console.log("切換至 Posts 頁籤...");
        const postsTab = page.locator('nav a, .club-tabs a').filter({ hasText: /Posts/i }).first();
        await postsTab.click({ force: true });
        await page.waitForTimeout(3000);

        // 3. 填寫並發布
        console.log("尋找發文框...");
        const createBtn = page.locator('a:has-text("Create a Post"), button:has-text("Create a Post")').first();
        if (await createBtn.isVisible()) {
            await createBtn.click({ force: true });
            await page.waitForTimeout(2000);
        }

        const postBox = page.locator('textarea[name="post[text]"], [contenteditable="true"]').first();
        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        await postBox.click();
        await page.keyboard.type(postContent);
        
        console.log("提交發布...");
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post")').first();
        await submitBtn.click({ force: true });

        await page.waitForTimeout(5000);
        console.log("🎉 終於成功了！全自動發文已完成。");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'debug_error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
