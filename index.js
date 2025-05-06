require('dotenv').config();  // Make sure you have a .env file
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');

console.log('Starting server...');
console.log('Environment variables check:');
console.log('- DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? 'Present' : 'Missing');
console.log('- DISCORD_WEBHOOK_URL:', process.env.DISCORD_WEBHOOK_URL ? 'Present' : 'Missing');

// Validate environment variables
if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN is not set in environment variables');
  process.exit(1);
}

if (!process.env.DISCORD_WEBHOOK_URL) {
  console.error('DISCORD_WEBHOOK_URL is not set in environment variables');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

console.log('WebSocket server initialized with path: /ws');

// Add express.json() middleware
app.use(express.json());

// Discord client setup
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION']
});

console.log('Discord client initialized with intents');

// Discord webhook for sending messages
let webhookClient;
try {
  webhookClient = new WebhookClient({ 
    url: process.env.DISCORD_WEBHOOK_URL 
  });
  console.log('Discord webhook initialized successfully');
} catch (err) {
  console.error('Error initializing Discord webhook:', err);
  process.exit(1); // Exit if webhook is invalid
}

// Store client connections
let clients = new Map();

// Session store
const sessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Store message IDs to session IDs mapping
const messageToSession = new Map();

// Discord bot event handlers
discordClient.on('ready', () => {
  console.log('=== Discord Bot Status ===');
  console.log(`Bot logged in as: ${discordClient.user.tag}`);
  console.log(`Bot ID: ${discordClient.user.id}`);
  console.log(`Bot is in ${discordClient.guilds.cache.size} servers`);
  console.log('Bot permissions and server access verified');
  console.log('========================');
});

// Add debug event handlers
discordClient.on('debug', (info) => {
  console.log('Discord Debug:', info);
});

discordClient.on('warn', (info) => {
  console.log('Discord Warning:', info);
});

discordClient.on('error', (error) => {
  console.error('Discord bot error:', error);
});

discordClient.on('messageCreate', async (message) => {
  // Log all messages for debugging
  console.log('\n=== Discord Message Event ===');
  console.log('Raw message:', {
    id: message.id,
    content: message.content,
    author: message.author.tag,
    channel: message.channel.name,
    isReply: !!message.reference,
    reference: message.reference,
    type: message.type,
    flags: message.flags
  });

  // Ignore bot messages
  if (message.author.bot) {
    console.log('Ignoring bot message');
    return;
  }
  
  console.log('\n=== Processing Discord Message ===');
  console.log('Message details:', {
    content: message.content,
    author: message.author.tag,
    channel: message.channel.name,
    isReply: !!message.reference,
    messageId: message.id,
    channelId: message.channel.id,
    guildId: message.guild?.id
  });

  // Check if message is a reply
  if (message.reference) {
    try {
      console.log('Processing reply message...');
      console.log('Message reference:', message.reference);
      console.log('Fetching referenced message...');
      
      // Fetch the referenced message
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
      console.log('Referenced message:', {
        content: referencedMessage.content,
        author: referencedMessage.author.tag,
        messageId: referencedMessage.id,
        channelId: referencedMessage.channel.id,
        guildId: referencedMessage.guild?.id
      });

      // First check if we have this message ID in our mapping
      const sessionId = messageToSession.get(referencedMessage.id);
      console.log('Session ID from mapping:', sessionId);
      
      if (sessionId) {
        console.log('Found session ID from message mapping:', sessionId);
        const session = sessions.get(sessionId);
        
        if (session && session.ws.readyState === WebSocket.OPEN) {
          console.log('Sending message to chat client...');
          const formattedMessage = `**${message.author.username}**: ${message.content}`;
          
          // Send the message
          session.ws.send(JSON.stringify({
            type: 'message',
            from: 'Admin',
            text: formattedMessage
          }));
          
          console.log('Message sent to chat client successfully');
          
          // Confirm the message was sent
          await message.react('✅');
          console.log('Added confirmation reaction');
        } else {
          console.log('Session state:', {
            exists: !!session,
            readyState: session ? session.ws.readyState : 'no session',
            sessionId: sessionId,
            channelId: message.channel.id,
            guildId: message.guild?.id
          });
          await message.reply('Error: Session not found or chat client disconnected.');
        }
      } else {
        // If not in mapping, try to extract from message content
        console.log('No session ID in mapping, checking message content...');
        const sessionMatch = referencedMessage.content.match(/Session ID: `([a-zA-Z0-9-]+)`/);
        
        if (sessionMatch) {
          const extractedSessionId = sessionMatch[1];
          console.log('Found session ID from message content:', extractedSessionId);
          
          // Store this mapping for future use
          messageToSession.set(referencedMessage.id, extractedSessionId);
          console.log('Stored message to session mapping:', {
            messageId: referencedMessage.id,
            sessionId: extractedSessionId
          });
          
          const session = sessions.get(extractedSessionId);
          if (session && session.ws.readyState === WebSocket.OPEN) {
            console.log('Sending message to chat client...');
            const formattedMessage = `**${message.author.username}**: ${message.content}`;
            
            session.ws.send(JSON.stringify({
              type: 'message',
              from: 'Admin',
              text: formattedMessage
            }));
            
            console.log('Message sent to chat client successfully');
            await message.react('✅');
          } else {
            console.log('Session not found or WebSocket not open');
            await message.reply('Error: Session not found or chat client disconnected.');
          }
        } else {
          console.log('No session ID found in referenced message:', referencedMessage.content);
          await message.reply('Error: No session ID found in the referenced message. Please reply to a message from the chat.');
        }
      }
    } catch (err) {
      console.error('Error handling Discord reply:', err);
      console.error('Error details:', {
        message: err.message,
        stack: err.stack
      });
      await message.reply('Error: Failed to process your reply. Please try again.');
    }
  } else {
    console.log('Message is not a reply');
  }
  console.log('=== End Discord Message Processing ===\n');
});

