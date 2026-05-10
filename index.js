const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    // 設定較大的視窗，確保所有按鈕都能正常渲染
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
        // 1. 抓取排行榜
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面抓取數據...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(5000);

        const leaderboard = await page.evaluate(() => {
            // 抓取所有可能的人名和里程
            const nameElements = Array.from(document.querySelectorAll('.athlete-name'));
            const distElements = Array.from(document.querySelectorAll('.distance'));
            
            let data = [];
            for (let i = 0; i < nameElements.length; i++) {
                const name = nameElements[i].innerText.trim();
                const dist = distElements[i] ? distElements[i].innerText.trim() : "0 km";
                // 💡 關鍵：過濾掉無用的字眼
                if (name && name !== "Distance" && name !== "Athlete" && name !== "Rank") {
                    data.push({ name, dist });
                }
            }
            
            // 排除重複並取前三
            return data.slice(0, 3).map((item, index) => {
                return `${index + 1}️⃣ ${item.name} - ${item.dist}`;
            }).join('\n');
        });

        if (!leaderboard) throw new Error("抓不到排行榜數據");

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 產出內容：\n", postContent);

        // 2. 前往發文 (嘗試多種路徑)
        console.log("正在前往發文頁面...");
        await page.goto('https://www.strava.com/clubs/2090529/posts', { waitUntil: 'networkidle' });

        // 💡 暴力發文邏輯：先看有沒有輸入框，沒有就嘗試點按鈕
        const postBoxSelector = 'textarea[name="post[text]"], [contenteditable="true"], .post-text-area';
        let postBox = page.locator(postBoxSelector).first();

        if (!(await postBox.isVisible())) {
            console.log("嘗試強制觸發『Create a Post』按鈕...");
            // 嘗試所有可能的按鈕選取器
            const btns = page.locator('a:has-text("Create a Post"), button:has-text("Create a Post"), .btn-primary:has-text("Post"), .btn:has-text("Post")');
            if (await btns.count() > 0) {
                await btns.first().click({ force: true });
                await page.waitForTimeout(3000);
            }
        }

        // 再次檢查輸入框是否出現
        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        await postBox.fill(postContent);
        
        console.log("正在提交發布...");
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post"), input[type="submit"]').first();
        await submitBtn.click({ force: true });

        await page.waitForTimeout(5000);
        console.log("🎉 終於大功告成！全自動發文已成功送到 Strava Club！");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'final_check.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
