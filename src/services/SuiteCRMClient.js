const axios = require('axios');
const qs = require('qs');

class SuiteCRMClient {
  constructor(config, logger, elevenlabsApiKey = '') {
    this.config = config;
    this.logger = logger;
    this.elevenlabsApiKey = elevenlabsApiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiVersion = config.apiVersion || 'V8';
    this.accessToken = null;
    this.tokenExpiry = null;
    this.axios = axios.create({
      baseURL: `${this.baseUrl}/Api/${this.apiVersion}`,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/vnd.api+json'
      }
    });

    // Add request interceptor for authentication
    this.axios.interceptors.request.use(
      async (config) => {
        await this.ensureAuthenticated();
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for error handling
    this.axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        // If unauthorized, try to re-authenticate once
        if (error.response?.status === 401 && !error.config._retry) {
          error.config._retry = true;
          this.accessToken = null;
          await this.authenticate();
          return this.axios(error.config);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Authenticate with SuiteCRM using OAuth2 client credentials or password grant
   */
  async authenticate() {
    try {
      const startTime = Date.now();

      this.logger.info('Authenticating with SuiteCRM...');

      const tokenUrl = `${this.baseUrl}/Api/access_token`;

      // Use client_credentials grant type by default (as per guide)
      // This is the recommended OAuth2 method for server-to-server communication
      const data = qs.stringify({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      });

      this.logger.info('Using OAuth2 client_credentials grant type');

      const response = await axios.post(tokenUrl, data, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: this.config.timeout
      });

      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      // Set expiry 5 minutes before actual expiry for safety (as per guide)
      this.tokenExpiry = Date.now() + (expiresIn - 300) * 1000;

      const duration = Date.now() - startTime;
      this.logger.logAPICall('SuiteCRM', 'POST', '/access_token', 200, duration);
      this.logger.info('SuiteCRM authentication successful', {
        expiresIn: `${expiresIn}s`,
        grantType: 'client_credentials'
      });

      return true;
    } catch (error) {
      this.logger.error('SuiteCRM authentication failed', error, {
        url: this.config.baseUrl,
        username: this.config.username,
        error: error.response?.data || error.message
      });
      throw new Error(`SuiteCRM authentication failed: ${error.message}`);
    }
  }

  /**
   * Ensure we have a valid access token
   */
  async ensureAuthenticated() {
    // If no token or token expired, authenticate
    if (!this.accessToken || (this.tokenExpiry && Date.now() >= this.tokenExpiry - 60000)) {
      await this.authenticate();
    }
  }

  /**
   * Fetch agent name from ElevenLabs API using agent ID
   * @param {string} agentId - ElevenLabs agent ID
   * @returns {Promise<string|null>} Agent name or null if not found/error
   */
  async getAgentName(agentId) {
    if (!agentId || !this.elevenlabsApiKey) {
      this.logger.debug('Cannot fetch agent name: missing agentId or API key', {
        hasAgentId: !!agentId,
        hasApiKey: !!this.elevenlabsApiKey
      });
      return null;
    }

    try {
      const response = await axios.get(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
        method: 'GET',
        headers: {
          'xi-api-key': this.elevenlabsApiKey
        },
        timeout: 10000
      });

      const agentName = response.data?.name || null;

      if (agentName) {
        this.logger.info('Fetched agent name from ElevenLabs', {
          agentId,
          agentName
        });
      }

      return agentName;
    } catch (error) {
      this.logger.warn('Failed to fetch agent name from ElevenLabs', {
        agentId,
        error: error.message,
        status: error.response?.status
      });
      return null;
    }
  }

  /**
   * Create a call record in SuiteCRM
   */
  async createCall(callData) {
    const startTime = Date.now();

    // Generate a fallback name if not provided
    let callName = callData.name;
    if (!callName) {
      if (callData.callerIdNum) {
        callName = `Call from ${callData.callerIdNum}`;
      } else if (callData.conversationId) {
        callName = `Call - ${callData.conversationId}`;
      } else {
        callName = 'AI Call';
      }
    }

    // Build base attributes (required fields) - outside try/catch for retry use
    const baseAttributes = {
      name: callName,
      status: callData.status || 'Held',
      direction: callData.direction || 'Inbound',
      date_start: callData.startTime || new Date().toISOString(),
      duration_hours: Math.floor((callData.duration || 0) / 3600),
      duration_minutes: Math.floor(((callData.duration || 0) % 3600) / 60),
      description: callData.description || ''
    };

    // Note: The Call module doesn't have a 'phone' field in SuiteCRM
    // Phone numbers should be stored as relationships to Contacts/Accounts
    // or in custom fields if needed

    try {

      // Build custom fields object separately
      const customFields = {};

      if (callData.callerIdName && typeof callData.callerIdName === 'string' && callData.callerIdName.trim()) {
        customFields.caller_id_name_c = callData.callerIdName;
      }

      // Only add conversationId if it's a valid non-empty string
      if (callData.conversationId && typeof callData.conversationId === 'string' && callData.conversationId.trim()) {
        // Truncate to 255 chars if needed to match Varchar(255) constraint
        const truncatedId = callData.conversationId.trim().substring(0, 255);
        customFields.conversation_id_c = truncatedId;
      }

      if (callData.aiSummary && typeof callData.aiSummary === 'string' && callData.aiSummary.trim()) {
        customFields.ai_summary_c = callData.aiSummary;
      }

      if (callData.transcript && typeof callData.transcript === 'string' && callData.transcript.trim()) {
        customFields.call_transcript_c = callData.transcript;
      }

      if (callData.callSuccessful && typeof callData.callSuccessful === 'string' && callData.callSuccessful.trim()) {
        customFields.call_successful_c = callData.callSuccessful;
      }

      // Cost can be 0, so check for null/undefined instead of falsy
      if (callData.cost != null && !isNaN(callData.cost)) {
        customFields.call_cost_c = parseFloat(callData.cost);
      }

      // Try with custom fields first
      const payload = {
        data: {
          type: 'Calls',
          attributes: { ...baseAttributes, ...customFields }
        }
      };

      const response = await this.axios.post('/module', payload);

      const duration = Date.now() - startTime;
      const callId = response.data.data.id;

      this.logger.logAPICall('SuiteCRM', 'POST', '/module/Calls', response.status, duration);
      this.logger.info('Call record created in SuiteCRM', {
        callId,
        callerIdNum: callData.callerIdNum,
        conversationId: callData.conversationId,
        duration: `${duration}ms`,
        hasCustomFields: Object.keys(customFields).length > 0
      });

      return {
        success: true,
        id: callId,
        data: response.data.data
      };
    } catch (error) {
      // If error is about custom fields validation, try again without them
      if (error.response?.status === 400 &&
        error.response?.data?.errors &&
        (error.response.data.errors.title?.includes('conversation_id_c') ||
          error.response.data.errors.detail?.includes('conversation_id_c') ||
          Object.keys(error.response.data.errors).some(key => key.includes('conversation_id_c')))) {

        this.logger.warn('Custom fields validation failed, retrying without custom fields', {
          error: error.response.data.errors
        });

        // Retry with only base attributes (no custom fields)
        try {
          const basePayload = {
            data: {
              type: 'Calls',
              attributes: baseAttributes
            }
          };

          const response = await this.axios.post('/module', basePayload);
          const duration = Date.now() - startTime;
          const callId = response.data.data.id;

          this.logger.logAPICall('SuiteCRM', 'POST', '/module/Calls', response.status, duration);
          this.logger.info('Call record created in SuiteCRM (without custom fields)', {
            callId,
            callerIdNum: callData.callerIdNum,
            conversationId: callData.conversationId,
            duration: `${duration}ms`,
            note: 'Custom fields may not be configured in SuiteCRM - create them using Studio'
          });

          return {
            success: true,
            id: callId,
            data: response.data.data
          };
        } catch (retryError) {
          // Fall through to original error handling
          throw error;
        }
      }

      const errorDetails = {
        callerIdNum: callData.callerIdNum,
        conversationId: callData.conversationId,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        errorData: error.response?.data
      };

      this.logger.error('Failed to create call record in SuiteCRM', error, errorDetails);
      throw error;
    }
  }

  /**
   * Create a call log record in SuiteCRM Call Logs module
   * This is specifically for ElevenLabs AI calls
   * 
   * @param {Object} callLogData - Call log data
   * @param {string} callLogData.name - Call log name
   * @param {string} callLogData.conversationId - ElevenLabs conversation ID
   * @param {string} callLogData.callerName - Caller's name
   * @param {string} callLogData.phoneNumber - Phone number (optional, legacy)
   * @param {string} callLogData.fromNumber - From number (based on direction)
   * @param {string} callLogData.toNumber - To number (based on direction)
   * @param {string} callLogData.callSid - Call SID (unique identifier)
   * @param {string} callLogData.summary - AI-generated summary
   * @param {string} callLogData.transcript - Call transcript
   * @param {string} callLogData.successful - Call successful indicator
   * @param {string|number} callLogData.cost - Call cost
   * @param {string} callLogData.agentId - ElevenLabs agent ID (will automatically fetch agent name)
   * @param {number} callLogData.duration - Call duration in seconds
   * @param {string} callLogData.durationFormatted - Call duration formatted as MM:SS
   * @param {number} callLogData.startTimeUnix - Start time (Unix timestamp)
   * @param {number} callLogData.acceptedTimeUnix - Accepted time (Unix timestamp)
   * @param {string} callLogData.startTimeFormatted - Start time formatted as readable date
   * @param {string} callLogData.acceptedTimeFormatted - Accepted time formatted as readable date
   * @param {string} callLogData.terminationReason - Termination reason
   * @param {string} callLogData.mainLanguage - Main language
   * @param {string} callLogData.callSummaryTitle - Summary title
   * @param {string} callLogData.status - Call status
   * @param {string} callLogData.direction - Call direction (Inbound/Outbound)
   * @param {Object} callLogData.evaluationResults - Evaluation criteria results
   * @param {Object} callLogData.dataCollectionResults - Data collection results
   * @param {Object} callLogData.feedback - Feedback data
   * @param {string} callLogData.authorizationMethod - Authorization method
   * @param {string} callLogData.conversationSource - Conversation source
   * @returns {Promise<Object>} Created call log record
   */
  async createCallLog(callLogData) {
    const startTime = Date.now();

    // Build base attributes (only required fields)
    const baseAttributes = {
      name: callLogData.name || 'Untitled Call Log'
    };

    try {
      // Build custom fields object separately
      const customFields = {};

      // Only add fields if they have valid non-empty values
      if (callLogData.conversationId && typeof callLogData.conversationId === 'string' && callLogData.conversationId.trim()) {
        const truncatedId = callLogData.conversationId.trim().substring(0, 255);
        customFields.conversation_id_c = truncatedId;
      }

      if (callLogData.callerName && typeof callLogData.callerName === 'string' && callLogData.callerName.trim()) {
        customFields.caller_id_name_c = callLogData.callerName;
      }

      if (callLogData.phoneNumber && typeof callLogData.phoneNumber === 'string' && callLogData.phoneNumber.trim()) {
        customFields.phone_c = callLogData.phoneNumber;
      }

      if (callLogData.summary && typeof callLogData.summary === 'string' && callLogData.summary.trim()) {
        customFields.ai_summary_c = callLogData.summary;
      }

      if (callLogData.transcript && typeof callLogData.transcript === 'string' && callLogData.transcript.trim()) {
        customFields.call_transcript_c = callLogData.transcript;
      }

      if (callLogData.successful && typeof callLogData.successful === 'string' && callLogData.successful.trim()) {
        customFields.call_successful_c = callLogData.successful;
      }

      if (callLogData.cost != null && !isNaN(callLogData.cost)) {
        customFields.call_cost_c = parseFloat(callLogData.cost);
      }

      // Agent information - fetch agent name from ElevenLabs API
      if (callLogData.agentId && typeof callLogData.agentId === 'string' && callLogData.agentId.trim()) {
        const agentId = callLogData.agentId.trim();

        // Fetch agent name from ElevenLabs API and store it
        const agentName = await this.getAgentName(agentId);
        if (agentName) {
          customFields.agent_name_c = agentName.substring(0, 255);
        }
      }

      // Timing information - only use fields that exist in SuiteCRM
      if (callLogData.durationFormatted && typeof callLogData.durationFormatted === 'string' && callLogData.durationFormatted.trim()) {
        customFields.call_duration_formatted_c = callLogData.durationFormatted.substring(0, 50);
      }

      // Formatted timestamps - only use fields that exist in SuiteCRM
      if (callLogData.startTimeFormatted && typeof callLogData.startTimeFormatted === 'string' && callLogData.startTimeFormatted.trim()) {
        customFields.start_time_formatted_c = callLogData.startTimeFormatted.substring(0, 100);
      }

      if (callLogData.acceptedTimeFormatted && typeof callLogData.acceptedTimeFormatted === 'string' && callLogData.acceptedTimeFormatted.trim()) {
        customFields.accepted_time_formatted_c = callLogData.acceptedTimeFormatted.substring(0, 100);
      }

      // Call metadata
      if (callLogData.terminationReason && typeof callLogData.terminationReason === 'string' && callLogData.terminationReason.trim()) {
        customFields.termination_reason_c = callLogData.terminationReason;
      }

      if (callLogData.mainLanguage && typeof callLogData.mainLanguage === 'string' && callLogData.mainLanguage.trim()) {
        customFields.main_language_c = callLogData.mainLanguage.substring(0, 50);
      }

      if (callLogData.callSummaryTitle && typeof callLogData.callSummaryTitle === 'string' && callLogData.callSummaryTitle.trim()) {
        customFields.call_summary_title_c = callLogData.callSummaryTitle.substring(0, 255);
      }

      if (callLogData.status && typeof callLogData.status === 'string' && callLogData.status.trim()) {
        customFields.call_status_c = callLogData.status.substring(0, 50);
      }

      // Call direction - note: field name is "directions_c" (plural) in SuiteCRM
      if (callLogData.direction && typeof callLogData.direction === 'string' && callLogData.direction.trim()) {
        customFields.directions_c = callLogData.direction;
      }

      // Phone numbers - store explicit agent and customer numbers
      if (callLogData.agentNumber && typeof callLogData.agentNumber === 'string' && callLogData.agentNumber.trim()) {
        customFields.agent_number_c = callLogData.agentNumber;
      }

      if (callLogData.externalNumber && typeof callLogData.externalNumber === 'string' && callLogData.externalNumber.trim()) {
        customFields.customer_number_c = callLogData.externalNumber;
      }

      // Call SID (unique identifier)
      if (callLogData.callSid && typeof callLogData.callSid === 'string' && callLogData.callSid.trim()) {
        customFields.call_sid_c = callLogData.callSid;
      }

      // Analysis results (store as JSON strings)
      if (callLogData.evaluationResults && typeof callLogData.evaluationResults === 'object') {
        try {
          customFields.evaluation_criteria_c = JSON.stringify(callLogData.evaluationResults);
        } catch (e) {
          // If JSON stringify fails, skip this field
        }
      }

      if (callLogData.dataCollectionResults && typeof callLogData.dataCollectionResults === 'object') {
        try {
          customFields.data_collection_results_c = JSON.stringify(callLogData.dataCollectionResults);
        } catch (e) {
          // If JSON stringify fails, skip this field
        }
      }

      if (callLogData.feedback && typeof callLogData.feedback === 'object') {
        try {
          customFields.feedback_data_c = JSON.stringify(callLogData.feedback);
        } catch (e) {
          // If JSON stringify fails, skip this field
        }
      }

      // Conversation initiation metadata
      if (callLogData.authorizationMethod && typeof callLogData.authorizationMethod === 'string' && callLogData.authorizationMethod.trim()) {
        customFields.authorization_method_c = callLogData.authorizationMethod.substring(0, 100);
      }

      if (callLogData.conversationSource && typeof callLogData.conversationSource === 'string' && callLogData.conversationSource.trim()) {
        customFields.conversation_source_c = callLogData.conversationSource.substring(0, 100);
      }

      // Try with custom fields first
      const payload = {
        data: {
          type: 'CLL_CallLog',
          attributes: { ...baseAttributes, ...customFields }
        }
      };

      const response = await this.axios.post('/module', payload);

      const duration = Date.now() - startTime;
      const callLogId = response.data.data.id;

      this.logger.logAPICall('SuiteCRM', 'POST', '/module/CLL_CallLog', response.status, duration);
      this.logger.info('Call log record created in SuiteCRM', {
        callLogId,
        conversationId: callLogData.conversationId,
        duration: `${duration}ms`,
        hasCustomFields: Object.keys(customFields).length > 0
      });

      return {
        success: true,
        id: callLogId,
        data: response.data.data
      };
    } catch (error) {
      // If error is about custom fields validation, try again without them
      if (error.response?.status === 400 &&
        error.response?.data?.errors &&
        (error.response.data.errors.title?.includes('invalid') ||
          error.response.data.errors.detail ||
          Object.keys(error.response.data.errors).some(key =>
            error.response.data.errors[key]?.includes('invalid')
          ))) {

        this.logger.warn('Custom fields validation failed in Call Log, retrying without custom fields', {
          error: error.response.data.errors
        });

        // Retry with only base attributes (no custom fields)
        try {
          const basePayload = {
            data: {
              type: 'CLL_CallLog',
              attributes: baseAttributes
            }
          };

          const response = await this.axios.post('/module', basePayload);
          const duration = Date.now() - startTime;
          const callLogId = response.data.data.id;

          this.logger.logAPICall('SuiteCRM', 'POST', '/module/CLL_CallLog', response.status, duration);
          this.logger.info('Call log record created in SuiteCRM (without custom fields)', {
            callLogId,
            conversationId: callLogData.conversationId,
            duration: `${duration}ms`,
            note: 'Custom fields may not be configured in SuiteCRM - create them using Studio'
          });

          return {
            success: true,
            id: callLogId,
            data: response.data.data
          };
        } catch (retryError) {
          // Fall through to original error handling
          throw error;
        }
      }

      const errorDetails = {
        conversationId: callLogData.conversationId,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        errorData: error.response?.data
      };

      this.logger.error('Failed to create call log record in SuiteCRM', error, errorDetails);
      throw error;
    }
  }

  /**
   * Update a call log record
   * 
   * @param {string} recordId - Record ID to update
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated call log record
   */
  async updateCallLog(recordId, updates) {
    try {
      const startTime = Date.now();

      const payload = {
        data: {
          type: 'CLL_CallLog',
          id: recordId,
          attributes: updates
        }
      };

      const response = await this.axios.patch('/module', payload);

      const duration = Date.now() - startTime;

      this.logger.logAPICall('SuiteCRM', 'PATCH', `/module/CLL_CallLog/${recordId}`, response.status, duration);
      this.logger.info('Call log record updated in SuiteCRM', {
        recordId,
        duration: `${duration}ms`
      });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      this.logger.error('Failed to update call log record in SuiteCRM', error, { recordId });
      throw error;
    }
  }

  /**
   * Update an existing call record
   */
  async updateCall(callId, updates) {
    try {
      const startTime = Date.now();

      const payload = {
        data: {
          type: 'Calls',
          id: callId,
          attributes: updates
        }
      };

      const response = await this.axios.patch('/module', payload);

      const duration = Date.now() - startTime;

      this.logger.logAPICall('SuiteCRM', 'PATCH', `/module/Calls/${callId}`, response.status, duration);
      this.logger.info('Call record updated in SuiteCRM', {
        callId,
        duration: `${duration}ms`
      });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      this.logger.error('Failed to update call record in SuiteCRM', error, { callId });
      throw error;
    }
  }

  /**
   * Get a call record by ID
   */
  async getCall(callId) {
    try {
      const startTime = Date.now();

      const response = await this.axios.get(`/module/Calls/${callId}`);

      const duration = Date.now() - startTime;

      this.logger.logAPICall('SuiteCRM', 'GET', `/module/Calls/${callId}`, response.status, duration);

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      this.logger.error('Failed to get call record from SuiteCRM', error, { callId });
      throw error;
    }
  }

  /**
   * Search for contacts by phone number
   */
  async searchContactByPhone(phoneNumber) {
    try {
      const startTime = Date.now();

      // Clean phone number (remove non-digits)
      const cleanPhone = phoneNumber.replace(/\D/g, '');

      // Search in Contacts module
      const response = await this.axios.get('/module/Contacts', {
        params: {
          'filter[phone_mobile][eq]': phoneNumber,
          'fields[Contacts]': 'id,first_name,last_name,phone_mobile,phone_work,email1'
        }
      });

      const duration = Date.now() - startTime;

      this.logger.logAPICall('SuiteCRM', 'GET', '/module/Contacts (search)', response.status, duration);

      const contacts = response.data.data || [];

      if (contacts.length > 0) {
        this.logger.info('Contact found by phone number', {
          phoneNumber,
          contactId: contacts[0].id,
          name: `${contacts[0].attributes.first_name} ${contacts[0].attributes.last_name}`
        });
      }

      return {
        success: true,
        found: contacts.length > 0,
        data: contacts
      };
    } catch (error) {
      this.logger.error('Failed to search contact in SuiteCRM', error, { phoneNumber });
      return {
        success: false,
        found: false,
        data: []
      };
    }
  }

  /**
   * Search for accounts by phone number
   */
  async searchAccountByPhone(phoneNumber) {
    try {
      const startTime = Date.now();

      const response = await this.axios.get('/module/Accounts', {
        params: {
          'filter[phone_office][eq]': phoneNumber,
          'fields[Accounts]': 'id,name,phone_office,phone_alternate,email1'
        }
      });

      const duration = Date.now() - startTime;

      this.logger.logAPICall('SuiteCRM', 'GET', '/module/Accounts (search)', response.status, duration);

      const accounts = response.data.data || [];

      return {
        success: true,
        found: accounts.length > 0,
        data: accounts
      };
    } catch (error) {
      this.logger.error('Failed to search account in SuiteCRM', error, { phoneNumber });
      return {
        success: false,
        found: false,
        data: []
      };
    }
  }

  /**
   * Create a relationship between call and contact
   */
  async linkCallToContact(callId, contactId) {
    try {
      const startTime = Date.now();

      const payload = {
        data: {
          type: 'Contacts',
          id: contactId
        }
      };

      const response = await this.axios.post(
        `/module/Calls/${callId}/relationships/contacts`,
        payload
      );

      const duration = Date.now() - startTime;

      this.logger.logAPICall('SuiteCRM', 'POST', `/module/Calls/${callId}/relationships/contacts`, response.status, duration);
      this.logger.info('Call linked to contact', { callId, contactId });

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to link call to contact', error, { callId, contactId });
      throw error;
    }
  }

  /**
   * Create a relationship between call and account
   */
  async linkCallToAccount(callId, accountId) {
    try {
      const startTime = Date.now();

      const payload = {
        data: {
          type: 'Accounts',
          id: accountId
        }
      };

      const response = await this.axios.post(
        `/module/Calls/${callId}/relationships/accounts`,
        payload
      );

      const duration = Date.now() - startTime;

      this.logger.logAPICall('SuiteCRM', 'POST', `/module/Calls/${callId}/relationships/accounts`, response.status, duration);
      this.logger.info('Call linked to account', { callId, accountId });

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to link call to account', error, { callId, accountId });
      throw error;
    }
  }

  /**
   * Process call with retry logic
   */
  async processCallWithRetry(callData) {
    let lastError;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await this.createCall(callData);
      } catch (error) {
        lastError = error;

        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelay * attempt;
          this.logger.warn(`Retry attempt ${attempt} after ${delay}ms`, {
            error: error.message
          });
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate configuration before attempting connection
   * Supports both password and client_credentials grant types
   */
  validateConfig() {
    const required = ['baseUrl', 'clientId', 'clientSecret'];
    const missing = required.filter(field => !this.config[field]);

    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }

    // Validate URL format
    try {
      new URL(this.config.baseUrl);
    } catch (error) {
      throw new Error(`Invalid baseUrl: ${this.config.baseUrl}`);
    }

    this.logger.info('SuiteCRM will use OAuth2 client_credentials grant authentication');
    this.logger.info('SuiteCRM configuration validated successfully');
    return true;
  }

  /**
 * Test basic API connectivity without authentication
 */
  async testAPIConnectivity() {
    try {
      this.logger.info('Testing SuiteCRM API connectivity...');

      // Test if base URL is reachable
      const response = await axios.get(this.baseUrl, {
        timeout: 5000,
        validateStatus: null // Don't throw on any status code
      });

      this.logger.info('SuiteCRM base URL is reachable', {
        status: response.status,
        statusText: response.statusText
      });

      // Test API endpoints
      const apiEndpoints = [
        '/Api/V8/meta/modules',
        '/legacy/Api/V8/meta/modules',
        '/api/V8/meta/modules'
      ];

      for (const endpoint of apiEndpoints) {
        try {
          const apiResponse = await axios.get(this.baseUrl + endpoint, {
            timeout: 5000,
            validateStatus: null
          });

          this.logger.info(`API endpoint test: ${endpoint}`, {
            status: apiResponse.status
          });

          if (apiResponse.status === 200) {
            return { reachable: true, workingEndpoint: endpoint };
          }
        } catch (error) {
          this.logger.warn(`API endpoint failed: ${endpoint}`, {
            error: error.message
          });
        }
      }

      return { reachable: true, workingEndpoint: null };
    } catch (error) {
      this.logger.error('SuiteCRM API connectivity test failed', error);
      return { reachable: false, error: error.message };
    }
  }

  /**
   * Test connection to SuiteCRM
   */
  async testConnection() {
    try {
      // First test basic connectivity
      const connectivity = await this.testAPIConnectivity();

      if (!connectivity.reachable) {
        throw new Error(`Cannot reach SuiteCRM server: ${connectivity.error}`);
      }

      // Then test authentication
      await this.authenticate();

      // Finally test API access with a simple request
      const response = await this.axios.get('/meta/modules', {
        timeout: 10000
      });

      this.logger.info('SuiteCRM connection test successful', {
        modulesCount: response.data.data?.length || 0
      });

      return {
        success: true,
        baseUrl: this.config.baseUrl,
        modulesCount: response.data.data?.length || 0
      };
    } catch (error) {
      const errorInfo = {
        baseUrl: this.config.baseUrl,
        error: error.message,
        suggestion: 'Check OAuth2 configuration and API endpoints'
      };

      this.logger.error('SuiteCRM connection test failed', error, errorInfo);

      return {
        success: false,
        error: error.message,
        details: errorInfo
      };
    }
  }
}

module.exports = SuiteCRMClient;

