// services/dateParser.js (Enhanced Version)
const NepaliDate = require('nepali-date-converter');
const { format, addDays, subDays, differenceInDays, parseISO, isValid } = require('date-fns');
const logger = require('../utils/logger');

class NEPSEStockDateParser {
  constructor() {
    this.TRADING_START_HOUR = 11;
    this.TRADING_END_HOUR = 15;
    this.TIMEZONE = 'Asia/Kathmandu';
    
    // Nepali month names
    this.nepaliMonths = [
      'Baisakh', 'Jestha', 'Ashad', 'Shrawan', 'Bhadra', 'Ashwin',
      'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'
    ];
    
    // Date formats for parsing
    this.dateFormats = [
      // AD formats
      { regex: /^(\d{4})-(\d{2})-(\d{2})$/, type: 'ad', group: [1, 2, 3] },
      { regex: /^(\d{4})\/(\d{2})\/(\d{2})$/, type: 'ad', group: [1, 2, 3] },
      { regex: /^(\d{2})-(\d{2})-(\d{4})$/, type: 'ad_dmy', group: [3, 2, 1] },
      { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, type: 'ad_dmy', group: [3, 2, 1] },
      
      // BS formats
      { regex: /^(\d{4})-(\d{2})-(\d{2})$/, type: 'bs', group: [1, 2, 3] },
      { regex: /^(\d{4})\/(\d{2})\/(\d{2})$/, type: 'bs', group: [1, 2, 3] },
      { regex: /^(\d{2})-(\d{2})-(\d{4})$/, type: 'bs_dmy', group: [3, 2, 1] },
      { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, type: 'bs_dmy', group: [3, 2, 1] },
      
      // Nepali text formats
      { regex: /(\d{4})\s*(?:Baisakh|Jestha|Ashad|Shrawan|Bhadra|Ashwin|Kartik|Mangsir|Poush|Magh|Falgun|Chaitra)\s*(\d{1,2})/i, type: 'nepali_text', group: [1, 0, 2] },
    ];
  }

  /**
   * Parse market date from any format
   */
  parseMarketDate(dateStr, source = 'merolagani') {
    if (!dateStr) return null;

    try {
      let cleaned = dateStr.toString().trim();
      
      // Try parsing with known formats
      for (const format of this.dateFormats) {
        const match = cleaned.match(format.regex);
        if (match) {
          return this.parseByFormat(match, format, source);
        }
      }
      
      // Try parsing as Nepali date text
      const nepaliTextResult = this.parseNepaliDateText(cleaned);
      if (nepaliTextResult) {
        return nepaliTextResult;
      }
      
      // Try parsing as JS Date
      const jsDate = new Date(cleaned);
      if (isValid(jsDate) && jsDate.getFullYear() > 2000) {
        return jsDate;
      }
      
      logger.warn(`Failed to parse date: ${dateStr} from source: ${source}`);
      return null;
      
    } catch (error) {
      logger.error(`Date parsing error for ${dateStr}:`, error);
      return null;
    }
  }

  /**
   * Parse date by matched format
   */
  parseByFormat(match, format, source) {
    let year, month, day;
    
    switch (format.type) {
      case 'ad':
        [year, month, day] = format.group.map(i => parseInt(match[i]));
        const adDate = new Date(year, month - 1, day);
        if (isValid(adDate)) return adDate;
        break;
        
      case 'ad_dmy':
        [year, month, day] = format.group.map(i => parseInt(match[i]));
        const adDateDMY = new Date(year, month - 1, day);
        if (isValid(adDateDMY)) return adDateDMY;
        break;
        
      case 'bs':
        [year, month, day] = format.group.map(i => parseInt(match[i]));
        if (year > 2000) {
          const bsDate = new NepaliDate(year, month - 1, day);
          return bsDate.toJsDate();
        }
        break;
        
      case 'bs_dmy':
        [year, month, day] = format.group.map(i => parseInt(match[i]));
        if (year > 2000) {
          const bsDate = new NepaliDate(year, month - 1, day);
          return bsDate.toJsDate();
        }
        break;
    }
    
    return null;
  }

  /**
   * Parse Nepali date in text format (e.g., "2081 Baisakh 15")
   */
  parseNepaliDateText(text) {
    for (let i = 0; i < this.nepaliMonths.length; i++) {
      const month = this.nepaliMonths[i];
      const regex = new RegExp(`(\\d{4})\\s*${month}\\s*(\\d{1,2})`, 'i');
      const match = text.match(regex);
      
      if (match) {
        const year = parseInt(match[1]);
        const day = parseInt(match[2]);
        if (year > 2000 && day >= 1 && day <= 32) {
          const bsDate = new NepaliDate(year, i, day);
          return bsDate.toJsDate();
        }
      }
    }
    return null;
  }

