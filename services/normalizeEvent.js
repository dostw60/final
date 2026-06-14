// services/normalizeEvent.js
const dateParser = require('./dateParser');
const logger = require('../utils/logger');
const symbolMapper = require('../scrapers/company/symbolMapper');

class EventNormalizer {
  constructor() {
    this.eventTypes = {
      IPO: 'ipo',
      FPO: 'fpo',
      RIGHT: 'right_share',
      DIVIDEND: 'dividend',
      BONUS: 'bonus',
      AGM: 'agm',
      SPLIT: 'stock_split',
      MERGER: 'merger',
      ACQUISITION: 'acquisition'
    };

    this.eventStatuses = {
      UPCOMING: 'upcoming',
      OPEN: 'open',
      CLOSED: 'closed',
      POSTPONED: 'postponed',
      CANCELLED: 'cancelled',
      COMPLETED: 'completed'
    };
  }

  /**
   * Normalize IPO/FPO event data from various sources
   */
  normalizeIPOEvent(rawData, source = 'merolagani') {
    try {
      const normalized = {
        event_type: this.eventTypes.IPO,
        source: source,
        raw_data: rawData,
        normalized_at: new Date().toISOString()
      };

      // Extract company information
      normalized.company_name = this.extractCompanyName(rawData);
      normalized.symbol = this.extractSymbol(rawData);
      
      // Extract dates
      normalized.open_date = this.extractDate(rawData, ['openDate', 'open_date', 'issueOpenDate', 'startDate']);
      normalized.close_date = this.extractDate(rawData, ['closeDate', 'close_date', 'issueCloseDate', 'endDate']);
      normalized.issue_date = this.extractDate(rawData, ['issueDate', 'issue_date']);
      normalized.allotment_date = this.extractDate(rawData, ['allotmentDate', 'allotment_date']);
      normalized.refund_date = this.extractDate(rawData, ['refundDate', 'refund_date']);
      normalized.listing_date = this.extractDate(rawData, ['listingDate', 'listing_date']);

      // Extract financial details
      normalized.issue_price = this.extractNumber(rawData, ['issuePrice', 'price', 'faceValue']);
      normalized.total_units = this.extractNumber(rawData, ['totalUnits', 'units', 'shares', 'totalShares']);
      normalized.promoter_units = this.extractNumber(rawData, ['promoterUnits', 'promoterShares']);
      normalized.public_units = this.extractNumber(rawData, ['publicUnits', 'publicShares', 'generalPublic']);
      normalized.institutional_units = this.extractNumber(rawData, ['institutionalUnits', 'institutional', 'mutualFund']);
      normalized.employees_units = this.extractNumber(rawData, ['employeesUnits', 'employees', 'staff']);
      
      // Extract application details
      normalized.min_application_units = this.extractNumber(rawData, ['minUnits', 'minShares', 'minimumApplication']);
      normalized.max_application_units = this.extractNumber(rawData, ['maxUnits', 'maxShares', 'maximumApplication']);
      normalized.application_price = this.extractNumber(rawData, ['applicationPrice', 'applicationFee']);
      
      // Extract status
      normalized.status = this.determineEventStatus(normalized.open_date, normalized.close_date);
      
      // Additional metadata
      normalized.issue_manager = this.extractText(rawData, ['issueManager', 'manager', 'leadManager']);
      normalized.registrar = this.extractText(rawData, ['registrar', 'shareRegistrar']);
      normalized.website = this.extractText(rawData, ['website', 'companyWebsite']);
      normalized.prospectus_url = this.extractText(rawData, ['prospectusUrl', 'prospectus', 'downloadLink']);

      // Validate required fields
      this.validateIPOEvent(normalized);

      return normalized;

    } catch (error) {
      logger.error('Failed to normalize IPO event:', error);
      return null;
    }
  }

