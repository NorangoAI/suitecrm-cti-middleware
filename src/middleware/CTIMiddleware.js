const EventEmitter = require('events');

/**
 * CTI Middleware - Main orchestrator for FreePBX, ElevenLabs, and SuiteCRM integration
 */
class CTIMiddleware extends EventEmitter {
  constructor(freepbxClient, elevenLabsWebhook, suitecrmClient, wsServer, logger) {
    super();
    this.freepbx = freepbxClient;
    this.elevenlabs = elevenLabsWebhook;
    this.suitecrm = suitecrmClient;
    this.wsServer = wsServer;
    this.logger = logger;

    // Store active calls with their data
    this.activeCalls = new Map(); // uniqueId -> call data

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for all services
   */
  setupEventHandlers() {
    // FreePBX AMI Events
    this.freepbx.on('call:new', (callData) => this.handleNewCall(callData));
    this.freepbx.on('call:state', (callData) => this.handleCallState(callData));
    this.freepbx.on('call:dial', (callData) => this.handleDial(callData));
    this.freepbx.on('call:hangup', (callData) => this.handleHangup(callData));
    this.freepbx.on('call:bridge', (callData) => this.handleBridge(callData));

    // ElevenLabs Webhook Events
    this.elevenlabs.on('post_call_transcription', (event) => this.handlePostCallTranscription(event));

    this.logger.info('CTI Middleware event handlers configured');
  }

  /**
   * Initialize the middleware
   */
  async initialize() {
    try {
      this.logger.info('Initializing CTI Middleware...');

      // Test SuiteCRM connection (optional - log warning if fails)
      try {
        await this.suitecrm.validateConfig();
        const connectivity = await this.suitecrm.testAPIConnectivity();

        if (!connectivity.reachable) {
          throw new Error('SuiteCRM server is not reachable');
        }

        const connectionTest = await this.suitecrm.testConnection();
        if (!connectionTest.success) {
          throw new Error(`Connection test failed: ${connectionTest.error}`);
        }

        this.logger.info('SuiteCRM connected successfully');
      } catch (error) {
        this.logger.error('SuiteCRM initialization failed', error);
        // Disable CRM features but continue running
      }

      // Connect to FreePBX AMI
      // try {
      //   await this.freepbx.connect();
      //   this.logger.info('FreePBX AMI connection successful');
      // } catch (error) {
      //   this.logger.warn('FreePBX AMI connection failed - call tracking will be disabled', {
      //     error: error.message,
      //     hint: 'Configure AMI_HOST, AMI_USERNAME, AMI_SECRET in .env'
      //   });
      // }

      this.logger.info('CTI Middleware initialized (some services may be disabled)');
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize CTI Middleware', error);
      throw error;
    }
  }

  /**
   * Check if SuiteCRM is available
   */
  isSuiteCRMAvailable() {
    return this.suitecrm && this.suitecrm.accessToken !== null;
  }

  /**
   * Check if FreePBX is connected
   */
  isFreePBXConnected() {
    // return this.freepbx && this.freepbx.isConnected();
    return false;
  }

  /**
   * Handle new call event from FreePBX
   */
  async handleNewCall(callData) {
    try {
      this.logger.info('Processing new call', {
        callerId: callData.callerIdNum,
        channel: callData.channel
      });

      // Store call data
      this.activeCalls.set(callData.uniqueId, {
        ...callData,
        startTime: new Date().toISOString(),
        events: ['new']
      });

      // Search for existing contact in SuiteCRM (if available)
      let contactResult = { found: false, data: [] };
      let accountResult = { found: false, data: [] };

      if (this.isSuiteCRMAvailable()) {
        try {
          contactResult = await this.suitecrm.searchContactByPhone(callData.callerIdNum);
          accountResult = await this.suitecrm.searchAccountByPhone(callData.callerIdNum);
        } catch (error) {
          this.logger.warn('Failed to search CRM for caller', { error: error.message });
        }
      }

      // Prepare screen pop data
      const screenPopData = {
        callerIdNum: callData.callerIdNum,
        callerIdName: callData.callerIdName,
        channel: callData.channel,
        uniqueId: callData.uniqueId,
        timestamp: callData.timestamp,
        contact: contactResult.found ? contactResult.data[0] : null,
        account: accountResult.found ? accountResult.data[0] : null
      };

      // Store contact/account info in active call
      const activeCall = this.activeCalls.get(callData.uniqueId);
      if (activeCall) {
        activeCall.contact = screenPopData.contact;
        activeCall.account = screenPopData.account;
      }

      // Send screen pop to agents via WebSocket
      this.wsServer.sendCallUpdate(screenPopData);

      // If extension is available, send targeted screen pop
      if (callData.exten) {
        this.wsServer.sendScreenPop(callData.exten, screenPopData);
      }

      this.emit('call:processed', {
        uniqueId: callData.uniqueId,
        contactFound: contactResult.found,
        accountFound: accountResult.found
      });

    } catch (error) {
      this.logger.error('Error handling new call', error, {
        callerId: callData.callerIdNum
      });
    }
  }

  /**
   * Handle call state changes
   */
  async handleCallState(callData) {
    const activeCall = this.activeCalls.get(callData.uniqueId);

    if (activeCall) {
      activeCall.state = callData.state;
      activeCall.stateDesc = callData.stateDesc;
      activeCall.events.push(`state:${callData.stateDesc}`);

      this.logger.debug('Call state changed', {
        uniqueId: callData.uniqueId,
        state: callData.stateDesc
      });
    }
  }

  /**
   * Handle dial event
   */
  async handleDial(callData) {
    this.logger.info('Dial event', {
      from: callData.callerIdNum,
      to: callData.destination,
      status: callData.dialStatus
    });

    // Send dial update to WebSocket clients
    this.wsServer.sendCallUpdate({
      type: 'dial',
      ...callData
    });
  }

  /**
   * Handle call hangup
   */
  async handleHangup(callData) {
    try {
      this.logger.info('Processing call hangup', {
        callerId: callData.callerIdNum,
        duration: callData.duration,
        cause: callData.causeTxt
      });

      const activeCall = this.activeCalls.get(callData.uniqueId);

      if (activeCall) {
        activeCall.endTime = new Date().toISOString();
        activeCall.duration = callData.duration;
        activeCall.hangupCause = callData.causeTxt;
        activeCall.events.push('hangup');

        // Create call record in SuiteCRM (if available)
        if (this.isSuiteCRMAvailable()) {
          try {
            const crmCallData = {
              name: `Call from ${callData.callerIdNum}`,
              callerIdNum: callData.callerIdNum,
              callerIdName: callData.callerIdName || activeCall.callerIdName,
              startTime: activeCall.startTime,
              duration: callData.duration,
              status: 'Held',
              direction: 'Inbound',
              description: `Call ended: ${callData.causeTxt}\nChannel: ${callData.channel}`,
              conversationId: activeCall.conversationId // Will be added by webhook if available
            };

            const result = await this.suitecrm.createCall(crmCallData);

            if (result.success) {
              activeCall.crmCallId = result.id;

              // Link to contact if found
              if (activeCall.contact?.id) {
                await this.suitecrm.linkCallToContact(result.id, activeCall.contact.id);
              }

              // Link to account if found
              if (activeCall.account?.id) {
                await this.suitecrm.linkCallToAccount(result.id, activeCall.account.id);
              }

              this.logger.info('Call record created in CRM', {
                crmCallId: result.id,
                uniqueId: callData.uniqueId
              });
            }
          } catch (error) {
            this.logger.error('Failed to create call record in CRM', error);
          }
        } else {
          this.logger.debug('Skipping CRM call record creation - SuiteCRM not available');
        }

        // Send hangup notification to WebSocket clients
        this.wsServer.sendCallUpdate({
          type: 'hangup',
          ...callData,
          crmCallId: activeCall.crmCallId
        });

        // Keep call data for webhook correlation (don't delete yet)
        // Will be cleaned up after webhook or timeout
      }

    } catch (error) {
      this.logger.error('Error handling call hangup', error, {
        callerId: callData.callerIdNum
      });
    }
  }

  /**
   * Handle bridge event (calls connected)
   */
  async handleBridge(callData) {
    this.logger.info('Calls bridged', {
      channel1: callData.channel1,
      channel2: callData.channel2
    });

    // Send bridge notification
    this.wsServer.sendCallUpdate({
      type: 'bridge',
      ...callData
    });
  }

  /**
   * Handle post-call transcription from ElevenLabs
   */
  async handlePostCallTranscription(event) {
    try {
      const callData = this.elevenlabs.extractCallData(event);

      this.logger.info('Processing post-call transcription', {
        conversationId: callData.conversationId,
        duration: callData.duration,
        callSuccessful: callData.callSuccessful,
        phoneNumber: callData.phoneNumber || '(not provided)',
        userName: callData.userName || '(not provided)'
      });

      // Find matching active call by conversation ID or phone number
      let matchingCall = null;

      // Try to find by conversation ID if stored
      for (const [uniqueId, call] of this.activeCalls.entries()) {
        if (call.conversationId === callData.conversationId) {
          matchingCall = { uniqueId, ...call };
          break;
        }
      }

      // If call already has CRM record, update it with AI data (if SuiteCRM available)
      if (matchingCall?.crmCallId && this.isSuiteCRMAvailable()) {
        try {
          const transcript = this.elevenlabs.formatTranscript(callData.transcript);

          const updates = {
            ai_summary_c: callData.summary,
            call_transcript_c: transcript,
            call_successful_c: callData.callSuccessful,
            call_cost_c: callData.cost,
            conversation_id_c: callData.conversationId
          };

          await this.suitecrm.updateCall(matchingCall.crmCallId, updates);

          // Also create a record in Call Logs module for better organization
          try {
            await this.suitecrm.createCallLog({
              name: `Call Log - ${callData.conversationId}`,
              conversationId: callData.conversationId,
              callerName: callData.userName || matchingCall.callerIdName || '',
              phoneNumber: callData.phoneNumber || matchingCall.callerIdNum || '',
              fromNumber: callData.fromNumber || '',
              toNumber: callData.toNumber || '',
              callSid: callData.callSid || '',
              summary: callData.summary,
              transcript: transcript,
              successful: callData.callSuccessful,
              cost: callData.cost,
              // Additional fields
              agentId: callData.agentId,
              duration: callData.duration,
              durationFormatted: callData.durationFormatted,
              startTimeUnix: callData.startTimeUnix,
              acceptedTimeUnix: callData.acceptedTimeUnix,
              startTimeFormatted: callData.startTimeFormatted,
              acceptedTimeFormatted: callData.acceptedTimeFormatted,
              terminationReason: callData.terminationReason,
              mainLanguage: callData.mainLanguage,
              callSummaryTitle: callData.callSummaryTitle,
              status: callData.status,
              direction: callData.direction,
              evaluationResults: callData.evaluationResults,
              dataCollectionResults: callData.dataCollectionResults,
              feedback: callData.feedback,
              authorizationMethod: callData.authorizationMethod,
              conversationSource: callData.conversationSource
            });
          } catch (logError) {
            // Log but don't fail - Call Logs module might not be installed
            this.logger.warn('Failed to create call log record (module may not be installed)', {
              error: logError.message
            });
          }

          this.logger.info('Call record updated with AI data', {
            crmCallId: matchingCall.crmCallId,
            conversationId: callData.conversationId
          });

          // Clean up active call data
          this.activeCalls.delete(matchingCall.uniqueId);
        } catch (error) {
          this.logger.error('Failed to update CRM with AI data', error);
        }
      } else if (this.isSuiteCRMAvailable()) {
        // Create new call record if not found (webhook arrived before AMI hangup)
        try {
          this.logger.warn('Creating call record from webhook (no matching AMI call found)', {
            conversationId: callData.conversationId
          });

          const transcript = this.elevenlabs.formatTranscript(callData.transcript);

          const crmCallData = {
            name: `AI Call - ${callData.conversationId}`,
            startTime: new Date(callData.startTime * 1000).toISOString(),
            duration: callData.duration,
            status: 'Held',
            direction: 'Inbound',
            description: `AI-assisted call\nTermination: ${callData.terminationReason}\nAgent ID: ${callData.agentId}`,
            callerIdName: callData.userName || '',
            callerIdNum: callData.phoneNumber || '',
            aiSummary: callData.summary,
            transcript: transcript,
            callSuccessful: callData.callSuccessful,
            cost: callData.cost,
            conversationId: callData.conversationId
          };

          await this.suitecrm.createCall(crmCallData);

          // Also create a record in Call Logs module
          try {
            await this.suitecrm.createCallLog({
              name: `Call Log - ${callData.conversationId}`,
              conversationId: callData.conversationId,
              callerName: callData.userName || '',
              phoneNumber: callData.phoneNumber || '',
              fromNumber: callData.fromNumber || '',
              toNumber: callData.toNumber || '',
              callSid: callData.callSid || '',
              summary: callData.summary,
              transcript: transcript,
              successful: callData.callSuccessful,
              cost: callData.cost,
              // Additional fields
              agentId: callData.agentId,
              duration: callData.duration,
              durationFormatted: callData.durationFormatted,
              startTimeUnix: callData.startTimeUnix,
              acceptedTimeUnix: callData.acceptedTimeUnix,
              startTimeFormatted: callData.startTimeFormatted,
              acceptedTimeFormatted: callData.acceptedTimeFormatted,
              terminationReason: callData.terminationReason,
              mainLanguage: callData.mainLanguage,
              callSummaryTitle: callData.callSummaryTitle,
              status: callData.status,
              direction: callData.direction,
              evaluationResults: callData.evaluationResults,
              dataCollectionResults: callData.dataCollectionResults,
              feedback: callData.feedback,
              authorizationMethod: callData.authorizationMethod,
              conversationSource: callData.conversationSource
            });
          } catch (logError) {
            // Log but don't fail - Call Logs module might not be installed
            this.logger.warn('Failed to create call log record (module may not be installed)', {
              error: logError.message
            });
          }
        } catch (error) {
          this.logger.error('Failed to create CRM call record from webhook', error);
        }
      } else {
        this.logger.debug('Skipping CRM update - SuiteCRM not available');
      }

      // Send AI summary to WebSocket clients
      this.wsServer.broadcast({
        type: 'ai_transcription',
        conversationId: callData.conversationId,
        summary: callData.summary,
        callSuccessful: callData.callSuccessful,
        timestamp: new Date().toISOString()
      });

      this.emit('transcription:processed', {
        conversationId: callData.conversationId,
        success: true
      });

    } catch (error) {
      this.logger.error('Error handling post-call transcription', error, {
        conversationId: event.data?.conversation_id
      });
    }
  }

  /**
   * Link conversation ID to active call (can be called externally)
   */
  linkConversationToCall(uniqueId, conversationId) {
    const activeCall = this.activeCalls.get(uniqueId);

    if (activeCall) {
      activeCall.conversationId = conversationId;
      this.logger.info('Conversation ID linked to call', {
        uniqueId,
        conversationId
      });
      return true;
    }

    return false;
  }

  /**
   * Get active call by unique ID
   */
  getActiveCall(uniqueId) {
    return this.activeCalls.get(uniqueId);
  }

  /**
   * Get all active calls
   */
  getAllActiveCalls() {
    return Array.from(this.activeCalls.values());
  }

  /**
   * Clean up old calls (called periodically)
   */
  cleanupOldCalls(maxAgeMinutes = 60) {
    const now = Date.now();
    const maxAge = maxAgeMinutes * 60 * 1000;
    let cleaned = 0;

    for (const [uniqueId, call] of this.activeCalls.entries()) {
      const callAge = now - new Date(call.startTime).getTime();

      if (callAge > maxAge) {
        this.activeCalls.delete(uniqueId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} old call(s) from memory`);
    }

    return cleaned;
  }

  /**
   * Get middleware statistics
   */
  getStats() {
    return {
      activeCalls: this.activeCalls.size,
      freepbxConnected: this.isFreePBXConnected(),
      suitecrmConnected: this.isSuiteCRMAvailable(),
      wsConnections: this.wsServer.getConnectionsCount(),
      connectedAgents: this.wsServer.getConnectedAgents()
    };
  }

  /**
   * Shutdown middleware gracefully
   */
  async shutdown() {
    this.logger.info('Shutting down CTI Middleware...');

    try {
      this.freepbx.disconnect();
      this.wsServer.close();

      this.logger.info('CTI Middleware shutdown complete');
    } catch (error) {
      this.logger.error('Error during shutdown', error);
    }
  }
}

module.exports = CTIMiddleware;

