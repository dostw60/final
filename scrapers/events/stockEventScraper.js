// scrapers/events/stockEventScraper.js
const axios = require('axios');
const pool = require('../../db/pool');
const symbolMapper = require('../company/symbolMapper');
const logger = require('../../utils/logger');

class StockEventScraper {
    constructor() {
        this.BASE_URL = 'https://www.merolagani.com/handlers/webrequesthandler.ashx';
    }

    /**
     * Fetches raw stock events for a given month.
     * @param {Date} startDate - Start of the month.
     * @param {Date} endDate - End of the month.
     */
    async fetchEventsForMonth(startDate, endDate) {
        const formatDate = (date) => `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()}`;
        const params = {
            type: 'stock_event',
            fromDate: formatDate(startDate),
            toDate: formatDate(endDate)
        };

        const response = await axios.get(this.BASE_URL, { params });
        if (response.data.mt !== 'ok') throw new Error('Invalid response from stock_event API');
        return response.data.detail;
    }

    /**
     * Parses an announcement string to extract the company symbol.
     * This is a powerful but necessary function. It uses rules and a lookup.
     * @param {string} text - The announcementDetail text.
     * @returns {string|null} - Extracted symbol or null.
     */
    extractSymbolFromText(text) {
        // Rule 1: Look for parentheses with a known symbol pattern (e.g., "(NABIL)")
        let match = text.match(/\(([A-Z]{3,})\)/);
        if (match) return match[1];

        // Rule 2: Look for a common pattern " - Company Name (SYMBOL)"
        match = text.match(/-\s.*?\(([A-Z]{3,})\)/);
        if (match) return match[1];

        // Rule 3: Look for "Company Name (SYMBOL)" at the end of a sentence
        match = text.match(/\b([A-Z]{3,})\b(?=[.\s]*$)/);
        if (match) return match[1];
        
        // Rule 4: Fallback to a manual keyword map for very common companies
        const keywordMap = {
            'Nabil Bank': 'NABIL', 'NIC Asia': 'NICA', 'Global IME': 'GBIME',
            'Himalayan Bank': 'HBL', 'Kumari Bank': 'KBL', 'Prabhu Bank': 'PRVU',
            'Laxmi Sunrise': 'LSB', 'Everest Bank': 'EBL', 'Nepal Investment': 'NIB',
            'NMB Bank': 'NMB', 'Sanima Bank': 'SANIMA', 'Citizen Bank': 'CZBIL',
            'Machhapuchchhre': 'MBL', 'Nepal SBI': 'SBI', 'Siddhartha Bank': 'SBL'
        };
        for (const [key, sym] of Object.entries(keywordMap)) {
            if (text.includes(key)) return sym;
        }
        return null;
    }

    /**
     * Determines the event type based on keywords in the text.
     */
    determineEventType(text) {
        if (text.includes('IPO shares') || text.includes('Initial Public Offering')) return 'IPO';
        if (text.includes('FPO shares')) return 'FPO';
        if (text.includes('right share') || text.includes('Right Share')) return 'RIGHT_SHARE';
        if (text.includes('AGM is scheduled') || text.includes('AGM scheduled')) return 'AGM';
        if (text.includes('Cash Dividend') || text.includes('Bonus Share') || text.includes('Dividend')) return 'DIVIDEND_BONUS';
        if (text.includes('auction')) return 'AUCTION';
        return 'ANNOUNCEMENT';
    }

    /**
     * Parses a date from the announcement text (e.g., "Jestha 18, 2083").
     * This is complex and requires a library like 'nepali-date-converter'.
     * For now, we'll use the actionDate from the API.
     * @returns {string} - YYYY-MM-DD formatted date.
     */
    parseNepaliDate(nepaliDateStr) {
        // TODO: Use the 'nepali-date-converter' library you already have in package.json
        // For example: const bsDate = new NepaliDate(nepaliDateStr); return bsDate.toJSDate();
        // Placeholder: returns today's date if parsing fails.
        logger.warn(`Nepali date parsing not fully implemented for: ${nepaliDateStr}`);
        return new Date().toISOString().slice(0,10);
    }

    /**
     * Processes and saves all events for a given month.
     */
    async processMonthlyEvents(year, month) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0); // Last day of the month
        
        const rawEvents = await this.fetchEventsForMonth(startDate, endDate);
        logger.info(`Processing ${rawEvents.length} raw events for ${year}-${month}`);
        
        const processedEvents = [];
        for (const ev of rawEvents) {
            const symbol = this.extractSymbolFromText(ev.announcementDetail);
            const companyId = symbol ? await symbolMapper.getCompanyId(symbol) : null;
            
            const event = {
                action_date: ev.actionDate,
                announcement_detail: ev.announcementDetail,
                event_type: this.determineEventType(ev.announcementDetail),
                symbol: symbol,
                company_id: companyId,
                raw_data: ev
            };
            
            // Enhance IPO events with structured data
            if (event.event_type === 'IPO') {
                // Use regex to extract units (e.g., "46,74,000.00 units")
                const unitsMatch = ev.announcementDetail.match(/(\d[\d,]+\.?\d*)\s*units/);
                event.units = unitsMatch ? parseInt(unitsMatch[1].replace(/,/g, '')) : null;
                
                // Extract open/close dates (e.g., "from 18th - 21st Jestha, 2083")
                const dateMatch = ev.announcementDetail.match(/from\s+\d+\w*\s*-\s*\d+\w*\s+([^,]+),\s+(\d{4})/);
                if (dateMatch) {
                    // TODO: Use dateMatch[1] (month) and dateMatch[2] (year) with NepaliDate converter
                }
            }
            processedEvents.push(event);
        }
        
        await this.saveEvents(processedEvents);
        return processedEvents;
    }
    
    async saveEvents(events) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const ev of events) {
                // Insert into a dedicated 'corporate_events' table (create this via migration)
                await client.query(`
                    INSERT INTO corporate_events 
                        (action_date, announcement_detail, event_type, symbol, company_id, raw_data)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (action_date, announcement_detail) DO NOTHING
                `, [ev.action_date, ev.announcement_detail, ev.event_type, ev.symbol, ev.company_id, JSON.stringify(ev.raw_data)]);
            }
            await client.query('COMMIT');
            logger.info(`Saved ${events.length} unique events.`);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = new StockEventScraper();