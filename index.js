const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');  // For converting audio formats

const client = new Client({
    // Use localStorage for saving authentication data
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Bot Owner's phone number (use the full phone number with country code)
const BOT_OWNER = '917594898804@c.us';  // Replace with your actual phone number

// List of allowed public commands
const publicCommands = ['!song', '!groupinfo', '!help'];

// Pairing Code Setup (For Initial Authentication)
client.on('authenticated', (session) => {
    console.log('Bot authenticated successfully!');
    // Save session for later use
    fs.writeFileSync('session.json', JSON.stringify(session));
});

// Try to load previous session (if available) for fast reconnection
client.on('ready', () => {
    console.log('Bot is ready!');
});

client.on('qr', (qr) => {
    console.log('Pairing code generated: ', qr);
    // You could also send the pairing code to the bot owner if you want
    // For example, via email or another platform to scan manually.
    console.log('Scan the pairing code in WhatsApp Web.');
});

client.on('message', async (message) => {
    const sender = message.from;

    // Command processing
    if (message.body.startsWith('!')) {
        // Check if the message is from the bot owner (private control)
        const isOwner = sender === BOT_OWNER;

        // Public commands
        if (publicCommands.some(cmd => message.body.startsWith(cmd))) {
            await handlePublicCommands(message);
        }

        // Private commands (only bot owner)
        if (isOwner) {
            await handleOwnerCommands(message);
        }

        // Group-specific commands
        if (message.isGroupMsg) {
            await handleGroupCommands(message);
        }
    }
});

// Handle public commands (accessible by everyone)
async function handlePublicCommands(message) {
    if (message.body.startsWith('!song ')) {
        const query = message.body.slice(6).trim();
        if (!query) {
            message.reply("Please provide a song query. Example: !song Bohemian Rhapsody");
            return;
        }

        // Search for the song on YouTube
        const results = await ytSearch(query);
        const videos = results.videos.slice(0, 5);

        let response = 'Here are the top 5 search results:\n';
        videos.forEach((video, index) => {
            response += `${index + 1}. ${video.title} (Duration: ${video.duration})\n`;
        });

        message.reply(response);
        message.reply('Reply with the number of the song you want to download.');
    }

    if (message.body.startsWith('!groupinfo')) {
        // Example of a group command (public)
        if (message.isGroupMsg) {
            const groupInfo = await client.getGroupInfo(message.chatId);
            message.reply(`Group Name: ${groupInfo.name}\nParticipants: ${groupInfo.participants.length}`);
        } else {
            message.reply('This command is only available in groups.');
        }
    }

    if (message.body.startsWith('!help')) {
        message.reply("Commands:\n!song <song name> - Search and download songs\n!groupinfo - Get group information (only in groups)");
    }
}

// Handle private commands (only bot owner)
async function handleOwnerCommands(message) {
    if (message.body.startsWith('!clear')) {
        // Clear command to delete messages (owner only)
        const chat = await message.getChat();
        chat.clearMessages();
        message.reply('All messages cleared.');
    }
}

// Handle group commands
async function handleGroupCommands(message) {
    if (message.body.startsWith('!groupstats')) {
        // Show group stats (only in groups)
        const groupInfo = await client.getGroupInfo(message.chatId);
        message.reply(`Group: ${groupInfo.name}\nParticipants: ${groupInfo.participants.length}`);
    }
}

// Handle song download and conversion
client.on('message', async (message) => {
    if (message.body.startsWith('!download ')) {
        const selection = parseInt(message.body.slice(10).trim()) - 1;

        if (isNaN(selection) || selection < 0 || selection > 4) {
            message.reply('Invalid selection. Please choose a number between 1 and 5.');
            return;
        }

        const video = results.videos[selection];
        const videoUrl = video.url;
        const videoTitle = video.title.replace(/[^a-zA-Z0-9 ]/g, '');
        message.reply(`Downloading: ${videoTitle}`);

        // Download the audio from YouTube
        try {
            const stream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
            const filePath = path.join(__dirname, 'downloads', `${videoTitle}.mp3`);
            const writer = fs.createWriteStream(filePath);

            stream.pipe(writer);

            writer.on('finish', () => {
                message.reply(`Download complete: ${videoTitle}.mp3`);
                client.sendMessage(message.from, fs.readFileSync(filePath), { caption: 'Here is your song' });
                fs.unlinkSync(filePath);  // Delete file after sending
            });
        } catch (error) {
            message.reply('Failed to download song. Please try again.');
        }
    }

    // Converter command (Convert audio)
    if (message.body.startsWith('!convert ')) {
        const fileName = message.body.slice(9).trim();
        const filePath = path.join(__dirname, 'downloads', `${fileName}.mp3`);

        // Check if file exists
        if (fs.existsSync(filePath)) {
            const convertedFilePath = path.join(__dirname, 'downloads', `${fileName}.wav`);

            // Convert audio using ffmpeg
            exec(`ffmpeg -i ${filePath} ${convertedFilePath}`, (error, stdout, stderr) => {
                if (error) {
                    message.reply('Error converting the audio file.');
                    return;
                }

                // Send the converted file
                message.reply('Conversion complete. Sending WAV file...');
                client.sendMessage(message.from, fs.readFileSync(convertedFilePath), { caption: 'Here is your converted file' });

                // Clean up after sending
                fs.unlinkSync(filePath);
                fs.unlinkSync(convertedFilePath);
            });
        } else {
            message.reply('Audio file not found. Please upload an MP3 first.');
        }
    }
});

client.initialize();