  /**
   * Normalize dividend event data
   */
  normalizeDividendEvent(rawData, source = 'merolagani') {
    try {
      const normalized = {
        event_type: this.eventTypes.DIVIDEND,
        source: source,
        raw_data: rawData,
        normalized_at: new Date().toISOString()
      };

      // Extract company information
      normalized.company_name = this.extractCompanyName(rawData);
      normalized.symbol = this.extractSymbol(rawData);
      
      // Extract dividend details
      normalized.cash_dividend_percent = this.extractNumber(rawData, ['cashDividend', 'cash', 'cashPercent', 'cashPercentage']);
      normalized.bonus_percent = this.extractNumber(rawData, ['bonusShare', 'bonus', 'bonusPercent', 'bonusPercentage']);
      normalized.total_dividend_percent = this.extractNumber(rawData, ['totalDividend', 'dividend', 'total', 'percentage']);
      
      // Parse dividend from text (e.g., "10% cash + 15% bonus")
      if (!normalized.cash_dividend_percent && !normalized.bonus_percent && normalized.total_dividend_percent) {
        const parsed = this.parseDividendText(rawData.dividend_text || rawData.description);
        normalized.cash_dividend_percent = parsed.cash;
        normalized.bonus_percent = parsed.bonus;
      }
      
      // Extract dates
      normalized.announcement_date = this.extractDate(rawData, ['announcementDate', 'announcement_date', 'date', 'meetingDate']);
      normalized.book_closure_date = this.extractDate(rawData, ['bookClosureDate', 'book_closure_date', 'closureDate']);
      normalized.distribution_date = this.extractDate(rawData, ['distributionDate', 'distribution_date', 'paymentDate']);
      normalized.agm_date = this.extractDate(rawData, ['agmDate', 'agm_date', 'annualMeeting']);
      
      // Extract financial details
      normalized.fiscal_year = this.extractFiscalYear(rawData);
      normalized.amount_per_share = this.calculateAmountPerShare(
        normalized.cash_dividend_percent,
        rawData.face_value || 100
      );
      
      // Extract meeting details
      normalized.agm_time = this.extractText(rawData, ['agmTime', 'meetingTime', 'time']);
      normalized.agm_venue = this.extractText(rawData, ['agmVenue', 'venue', 'location', 'address']);
      
      // Extract status
      normalized.status = this.determineDividendStatus(normalized);
      
      // Additional metadata
      normalized.resolution_number = this.extractText(rawData, ['resolutionNumber', 'resolution', 'resolutionNo']);
      normalized.approved_by = this.extractText(rawData, ['approvedBy', 'boardMeeting', 'meeting']);

      this.validateDividendEvent(normalized);

      return normalized;

    } catch (error) {
      logger.error('Failed to normalize dividend event:', error);
      return null;
    }
  }

  /**
   * Normalize bonus share event
   */
  normalizeBonusEvent(rawData, source = 'merolagani') {
    try {
      const normalized = {
        event_type: this.eventTypes.BONUS,
        source: source,
        raw_data: rawData,
        normalized_at: new Date().toISOString()
      };

      // Extract company information
      normalized.company_name = this.extractCompanyName(rawData);
      normalized.symbol = this.extractSymbol(rawData);
      
      // Extract bonus details
      normalized.bonus_percent = this.extractNumber(rawData, ['bonusPercent', 'bonus', 'percentage', 'ratio']);
      normalized.bonus_ratio = this.formatBonusRatio(normalized.bonus_percent);
      
      // Calculate share impact
      normalized.previous_shares = this.extractNumber(rawData, ['previousShares', 'existingShares', 'oldShares']);
      normalized.bonus_shares_issued = this.extractNumber(rawData, ['bonusShares', 'sharesIssued', 'newShares']);
      normalized.total_shares_after = this.calculateTotalShares(
        normalized.previous_shares,
        normalized.bonus_shares_issued,
        normalized.bonus_percent
      );
      
      // Extract dates
      normalized.announcement_date = this.extractDate(rawData, ['announcementDate', 'announcement_date', 'date']);
      normalized.book_closure_date = this.extractDate(rawData, ['bookClosureDate', 'book_closure_date']);
      normalized.distribution_date = this.extractDate(rawData, ['distributionDate', 'distribution_date', 'bonusDate']);
      normalized.record_date = this.extractDate(rawData, ['recordDate', 'record_date']);
      
      // Extract financial details
      normalized.fiscal_year = this.extractFiscalYear(rawData);
      normalized.face_value = this.extractNumber(rawData, ['faceValue', 'face_value']) || 100;
      
      // Calculate value impact
      normalized.previous_capital = normalized.previous_shares * normalized.face_value;
      normalized.bonus_capital = normalized.bonus_shares_issued * normalized.face_value;
      normalized.new_capital = normalized.total_shares_after * normalized.face_value;
      
      // Extract status
      normalized.status = this.determineBonusStatus(normalized);
      
      // Additional metadata
      normalized.board_meeting_date = this.extractDate(rawData, ['boardMeetingDate', 'boardDate']);
      normalized.approval_authority = this.extractText(rawData, ['approvedBy', 'authority']);

      this.validateBonusEvent(normalized);

      return normalized;

    } catch (error) {
      logger.error('Failed to normalize bonus event:', error);
      return null;
    }
  }

