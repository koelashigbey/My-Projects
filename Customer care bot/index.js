require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const { google } = require('googleapis');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
app.use(express.json());

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

const db = getFirestore();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const conversationHistory = {};

const GRAPH_API_VERSION = 'v21.0';

async function getNextTransactionId() {
  const counterRef = db.collection('metadata').doc('transactionCounter');
  const nextNumber = await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(counterRef);
    const last = doc.exists ? doc.data().lastNumber : 0;
    const next = last + 1;
    transaction.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });
  return `TXN-${String(nextNumber).padStart(4, '0')}`;
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

async function appendToGoogleSheet(transaction) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    console.warn('GOOGLE_SHEET_ID not set — skipping Google Sheets sync');
    return;
  }

  const tab = process.env.GOOGLE_SHEET_TAB || 'Sheet1';
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        transaction.transactionId,
        transaction.createdAt,
        transaction.amount,
        transaction.payer,
        transaction.payee || '',
        transaction.description,
        transaction.recordedBy
      ]]
    }
  });

  console.log(`Synced ${transaction.transactionId} to Google Sheets`);
}

app.get('/', (req, res) => {
  res.send('Bot is running. Webhook URL: /webhook');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  console.log('Webhook POST received:', JSON.stringify(req.body));
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'whatsapp_business_account') {
    console.log('Ignored webhook (not whatsapp_business_account)');
    return;
  }

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const messages = change.value?.messages;
      if (!messages) continue;

      for (const message of messages) {
        if (message.type !== 'text') {
          console.log(`Skipped non-text message type: ${message.type}`);
          continue;
        }

        const from = message.from;
        const userMessage = message.text.body;
        console.log(`Message from ${from}: ${userMessage}`);

        handleIncomingMessage(from, userMessage).catch((error) => {
          console.error('Error handling message:', error.message);
          if (error.message.includes('WhatsApp API error')) {
            console.error('Tip: regenerate your access token in Meta API Setup (temporary tokens expire in 24h).');
          }
        });
      }
    }
  }
});

async function handleIncomingMessage(from, userMessage) {
  const aiReply = await getAIReply(from, userMessage);
  await sendMessage(from, aiReply);
}

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
        
        Use {"action":"record","amount":500,"payer":"Kofi","payee":"Ama","description":"invoice #123"} to record a transaction.
        payer = who paid. payee = who received the payment. Ask for payee if missing.
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
      const transactionId = await getNextTransactionId();
      const createdAt = new Date().toISOString();

      const transaction = {
        transactionId,
        amount: parsed.amount,
        payer: parsed.payer,
        payee: parsed.payee,
        description: parsed.description,
        recordedBy: userId,
        createdAt
      };

      await db.collection('transactions').add(transaction);

      try {
        await appendToGoogleSheet(transaction);
      } catch (error) {
        console.error('Google Sheets sync failed:', error.message);
      }

      const reply = `Recorded!\nID: ${transactionId}\nAmount: GHS ${parsed.amount}\nFrom: ${parsed.payer}\nTo: ${parsed.payee}\nDescription: ${parsed.description}`;
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
        list += `${i}. [${t.transactionId || '—'}] GHS ${t.amount} from ${t.payer} to ${t.payee || '—'} - ${t.description}\n`;
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
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp API error: ${error}`);
  }

  console.log(`Reply sent to ${to}`);
}

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — another bot instance is probably running.`);
    console.error('Close the other terminal, or stop the process using that port.');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

server.on('listening', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Keep this terminal open. Press Ctrl+C to stop.');
});
