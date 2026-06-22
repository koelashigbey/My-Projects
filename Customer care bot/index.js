require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const Groq = require('groq-sdk');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
app.use(express.urlencoded({ extended: false }));

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

const db = getFirestore();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const conversationHistory = {};

app.post('/webhook', async (req, res) => {
  const userMessage = req.body.Body;
  const from = req.body.From;

  console.log(`Message from ${from}: ${userMessage}`);

  try {
    const aiReply = await getAIReply(from, userMessage);
    await sendMessage(from, aiReply);
    res.sendStatus(200);

  } catch (error) {
    console.error('Error:', error.message);
    res.sendStatus(500);
  }
});

async function getAIReply(userId, userMessage) {
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  conversationHistory[userId].push({ role: 'user', content: userMessage });

  const recentHistory = conversationHistory[userId].slice(-10);

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a financial transaction recorder. Always respond with valid JSON only.
        
        Use {"action":"record","amount":500,"payer":"Kofi","description":"invoice #123"} to record a transaction.
        Use {"action":"list"} to list transactions.
        Use {"action":"reply","message":"your reply"} for everything else.`
      },
      ...recentHistory
    ]
  });

  const rawReply = response.choices[0].message.content;
  console.log('RAW REPLY:', rawReply);

  const cleanReply = rawReply.replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(cleanReply);

    if (parsed.action === 'record') {
      await db.collection('transactions').add({
        amount: parsed.amount,
        payer: parsed.payer,
        description: parsed.description,
        recordedBy: userId,
        createdAt: new Date().toISOString()
      });

      const reply = `Recorded!\nAmount: GHS ${parsed.amount}\nPayer: ${parsed.payer}\nDescription: ${parsed.description}`;
      conversationHistory[userId].push({ role: 'assistant', content: reply });
      return reply;

    } else if (parsed.action === 'list') {
      const snapshot = await db.collection('transactions')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

      if (snapshot.empty) {
        return 'No transactions recorded yet.';
      }

      let list = 'Recent Transactions:\n\n';
      let i = 1;
      snapshot.forEach((doc) => {
        const t = doc.data();
        list += `${i}. GHS ${t.amount} from ${t.payer} - ${t.description}\n`;
        i++;
      });

      conversationHistory[userId].push({ role: 'assistant', content: list });
      return list;

    } else {
      conversationHistory[userId].push({ role: 'assistant', content: parsed.message });
      return parsed.message;
    }

  } catch (e) {
    console.error('JSON parse error:', e.message);
    console.error('Raw reply was:', rawReply);
    conversationHistory[userId].push({ role: 'assistant', content: rawReply });
    return rawReply;
  }
}

async function sendMessage(to, body) {
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body
  });
  console.log(`Reply sent to ${to}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});345