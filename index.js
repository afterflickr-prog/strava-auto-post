const { chromium } = require('playwright');

(async () => {
    // 1. 啟動瀏覽器 (模擬桌機解析度)
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 1000 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    // 2. 處理並注入 Cookie
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
        console.error("❌ Cookie 載入失敗，請檢查 GitHub Secrets 是否正確");
        process.exit(1);
    }

    const page = await context.newPage();

    try {
        // 3. 獲取上週排行榜數據 (ID: 2090529)
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜頁面抓取數據...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle' });

        // 稍微捲動確保數據加載
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(3000);

        // 抓取前三名
        const leaderboard = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.table-leaderboard tbody tr'));
            if (rows.length === 0) return null;
            return rows.slice(0, 3).map((row, index) => {
                const name = row.querySelector('.athlete-name')?.innerText.trim() || "未知跑者";
                const distance = row.querySelector('.distance')?.innerText.trim() || "0 km";
                return `${index + 1}️⃣ ${name} - ${distance}`;
            }).join('\n');
        });

        if (!leaderboard) {
            throw new Error("抓不到排行榜數據，請確認該週是否有跑步紀錄。");
        }

        // 組合貼文內容
        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n各位隊友辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("✅ 成功生成貼文內容：\n", postContent);

        // 4. 前往俱樂部發布貼文
        console.log("正在前往俱樂部發文頁面...");
        await page.goto('https://www.strava.com/clubs/2090529/posts', { waitUntil: 'networkidle' });

        // 💡 策略：如果沒看到輸入框，嘗試點擊「Create a Post」按鈕
        const textareaSelector = 'textarea[name="post[text]"], textarea.form-control, [contenteditable="true"]';
        
        const isVisible = await page.isVisible(textareaSelector);
        if (!isVisible) {
            console.log("未直接發現輸入框，嘗試尋找『Create a Post』按鈕...");
            const createBtn = page.locator('button:has-text("Create a Post"), a:has-text("Create a Post"), .btn-primary:has-text("Post")').first();
            if (await createBtn.count() > 0) {
                await createBtn.click();
                console.log("已點擊 Create a Post 按鈕");
                await page.waitForTimeout(2000);
            }
        }

        // 5. 填寫並發布
        console.log("正在填寫內容...");
        const postBox = page.locator(textareaSelector).first();
        await postBox.waitFor({ state: 'visible', timeout: 15000 });
        await postBox.fill(postContent);

        console.log("正在點擊發布按鈕...");
        // 定位發布按鈕 (可能會是 Post 或 Submit)
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post"), .btn-primary:has-text("Post")').first();
        await submitBtn.click();

        // 6. 完工確認
        await page.waitForTimeout(5000);
        console.log("🎉 任務完成！貼文已成功發布到 Strava。");

    } catch (err) {
        console.error("❌ 執行出錯:", err.message);
        // 出錯時截圖，方便你檢查是卡在哪個畫面
        await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
