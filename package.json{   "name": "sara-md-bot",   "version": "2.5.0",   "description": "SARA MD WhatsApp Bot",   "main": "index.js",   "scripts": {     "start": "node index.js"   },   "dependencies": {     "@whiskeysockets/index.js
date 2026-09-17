const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const yts = require('yt-search');
const config = require('./config');

let logoBuffer = null;

/* =========================
   IMAGE HELPER
========================= */

async function getMenuImage() {
    const files = [
        'sara-logo.png',
        'sara-logo.jpg',
        'logo.png',
        'logo.jpg'
    ];

    for (const file of files) {
        const filePath = path.join(__dirname, file);

        if (fs.existsSync(filePath)) {
            try {
                return fs.readFileSync(filePath);
            } catch (_) {}
        }
    }

    if (logoBuffer) return logoBuffer;

    if (config.LOGO) {
        try {
            const res = await fetch(config.LOGO);

            if (res.ok) {
                const buffer = Buffer.from(
                    await res.arrayBuffer()
                );

                logoBuffer = buffer;
                return buffer;
            }
        } catch (_) {}
    }

    return null;
}

/* =========================
   HELPERS & DOWNLOADERS
========================= */

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    seconds %= 86400;

    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function getText(message) {
    return (
        message?.conversation ||
        message?.extendedTextMessage?.text ||
        message?.imageMessage?.caption ||
        message?.videoMessage?.caption ||
        ''
    );
}

function getNumber(jid) {
    return jid
        ?.split('@')[0]
        ?.split(':')[0];
}

function isAdmin(participant, metadata) {
    const user = metadata.participants.find(
        p => p.id === participant
    );

    return user?.admin === 'admin' ||
           user?.admin === 'superadmin';
}

const fetchWithTimeout = async (url, options = {}, timeout = 12000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (_) {
        clearTimeout(id);
        return null;
    }
};

// 🎵 Audio Multi-Route Downloader
async function getAudioDownloadUrl(videoUrl) {
    const apiChain = [
        `https://api.dreaded.site/api/ytdl/audio?url=${encodeURIComponent(videoUrl)}`,
        `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://api.giftedtech.my.id/api/download/dlmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://api.davidcyriltech.my.id/download/ytmp3?url=${encodeURIComponent(videoUrl)}`
    ];

    for (const api of apiChain) {
        try {
            const res = await fetchWithTimeout(api);
            if (res && res.ok) {
                const data = await res.json();
                const link = data?.result?.downloadUrl || data?.data?.dl || data?.result?.download_url || data?.result?.url || data?.download;
                if (link && typeof link === 'string' && link.startsWith('http')) {
                    return link;
                }
            }
        } catch (_) {
            continue;
        }
    }
    return null;
}

// 🎬 Video Multi-Route Downloader
async function getVideoDownloadUrl(videoUrl) {
    const apiChain = [
        `https://api.dreaded.site/api/ytdl/video?url=${encodeURIComponent(videoUrl)}`,
        `https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://api.giftedtech.my.id/api/download/dlmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://api.davidcyriltech.my.id/download/ytmp4?url=${encodeURIComponent(videoUrl)}`
    ];

    for (const api of apiChain) {
        try {
            const res = await fetchWithTimeout(api);
            if (res && res.ok) {
                const data = await res.json();
                const link = data?.result?.downloadUrl || data?.data?.dl || data?.result?.download_url || data?.result?.url || data?.download;
                if (link && typeof link === 'string' && link.startsWith('http')) {
                    return link;
                }
            }
        } catch (_) {
            continue;
        }
    }
    return null;
}

/* =========================
   START BOT
========================= */

async function startBot() {

    const authDir = './auth_info';

    if (!fs.existsSync(`${authDir}/creds.json`)) {
        console.error('❌ auth_info/creds.json not found!');
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['SARA MD BOT', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    /* =========================
       CONNECTION
    ========================= */

    sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('🚀 SARA MD BOT Connected!');

            const myNumber = getNumber(sock.user.id);
            const jid = `${myNumber}@s.whatsapp.net`;

            const text =
`*✦ SARA MD BOT IS ONLINE ✦*

🤖 *Bot:* ${config.BOT_NAME}
👨‍💻 *Developer:* IMALSHA NETHSARA
📌 *Prefix:* ${config.PREFIX}

Type *${config.PREFIX}menu* to view commands.`;

            try {
                const img = await getMenuImage();
                if (img) {
                    await sock.sendMessage(jid, { image: img, caption: text });
                } else {
                    await sock.sendMessage(jid, { text });
                }
            } catch (_) {}
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting...');
                setTimeout(startBot, 3000);
            } else {
                console.log('❌ Logged out.');
                process.exit(1);
            }
        }
    });

    /* =========================
       MESSAGE HANDLER
    ========================= */

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];

        if (!msg?.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        if (!from) return;

        const isGroup = from.endsWith('@g.us');
        const sender = isGroup ? msg.key.participant : from;
        const senderNumber = getNumber(sender);
        const ownerNumber = getNumber(config.OWNER_NUMBER);
        const isOwner = senderNumber === ownerNumber;

        const body = getText(msg).trim();
        const prefix = config.PREFIX;

        if (!body.startsWith(prefix)) return;

        const parts = body.slice(prefix.length).trim().split(/\s+/);
        const command = parts.shift()?.toLowerCase();
        const q = parts.join(' ');

        const footer = `\n\n👨‍💻 *CREATED BY IMALSHA NETHSARA*`;

        /* =====================
           MENU
        ===================== */

        if (command === 'menu' || command === 'help') {
            const uptime = formatUptime(process.uptime());
            const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

            const menu =
`╭━━━〔 ✦ *SARA MD BOT* ✦ 〕━━━╮
┃ 👨‍💻 *Dev:* IMALSHA NETHSARA
┃ 🤖 *Version:* 2.5.0
┃ ⏱️ *Uptime:* ${uptime}
┃ 💾 *RAM:* ${ram} MB
┃ 📌 *Prefix:* ${prefix}
╰━━━━━━━━━━━━━━━━━━━━━━━╯

╭━━━〔 📥 *DOWNLOAD / SEARCH* 〕━━━╮
┃ ◈ ${prefix}song <name/url>
┃ ◈ ${prefix}video <name/url>
╰━━━━━━━━━━━━━━━━━━━━━━━╯

╭━━━〔 👥 *GROUP COMMANDS* 〕━━━╮
┃ ◈ ${prefix}tagall
┃ ◈ ${prefix}hidetag <text>
┃ ◈ ${prefix}open
┃ ◈ ${prefix}close
╰━━━━━━━━━━━━━━━━━━━━━━━╯

╭━━━〔 👑 *OWNER* 〕━━━╮
┃ ◈ ${prefix}owner
┃ ◈ ${prefix}restart
╰━━━━━━━━━━━━━━━━━━━━━━━╯

╭━━━〔 🛠️ *TOOLS* 〕━━━╮
┃ ◈ ${prefix}ping
┃ ◈ ${prefix}alive
╰━━━━━━━━━━━━━━━━━━━━━━━╯${footer}`;

            const img = await getMenuImage();

            if (img) {
                await sock.sendMessage(from, { image: img, caption: menu }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: menu }, { quoted: msg });
            }
            return;
        }

        /* =====================
           ALIVE
        ===================== */

        if (command === 'alive') {
            const uptime = formatUptime(process.uptime());
            await sock.sendMessage(
                from,
                {
                    text:
`✨ *SARA MD BOT IS ONLINE*

🤖 Status: Active
⏱️ Uptime: ${uptime}${footer}`
                },
                { quoted: msg }
            );
            return;
        }

        /* =====================
           PING
        ===================== */

        if (command === 'ping') {
            const start = Date.now();
            await sock.sendMessage(from, { text: '🏓 *Pinging...*' }, { quoted: msg });
            const latency = Date.now() - start;

            await sock.sendMessage(
                from,
                {
                    text:
`🏓 *PONG!*

⚡ Response: ${latency} ms${footer}`
                },
                { quoted: msg }
            );
            return;
        }

        /* =====================
           OWNER
        ===================== */

        if (command === 'owner') {
            await sock.sendMessage(
                from,
                {
                    text:
`╭━━〔 👑 *BOT OWNER* 〕━━╮
┃
┃ 👨‍💻 Name:
┃ IMALSHA NETHSARA
┃
┃ 📞 Number:
┃ +${config.OWNER_NUMBER}
┃
┃ 🛠️ Role:
┃ Creator & Developer
┃
╰━━━━━━━━━━━━━━━━━━╯${footer}`
                },
                { quoted: msg }
            );
            return;
        }

        /* =====================
           OWNER RESTART
        ===================== */

        if (command === 'restart') {
            if (!isOwner) {
                await sock.sendMessage(from, { text: `❌ Owner only command.${footer}` }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `🔄 *SARA MD BOT restarting...*` }, { quoted: msg });
            setTimeout(() => process.exit(0), 1000);
            return;
        }

        /* =====================
           GROUP CHECK & METADATA
        ===================== */

        const groupCommands = ['tagall', 'hidetag', 'open', 'close'];

        if (groupCommands.includes(command) && !isGroup) {
            await sock.sendMessage(from, { text: `❌ මේ command එක Group එකකදී විතරයි වැඩ කරන්නේ.${footer}` }, { quoted: msg });
            return;
        }

        let metadata = null;
        if (isGroup && groupCommands.includes(command)) {
            metadata = await sock.groupMetadata(from);
        }

        /* =====================
           TAG ALL & HIDETAG
        ===================== */

        if (command === 'tagall') {
            const mentions = metadata.participants.map(p => p.id);
            let text = q || '📢 *Attention Everyone!*';
            text += '\n\n';

            for (const participant of metadata.participants) {
                text += `@${getNumber(participant.id)} `;
            }

            await sock.sendMessage(from, { text, mentions }, { quoted: msg });
            return;
        }

        if (command === 'hidetag') {
            if (!q) {
                await sock.sendMessage(from, { text: `❌ Text එකක් දෙන්න.\n\nExample: ${prefix}hidetag Hello` }, { quoted: msg });
                return;
            }
            const mentions = metadata.participants.map(p => p.id);
            await sock.sendMessage(from, { text: q, mentions }, { quoted: msg });
            return;
        }

        /* =====================
           OPEN / CLOSE GROUP
        ===================== */

        if (command === 'open') {
            if (!isOwner && !isAdmin(sender, metadata)) {
                await sock.sendMessage(from, { text: `❌ Admin only command.` }, { quoted: msg });
                return;
            }
            try {
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: `🔓 *Group opened!*\n\nMembers can now send messages.` }, { quoted: msg });
            } catch (_) {
                await sock.sendMessage(from, { text: `❌ Group open කරන්න බැරි වුණා.` }, { quoted: msg });
            }
            return;
        }

        if (command === 'close') {
            if (!isOwner && !isAdmin(sender, metadata)) {
                await sock.sendMessage(from, { text: `❌ Admin only command.` }, { quoted: msg });
                return;
            }
            try {
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: `🔒 *Group closed!*\n\nOnly admins can send messages.` }, { quoted: msg });
            } catch (_) {
                await sock.sendMessage(from, { text: `❌ Group close කරන්න බැරි වුණා.` }, { quoted: msg });
            }
            return;
        }

        /* =====================
           SONG DOWNLOADER (AUDIO)
        ===================== */

        if (command === 'song' || command === 'play') {
            if (!q) {
                await sock.sendMessage(from, { text: `❌ Song name එකක් හෝ Link එකක් දෙන්න.\n\nExample: ${prefix}song Lelena` }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `⚡ *SARA MD BOT* - ගීතය සෙවීම ආරම්භ කළා... ⏳` }, { quoted: msg });

            try {
                let videoUrl = q;
                let title = 'Song';
                let thumbUrl = null;

                if (!q.includes('youtube.com') && !q.includes('youtu.be')) {
                    const search = await yts(q);
                    const video = search.videos[0];
                    if (!video) {
                        await sock.sendMessage(from, { text: `❌ Song එක හොයාගන්න බැරි වුණා.` }, { quoted: msg });
                        return;
                    }
                    videoUrl = video.url;
                    title = video.title;
                    thumbUrl = video.thumbnail;
                }

                const infoText = `🎧 *SARA MD SONG DOWNLOADER*\n\n📌 *Title:* ${title}\n📤 *Audio එක යවමින් පවතී...*${footer}`;

                if (thumbUrl) {
                    await sock.sendMessage(from, { image: { url: thumbUrl }, caption: infoText }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                }

                const audioUrl = await getAudioDownloadUrl(videoUrl);

                if (audioUrl) {
                    await sock.sendMessage(
                        from,
                        {
                            audio: { url: audioUrl },
                            mimetype: 'audio/mpeg',
                            fileName: `${title}.mp3`,
                            ptt: false
                        },
                        { quoted: msg }
                    );
                } else {
                    await sock.sendMessage(from, { text: `❌ Audio එක download කරගන්න බැරි වුණා. වෙනත් නමකින් උත්සාහ කරන්න.` }, { quoted: msg });
                }

            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Search error: ${err.message}` }, { quoted: msg });
            }

            return;
        }

        /* =====================
           VIDEO DOWNLOADER
        ===================== */

        if (command === 'video') {
            if (!q) {
                await sock.sendMessage(from, { text: `❌ Video name එකක් හෝ Link එකක් දෙන්න.\n\nExample: ${prefix}video Lehari` }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `⚡ *SARA MD BOT* - වීඩියෝව සෙවීම ආරම්භ කළා... ⏳` }, { quoted: msg });

            try {
                let videoUrl = q;
                let title = 'Video';

                if (!q.includes('youtube.com') && !q.includes('youtu.be')) {
                    const search = await yts(q);
                    const video = search.videos[0];
                    if (!video) {
                        await sock.sendMessage(from, { text: `❌ Video එක හොයාගන්න බැරි වුණා.` }, { quoted: msg });
                        return;
                    }
                    videoUrl = video.url;
                    title = video.title;
                }

                const videoDownloadUrl = await getVideoDownloadUrl(videoUrl);

                if (videoDownloadUrl) {
                    const infoText = `🎬 *SARA MD VIDEO DOWNLOADER*\n\n📌 *Title:* ${title}\n📤 *Video එක යවමින් පවතී...*${footer}`;

                    await sock.sendMessage(
                        from,
                        {
                            video: { url: videoDownloadUrl },
                            caption: infoText,
                            mimetype: 'video/mp4'
                        },
                        { quoted: msg }
                    );
                } else {
                    await sock.sendMessage(from, { text: `❌ Video එක download කරගන්න බැරි වුණා. වෙනත් නමකින් උත්සාහ කරන්න.` }, { quoted: msg });
                }

            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Search error: ${err.message}` }, { quoted: msg });
            }

            return;
        }

        /* =====================
           UNKNOWN COMMAND
        ===================== */

        await sock.sendMessage(
            from,
            {
                text:
`❌ *Unknown Command*

"${command}" කියන command එක නැහැ.

📌 ${prefix}menu → Commands බලන්න.`
            },
            { quoted: msg }
        );
    });
}

startBot().catch(err => {
    console.error('❌ Bot startup error:', err);
});

