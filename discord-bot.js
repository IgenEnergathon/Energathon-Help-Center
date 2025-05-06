require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(bodyParser.json());

const sessions = new Map(); // sessionId => ws

// Serve static files (frontend)
app.use(express.static('public'));

// WebSocket connection
wss.on('connection', (ws) => {
  const sessionId = uuidv4();
  console.log(`🟢 New WebSocket session: ${sessionId}`);
  sessions.set(sessionId, ws);

  ws.send(JSON.stringify({
    type: 'session',
    sessionId,
    history: [] // Add history if needed
  }));

  ws.on('close', () => {
    console.log(`🔴 WebSocket closed: ${sessionId}`);
    sessions.delete(sessionId);
  });
});

// Handle user message from frontend
app.post('/send', (req, res) => {
  const { sessionId, text } = req.body;
  const ws = sessions.get(sessionId);

  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({
      type: 'message',
      from: 'User',
      text
    }));
    res.sendStatus(200);
  } else {
    res.status(400).send('WebSocket not connected for session');
  }
});

// Handle reset chat
app.post('/reset-chat', (req, res) => {
  const { sessionId } = req.body;
  const ws = sessions.get(sessionId);
  if (ws) ws.close();
  res.sendStatus(200);
});

// Webhook from Discord bot
app.post('/webhook/discord', (req, res) => {
  const { sessionId, reply, from } = req.body;
  const ws = sessions.get(sessionId);

  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({
      type: 'message',
      from: from || 'Discord',
      text: reply
    }));
    res.sendStatus(200);
  } else {
    console.warn(`❌ No WebSocket for session: ${sessionId}`);
    res.status(400).send('Invalid or inactive session');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