  /**
   * Get current time in Nepal
   */
  getCurrentNepalTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: this.TIMEZONE }));
  }

  /**
   * Check if a date is a trading day
   */
  isTradingDay(date) {
    const dayOfWeek = date.getDay();
    // Saturday is 6
    if (dayOfWeek === 6) return false;
    
    return true;
  }

  /**
   * Get the correct trading date for a candle
   */
  getCandleDate(scrapedAt = null) {
    const nepalTime = scrapedAt || this.getCurrentNepalTime();
    const hour = nepalTime.getHours();
    
    if (hour < this.TRADING_START_HOUR) {
      return this.getPreviousTradingDay(nepalTime);
    }
    
    return nepalTime;
  }

  /**
   * Get previous trading day
   */
  getPreviousTradingDay(date) {
    let prevDay = subDays(date, 1);
    prevDay.setHours(0, 0, 0, 0);
    
    while (!this.isTradingDay(prevDay)) {
      prevDay = subDays(prevDay, 1);
    }
    
    return prevDay;
  }

  /**
   * Get next trading day
   */
  getNextTradingDay(date) {
    let nextDay = addDays(date, 1);
    nextDay.setHours(0, 0, 0, 0);
    
    while (!this.isTradingDay(nextDay)) {
      nextDay = addDays(nextDay, 1);
    }
    
    return nextDay;
  }

  /**
   * Get trading days between two dates
   */
  getTradingDays(startDate, endDate) {
    const tradingDays = [];
    let current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
      if (this.isTradingDay(current)) {
        tradingDays.push(new Date(current));
      }
      current = addDays(current, 1);
    }
    
    return tradingDays;
  }

  /**
   * Convert AD to BS date string
   */
  toBSDate(adDate) {
    try {
      const nepali = new NepaliDate(adDate);
      return nepali.format('YYYY-MM-DD');
    } catch (error) {
      logger.error(`BS conversion error for ${adDate}:`, error);
      return null;
    }
  }

  /**
   * Convert BS to AD date
   */
  toADDate(bsDateStr) {
    try {
      const [year, month, day] = bsDateStr.split('-').map(Number);
      const nepali = new NepaliDate(year, month - 1, day);
      return nepali.toJsDate();
    } catch (error) {
      logger.error(`AD conversion error for ${bsDateStr}:`, error);
      return null;
    }
  }

  /**
   * Format date for database storage
   */
  formatForDatabase(date) {
    if (!date) return null;
    if (date instanceof Date) {
      return format(date, 'yyyy-MM-dd');
    }
    if (typeof date === 'string') {
      const parsed = this.parseMarketDate(date);
      return parsed ? format(parsed, 'yyyy-MM-dd') : null;
    }
    return null;
  }

  /**
   * Format date for display
   */
  formatForDisplay(date, format = 'YYYY-MM-DD', calendar = 'ad') {
    if (!date) return null;
    
    const dateObj = typeof date === 'string' ? this.parseMarketDate(date) : date;
    if (!dateObj) return null;
    
    if (calendar === 'bs') {
      const nepali = new NepaliDate(dateObj);
      return nepali.format(format);
    }
    
    // AD format
    return format(dateObj, format.toLowerCase());
  }

  /**
   * Get fiscal year for a given date
   */
  getFiscalYear(date) {
    const dateObj = typeof date === 'string' ? this.parseMarketDate(date) : date;
    if (!dateObj) return null;
    
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1; // JavaScript months are 0-indexed
    
    // Nepali fiscal year starts in mid-July (Ashad)
    if (month >= 7) {
      return `${year}/${(year + 1).toString().slice(-2)}`;
    } else {
      return `${year - 1}/${year.toString().slice(-2)}`;
    }
  }

  /**
   * Get the start and end dates of a fiscal year
   */
  getFiscalYearRange(fiscalYear) {
    const match = fiscalYear.match(/(\d{4})\/(\d{2})/);
    if (!match) return null;
    
    const startYear = parseInt(match[1]);
    const startDate = new Date(startYear, 6, 16); // July 16
    const endDate = new Date(startYear + 1, 6, 15); // July 15 next year
    
    return {
      start: startDate,
      end: endDate,
      start_bs: this.toBSDate(startDate),
      end_bs: this.toBSDate(endDate)
    };
  }

  /**
   * Parse relative date expressions
   */
  parseRelativeDate(expression, referenceDate = null) {
    const refDate = referenceDate || new Date();
    const expr = expression.toLowerCase().trim();
    
    if (expr === 'today') return refDate;
    if (expr === 'yesterday') return subDays(refDate, 1);
    if (expr === 'tomorrow') return addDays(refDate, 1);
    if (expr === 'last_trading_day') return this.getPreviousTradingDay(refDate);
    if (expr === 'next_trading_day') return this.getNextTradingDay(refDate);
    
    // Parse "X days ago"
    const daysAgoMatch = expr.match(/(\d+)\s*days?\s*ago/);
    if (daysAgoMatch) {
      return subDays(refDate, parseInt(daysAgoMatch[1]));
    }
    
    // Parse "in X days"
    const inDaysMatch = expr.match(/in\s*(\d+)\s*days?/);
    if (inDaysMatch) {
      return addDays(refDate, parseInt(inDaysMatch[1]));
    }
    
    return null;
  }

  /**
   * Calculate age of data in days
   */
  getDataAge(date) {
    const dateObj = typeof date === 'string' ? this.parseMarketDate(date) : date;
    if (!dateObj) return null;
    
    return differenceInDays(new Date(), dateObj);
  }

  /**
   * Check if date is within trading hours
   */
  isTradingHour(date = null) {
    const nepalTime = date || this.getCurrentNepalTime();
    const hour = nepalTime.getHours();
    const isWeekday = nepalTime.getDay() !== 6;
    
    return isWeekday && hour >= this.TRADING_START_HOUR && hour <= this.TRADING_END_HOUR;
  }

  /**
   * Get the next IPO application deadline
   */
  getNextDeadline(deadlines) {
    const now = new Date();
    const futureDeadlines = deadlines
      .map(d => this.parseMarketDate(d))
      .filter(d => d && d > now)
      .sort((a, b) => a - b);
    
    return futureDeadlines.length > 0 ? futureDeadlines[0] : null;
  }

  /**
   * Batch parse multiple dates
   */
  batchParseDates(dateStrings, source = 'merolagani') {
    const results = {};
    
    for (const dateStr of dateStrings) {
      results[dateStr] = this.parseMarketDate(dateStr, source);
    }
    
    return results;
  }

  /**
   * Validate date range
   */
  validateDateRange(startDate, endDate) {
    const start = typeof startDate === 'string' ? this.parseMarketDate(startDate) : startDate;
    const end = typeof endDate === 'string' ? this.parseMarketDate(endDate) : endDate;
    
    if (!start || !end) {
      return { valid: false, error: 'Invalid date format' };
    }
    
    if (start > end) {
      return { valid: false, error: 'Start date must be before end date' };
    }
    
    const daysDiff = differenceInDays(end, start);
    if (daysDiff > 3650) { // 10 years max
      return { valid: false, error: 'Date range too large (max 10 years)' };
    }
    
    return { valid: true, days: daysDiff };
  }

  /**
   * Get date range for backfilling
   */
  getBackfillRange(startDate, endDate, maxDays = 365) {
    const start = typeof startDate === 'string' ? this.parseMarketDate(startDate) : startDate;
    const end = typeof endDate === 'string' ? this.parseMarketDate(endDate) : endDate || new Date();
    
    if (!start) return null;
    
    // Limit to maxDays
    const maxStart = subDays(end, maxDays);
    const actualStart = start < maxStart ? maxStart : start;
    
    return {
      start: actualStart,
      end: end,
      days: differenceInDays(end, actualStart),
      tradingDays: this.getTradingDays(actualStart, end).length
    };
  }

  /**
   * Convert date range to BS
   */
  toBSDateRange(startDate, endDate) {
    return {
      start: this.toBSDate(startDate),
      end: this.toBSDate(endDate)
    };
  }

  /**
   * Get market session info
   */
  getMarketSession() {
    const now = this.getCurrentNepalTime();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const isTradingDay = this.isTradingDay(now);
    
    let session = 'closed';
    let nextEvent = null;
    
    if (!isTradingDay) {
      session = 'closed';
      const nextDay = this.getNextTradingDay(now);
      nextEvent = {
        type: 'market_open',
        date: nextDay,
        time: '11:00',
        formatted: this.formatForDisplay(nextDay, 'YYYY-MM-DD HH:mm:ss')
      };
    } else if (hour < this.TRADING_START_HOUR) {
      session = 'pre-market';
      nextEvent = {
        type: 'market_open',
        date: now,
        time: '11:00',
        formatted: `${this.formatForDisplay(now, 'YYYY-MM-DD')} 11:00:00`
      };
    } else if (hour >= this.TRADING_START_HOUR && hour <= this.TRADING_END_HOUR) {
      session = 'open';
      const endTime = new Date(now);
      endTime.setHours(this.TRADING_END_HOUR, 0, 0);
      nextEvent = {
        type: 'market_close',
        date: now,
        time: '15:00',
        formatted: `${this.formatForDisplay(now, 'YYYY-MM-DD')} 15:00:00`
      };
    } else {
      session = 'closed';
      const nextDay = this.getNextTradingDay(now);
      nextEvent = {
        type: 'market_open',
        date: nextDay,
        time: '11:00',
        formatted: this.formatForDisplay(nextDay, 'YYYY-MM-DD HH:mm:ss')
      };
    }
    
    return {
      session,
      is_trading_day: isTradingDay,
      is_trading_hour: session === 'open',
      current_time: this.formatForDisplay(now, 'YYYY-MM-DD HH:mm:ss'),
      next_event: nextEvent
    };
  }
}

module.exports = new NEPSEStockDateParser();