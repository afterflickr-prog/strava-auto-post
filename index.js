const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 1000 },
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
        // 1. 抓取上週排行榜
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });

        // 💡 修改點：明確等待表格中的「行 (tr)」出現，而不只是等 3 秒
        console.log("等待排行榜數據加載...");
        await page.waitForSelector('.table-leaderboard tbody tr', { timeout: 30000 });

        // 稍微捲動一下觸發可能存在的懶加載
        await page.evaluate(() => window.scrollBy(0, 300));
        await page.waitForTimeout(2000);

        const leaderboard = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.table-leaderboard tbody tr'));
            return rows.slice(0, 3).map((row, index) => {
                // 優化選取器，確保抓到正確的文字
                const name = row.querySelector('.athlete-name')?.innerText.split('\n')[0].trim() || "未知跑者";
                const distance = row.querySelector('.distance')?.innerText.trim() || "0 km";
                return `${index + 1}️⃣ ${name} - ${distance}`;
            }).join('\n');
        });

        if (!leaderboard || leaderboard.includes("未知跑者 - 0 km")) {
            throw new Error("抓取到的數據不完整，請檢查頁面結構。");
        }

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 成功生成貼文：\n", postContent);

        // 2. 前往發文
        console.log("正在前往發文頁面...");
        await page.goto('https://www.strava.com/clubs/2090529/posts', { waitUntil: 'networkidle' });

        // 尋找發文框 (嘗試多種可能的定位)
        const postBox = page.locator('textarea[name="post[text]"], [contenteditable="true"], textarea.form-control').first();
        
        // 如果沒看到輸入框，試著點「Create a Post」
        if (!await postBox.isVisible()) {
            const createBtn = page.locator('text="Create a Post", .btn-primary:has-text("Post")').first();
            if (await createBtn.count() > 0) {
                await createBtn.click();
                await page.waitForTimeout(2000);
            }
        }

        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        await postBox.fill(postContent);
        
        console.log("提交貼文...");
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post")').first();
        await submitBtn.click();

        await page.waitForTimeout(5000);
        console.log("🎉 任務完全成功！");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        // 失敗時截圖，這張圖會非常重要
        await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
