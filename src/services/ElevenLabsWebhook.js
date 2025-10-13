const crypto = require('crypto');
const express = require('express');

class ElevenLabsWebhook {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.secret = config.webhookSecret;
    this.timestampTolerance = config.timestampTolerance || 1800; // 30 minutes default
    this.router = express.Router();
    this.handlers = new Map();

    this.setupRoutes();
  }

  /**
   * Set up webhook routes
   */
  setupRoutes() {
    // Health check endpoint
    this.router.get(this.config.webhookPath, (req, res) => {
      res.json({ status: 'webhook listening', service: 'elevenlabs' });
    });

    // Main webhook endpoint
    this.router.post(this.config.webhookPath, express.raw({ type: 'application/json' }), async (req, res) => {
      try {
        const startTime = Date.now();

        // Get signature from headers
        const signatureHeader = req.headers[this.config.signatureHeader.toLowerCase()];

        if (!signatureHeader) {
          this.logger.warn('Webhook received without signature header', {
            ip: req.ip,
            path: req.path
          });
          return res.status(400).json({ error: 'Missing signature header' });
        }

        // Verify signature
        const { valid, error } = this.verifySignature(req.body, signatureHeader);

        if (!valid) {
          this.logger.error('Webhook signature verification failed', null, {
            error,
            ip: req.ip
          });
          return res.status(401).json({ error: error || 'Invalid signature' });
        }

        // Parse body
        const event = JSON.parse(req.body.toString('utf-8'));

        this.logger.logWebhook('ElevenLabs', event.type, {
          eventType: event.type,
          timestamp: event.event_timestamp,
          agentId: event.data?.agent_id,
          conversationId: event.data?.conversation_id
        });

        // Process the webhook event
        await this.processWebhookEvent(event);

        const duration = Date.now() - startTime;
        this.logger.info('Webhook processed successfully', {
          eventType: event.type,
          duration: `${duration}ms`
        });

        // Always return 200 quickly
        res.status(200).json({ received: true });
      } catch (error) {
        this.logger.error('Error processing webhook', error, {
          path: req.path,
          ip: req.ip
        });

        // Still return 200 to prevent webhook retry storms
        res.status(200).json({ received: true, error: 'Processing error' });
      }
    });
  }

  /**
   * Verify HMAC signature from ElevenLabs
   */
  verifySignature(payload, signatureHeader) {
    try {
      // Parse signature header: "t=timestamp,v0=hash"
      const headers = signatureHeader.split(',');
      const timestamp = headers.find((e) => e.startsWith('t='))?.substring(2);
      const signature = headers.find((e) => e.startsWith('v0='));

      if (!timestamp || !signature) {
        return { valid: false, error: 'Invalid signature format' };
      }

      // Validate timestamp (prevent replay attacks)
      const reqTimestamp = Number(timestamp) * 1000;
      const tolerance = Date.now() - (this.timestampTolerance * 1000);

      if (reqTimestamp < tolerance) {
        return { valid: false, error: 'Request expired' };
      }

      // Skip signature validation if secret is not configured (dev mode)
      if (!this.secret) {
        this.logger.warn('Webhook secret not configured, skipping signature validation');
        return { valid: true };
      }

      // Validate hash
      const message = `${timestamp}.${payload.toString('utf-8')}`;
      const digest = 'v0=' + crypto
        .createHmac('sha256', this.secret)
        .update(message)
        .digest('hex');

      if (signature !== digest) {
        return { valid: false, error: 'Invalid signature' };
      }

      return { valid: true };
    } catch (error) {
      this.logger.error('Signature verification error', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Process webhook event based on type
   */
  async processWebhookEvent(event) {
    const eventType = event.type;

    // Call registered handlers for this event type
    if (this.handlers.has(eventType)) {
      const handler = this.handlers.get(eventType);
      await handler(event);
    } else {
      // Default handler for unknown events
      this.logger.warn(`No handler registered for event type: ${eventType}`, {
        eventType,
        availableHandlers: Array.from(this.handlers.keys())
      });
    }

    // Always emit a generic event
    this.emit('webhook', event);
  }

  /**
   * Register a handler for a specific event type
   */
  on(eventType, handler) {
    this.handlers.set(eventType, handler);
    this.logger.debug(`Handler registered for event type: ${eventType}`);
  }

  /**
   * Extract relevant data from post_call_transcription event
   */
  extractCallData(event) {
    if (event.type !== 'post_call_transcription') {
      return null;
    }

    const data = event.data;

    return {
      agentId: data.agent_id,
      conversationId: data.conversation_id,
      status: data.status,
      startTime: data.metadata?.start_time_unix_secs,
      duration: data.metadata?.call_duration_secs,
      cost: data.metadata?.cost,
      transcript: data.transcript,
      summary: data.analysis?.transcript_summary,
      callSuccessful: data.analysis?.call_successful,
      evaluationResults: data.analysis?.evaluation_criteria_results,
      dataCollectionResults: data.analysis?.data_collection_results,
      userName: data.conversation_initiation_client_data?.dynamic_variables?.user_name,
      feedback: data.metadata?.feedback,
      terminationReason: data.metadata?.termination_reason,
      eventTimestamp: event.event_timestamp
    };
  }

  /**
   * Format transcript for storage
   */
  formatTranscript(transcript) {
    if (!Array.isArray(transcript)) {
      return '';
    }

    return transcript.map(turn => {
      const role = turn.role.toUpperCase();
      const message = turn.message;
      const time = turn.time_in_call_secs ? `[${turn.time_in_call_secs}s]` : '';
      return `${time} ${role}: ${message}`;
    }).join('\n\n');
  }

  /**
   * Get Express router
   */
  getRouter() {
    return this.router;
  }

  /**
   * Simple event emitter implementation
   */
  emit(event, data) {
    // This can be enhanced with a proper EventEmitter if needed
    this.logger.debug(`Event emitted: ${event}`, { event, dataKeys: Object.keys(data) });
  }
}

module.exports = ElevenLabsWebhook;

