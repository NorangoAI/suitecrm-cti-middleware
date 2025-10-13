const axios = require('axios');
const qs = require('qs');

class SuiteCRMClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
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
   * Authenticate with SuiteCRM using OAuth2 password grant
   */
  async authenticate() {
    try {
      const startTime = Date.now();

      this.logger.info('Authenticating with SuiteCRM...');

      const tokenUrl = `${this.baseUrl}/Api/access_token`;

      const data = qs.stringify({
        grant_type: 'password',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        username: this.config.username,
        password: this.config.password,
        scope: ''
      });

      const response = await axios.post(tokenUrl, data, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: this.config.timeout
      });

      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiry = Date.now() + (expiresIn * 1000);

      const duration = Date.now() - startTime;
      this.logger.logAPICall('SuiteCRM', 'POST', '/access_token', 200, duration);
      this.logger.info('SuiteCRM authentication successful', {
        expiresIn: `${expiresIn}s`
      });

      return true;
    } catch (error) {
      this.logger.error('SuiteCRM authentication failed', error, {
        url: this.config.baseUrl,
        username: this.config.username
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
   * Create a call record in SuiteCRM
   */
  async createCall(callData) {
    try {
      const startTime = Date.now();

      const payload = {
        data: {
          type: 'Calls',
          attributes: {
            name: callData.name || `Call from ${callData.callerIdNum}`,
            status: callData.status || 'Held',
            direction: callData.direction || 'Inbound',
            date_start: callData.startTime || new Date().toISOString(),
            duration_hours: Math.floor((callData.duration || 0) / 3600),
            duration_minutes: Math.floor(((callData.duration || 0) % 3600) / 60),
            description: callData.description || '',
            phone: callData.callerIdNum || '',
            caller_id_name_c: callData.callerIdName || '',
            conversation_id_c: callData.conversationId || '',
            ai_summary_c: callData.aiSummary || '',
            call_transcript_c: callData.transcript || '',
            call_successful_c: callData.callSuccessful || '',
            call_cost_c: callData.cost || 0
          }
        }
      };

      const response = await this.axios.post('/module', payload);

      const duration = Date.now() - startTime;
      const callId = response.data.data.id;

      this.logger.logAPICall('SuiteCRM', 'POST', '/module/Calls', response.status, duration);
      this.logger.info('Call record created in SuiteCRM', {
        callId,
        callerIdNum: callData.callerIdNum,
        duration: `${duration}ms`
      });

      return {
        success: true,
        id: callId,
        data: response.data.data
      };
    } catch (error) {
      this.logger.error('Failed to create call record in SuiteCRM', error, {
        callerIdNum: callData.callerIdNum
      });
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
   * Test connection to SuiteCRM
   */
  async testConnection() {
    try {
      await this.authenticate();

      // Try to fetch modules to verify API access
      const response = await this.axios.get('/meta/modules');

      this.logger.info('SuiteCRM connection test successful', {
        modulesCount: response.data.data?.length || 0
      });

      return true;
    } catch (error) {
      this.logger.error('SuiteCRM connection test failed', error);
      return false;
    }
  }
}

module.exports = SuiteCRMClient;

