const { chromium } = require('playwright');

(async () => {
    // 啟動無頭瀏覽器
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
    // 從 GitHub Secret 讀取 Cookie 並注入瀏覽器
    const cookies = JSON.parse(process.env.STRAVA_COOKIES);
    await context.addCookies(cookies);

    const page = await context.newPage();
    
    // 以下就是我們之後要寫的「抓取排行榜」與「發布貼文」的邏輯...
    console.log("成功注入 Cookie，準備前往 Strava...");
    await page.goto('https://www.strava.com/dashboard');
    
    // 截圖確認是否真的登入成功 (除錯用)
    await page.screenshot({ path: 'test.png' });

    await browser.close();
})();