  /**
   * Normalize AGM event
   */
  normalizeAGMEvent(rawData, source = 'merolagani') {
    try {
      const normalized = {
        event_type: this.eventTypes.AGM,
        source: source,
        raw_data: rawData,
        normalized_at: new Date().toISOString()
      };

      // Extract company information
      normalized.company_name = this.extractCompanyName(rawData);
      normalized.symbol = this.extractSymbol(rawData);
      
      // Extract AGM details
      normalized.agm_date = this.extractDate(rawData, ['agmDate', 'date', 'meetingDate']);
      normalized.agm_time = this.extractText(rawData, ['time', 'meetingTime', 'agmTime']);
      normalized.agm_venue = this.extractText(rawData, ['venue', 'location', 'address', 'place']);
      
      // Extract agenda
      normalized.agenda = this.extractAgenda(rawData);
      normalized.proposals = this.extractProposals(rawData);
      
      // Extract financial decisions
      normalized.dividend_proposal = this.extractNumber(rawData, ['proposedDividend', 'dividendProposal']);
      normalized.bonus_proposal = this.extractNumber(rawData, ['proposedBonus', 'bonusProposal']);
      
      // Extract dates
      normalized.book_closure_date = this.extractDate(rawData, ['bookClosureDate', 'closureDate']);
      normalized.record_date = this.extractDate(rawData, ['recordDate']);
      
      // Extract status
      normalized.status = this.determineAGMStatus(normalized);
      
      // Additional metadata
      normalized.fiscal_year = this.extractFiscalYear(rawData);
      normalized.notice_url = this.extractText(rawData, ['noticeUrl', 'notice', 'pdf']);
      normalized.contact_person = this.extractText(rawData, ['contactPerson', 'contact']);

      return normalized;

    } catch (error) {
      logger.error('Failed to normalize AGM event:', error);
      return null;
    }
  }

  /**
   * Normalize stock split event
   */
  normalizeStockSplitEvent(rawData, source = 'merolagani') {
    try {
      const normalized = {
        event_type: this.eventTypes.SPLIT,
        source: source,
        raw_data: rawData,
        normalized_at: new Date().toISOString()
      };

      // Extract company information
      normalized.company_name = this.extractCompanyName(rawData);
      normalized.symbol = this.extractSymbol(rawData);
      
      // Extract split details
      normalized.old_ratio = this.extractNumber(rawData, ['oldRatio', 'oldFaceValue', 'oldValue']);
      normalized.new_ratio = this.extractNumber(rawData, ['newRatio', 'newFaceValue', 'newValue']);
      normalized.split_ratio = `${normalized.old_ratio}:${normalized.new_ratio}`;
      
      // Calculate impact
      normalized.split_factor = normalized.new_ratio / normalized.old_ratio;
      
      // Extract dates
      normalized.announcement_date = this.extractDate(rawData, ['announcementDate', 'date']);
      normalized.effective_date = this.extractDate(rawData, ['effectiveDate', 'splitDate']);
      normalized.record_date = this.extractDate(rawData, ['recordDate']);
      
      // Extract financial details
      normalized.fiscal_year = this.extractFiscalYear(rawData);
      
      // Extract status
      normalized.status = this.determineSplitStatus(normalized);

      return normalized;

    } catch (error) {
      logger.error('Failed to normalize stock split event:', error);
      return null;
    }
  }

