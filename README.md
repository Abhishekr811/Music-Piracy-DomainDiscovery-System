# 🎵 Music Piracy Domain Discovery System

An automated, database-driven threat intelligence pipeline that scrapes search engine footprints to discover and audit the infrastructural telemetry of high-risk digital piracy domains.

---

## 🗺️ Architectural Pipeline System

The intelligence system is built using an asynchronous, data-driven architecture. Workloads are completely separated across isolated state-machine workers coordinating through a centralized MySQL cluster.

```text
       [ central_mysql_pool ] 
                 │
      ┌──────────┴──────────┐
      ▼ (WHERE status='pending')▼ (WHERE ip_address IS NULL)
┌───────────┐         ┌───────────┐
│ Worker 01 │         │ Worker 02 │
│  Scraper  │         │ Intel-Gen │
└─────┬─────┘         └─────┬─────┘
      │                     │
      ▼ [Puppeteer Core]    ▼ [Puppeteer Core]
 ┌─────────────┐       ┌──────────────────────┐
 │ Bing Search │       │   Global Infra Lookup:   │
 └──────┬──────┘       │  ► dns.google        │
        │              │  ► rdap.org          │
        ▼              │  ► ipinfo.io         │
 [Link Extract]        └───────────┬──────────┘
        │                          │
        ▼ [Normalize Engine]       ▼
 [Save scraped_domains] ──► [Update domain_intelligence]

```

🛠️ System Components & Core Responsibilities
The codebase is split into modular execution nodes, ensuring high maintainability and failure isolation:

googleScraper.js• Ingests query tasks• Simulates human browsing footprint• Extracts raw organic layoutsPuppeteer (Headless Chrome)Bing Search Index Enginescraped_domains tabledomain

IntelCollector.js• Massages messy raw domain properties• Performs zero-key network lookups• Pinpoints geographic host countriesGoogle DNS EngineOfficial ICANN RDAP ServiceIPinfo.io CDN Backbonedomain_intelligence table


🚀 Step-by-Step Installation & Setup
Follow this step-by-step pathway to spin up the automation matrix inside your local VS Code environment:

1. Environmental PrerequisitesEnsure you have Node.js (v18+) installed along with a running local instance of a MySQL Server (via XAMPP, Workbench, or Docker).

2. Initialize Database TopologyConnect to your local MySQL server instance and execute the following SQL script to create the relational schematics:

SQLCREATE DATABASE IF NOT EXISTS search_scraper_db;
USE search_scraper_db;

CREATE TABLE IF NOT EXISTS keywords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL UNIQUE,
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scraped_domains (
    id INT AUTO_INCREMENT PRIMARY KEY,
    keyword_id INT,
    domain_name VARCHAR(255) NOT NULL,
    source_url TEXT NOT NULL,
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (keyword_id) REFERENCES keywords(id),
    UNIQUE KEY unique_keyword_domain (keyword_id, domain_name)
);

CREATE TABLE IF NOT EXISTS domain_intelligence (
    id INT AUTO_INCREMENT PRIMARY KEY,
    domain_name VARCHAR(255) NOT NULL UNIQUE,
    registrar VARCHAR(255),
    registration_date DATE,
    expiry_date DATE,
    nameservers TEXT,
    ip_address VARCHAR(100),
    hosting_provider VARCHAR(255),
    asn VARCHAR(50),
    hosting_country VARCHAR(100),
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed processing targets
INSERT IGNORE INTO keywords (keyword) VALUES 
('bollywood songs download'),
('hindi ringtone download'),
('mp3 song download');


3. Deploy Local Repository & DependenciesClone your codebase folder layout, navigate inside using your terminal, and install the required node packages:Bash# Install core database engine, browser toolsets, and configuration handlers
npm install mysql2 puppeteer dotenv


4. Wire Up Environment Variables (.env)Create a file named exactly .env in the root folder of your project to store connection configurations.⚠️ Security Warning: The .env template below contains credentials specific to your environment. Do NOT commit this file to GitHub. It is securely added to the .gitignore mapping rules.
Ini, TOML
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_local_mysql_password_here
DB_NAME=search_scraper_db




⚡ Execution InstructionsThe pipeline functions sequentially. Execute the modules through your terminal in this order:

Phase A: Target FingerprintingFire up the primary scraping system to consume items flagged as pending from the keyword queue:
Bashnode googleScraper.js

Phase B: Infrastructural Deep DiveOnce the scraper updates statuses to completed, deploy the secondary intelligence collector to analyze network parameters:
Bashnode domainIntelCollector.js

Phase C: Review Captured Threat IntelligenceQuery your MySQL console instance to track your freshly populated analytics data maps:
SQLSELECT domain_name, ip_address, hosting_country, registrar, registration_date 
FROM domain_intelligence;



🧠 Architectural Assumptions & Resiliency Controls
To operate at scale, the architecture relies on several defensive design principles:

1. Firewall and Proxy ImmunityInstead of using raw Node.js http/dns background modules (which are heavily filtered on local networks and developer machines), Phase B routes all external requests through Puppeteer. By pulling JSON strings straight out of the document viewport of tier-1 backbones (dns.google, ipinfo.io), the system inherits the machine's global system proxy settings and certificates seamlessly.

2. Auto-Throttling Rate ControlsUnauthenticated public endpoints protect their infrastructure using rate limiters. To stay under these security thresholds, the scripts include a hardcoded RATE_LIMIT_DELAY = 2000 (2-second pause). This ensures clean, long-term executions without triggering IP blocks.

3. Automatic De-DuplicationWebsites frequently map multiple localized links or internal paths back to a single domain name. The pipeline normalizes strings using the JavaScript URL parsing API to strip away subdomains (like www.), queries, and routes. Duplicate conflicts are automatically resolved on the database side using an internal ON DUPLICATE KEY UPDATE and compound unique constraint layers.
