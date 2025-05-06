require('dotenv').config();
const axios = require('axios');

const sessionId = 'mac4nisa-eea99d0fba59c1e7'; // Replace with a real one for testing

async function testWebhook() {
  try {
    if (!process.env.DISCORD_WEBHOOK) {
      throw new Error('DISCORD_WEBHOOK not found in .env file');
    }

    const message = {
      username: 'IGEN FAQ Bot',
      content: `Session: ${sessionId}`,
      embeds: [
        {
          title: 'Message from User',
          color: 5814783,
          fields: [
            { name: 'Message', value: 'This is a test message from the bot.' },
            { name: 'Session ID', value: `\`${sessionId}\`` }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };

    const response = await axios.post(process.env.DISCORD_WEBHOOK, message);

    if (response.status === 204) {
      console.log('✅ Webhook test successful!');
    } else {
      console.log(`⚠️ Unexpected status: ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    } else {
      console.error('No response received. Check network or config.');
    }
  }
}

testWebhook();
