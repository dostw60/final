// scrapers/market/candleScraper.js
const axios = require('axios');
const pool = require('../../db/pool');
const symbolMapper = require('../company/symbolMapper');
const { withRetry } = require('../../utils/retry');
const logger = require('../../utils/logger');

// A helper for Unix timestamps (in seconds, not milliseconds)
const getUnixTimestamp = (date) => Math.floor(date.getTime() / 1000);

class NEPSECandleScraper {
    constructor() {
        this.BASE_URL = 'https://www.merolagani.com/handlers/TechnicalChartHandler.ashx';
    }

    /**
     * Fetches historical OHLC data for a single symbol from Merolagani.
     * @param {string} symbol - The stock symbol (e.g., 'NABIL').
     * @param {Date} startDate - Start date for the data range.
     * @param {Date} endDate - End date for the data range.
     * @returns {Promise<object>} - The API's JSON response.
     */
    async fetchRawCandles(symbol, startDate, endDate) {
        const params = {
            type: 'get_advanced_chart',
            symbol: symbol.toUpperCase(),
            resolution: '1D',
            rangeStartDate: getUnixTimestamp(startDate),
            rangeEndDate: getUnixTimestamp(endDate),
            isAdjust: 1, // Crucial for accurate, split-adjusted data
            currencyCode: 'NPR'
        };

        logger.debug(`Fetching candles for ${symbol} from ${startDate.toISOString().slice(0,10)} to ${endDate.toISOString().slice(0,10)}`);

        const response = await withRetry(
            () => axios.get(this.BASE_URL, { params, timeout: 15000 }),
            { retries: 3, delay: 1000 }
        );

        if (response.data.s !== 'ok') {
            throw new Error(`Merolagani API error for ${symbol}: ${response.data.s}`);
        }
        return response.data;
    }

    /**
     * Normalizes the raw API response into database-ready candle objects.
     * @param {object} rawData - The raw response from fetchRawCandles.
     * @param {number} companyId - The internal company ID from your DB.
     * @returns {Array} - An array of candle objects for insertion.
     */
    normalizeCandles(rawData, companyId) {
        const { t, o, h, l, c, v } = rawData;
        const candles = [];

        for (let i = 0; i < t.length; i++) {
            // Convert Unix timestamp (seconds) to a JS Date object, then to YYYY-MM-DD
            const date = new Date(t[i] * 1000);
            const dateStr = date.toISOString().slice(0, 10);

            candles.push({
                company_id: companyId,
                date: dateStr,
                open_price: parseFloat(o[i]),
                high_price: parseFloat(h[i]),
                low_price: parseFloat(l[i]),
                close_price: parseFloat(c[i]),
                volume: parseInt(v[i], 10),
                source: 'merolagani_advanced_chart'
            });
        }
        return candles;
    }

    /**
     * Upserts an array of candles into the price_candles table.
     * @param {Array} candles - The normalized candle objects.
     * @returns {Promise<number>} - The number of rows inserted/updated.
     */
    async upsertCandles(candles) {
        if (!candles.length) return 0;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            let insertedCount = 0;

            for (const candle of candles) {
                const query = `
                    INSERT INTO price_candles
                        (company_id, date, open_price, high_price, low_price, close_price, volume, source)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (company_id, date) DO UPDATE SET
                        open_price = EXCLUDED.open_price,
                        high_price = EXCLUDED.high_price,
                        low_price = EXCLUDED.low_price,
                        close_price = EXCLUDED.close_price,
                        volume = EXCLUDED.volume,
                        source = EXCLUDED.source,
                        scraped_at = CURRENT_TIMESTAMP
                `;
                const res = await client.query(query, [
                    candle.company_id, candle.date, candle.open_price, candle.high_price,
                    candle.low_price, candle.close_price, candle.volume, candle.source
                ]);
                insertedCount += res.rowCount;
            }

            await client.query('COMMIT');
            logger.info(`Upserted ${insertedCount} candles for company ID ${candles[0].company_id}.`);
            return insertedCount;
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Failed to upsert candles:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Public method to scrape a date range for a given symbol.
     * @param {string} symbol - The stock symbol.
     * @param {Date} startDate - Start of the range.
     * @param {Date} endDate - End of the range.
     * @returns {Promise<object>} - Summary of the operation.
     */
    async scrapeSymbolRange(symbol, startDate, endDate) {
        try {
            const companyId = await symbolMapper.getCompanyId(symbol);
            if (!companyId) {
                throw new Error(`Could not map symbol "${symbol}" to a company.`);
            }

            const rawData = await this.fetchRawCandles(symbol, startDate, endDate);
            const candles = this.normalizeCandles(rawData, companyId);
            const insertedCount = await this.upsertCandles(candles);

            return { success: true, symbol, count: insertedCount };
        } catch (error) {
            logger.error(`Scraping failed for ${symbol}:`, error);
            return { success: false, symbol, error: error.message };
        }
    }
}

module.exports = new NEPSECandleScraper();