  /**
   * Normalize merger/acquisition event
   */
  normalizeMergerEvent(rawData, source = 'merolagani') {
    try {
      const normalized = {
        event_type: this.eventTypes.MERGER,
        source: source,
        raw_data: rawData,
        normalized_at: new Date().toISOString()
      };

      // Extract companies involved
      normalized.acquiring_company = this.extractText(rawData, ['acquiringCompany', 'acquirer', 'buyer']);
      normalized.acquiring_symbol = this.extractSymbol(rawData, 'acquiring');
      normalized.target_company = this.extractText(rawData, ['targetCompany', 'target', 'seller']);
      normalized.target_symbol = this.extractSymbol(rawData, 'target');
      
      // Extract merger details
      normalized.merger_ratio = this.extractText(rawData, ['mergerRatio', 'swapRatio', 'ratio']);
      normalized.exchange_ratio = this.parseExchangeRatio(normalized.merger_ratio);
      
      // Extract dates
      normalized.announcement_date = this.extractDate(rawData, ['announcementDate', 'date']);
      normalized.effective_date = this.extractDate(rawData, ['effectiveDate', 'mergerDate']);
      normalized.approval_date = this.extractDate(rawData, ['approvalDate', 'regulatoryApproval']);
      
      // Extract status
      normalized.status = this.extractText(rawData, ['status', 'stage']);
      
      return normalized;

    } catch (error) {
      logger.error('Failed to normalize merger event:', error);
      return null;
    }
  }

  /**
   * Generic event normalizer - detects event type and normalizes accordingly
   */
  async normalizeEvent(rawData, source = 'unknown') {
    try {
      // Detect event type
      const eventType = this.detectEventType(rawData);
      
      let normalized = null;
      
      switch (eventType) {
        case this.eventTypes.IPO:
          normalized = this.normalizeIPOEvent(rawData, source);
          break;
        case this.eventTypes.DIVIDEND:
          normalized = this.normalizeDividendEvent(rawData, source);
          break;
        case this.eventTypes.BONUS:
          normalized = this.normalizeBonusEvent(rawData, source);
          break;
        case this.eventTypes.AGM:
          normalized = this.normalizeAGMEvent(rawData, source);
          break;
        case this.eventTypes.SPLIT:
          normalized = this.normalizeStockSplitEvent(rawData, source);
          break;
        case this.eventTypes.MERGER:
          normalized = this.normalizeMergerEvent(rawData, source);
          break;
        default:
          logger.warn(`Unknown event type: ${eventType}`);
          return null;
      }
      
      // Map symbol to company ID if possible
      if (normalized && normalized.symbol) {
        const companyId = await symbolMapper.getCompanyId(normalized.symbol);
        if (companyId) {
          normalized.company_id = companyId;
        }
      }
      
      return normalized;
      
    } catch (error) {
      logger.error('Failed to normalize event:', error);
      return null;
    }
  }

  /**
   * Batch normalize multiple events
   */
  async normalizeEvents(events, source = 'unknown') {
    const normalized = [];
    
    for (const event of events) {
      const normalizedEvent = await this.normalizeEvent(event, source);
      if (normalizedEvent) {
        normalized.push(normalizedEvent);
      }
    }
    
    logger.info(`Normalized ${normalized.length} events from ${events.length} raw events`);
    
    return normalized;
  }

  /**
   * Detect event type from raw data
   */
  detectEventType(rawData) {
    const text = JSON.stringify(rawData).toLowerCase();
    
    if (text.includes('ipo') || text.includes('initial public offering')) {
      return this.eventTypes.IPO;
    }
    if (text.includes('fpo') || text.includes('further public offering')) {
      return this.eventTypes.FPO;
    }
    if (text.includes('right') || text.includes('right share')) {
      return this.eventTypes.RIGHT;
    }
    if (text.includes('dividend') || text.includes('cash dividend') || text.includes('नगद लाभांश')) {
      return this.eventTypes.DIVIDEND;
    }
    if (text.includes('bonus') || text.includes('bonus share') || text.includes('बोनस सेयर')) {
      return this.eventTypes.BONUS;
    }
    if (text.includes('agm') || text.includes('annual general') || text.includes('साधारण सभा')) {
      return this.eventTypes.AGM;
    }
    if (text.includes('split') || text.includes('stock split') || text.includes('face value')) {
      return this.eventTypes.SPLIT;
    }
    if (text.includes('merger') || text.includes('acquisition') || text.includes('समायोजन')) {
      return this.eventTypes.MERGER;
    }
    
    return null;
  }