// Login to Discord
console.log('Attempting to login to Discord...');
discordClient.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
  console.error('Failed to login to Discord:', err);
  process.exit(1);
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const sessionId = crypto.randomUUID();
  console.log('\n=== New WebSocket Connection ===');
  console.log('Session ID:', sessionId);
  console.log('Client IP:', req.socket.remoteAddress);
  
  const session = {
    id: sessionId,
    ws,
    lastActivity: Date.now(),
    messages: []
  };
  sessions.set(sessionId, session);

  // Send session ID to client
  ws.send(JSON.stringify({ type: 'session', sessionId }));
  console.log('Session ID sent to client');

  // Handle incoming messages
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      console.log('\n=== WebSocket Message Received ===');
      console.log('Message:', message);
      session.lastActivity = Date.now();
      session.messages.push(message);

      // Forward message to Discord
      if (message.type === 'message' && message.from === 'User') {
        const discordMessage = `**New Message from Chat**\nSession ID: \`${sessionId}\`\nMessage: ${message.text}\n\n*Reply to this message to respond to the user*`;
        console.log('Sending to Discord:', discordMessage);
        try {
          const sentMessage = await webhookClient.send({
            content: discordMessage,
            allowedMentions: { parse: [] }  // Prevent unwanted mentions
          });
          
          // Store the message ID to session ID mapping
          messageToSession.set(sentMessage.id, sessionId);
          console.log('Message sent to Discord successfully:', {
            messageId: sentMessage.id,
            channelId: sentMessage.channel_id,
            sessionId: sessionId
          });
        } catch (err) {
          console.error('Error sending to Discord:', err);
          console.error('Error details:', {
            message: err.message,
            stack: err.stack
          });
          ws.send(JSON.stringify({
            type: 'error',
            text: 'Failed to send message to Discord. Please try again.'
          }));
        }
      }
      console.log('=== End WebSocket Message Processing ===\n');
    } catch (err) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({
        type: 'error',
        text: 'Error processing your message. Please try again.'
      }));
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log('\n=== WebSocket Connection Closed ===');
    console.log('Session ID:', sessionId);
    sessions.delete(sessionId);
    console.log('Session removed');
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('\n=== WebSocket Error ===');
    console.error('Session ID:', sessionId);
    console.error('Error:', error);
    sessions.delete(sessionId);
  });
});

// Cleanup inactive sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      console.log('Cleaning up inactive session:', id);
      session.ws.close();
      sessions.delete(id);
      
      // Clean up message mappings for this session
      for (const [messageId, sessionId] of messageToSession.entries()) {
        if (sessionId === id) {
          messageToSession.delete(messageId);
        }
      }
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
        from: 'User',
        text: trimmedText
      }));
    }

    // Forward to Discord
    const discordMessage = `**New Message from Chat**\nSession ID: \`${sessionId}\`\nMessage: ${trimmedText}`;
    try {
      await webhookClient.send({
        content: discordMessage
      });
      console.log('Message sent to Discord successfully');
    } catch (err) {
      console.error('Error sending to Discord:', err);
      return res.status(500).json({ error: 'Failed to send message to Discord' });
    }

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
app.use(express.static(path.join(__dirname, 'public')));

// Redirect root to chat interface
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('=== Server Error ===');
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n=== Server Started ===');
  console.log(`Server is running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('=====================\n');
});
