const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') }); 
const mysql = require('mysql2/promise');
const { getJson } = require('serpapi'); // Official SerpApi Client Library
const fs = require('fs');


// --- PIPELINE CONFIGURATION (GOOGLE PARAMETERS) ---
const PAGES_TO_SCRAPE_PER_RUN = 6; // Max page depth per execution loop
const RESULTS_PER_PAGE = 10;       // Google 'num' supports up to 100 entries

const DB_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

// Global File Logging Helper System
function logEvent(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const formattedLog = `[${timestamp}] ${message}\n`;
  console.log(message);
  fs.appendFileSync(path.join(__dirname, 'pipeline.log'), formattedLog, 'utf8');
}

// Helper utility to parse root hostnames out of raw search URLs
function normalizeDomain(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    let hostname = parsed.hostname.toLowerCase();

    // Split the hostname into an array of segments (e.g., "sub", "domain", "com")
    const parts = hostname.split('.');

    // Check if it's a multi-part country code TLD (like .co.uk, .com.in, .org.za)
    const isCcTld = parts.length > 2 && ['co', 'com', 'org', 'net', 'gov', 'edu'].includes(parts[parts.length - 2]);

    if (isCcTld) {
      // Keep the last 3 parts for regional domains (e.g., "piracysite.co.in")
      return parts.slice(-3).join('.');
    } else if (parts.length >= 2) {
      // Keep only the last 2 parts for standard domains (e.g., "piracysite.to")
      return parts.slice(-2).join('.');
    }

    return hostname;
  } catch (e) {
    return null;
  }
}

async function runGoogleSerpApiScraper() {
  logEvent('SYSTEM START: Initializing SerpApi Google Search Architecture...');
  
  if (!process.env.SERPAPI_KEY) {
    logEvent('CRITICAL ERROR: SERPAPI_KEY variable is missing from your .env configuration.');
    return;
  }

  const pool = await mysql.createPool(DB_CONFIG);

  try {
    // 1. Fetch pending search targets from the MySQL queue layout
    const [rows] = await pool.query("SELECT keyword FROM keywords WHERE status = 'pending' LIMIT 2");
    
    if (rows.length === 0) {
      logEvent('Database index clean. No pending search terms to look up.');
      return;
    }

    // 2. CONCATENATE KEYWORDS & INJECT EXCLUSIONS
    const keywordPhrases = rows.map(r => `"${r.keyword}"`);

    // Build your combined query as usual
    let combinedQuery = keywordPhrases.join(' OR ');

    // Append your structural target exclusions directly to the end of the search string
    const exclusions =  " -site:youtube.com -site:music.youtube.com -site:instagram.com -site:facebook.com -site:twitter.com -site:x.com -site:amazon.com -site:wikipedia.org -site:apple.com -site:music.apple.com -site:spotify.com -site:soundcloud.com -site:pinterest.com -site:gaana.com";
    combinedQuery += exclusions;
    console.log(`\n[DEBUG] Combined Query: ${combinedQuery}\n`);

    logEvent(`  Grouped keywords with native search exclusions: [ ${combinedQuery} ]`);

    // Lock rows in the DB queue right away
    await pool.query("UPDATE keywords SET status = 'processing' WHERE keyword IN (?)", [keywordPhrases]);

    // 3. EXECUTE ENGINE WITH PAGE TRACKING COUNTER
    let pageCounter = 1; 
    let currentResultOffset = 0; // Google index starts row offsets at 0

    while (pageCounter <= PAGES_TO_SCRAPE_PER_RUN) {
      logEvent(`PAGE COUNTER: Accessing Google Viewport Page [ ${pageCounter} ] (Start Index: ${currentResultOffset})`);

      // ─── GOOGLE PARAMETER SCHEMA SPECIFICS ───
      const searchParams = {
        engine: "google",                 // Route execution directly to Google
        api_key: process.env.SERPAPI_KEY,  // Secure authorization pass-through
        q: combinedQuery,                 // Combined query string
        num: RESULTS_PER_PAGE,            // Google uses 'num' instead of 'count'
        start: currentResultOffset,       // Google uses 'start' instead of 'first'

        gl:"in",
        hl:"en",
      };

      logEvent(`     Dispatching API bundle request wrapper to SerpApi secure endpoint...`);
      
      // Execute the module lookup utilizing native clean async/await Promises
      const results = await getJson(searchParams);
      const organicResults = results.organic_results || [];

      logEvent(`   ✓ Successfully retrieved ${organicResults.length} organic index entries from Google Page ${pageCounter}.`);

      if (organicResults.length === 0) {
        logEvent('     Google index data pool dried up. Terminating page loop sequence.');
        break;
      }

      // 4. Extract, normalize, and parse unique tracking targets
      let addedCount = 0;
      for (let item of organicResults) {
        if (!item.link) continue;
        
        const cleanDomain = normalizeDomain(item.link);
        if (!cleanDomain) continue;

        try {
          await pool.query(
            "INSERT IGNORE INTO reported_domain(domain) VALUES (?)",
            [cleanDomain]
          );
          addedCount++;
        } catch (dbErr) {
          logEvent(`     DB Row Insertion Exception: ${dbErr.message}`);
        }
      }

      logEvent(`     Saved ${addedCount} unique host targets from Page ${pageCounter} into MySQL.`);

      // 5. COUNTER ADVANCEMENTS
      pageCounter++;                           // Increments your visible text logger
      currentResultOffset += RESULTS_PER_PAGE; // Mathematical calculation shifting the index window forward
      
      await new Promise(res => setTimeout(res, 1500)); // Standard polite background network pause
    }

    // Release and complete the processing queue status values
    // Change "keywordIds" to "targetKeywords"
    await pool.query("UPDATE keywords SET status = 'completed' WHERE keyword IN (?)", [keywordPhrases]);
    logEvent(`✔ Completed entire Google keyword database slice successfully.`);

  } catch (globalErr) {
    logEvent(`  CRITICAL WORKER FAULT: ${globalErr.message}`);
  }finally {
    await pool.end();
    logEvent('  SYSTEM END: Google SerpApi integration worker context closed.\n');
  }
}

runGoogleSerpApiScraper();