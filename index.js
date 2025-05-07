const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('ytdl-core');
const ytsr = require('ytsr');
const spotify = require('spotify-url-info');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Replit setup
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.get('/', (req, res) => res.send('WhatsApp Downloader Bot Running'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Bot configuration
const config = {
  publicMode: false,
  allowedUsers: [],
  adminNumber: 'YOUR_ADMIN_NUMBER' // with country code
};

// Initialize WhatsApp
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    generateHighQualityLinkPreview: true,
    getMessage: async () => ({})
  });

  // Pairing code for authentication
  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    
    if (qr) console.log('Pairing Code:', qr);
    if (connection === 'open') console.log('✅ Bot connected successfully!');
    if (connection === 'close') {
      const shouldReconnect = (update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      if (shouldReconnect) setTimeout(startBot, 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Message handler
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    
    const user = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const isAdmin = user.includes(config.adminNumber);
    
    // Check if user is allowed in private mode
    if (!config.publicMode && !config.allowedUsers.includes(user.split('@')[0]) && !isAdmin) {
      await sock.sendMessage(user, { text: '🔒 Bot is in private mode. Contact admin for access.' });
      return;
    }
    
    // Admin commands
    if (isAdmin && text.startsWith('!')) {
      if (text === '!public') {
        config.publicMode = true;
        await sock.sendMessage(user, { text: '✅ Bot is now in public mode' });
        return;
      }
      if (text === '!private') {
        config.publicMode = false;
        await sock.sendMessage(user, { text: '✅ Bot is now in private mode' });
        return;
      }
      if (text.startsWith('!allow ')) {
        const number = text.split(' ')[1];
        config.allowedUsers.push(number);
        await sock.sendMessage(user, { text: `✅ Added ${number} to allowed users` });
        return;
      }
    }
    
    // Song download by query
    if (text.startsWith('!song ')) {
      const query = text.replace('!song ', '').trim();
      await handleSongQuery(sock, user, query);
      return;
    }
    
    // Media downloader
    if (msg.message.imageMessage || msg.message.videoMessage) {
      await handleMediaDownload(sock, msg);
      return;
    }
    
    // Song downloader from URL
    if (text.includes('youtube.com') || text.includes('youtu.be') || text.includes('spotify')) {
      await handleSongDownload(sock, msg, text);
      return;
    }
    
    // Help menu
    if (text === '!help') {
      await sock.sendMessage(user, {
        text: `📱 *WhatsApp Downloader Bot*\n\n` +
              `*Features:*\n` +
              `- Send !song <query> to download music\n` +
              `- Send YouTube/Spotify links for audio\n` +
              `- Send images/videos to download\n` +
              `- Select video quality via buttons\n\n` +
              `*Admin Commands:*\n` +
              `!public - Enable public mode\n` +
              `!private - Disable public mode\n` +
              `!allow [number] - Add user to whitelist`
      });
      return;
    }
  });

  // Handle button responses
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message?.buttonsResponseMessage) return;
    
    const user = msg.key.remoteJid;
    const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
    
    if (buttonId.startsWith('quality_')) {
      const quality = buttonId.replace('quality_', '');
      await handleVideoQuality(sock, user, quality);
    }
  });
}

// YouTube search function
async function searchYouTube(query) {
  const filters = await ytsr.getFilters(query);
  const filter = filters.get('Type').get('Video');
  const searchResults = await ytsr(null, { limit: 1, nextpageRef: filter.url });
  return searchResults.items[0]?.url;
}

// Song download by query
async function handleSongQuery(sock, user, query) {
  try {
    await sock.sendMessage(user, { text: `🔍 Searching for "${query}"...` });
    
    const youtubeUrl = await searchYouTube(query);
    if (!youtubeUrl) {
      await sock.sendMessage(user, { text: '❌ No results found.' });
      return;
    }
    
    await sock.sendMessage(user, { text: '⬇️ Downloading audio...' });
    const info = await ytdl.getInfo(youtubeUrl);
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
    const filename = `${title}.mp3`;
    
    await new Promise((resolve) => {
      ffmpeg(ytdl(youtubeUrl, { quality: 'highestaudio' }))
        .audioBitrate(320)
        .save(filename)
        .on('end', resolve);
    });
    
    await sock.sendMessage(user, {
      audio: { url: filename },
      mimetype: 'audio/mpeg',
      fileName: filename
    });
    
    fs.unlinkSync(filename);
  } catch (error) {
    console.error(error);
    await sock.sendMessage(user, { text: '❌ Failed to download song.' });
  }
}

// Media download handler
async function handleMediaDownload(sock, msg) {
  const user = msg.key.remoteJid;
  const isImage = msg.message.imageMessage;
  
  try {
    await sock.sendMessage(user, { text: '⏳ Downloading your media...' });
    
    const buffer = await sock.downloadMediaMessage(msg);
    const filename = `media_${Date.now()}.${isImage ? 'jpg' : 'mp4'}`;
    fs.writeFileSync(filename, buffer);
    
    if (isImage) {
      await sock.sendMessage(user, {
        image: { url: filename },
        caption: '✅ Here is your downloaded image'
      });
    } else {
      await sock.sendMessage(user, {
        video: { url: filename },
        caption: '✅ Here is your downloaded video'
      });
    }
    
    fs.unlinkSync(filename);
  } catch (error) {
    console.error(error);
    await sock.sendMessage(user, { text: '❌ Failed to download media' });
  }
}

// Song download from URL
async function handleSongDownload(sock, msg, url) {
  const user = msg.key.remoteJid;
  
  try {
    await sock.sendMessage(user, { text: '⏳ Processing your song request...' });
    
    let audioStream;
    let title = 'downloaded_audio';
    
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const info = await ytdl.getInfo(url);
      title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
      audioStream = ytdl(url, { quality: 'highestaudio' });
    } else if (url.includes('spotify')) {
      const spotifyInfo = await spotify.getData(url);
      title = spotifyInfo.name;
      const searchQuery = `${spotifyInfo.name} ${spotifyInfo.artists[0].name}`;
      const youtubeUrl = await searchYouTube(searchQuery);
      if (!youtubeUrl) throw new Error('No YouTube match found');
      const info = await ytdl.getInfo(youtubeUrl);
      title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
      audioStream = ytdl(youtubeUrl, { quality: 'highestaudio' });
    }
    
    const filename = `${title}.mp3`;
    
    await new Promise((resolve) => {
      ffmpeg(audioStream)
        .audioBitrate(320)
        .save(filename)
        .on('end', resolve);
    });
    
    await sock.sendMessage(user, {
      audio: { url: filename },
      mimetype: 'audio/mpeg',
      fileName: filename
    });
    
    fs.unlinkSync(filename);
  } catch (error) {
    console.error(error);
    await sock.sendMessage(user, { text: '❌ Failed to download song' });
  }
}

// Video quality handler
async function handleVideoQuality(sock, user, quality) {
  // Implement your video quality conversion logic here
  await sock.sendMessage(user, { text: `✅ Video will be converted to ${quality} quality` });
}

startBot().catch(console.error);
