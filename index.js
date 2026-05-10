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
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });

        // 確保頁面內容加載
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(5000);

        // 💡 核心抓取邏輯：同時支援圖卡 (Cards) 與表格 (Table)
        const leaderboard = await page.evaluate(() => {
            // 1. 嘗試抓取週一凌晨出現的「摘要圖卡」
            const cards = Array.from(document.querySelectorAll('.leaderboard > .row .ranking'));
            if (cards.length > 0) {
                console.log("偵測到摘要圖卡格式");
                return cards.slice(0, 3).map((card, index) => {
                    const name = card.querySelector('.athlete-name')?.innerText.trim() || "未知";
                    const dist = card.querySelector('.distance')?.innerText.trim() || "0 km";
                    return `${index + 1}️⃣ ${name} - ${dist}`;
                }).join('\n');
            }

            // 2. 嘗試抓取週日深夜的「標準表格」
            const rows = Array.from(document.querySelectorAll('.table-leaderboard tbody tr'));
            if (rows.length > 0) {
                console.log("偵測到標準表格格式");
                return rows.slice(0, 3).map((row, index) => {
                    const name = row.querySelector('.athlete-name')?.innerText.trim() || "未知";
                    const dist = row.querySelector('.distance')?.innerText.trim() || "0 km";
                    return `${index + 1}️⃣ ${name} - ${dist}`;
                }).join('\n');
            }
            return null;
        });

        if (!leaderboard) {
            throw new Error("找不到任何排行榜數據 (圖卡或表格)");
        }

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 產出內容：\n", postContent);

        // --- 發布貼文部分 ---
        console.log("正在前往發文頁面...");
        await page.goto('https://www.strava.com/clubs/2090529/posts', { waitUntil: 'networkidle' });
        
        const postBox = page.locator('textarea[name="post[text]"], [contenteditable="true"]').first();
        if (!await postBox.isVisible()) {
            const createBtn = page.locator('button:has-text("Post"), a:has-text("Create a Post")').first();
            if (await createBtn.count() > 0) {
                await createBtn.click();
                await page.waitForTimeout(2000);
            }
        }

        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        await postBox.fill(postContent);
        
        console.log("提交貼文...");
        await page.click('button[type="submit"], button:has-text("Post")');

        await page.waitForTimeout(5000);
        console.log("🎉 終於大功告成！貼文已發布。");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
