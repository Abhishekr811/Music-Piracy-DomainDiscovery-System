require('dotenv').config();
const mysql = require('mysql2/promise');
const puppeteer = require('puppeteer');

// --- REGULATION CONFIGURATION ---
const ITEMS_PER_PAGE = 5; // This controls your SQL pagination LIMIT
const RATE_LIMIT_DELAY = 2000; // 2-second safe cooldown between API calls

const DB_CONFIG = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function collectDomainIntelligence() {
  const pool = await mysql.createPool(DB_CONFIG);
  
  console.log('Launching enterprise-backed browser data pipeline (Paginated)...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    let pageNumber = 1;
    let hasMoreRecords = true;

    // ─── PAGINATION ENGINE CONTROL LOOP ───
    while (hasMoreRecords) {
      // Calculate data index window dynamically for the current page
      const currentOffset = (pageNumber - 1) * ITEMS_PER_PAGE;
      
      console.log(`\n============================================`);
      console.log(`FETCHING BATCH: Page ${pageNumber} (Offset: ${currentOffset})`);
      console.log(`============================================`);

      // Query database queue utilizing LIMIT and OFFSET pagination
      const [pendingDomains] = await pool.query(`
        SELECT DISTINCT d.domain_name 
        FROM scraped_domains d
        LEFT JOIN domain_intelligence i ON d.domain_name = i.domain_name
        WHERE i.ip_address IS NULL
        LIMIT ? OFFSET ?`, 
        [ITEMS_PER_PAGE, currentOffset]
      );

      // Break Condition: If the current database page slice returns nothing, stop
      if (pendingDomains.length === 0) {
        console.log('\n✔ All pages processed successfully. No unprofiled targets remaining.');
        hasMoreRecords = false;
        break;
      }

      console.log(`Loaded ${pendingDomains.length} domains from Page ${pageNumber}. Starting lookups...`);

      // Process current batch page array
      for (const target of pendingDomains) {
        const domain = target.domain_name;
        console.log(`\n--------------------------------------------`);
        console.log(`Profiling network parameters for: "${domain}"`);

        let intel = {
          domain_name: domain, registrar: null, reg_date: null, exp_date: null,
          nameservers: null, ip: null, provider: null, asn: null, country: null
        };

        // PHASE A: Google DNS Engine
        try {
          await page.goto(`https://dns.google/resolve?name=${domain}&type=A`, { waitUntil: 'networkidle2' });
          const bodyText = await page.evaluate(() => document.body.innerText);
          const dnsData = JSON.parse(bodyText);

          if (dnsData && dnsData.Answer && dnsData.Answer.length > 0) {
            intel.ip = dnsData.Answer[dnsData.Answer.length - 1].data;
            console.log(`✓ Google DNS Resolved: IP -> ${intel.ip}`);
          }
        } catch (dnsErr) {
          console.log(`❌ DNS lookup failed for target: ${domain}`);
        }

        // PHASE B: Official Enterprise RDAP JSON Lookup
        try {
          await delay(RATE_LIMIT_DELAY);
          await page.goto(`https://rdap.org/domain/${domain}`, { waitUntil: 'networkidle2' });
          const bodyText = await page.evaluate(() => document.body.innerText);
          const rdapData = JSON.parse(bodyText);

          if (rdapData) {
            if (rdapData.port43) intel.registrar = rdapData.port43.trim();
            
            if (rdapData.events) {
              const regEvent = rdapData.events.find(e => e.eventAction === 'registration');
              const expEvent = rdapData.events.find(e => e.eventAction === 'expiration');
              if (regEvent) intel.reg_date = regEvent.eventDate.substring(0, 10);
              if (expEvent) intel.exp_date = expEvent.eventDate.substring(0, 10);
            }
            console.log(`✓ Enterprise RDAP Complete: Registrar -> ${intel.registrar || 'Unknown'}`);
          }
        } catch (rdapErr) {
          console.log(`⚠️ WHOIS/RDAP skipped or restricted for TLD on domain: ${domain}`);
        }

        // PHASE C: Enterprise IPinfo.io Geolocation Engine
        if (intel.ip) {
          try {
            await delay(RATE_LIMIT_DELAY);
            await page.goto(`https://ipinfo.io/${intel.ip}/json`, { waitUntil: 'networkidle2' });
            const bodyText = await page.evaluate(() => document.body.innerText);
            const geoData = JSON.parse(bodyText);

            if (geoData && !geoData.error) {
              intel.provider = geoData.org || null;
              intel.asn = geoData.asn || null;
              intel.country = geoData.country || null;
              console.log(`✓ IPinfo Geolocation Complete: Country -> ${intel.country}`);
            }
          } catch (geoErr) {
            console.log(`❌ IPinfo Geolocation failed for IP: ${intel.ip}`);
          }
        }

        // 3. Update database record tracking states
        try {
          await pool.query(`
            INSERT INTO domain_intelligence 
            (domain_name, registrar, registration_date, expiry_date, nameservers, ip_address, hosting_provider, asn, hosting_country)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
              ip_address = VALUES(ip_address),
              registrar = VALUES(registrar),
              registration_date = VALUES(registration_date),
              expiry_date = VALUES(expiry_date),
              nameservers = VALUES(nameservers),
              hosting_provider = VALUES(hosting_provider),
              asn = VALUES(asn),
              hosting_country = VALUES(hosting_country),
              processed_at = CURRENT_TIMESTAMP`,
            [
              intel.domain_name, intel.registrar, intel.reg_date, intel.exp_date,
              intel.nameservers, intel.ip, intel.provider, intel.asn, intel.country
            ]
          );
          console.log(`Successfully saved records to MySQL for: ${domain}`);
        } catch (dbErr) {
          console.error(`Database Transaction Error:`, dbErr.message);
        }
      }

      // Increment page loop index to offset the next chunk of query fields
      pageNumber++;
      await delay(1000); // Small polite cooldown break between page transitions
    }

  } catch (globalErr) {
    console.error('Fatal Pipeline Failure:', globalErr);
  } finally {
    await browser.close();
    await pool.end();
    console.log('\nData profile sweep complete.');
  }
}

collectDomainIntelligence();