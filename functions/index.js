const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
app.use(express.json()); // for parsing JSON from Meta

const PAGE_ACCESS_TOKEN = functions.config().meta.token; // store securely

async function downloadImageFromMeta(mediaId) {
  const mediaUrlRes = await axios.get(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${PAGE_ACCESS_TOKEN}`
      }
    }
  );

  const mediaUrl = mediaUrlRes.data.url;

  const mediaRes = await axios.get(mediaUrl, {
    headers: {
      Authorization: `Bearer ${PAGE_ACCESS_TOKEN}`
    },
    responseType: 'arraybuffer'
  });

  return mediaRes.data;
}

async function uploadToFirebaseStorage(buffer, fileName) {
  const filePath = `whatsapp-images/${fileName}`;
  const file = bucket.file(filePath);
  await file.save(buffer, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: {
        firebaseStorageDownloadTokens: uuidv4()
      }
    }
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media`;
}

// ✅ Meta WhatsApp webhook handler
app.post('/webhook', async (req, res) => {
  console.log('📥 Incoming WhatsApp message:', JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const message = changes?.messages?.[0];
    const from = message?.from;
    const type = message?.type;

    let imageUrl = null;
    let messageText = '';
    let mediaId = null;

    if (type === 'image') {
      mediaId = message.image.id;
      const buffer = await downloadImageFromMeta(mediaId);
      const fileName = `${Date.now()}_${from}.jpg`;
      imageUrl = await uploadToFirebaseStorage(buffer, fileName);
    }

    if (message?.text?.body) {
      messageText = message.text.body;
    }

    await db.collection('expiries').add({
      from,
      imageUrl,
      mediaId,
      messageText,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('✅ Message stored in Firestore');

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error handling Meta webhook:', err);
    res.status(500).send('Internal Error');
  }
});



// Export the Cloud Function
exports.metaWebhook = functions.https.onRequest(app);
