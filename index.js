const { chromium } = require('playwright');

(async () => {
    // 增加慢速模式模擬真人，並設定視窗大小
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
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
        // 前往上週排行榜
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在前往排行榜...");
        await page.goto(leaderboardUrl, { waitUntil: 'load', timeout: 60000 });

        // 💡 關鍵動作 1：模擬往下捲動，觸發 Strava 數據載入
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(5000); // 硬等 5 秒讓數據飛一會兒

        // 📸 截圖存檔 (這次看能不能拍到表格)
        await page.screenshot({ path: 'debug_page.png' });

        // 💡 關鍵動作 2：使用更靈活的等待方式
        console.log("正在等待排行榜表格...");
        const tableFound = await page.evaluate(() => {
            return !!document.querySelector('.table-leaderboard') || !!document.querySelector('table');
        });

        if (!tableFound) {
            console.log("⚠️ 沒看到 .table-leaderboard，嘗試等待 10 秒...");
            await page.waitForTimeout(10000);
        }

        // 抓取數據
        const leaderboard = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.table-leaderboard tbody tr, table tbody tr'));
            if (rows.length === 0) return null;
            
            return rows.slice(0, 3).map((row, index) => {
                const name = row.querySelector('.athlete-name, td:nth-child(2)')?.innerText.trim() || "未知跑者";
                const distance = row.querySelector('.distance, td:nth-child(3)')?.innerText.trim() || "0 km";
                return `${index + 1}️⃣ ${name} - ${distance}`;
            }).join('\n');
        });

        if (!leaderboard) {
            throw new Error("真的抓不到數據，可能這週沒人跑步或是頁面結構變了。");
        }

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n各位隊友辛苦了！上週戰績如下：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，Keep Running! 💪`;
        console.log("產出內容：\n", postContent);

        // 前往 Club 發文
        await page.goto('https://www.strava.com/clubs/2090529');
        await page.waitForSelector('textarea[name="post[text]"]', { timeout: 20000 });
        await page.fill('textarea[name="post[text]"]', postContent);
        
        console.log("正在點擊發布...");
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);
        console.log("✅ 恭喜！全自動發文成功！");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'error_screenshot.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
