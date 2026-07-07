require('dotenv').config();
const puppeteer = require('puppeteer');
const mysql = require('mysql2/promise');
const { URL } = require('url');

const BATCH_SIZE = 2; 
const CURRENT_FILTER = 'week'; 
const CUSTOM_DATE_RANGE = { start: '01/01/2026', end: '06/30/2026' }; 

const DB_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));
// Change this temporarily to give yourself a 80-second window to solve the CAPTCHA
const randomDelay = () => delay(120000);

function buildGoogleUrl(keyword, filter) {
  const encodedKeyword = encodeURIComponent(keyword);
  let url = `https://www.google.com/search?q=${encodedKeyword}`;
  switch (filter) {
    case '24h': url += '&tbs=qdr:d'; break;
    case 'week': url += '&tbs=qdr:w'; break;
    case 'month': url += '&tbs=qdr:m'; break;
    case 'year': url += '&tbs=qdr:y'; break;
    case 'custom': url += `&tbs=cdr:1,cd_min:${CUSTOM_DATE_RANGE.start},cd_max:${CUSTOM_DATE_RANGE.end}`; break;
    default: break; 
  }
  return url;
}

async function startScrapingEngine() {
  const pool = await mysql.createPool(DB_CONFIG);
  
  console.log('Launching browser session (Visible Mode)...');
  const browser = await puppeteer.launch({
    headless: false, // ⚠️ Turned off so you can see exactly what Google loads!
    args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  try {
    const [keywords] = await pool.query(
      'SELECT id, keyword FROM keywords WHERE status = "pending" LIMIT ?', 
      [BATCH_SIZE]
    );

    if (keywords.length === 0) {
      console.log('No pending tracking items found. Exiting.');
      return;
    }

    console.log(`Acquired tracking targets: Found ${keywords.length} items to evaluate.`);

    for (const target of keywords) {
      console.log(`\n--------------------------------------------`);
      console.log(`Processing operational slot [ID: ${target.id}]: "${target.keyword}"`);
      
      await pool.query('UPDATE keywords SET status = "processing" WHERE id = ?', [target.id]);
      const searchUrl = buildGoogleUrl(target.keyword, CURRENT_FILTER);
      
      try {
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        await randomDelay();

        // Get the current page title to check for security blocks
        const pageTitle = await page.title();
        console.log(`Current Page Title: "${pageTitle}"`);

        // ==================================================
        // ULTIMATE FALLBACK: Grab all links, exclude Google
        // ==================================================
        const organicUrls = await page.evaluate(() => {
          const anchors = document.querySelectorAll('a');
          const results = [];
          
          anchors.forEach(anchor => {
            const href = anchor.getAttribute('href');
            if (!href) return;

            // Strict checklist to clean up and exclude Google's infrastructure footprints
            const isExternal = href.startsWith('http');
            const isGoogle = href.includes('google.com') || href.includes('google.co');
            const isSystem = href.includes('gstatic.com') || href.includes('youtube.com') || href.includes('schema.org');

            if (isExternal && !isGoogle && !isSystem) {
              results.push(href);
            }
          });
          return [...new Set(results)]; 
        });

        // Debugging snapshot if extraction turns up empty
        if (organicUrls.length === 0) {
          console.log(`⚠️ 0 links found. Saving verification snapshot to debug_google.png`);
          await page.screenshot({ path: 'debug_google.png' });
        }

        console.log(`Extracted ${organicUrls.length} organic links. Processing domains...`);

        for (const rawUrl of organicUrls) {
          try {
            const parsedUrl = new URL(rawUrl);
            const normalizedDomain = parsedUrl.hostname.replace('www.', '');

            await pool.query(
              `INSERT IGNORE INTO reported_domain(domain_name) 
               VALUES ( ?)`,
              [normalizedDomain]
            );
          } catch (urlErr) {
            continue;
          }
        }

        await pool.query('UPDATE keywords SET status = "completed" WHERE id = ?', [target.id]);
        console.log(`Finished processing keyword ID ${target.id}`);

      } catch (err) {
        console.error(`Execution fault detected on item [ID ${target.id}]:`, err.message);
        await pool.query('UPDATE keywords SET status = "failed" WHERE id = ?', [target.id]);
      }
    }

  } catch (globalError) {
    console.error('Fatal tracking crash encountered:', globalError);
  } finally {
    await browser.close();
    await pool.end();
    console.log('\nAll database and browser sessions closed clean.');
  }
}

startScrapingEngine();