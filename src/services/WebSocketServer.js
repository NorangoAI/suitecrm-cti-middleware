const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class WebSocketServer {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.wss = null;
    this.clients = new Map(); // Map of clientId -> { ws, metadata }
    this.pingInterval = null;
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.wss = new WebSocket.Server({
      server,
      path: '/ws'
    });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (error) => {
      this.logger.error('WebSocket server error', error);
    });

    // Start ping/pong for keeping connections alive
    this.startPingInterval();

    this.logger.info('WebSocket server initialized', {
      path: '/ws',
      maxConnections: this.config.maxConnections
    });
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, req) {
    const clientId = uuidv4();
    const clientIp = req.socket.remoteAddress;

    // Check max connections
    if (this.clients.size >= this.config.maxConnections) {
      this.logger.warn('Max WebSocket connections reached, rejecting new connection', {
        clientIp,
        currentConnections: this.clients.size
      });
      ws.close(1008, 'Max connections reached');
      return;
    }

    // Store client connection
    this.clients.set(clientId, {
      ws,
      id: clientId,
      ip: clientIp,
      connectedAt: new Date().toISOString(),
      isAlive: true,
      metadata: {}
    });

    // Set up client event handlers
    ws.on('message', (message) => {
      this.handleMessage(clientId, message);
    });

    ws.on('pong', () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.isAlive = true;
      }
    });

    ws.on('close', (code, reason) => {
      this.handleDisconnection(clientId, code, reason);
    });

    ws.on('error', (error) => {
      this.logger.error('WebSocket client error', error, { clientId });
    });

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'connected',
      clientId,
      message: 'Connected to CTI middleware',
      timestamp: new Date().toISOString()
    });

    this.logger.logWSEvent('client_connected', {
      clientId,
      ip: clientIp,
      totalConnections: this.clients.size
    });
  }

  /**
   * Handle incoming messages from clients
   */
  handleMessage(clientId, message) {
    try {
      const data = JSON.parse(message.toString());

      this.logger.logWSEvent('message_received', {
        clientId,
        type: data.type
      });

      const client = this.clients.get(clientId);
      if (!client) return;

      switch (data.type) {
        case 'register_agent':
          // Register agent with metadata
          client.metadata = {
            ...client.metadata,
            agentId: data.agentId,
            agentName: data.agentName,
            extension: data.extension
          };

          this.sendToClient(clientId, {
            type: 'registered',
            message: 'Agent registered successfully',
            agentId: data.agentId
          });

          this.logger.info('Agent registered', {
            clientId,
            agentId: data.agentId,
            extension: data.extension
          });
          break;

        case 'ping':
          this.sendToClient(clientId, { type: 'pong' });
          break;

        case 'get_status':
          this.sendToClient(clientId, {
            type: 'status',
            connected: true,
            clientId,
            metadata: client.metadata
          });
          break;

        default:
          this.logger.debug('Unknown message type', { clientId, type: data.type });
      }
    } catch (error) {
      this.logger.error('Error handling WebSocket message', error, { clientId });
    }
  }

  /**
   * Handle client disconnection
   */
  handleDisconnection(clientId, code, reason) {
    const client = this.clients.get(clientId);

    if (client) {
      this.logger.logWSEvent('client_disconnected', {
        clientId,
        agentId: client.metadata?.agentId,
        code,
        reason: reason?.toString(),
        totalConnections: this.clients.size - 1
      });

      this.clients.delete(clientId);
    }
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId, data) {
    const client = this.clients.get(clientId);

    if (!client) {
      this.logger.warn('Cannot send message, client not found', { clientId });
      return false;
    }

    if (client.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('Cannot send message, client not connected', { clientId });
      return false;
    }

    try {
      client.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      this.logger.error('Error sending message to client', error, { clientId });
      return false;
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(data, excludeClientId = null) {
    let sentCount = 0;

    this.clients.forEach((client, clientId) => {
      if (clientId !== excludeClientId) {
        if (this.sendToClient(clientId, data)) {
          sentCount++;
        }
      }
    });

    this.logger.debug('Broadcast sent', {
      recipients: sentCount,
      excluded: excludeClientId ? 1 : 0
    });

    return sentCount;
  }

  /**
   * Send screen pop to specific agent by extension or agent ID
   */
  sendScreenPop(agentIdentifier, callData) {
    let sent = false;

    this.clients.forEach((client, clientId) => {
      // Match by agentId or extension
      if (
        client.metadata?.agentId === agentIdentifier ||
        client.metadata?.extension === agentIdentifier
      ) {
        const screenPopData = {
          type: 'screen_pop',
          callData: {
            callerIdNum: callData.callerIdNum,
            callerIdName: callData.callerIdName,
            callerId: callData.callerId,
            channel: callData.channel,
            timestamp: callData.timestamp || new Date().toISOString(),
            contact: callData.contact || null,
            account: callData.account || null,
            aiSummary: callData.aiSummary || null,
            conversationId: callData.conversationId || null
          },
          timestamp: new Date().toISOString()
        };

        if (this.sendToClient(clientId, screenPopData)) {
          sent = true;

          this.logger.logWSEvent('screen_pop_sent', {
            clientId,
            agentId: client.metadata?.agentId,
            extension: client.metadata?.extension,
            callerIdNum: callData.callerIdNum
          });
        }
      }
    });

    if (!sent) {
      this.logger.warn('Screen pop not sent, agent not found or not connected', {
        agentIdentifier,
        callerIdNum: callData.callerIdNum
      });
    }

    return sent;
  }

  /**
   * Send call update to relevant agents
   */
  sendCallUpdate(callData) {
    const updateData = {
      type: 'call_update',
      callData,
      timestamp: new Date().toISOString()
    };

    // Broadcast to all connected agents
    const sentCount = this.broadcast(updateData);

    this.logger.logWSEvent('call_update_sent', {
      recipients: sentCount,
      callerId: callData.callerIdNum
    });

    return sentCount;
  }

  /**
   * Start ping interval to keep connections alive
   */
  startPingInterval() {
    this.pingInterval = setInterval(() => {
      this.clients.forEach((client, clientId) => {
        if (!client.isAlive) {
          // Client didn't respond to last ping, terminate
          this.logger.warn('Client did not respond to ping, terminating', { clientId });
          client.ws.terminate();
          this.clients.delete(clientId);
          return;
        }

        // Mark as not alive and send ping
        client.isAlive = false;
        client.ws.ping();
      });
    }, this.config.pingInterval || 30000);

    this.logger.debug('WebSocket ping interval started', {
      interval: this.config.pingInterval
    });
  }

  /**
   * Get connected clients count
   */
  getConnectionsCount() {
    return this.clients.size;
  }

  /**
   * Get connected agents info
   */
  getConnectedAgents() {
    const agents = [];

    this.clients.forEach((client) => {
      if (client.metadata?.agentId) {
        agents.push({
          clientId: client.id,
          agentId: client.metadata.agentId,
          agentName: client.metadata.agentName,
          extension: client.metadata.extension,
          connectedAt: client.connectedAt
        });
      }
    });

    return agents;
  }

  /**
   * Close all connections and stop server
   */
  close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.clients.forEach((client) => {
      client.ws.close(1001, 'Server shutting down');
    });

    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.logger.info('WebSocket server closed');
    }
  }
}

module.exports = WebSocketServer;