  /**
   * Extract company name from raw data
   */
  extractCompanyName(rawData) {
    const fields = ['companyName', 'company_name', 'name', 'issuer', 'company', 'title'];
    
    for (const field of fields) {
      if (rawData[field]) {
        return rawData[field].toString().trim();
      }
    }
    
    return null;
  }

  /**
   * Extract symbol from raw data
   */
  extractSymbol(rawData, prefix = '') {
    const fields = [
      `${prefix}Symbol`, `${prefix}_symbol`,
      'symbol', 'ticker', 'code', 'scrip'
    ];
    
    for (const field of fields) {
      if (rawData[field]) {
        return rawData[field].toString().toUpperCase().trim();
      }
    }
    
    return null;
  }

  /**
   * Extract date from raw data
   */
  extractDate(rawData, possibleFields) {
    for (const field of possibleFields) {
      if (rawData[field]) {
        const parsedDate = dateParser.parseMarketDate(rawData[field]);
        if (parsedDate) {
          return dateParser.formatForDatabase(parsedDate);
        }
      }
    }
    return null;
  }

  /**
   * Extract number from raw data
   */
  extractNumber(rawData, possibleFields) {
    for (const field of possibleFields) {
      if (rawData[field] !== undefined && rawData[field] !== null) {
        const value = rawData[field];
        if (typeof value === 'number') return value;
        const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
        if (!isNaN(parsed)) return parsed;
      }
    }
    return null;
  }

  /**
   * Extract text from raw data
   */
  extractText(rawData, possibleFields) {
    for (const field of possibleFields) {
      if (rawData[field]) {
        return rawData[field].toString().trim();
      }
    }
    return null;
  }

  /**
   * Extract fiscal year from raw data
   */
  extractFiscalYear(rawData) {
    const fiscalYear = this.extractText(rawData, ['fiscalYear', 'fy', 'year', 'fiscal_year']);
    
    if (fiscalYear) {
      // Format as "2079/80"
      const match = fiscalYear.match(/(\d{4})(?:\/|–|-)?(\d{2})/);
      if (match) {
        return `${match[1]}/${match[2]}`;
      }
    }
    
    return null;
  }

  /**
   * Parse dividend text like "10% cash + 15% bonus"
   */
  parseDividendText(text) {
    if (!text) return { cash: 0, bonus: 0 };
    
    const cash = text.match(/(\d+(?:\.\d+)?)%?\s*(?:cash|नगद)/i);
    const bonus = text.match(/(\d+(?:\.\d+)?)%?\s*(?:bonus|बोनस)/i);
    
    return {
      cash: cash ? parseFloat(cash[1]) : 0,
      bonus: bonus ? parseFloat(bonus[1]) : 0
    };
  }

  /**
   * Format bonus ratio (e.g., 15% -> "15:100")
   */
  formatBonusRatio(percent) {
    if (!percent) return null;
    return `${percent}:100`;
  }

  /**
   * Calculate total shares after bonus
   */
  calculateTotalShares(previousShares, bonusShares, bonusPercent) {
    if (previousShares && bonusShares) {
      return previousShares + bonusShares;
    }
    if (previousShares && bonusPercent) {
      return previousShares * (1 + bonusPercent / 100);
    }
    return null;
  }

  /**
   * Calculate amount per share from dividend percentage
   */
  calculateAmountPerShare(dividendPercent, faceValue = 100) {
    if (!dividendPercent) return 0;
    return (dividendPercent / 100) * faceValue;
  }

  /**
   * Parse exchange ratio (e.g., "1:2" or "0.5")
   */
  parseExchangeRatio(ratioStr) {
    if (!ratioStr) return null;
    
    const match = ratioStr.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
    if (match) {
      return parseFloat(match[1]) / parseFloat(match[2]);
    }
    
    const number = parseFloat(ratioStr);
    if (!isNaN(number)) return number;
    
    return null;
  }

