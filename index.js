const { chromium } = require('playwright');

// 💡 計算目前是今年的「第幾週」
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
}

(async () => {
    const browser = await chromium.launch({ headless: true });
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
        // 1. 前往排行榜頁面
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        const leaderboardUrl = 'https://www.strava.com/clubs/2090529/leaderboard';
        console.log("正在前往排行榜頁面...");
        await page.goto(leaderboardUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        // 👇👇👇 加上這段「Cookie 失效偵測器」 👇👇👇
        if (page.url().includes('login')) {
            console.error("🚨 嚴重錯誤：機器人被強制導向登入頁面！");
            throw new Error("🍪 Strava Cookie 已過期失效！請重新登入 Strava，複製最新的 Cookie 並更新至 GitHub Secrets。");
        }
        // 👆👆👆 ============================== 👆👆👆

        await page.evaluate(() => window.scrollBy(0, 600));
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(5000);

        // 💡 關鍵邏輯：檢查目前的 Rank 表格是不是空的 ("There are no results.")
        const isEmpty = await page.evaluate(() => {
            return document.body.innerText.includes('There are no results');
        });

        if (isEmpty) {
            console.log("⚠️ 發現本週表格暫無紀錄，正在點擊『Last Week』按鈕切換至上週數據...");
            // 點擊 Last Week 按鈕來載入上週那 10 個人的排名
            const lastWeekBtn = page.locator('text="Last Week"').last();
            if (await lastWeekBtn.isVisible()) {
                await lastWeekBtn.click();
                await page.waitForTimeout(4000); // 等待表格 AJAX 重新載入
            }
        }

        // 2. 精準抓取帶有 Rank 的表格數據
        const leaderboard = await page.evaluate(() => {
            let data = [];
            
            // 尋找表頭包含 Rank 或 Athlete 的目標表格
            const tables = Array.from(document.querySelectorAll('table'));
            const targetTable = tables.find(table => {
                const header = table.querySelector('thead');
                return header && (header.innerText.includes('Rank') || header.innerText.includes('Athlete'));
            }) || document.querySelector('.table-leaderboard');

            if (targetTable) {
                console.log("✅ 成功鎖定 Rank 排行榜表格");
                const rows = targetTable.querySelectorAll('tbody tr');
                
                rows.forEach(row => {
                    // 略過 "There are no results" 的空行
                    if (row.innerText.includes('There are no results')) return;

                    // Rank 表格通常：td[0]是排名, td[1]是名字, td[2]是距離
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 3) {
                        const name = cells[1].innerText.trim().split('\n')[0];
                        const dist = cells[2].innerText.trim();

                        if (name && dist && dist.includes('km')) {
                            data.push({ name, dist });
                        }
                    }
                });
            }

            if (data.length === 0) {
                return "本週大家都還在休息中，暫無里程紀錄！🛌💤";
            }

            // 去重並取前 10 名
            const seen = new Set();
            const uniqueData = data.filter(item => {
                if (seen.has(item.name)) return false;
                seen.add(item.name);
                return true;
            });

            // 💡 這裡改為 slice(0, 10)，抓取前 10 名
            return uniqueData.slice(0, 10).map((item, index) => {
                // 給前三名獎牌，其餘顯示數字
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `🔹 ${index + 1}.`;
                return `${medal} ${item.name} - ${item.dist}`;
            }).join('\n');
        });

        // 3. 標題與內文組成
        const currentYear = new Date().getFullYear();
        // 如果現在是週一且表格是空的，代表我們點了「Last Week」，週數理應 -1 才精準
        let currentWeek = getWeekNumber(new Date()); 
        if (isEmpty) currentWeek -= 1; 

        const postTitle = `【夜繽Run ${currentYear} 第 ${currentWeek} 週戰報】🏃‍♂️💨`;
        
        // 內文改為 Top 10
        const postContent = `${postTitle}\n大家這週辛苦了！戰績如下：\n\n🏆 里程 Top 10：\n${leaderboard}\n\n繼續努力，Keep Running! 💪\n\n#夜繽Run #跑步 #Strava`;
        
        console.log("✅ 成功產出內容：\n", postContent);

        // 4. 前往發文
        const newPostUrl = 'https://www.strava.com/clubs/2090529/posts/new';
        console.log("正在前往新發文頁面...");
        await page.goto(newPostUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(8000); 

        // 填充標題
        const titleSelectors = ['input[placeholder*="標題"]', 'input[placeholder*="Title"]', 'input[type="text"]'];
        for (const selector of titleSelectors) {
            try {
                const titleInput = page.locator(selector).first();
                if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await titleInput.fill(postTitle);
                    await page.waitForTimeout(500);
                    break;
                }
            } catch (e) {}
        }

        // 填充內容
        const contentSelectors = ['textarea[placeholder*="新鮮"]', 'textarea[placeholder*="Fresh"]', 'textarea[placeholder*="想"]', 'textarea:last-of-type', 'textarea'];
        let contentFilled = false;
        for (const selector of contentSelectors) {
            try {
                const contentBox = page.locator(selector).first();
                if (await contentBox.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await contentBox.scrollIntoViewIfNeeded();
                    await contentBox.click();
                    await page.waitForTimeout(500);
                    await contentBox.fill(postContent);
                    contentFilled = true;
                    await page.waitForTimeout(1000);
                    break;
                }
            } catch (e) {}
        }

        if (!contentFilled) throw new Error("找不到內容框");

        // 發布
        const publishSelectors = ['button:has-text("發布")', 'button:has-text("Publish")', 'button:has-text("Share")', 'button[type="submit"]', 'button[class*="primary"]'];
        for (const selector of publishSelectors) {
            try {
                const publishBtn = page.locator(selector).first();
                if (await publishBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await publishBtn.scrollIntoViewIfNeeded();
                    await publishBtn.click({ force: true });
                    await page.waitForTimeout(5000);
                    break;
                }
            } catch (e) {}
        }

        console.log("🎉 任務完成！自動貼文已成功發布。");

    } catch (err) {
        console.error("❌ 執行失敗:", err.message);
        await page.screenshot({ path: 'error.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
