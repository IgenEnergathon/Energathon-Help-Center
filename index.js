require('dotenv').config();  // Make sure you have a .env file
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Add express.json() middleware
app.use(express.json());

// Discord client setup
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// Discord webhook for sending messages
const webhookClient = new WebhookClient({ 
  url: process.env.DISCORD_WEBHOOK_URL 
});

// Store client connections
let clients = new Map();

// Session store
const sessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    ws,
    lastActivity: Date.now(),
    messages: []
  };
  sessions.set(sessionId, session);

  // Send session ID to client
  ws.send(JSON.stringify({ type: 'session', sessionId }));

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      session.lastActivity = Date.now();
      session.messages.push(message);

      // Forward message to Discord
      if (message.type === 'message' && message.from === 'User') {
        const discordMessage = **New Message from Chat**\nSession ID: \${sessionId}\\nMessage: ${message.text};
        webhookClient.send({
          content: discordMessage
        }).catch(err => {
          console.error('Error sending to Discord:', err);
        });
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    sessions.delete(sessionId);
  });
});

// Cleanup inactive sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      session.ws.close();
      sessions.delete(id);
    }
  }
}, 60000);

// API: Receive user message and respond
app.post('/chat/send', async (req, res) => {
  try {
    const { text, sessionId } = req.body;
    if (!text || !sessionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const trimmedText = text.trim();
    
    // Send to chat
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'message',
        from: 'Bot',
        text: "Message received! An admin will respond shortly."
      }));
    }

    // Forward to Discord
    const discordMessage = **New Message**\nSession ID: \${sessionId}\\nMessage: ${trimmedText};
    webhookClient.send({
      content: discordMessage
    }).catch(err => {
      console.error('Error sending to Discord:', err);
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Discord webhook endpoint for replies
app.post('/chat/webhook/discord', async (req, res) => {
  try {
    const { content, sessionId } = req.body;
    
    if (!content || !sessionId) {
      return res.status(400).json({ error: 'Missing content or session ID' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Send to chat
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'message',
        from: 'Admin',
        text: content
      }));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Discord webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset chat endpoint
app.post('/reset-chat', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  session.messages = [];
  res.json({ success: true });
});

// Serve static files from the chat directory
app.use('/chat', express.static(path.join(__dirname, 'public')));

// Redirect root to chat interface
app.get('/', (req, res) => {
  res.redirect('/chat');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Discord bot event handlers
discordClient.on('ready', () => {
  console.log(Discord bot logged in as ${discordClient.user.tag});
});

discordClient.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check if message is a reply
  if (message.reference) {
    try {
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      const sessionMatch = referencedMessage.content.match(/Session ID: ([a-zA-Z0-9-]+)/);
      
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const session = sessions.get(sessionId);
        
        if (session && session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({
            type: 'message',
            from: 'Admin',
            text: message.content
          }));
        }
      }
    } catch (err) {
      console.error('Error handling Discord reply:', err);
    }
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(Server is running on port ${PORT});
});

// Login to Discord
discordClient.login(process.env.DISCORD_BOT_TOKEN);