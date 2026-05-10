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
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.waitForTimeout(5000);

        const leaderboard = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.athlete-name'));
            const distances = Array.from(document.querySelectorAll('.distance'));
            
            // 過濾掉非人名的標題字眼，例如 "Distance"
            const filtered = items
                .map((el, i) => {
                    const name = el.innerText.trim();
                    const dist = distances[i] ? distances[i].innerText.trim() : "0 km";
                    return { name, dist };
                })
                .filter(item => item.name !== "Distance" && item.name !== "" && item.name !== "Athlete");

            return filtered.slice(0, 3).map((item, index) => {
                return `${index + 1}️⃣ ${item.name} - ${item.dist}`;
            }).join('\n');
        });

        if (!leaderboard) throw new Error("抓不到排行榜數據");

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n大家這週辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 成功產出內容：\n", postContent);

        // --- 發布貼文優化版 ---
        console.log("正在前往發文頁面...");
        await page.goto('https://www.strava.com/clubs/2090529/posts', { waitUntil: 'networkidle' });

        // 💡 關鍵：強制點擊「Create a Post」按鈕讓輸入框出現
        console.log("嘗試點擊『Create a Post』按鈕...");
        const createBtn = page.locator('a:has-text("Create a Post"), button:has-text("Create a Post"), .btn-primary:has-text("Post")').first();
        await createBtn.click();
        
        // 等待輸入框出現 (Strava 點擊後通常會有動畫，等一下下)
        console.log("等待輸入框...");
        const postBox = page.locator('textarea[name="post[text]"], [contenteditable="true"]').first();
        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        await postBox.fill(postContent);
        
        console.log("提交發布...");
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post")').first();
        await submitBtn.click();

        await page.waitForTimeout(5000);
        console.log("🎉 終於大功告成！全自動發文已成功！");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'final_error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