  /**
   * Extract agenda items from raw data
   */
  extractAgenda(rawData) {
    const agendaText = this.extractText(rawData, ['agenda', 'agendaItems', 'meetingAgenda']);
    if (agendaText) {
      return agendaText.split(/[;,]\s*/);
    }
    return [];
  }

  /**
   * Extract proposals from raw data
   */
  extractProposals(rawData) {
    const proposals = [];
    
    if (rawData.proposals) {
      if (Array.isArray(rawData.proposals)) {
        return rawData.proposals;
      }
      if (typeof rawData.proposals === 'string') {
        return rawData.proposals.split(/[;,]\s*/);
      }
    }
    
    return proposals;
  }

  /**
   * Determine event status based on dates
   */
  determineEventStatus(openDate, closeDate) {
    const now = new Date();
    const open = openDate ? new Date(openDate) : null;
    const close = closeDate ? new Date(closeDate) : null;
    
    if (!open && !close) return this.eventStatuses.UPCOMING;
    
    if (open && now < open) return this.eventStatuses.UPCOMING;
    if (open && close && now >= open && now <= close) return this.eventStatuses.OPEN;
    if (close && now > close) return this.eventStatuses.CLOSED;
    
    return this.eventStatuses.UPCOMING;
  }

  /**
   * Determine dividend status
   */
  determineDividendStatus(dividend) {
    const now = new Date();
    
    if (dividend.announcement_date && now < new Date(dividend.announcement_date)) {
      return this.eventStatuses.UPCOMING;
    }
    if (dividend.book_closure_date && now > new Date(dividend.book_closure_date)) {
      return this.eventStatuses.COMPLETED;
    }
    if (dividend.distribution_date && now > new Date(dividend.distribution_date)) {
      return this.eventStatuses.COMPLETED;
    }
    
    return this.eventStatuses.OPEN;
  }

  /**
   * Determine bonus status
   */
  determineBonusStatus(bonus) {
    return this.determineDividendStatus(bonus);
  }

  /**
   * Determine AGM status
   */
  determineAGMStatus(agm) {
    const now = new Date();
    
    if (agm.agm_date && now > new Date(agm.agm_date)) {
      return this.eventStatuses.COMPLETED;
    }
    if (agm.agm_date && now < new Date(agm.agm_date)) {
      return this.eventStatuses.UPCOMING;
    }
    
    return this.eventStatuses.UPCOMING;
  }

  /**
   * Determine stock split status
   */
  determineSplitStatus(split) {
    const now = new Date();
    
    if (split.effective_date && now > new Date(split.effective_date)) {
      return this.eventStatuses.COMPLETED;
    }
    if (split.effective_date && now < new Date(split.effective_date)) {
      return this.eventStatuses.UPCOMING;
    }
    
    return this.eventStatuses.UPCOMING;
  }

  /**
   * Validate IPO event data
   */
  validateIPOEvent(event) {
    if (!event.company_name && !event.symbol) {
      logger.warn('IPO event missing company identification');
    }
    
    if (!event.open_date || !event.close_date) {
      logger.warn('IPO event missing dates');
    }
    
    return true;
  }

  /**
   * Validate dividend event data
   */
  validateDividendEvent(event) {
    if (!event.cash_dividend_percent && !event.bonus_percent) {
      logger.warn('Dividend event has no dividend percentage');
    }
    
    return true;
  }

  /**
   * Validate bonus event data
   */
  validateBonusEvent(event) {
    if (!event.bonus_percent) {
      logger.warn('Bonus event has no bonus percentage');
    }
    
    return true;
  }

  /**
   * Get standardized event schema
   */
  getEventSchema() {
    return {
      id: null,
      event_type: null,
      company_id: null,
      company_name: null,
      symbol: null,
      status: null,
      source: null,
      raw_data: null,
      normalized_at: null,
      
      // Date fields
      announcement_date: null,
      open_date: null,
      close_date: null,
      book_closure_date: null,
      distribution_date: null,
      effective_date: null,
      
      // Financial fields
      percentage: null,
      amount: null,
      units: null,
      price: null,
      
      // Additional fields
      description: null,
      notes: null,
      attachments: null
    };
  }
}

module.exports = new EventNormalizer();