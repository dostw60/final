// scrapers/events/stockEventScraper.js
const axios = require('axios');
const logger = require('../../utils/logger');

class StockEventScraper {
    constructor() {
        this.BASE_URL = 'https://www.merolagani.com/handlers/webrequesthandler.ashx';
        this.cache = new Map();
    }

    /**
     * Fetches raw stock events for a given date range
     */
    async fetchEvents(fromDate, toDate) {
        const cacheKey = `events_${fromDate}_${toDate}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < 3600000) {
            return cached.data;
        }
        
        const params = {
            type: 'stock_event',
            fromDate: fromDate,
            toDate: toDate
        };

        const response = await axios.get(this.BASE_URL, { params });
        if (response.data.mt !== 'ok') throw new Error('Invalid response from stock_event API');
        
        const events = response.data.detail || [];
        this.cache.set(cacheKey, { data: events, timestamp: Date.now() });
        
        return events;
    }

    /**
     * Fetches events for a specific month
     */
    async fetchEventsForMonth(year, month) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const fromDate = `${startDate.getMonth() + 1}/${startDate.getDate()}/${startDate.getFullYear()}`;
        const toDate = `${endDate.getMonth() + 1}/${endDate.getDate()}/${endDate.getFullYear()}`;
        
        return this.fetchEvents(fromDate, toDate);
    }

    /**
     * Fetches upcoming events for next N months
     */
    async fetchUpcomingEvents(months = 3) {
        const now = new Date();
        const fromDate = `${now.getMonth() + 1}/1/${now.getFullYear()}`;
        
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + months);
        const toDate = `${endDate.getMonth() + 1}/${endDate.getDate()}/${endDate.getFullYear()}`;
        
        return this.fetchEvents(fromDate, toDate);
    }

    /**
     * Parses an announcement string to extract the company symbol
     */
    extractSymbolFromText(text) {
        if (!text) return null;
        
        // Rule 1: Look for parentheses with a known symbol pattern (e.g., "(NABIL)")
        let match = text.match(/\(([A-Z]{3,})\)/);
        if (match) return match[1];

        // Rule 2: Look for a common pattern " - Company Name (SYMBOL)"
        match = text.match(/-\s.*?\(([A-Z]{3,})\)/);
        if (match) return match[1];

        // Rule 3: Look for "Company Name (SYMBOL)" at the end of a sentence
        match = text.match(/\b([A-Z]{3,})\b(?=[.\s]*$)/);
        if (match) return match[1];
        
        // Rule 4: Manual keyword map for common companies
        const keywordMap = {
            'Nabil Bank': 'NABIL', 'NIC Asia': 'NICA', 'Global IME': 'GBIME',
            'Himalayan Bank': 'HBL', 'Kumari Bank': 'KBL', 'Prabhu Bank': 'PRVU',
            'Laxmi Sunrise': 'LSB', 'Everest Bank': 'EBL', 'Nepal Investment': 'NIB',
            'NMB Bank': 'NMB', 'Sanima Bank': 'SANIMA', 'Citizen Bank': 'CZBIL',
            'Machhapuchchhre': 'MBL', 'Nepal SBI': 'SBI', 'Siddhartha Bank': 'SBL',
            'Sopan': 'SOPL', 'SOPAN': 'SOPL'
        };
        
        for (const [key, sym] of Object.entries(keywordMap)) {
            if (text.includes(key)) return sym;
        }
        return null;
    }

    /**
     * Determines the event type based on keywords
     */
    determineEventType(text) {
        if (!text) return 'ANNOUNCEMENT';
        
        if (text.includes('IPO shares') || text.includes('Initial Public Offering')) return 'IPO';
        if (text.includes('FPO shares')) return 'FPO';
        if (text.includes('right share') || text.includes('Right Share')) return 'RIGHT_SHARE';
        if (text.includes('AGM is scheduled') || text.includes('AGM scheduled') || text.includes('AGM will')) return 'AGM';
        if (text.includes('Cash Dividend') || text.includes('Bonus Share') || text.includes('Dividend')) return 'DIVIDEND_BONUS';
        if (text.includes('auction')) return 'AUCTION';
        
        return 'ANNOUNCEMENT';
    }

    /**
     * Extract IPO units from text
     */
    extractIPOUnits(text) {
        const match = text.match(/(\d[\d,]+\.?\d*)\s*units/);
        return match ? parseInt(match[1].replace(/,/g, '')) : null;
    }

    /**
     * Extract company name from text
     */
    extractCompanyName(text) {
        // Try to find pattern like "Company Name Limited (SYMBOL)"
        const match = text.match(/([A-Za-z\s]+(?:Limited|Ltd|Bank|Company))(?:\s*\([A-Z]+\))?/i);
        return match ? match[1].trim() : null;
    }

    /**
     * Process events and return structured data
     */
    async processEvents(events) {
        const processed = [];
        
        for (const ev of events) {
            const symbol = this.extractSymbolFromText(ev.announcementDetail);
            
            const event = {
                date: ev.actionDate,
                day: ev.day,
                description: ev.announcementDetail,
                event_type: this.determineEventType(ev.announcementDetail),
                symbol: symbol,
                company_name: this.extractCompanyName(ev.announcementDetail)
            };
            
            // Add IPO specific data
            if (event.event_type === 'IPO') {
                event.units = this.extractIPOUnits(ev.announcementDetail);
            }
            
            processed.push(event);
        }
        
        return processed;
    }

    /**
     * Get events by type (ipo, agm, dividend, etc.)
     */
    async getEventsByType(eventType, months = 3) {
        const events = await this.fetchUpcomingEvents(months);
        return events.filter(event => 
            this.determineEventType(event.announcementDetail).toLowerCase() === eventType.toLowerCase()
        );
    }

    /**
     * Get events for a specific company
     */
    async getEventsByCompany(symbol, months = 6) {
        const events = await this.fetchUpcomingEvents(months);
        return events.filter(event => {
            const extractedSymbol = this.extractSymbolFromText(event.announcementDetail);
            return extractedSymbol && extractedSymbol.toUpperCase() === symbol.toUpperCase();
        });
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        logger.info('Stock event cache cleared');
    }
}

module.exports = new StockEventScraper();