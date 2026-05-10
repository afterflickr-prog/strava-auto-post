const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
    // 1. 處理並注入 Cookie
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
        console.error("Cookie 格式錯誤，請檢查 GitHub Secrets:", e);
        process.exit(1);
    }

    const page = await context.newPage();

    try {
        // 2. 進入排行榜頁面 (請更換 ID)
        console.log("正在獲取排行榜數據...");
        await page.goto('https://www.strava.com/clubs/2090529/leaderboard');
        
        // 等待排行榜表格載入
        await page.waitForSelector('.table-leaderboard');

        // 3. 抓取前三名數據
        const leaderboard = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.table-leaderboard tbody tr'));
            return rows.slice(0, 3).map((row, index) => {
                const name = row.querySelector('.athlete-name')?.innerText || "未知跑者";
                const distance = row.querySelector('.distance')?.innerText || "0 km";
                return `${index + 1}️⃣ ${name} - ${distance}`;
            }).join('\n');
        });

        // 4. 組合貼文內容
        const postContent = `【本週跑團結算】🏃‍♂️💨\n大家這週辛苦了！來看看本週戰績：\n\n🏆 本週里程 Top 3：\n${leaderboard}\n\n下週繼續加油！Keep Running! 💪`;
        console.log("產出貼文內容：\n", postContent);

        // 5. 前往 Club 首頁進行發布 (請更換 ID)
        await page.goto('https://www.strava.com/clubs/2090529');
        
        // 點擊發文輸入框並填入文字
        await page.waitForSelector('textarea[name="post[text]"]');
        await page.fill('textarea[name="post[text]"]', postContent);
        
        // 點擊發布按鈕
        console.log("正在點擊發布...");
        await page.click('button[type="submit"]');

        // 稍微等待確認發布完成
        await page.waitForTimeout(3000);
        console.log("✅ 貼文已成功發布！");

    } catch (err) {
        console.error("執行過程中發生錯誤:", err);
        // 如果報錯，截個圖存檔方便除錯
        await page.screenshot({ path: 'error_screenshot.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
