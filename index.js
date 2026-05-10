const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
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
        // 🚀 重點修改：加上 ?week_offset=-1 確保抓到的是「剛結束的那一週」數據
        // 這樣即使在週日深夜或週一凌晨執行，數據都不會變空白
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard?week_offset=-1';
        console.log("正在獲取上週排行榜數據...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle' });

        // 拍照存檔
        await page.screenshot({ path: 'debug_page.png' });

        // 等待表格出現
        await page.waitForSelector('.table-leaderboard', { timeout: 15000 });

        const leaderboard = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.table-leaderboard tbody tr'));
            return rows.slice(0, 3).map((row, index) => {
                const name = row.querySelector('.athlete-name')?.innerText || "未知跑者";
                const distance = row.querySelector('.distance')?.innerText || "0 km";
                return `${index + 1}️⃣ ${name} - ${distance}`;
            }).join('\n');
        });

        const postContent = `【夜繽Run 本週戰報】🏃‍♂️💨\n各位隊友辛苦了！上週大家表現非常出色：\n\n🏆 里程 Top 3：\n${leaderboard}\n\n下週繼續努力，大家加油！💪`;
        console.log("擬稿內容：\n", postContent);

        // 前往 Club 發文
        await page.goto('https://www.strava.com/clubs/2090529');
        await page.waitForSelector('textarea[name="post[text]"]');
        await page.fill('textarea[name="post[text]"]', postContent);
        
        console.log("正在發布貼文...");
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);
        console.log("✅ 全自動發文完成！");

    } catch (err) {
        console.error("執行失敗:", err);
        await page.screenshot({ path: 'error_screenshot.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
