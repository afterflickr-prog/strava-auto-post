const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 1200 },
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
        // 1. 前往排行榜頁面 (帶上上一週參數)
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面抓取數據...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });

        // 💡 強化：模擬多次捲動確保數據完全浮現
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.waitForTimeout(5000);

        // 💡 核心：地毯式搜索數據
        const leaderboard = await page.evaluate(() => {
            // 抓取所有可能包含人名和距離的區塊
            // 在週一凌晨的圖卡模式中，人名通常在 .athlete-name，距離在 .distance
            const names = Array.from(document.querySelectorAll('.athlete-name'));
            const dists = Array.from(document.querySelectorAll('.distance'));
            
            if (names.length === 0) return null;

            // 我們只需要前三個數據
            let results = [];
            for (let i = 0; i < Math.min(3, names.length); i++) {
                const nameText = names[i].innerText.trim().split('\n')[0];
                const distText = dists[i] ? dists[i].innerText.trim() : "0 km";
                results.push(`${i + 1}️⃣ ${nameText} - ${distText}`);
            }
            return results.join('\n');
        });

        if (!leaderboard || leaderboard.trim() === "") {
            throw new Error("地毯式搜索依然找不到數據，可能頁面加載失敗。");
        }

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 成功抓取內容：\n", postContent);

        // 2. 前往發布
        console.log("正在前往發文頁面...");
        await page.goto('https://www.strava.com/clubs/2090529/posts', { waitUntil: 'networkidle' });
        
        // 尋找發文框
        const postBox = page.locator('textarea[name="post[text]"], [contenteditable="true"], textarea.form-control').first();
        if (!await postBox.isVisible()) {
            const createBtn = page.locator('button:has-text("Post"), a:has-text("Create a Post")').first();
            if (await createBtn.count() > 0) {
                await createBtn.click();
                await page.waitForTimeout(2000);
            }
        }

        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        await postBox.fill(postContent);
        
        console.log("正在提交發布...");
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post"), .btn-primary:has-text("Post")').first();
        await submitBtn.click();

        await page.waitForTimeout(5000);
        console.log("🎉 成功！機器人已完成本週任務！");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
