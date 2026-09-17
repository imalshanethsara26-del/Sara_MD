const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const yts = require("yt-search");
const ytdl = require("@distube/ytdl-core");

const config = require("./config");

const AUTH_DIR = "./auth_info";
const DB_DIR = "./database";
const GROUP_DB = path.join(DB_DIR, "groups.json");

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(GROUP_DB)) fs.writeFileSync(GROUP_DB, "{}");

function loadGroups() {
    try {
        return JSON.parse(fs.readFileSync(GROUP_DB));
    } catch {
        return {};
    }
}

function saveGroups(data) {
    fs.writeFileSync(
        GROUP_DB,
        JSON.stringify(data, null, 2)
    );
}

function getGroupData(jid) {
    const db = loadGroups();

    if (!db[jid]) {
        db[jid] = {
            welcome: false,
            goodbye: false,
            antilink: false,
            muted: false
        };
        saveGroups(db);
    }

    return db[jid];
}

function isGroup(jid) {
    return jid.endsWith("@g.us");
}

function getNumber(jid) {
    return jid.split("@")[0];
}

function isOwner(jid) {
    const number = getNumber(jid);

    return config.OWNER_NUMBER
        .replace(/[^0-9]/g, "")
        === number;
}

async function getGroupAdmins(sock, jid) {
    const metadata = await sock.groupMetadata(jid);

    return metadata.participants
        .filter(p => p.admin)
        .map(p => p.id);
}

async function isAdmin(sock, jid, sender) {
    if (!isGroup(jid)) return false;

    const admins = await getGroupAdmins(sock, jid);

    return admins.includes(sender);
}

async function startBot() {

    const { state, saveCreds } =
        await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        browser: ["Sara MD", "Chrome", "1.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    /*
    ==============================
           PAIRING CODE
    ==============================
    */

    if (!sock.authState.creds.registered) {

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const number = await new Promise(resolve => {
            rl.question(
                "📱 WhatsApp Number: ",
                answer => {
                    rl.close();
                    resolve(
                        answer.replace(/[^0-9]/g, "")
                    );
                }
            );
        });

        try {

            const code =
                await sock.requestPairingCode(number);

            console.log("\n");
            console.log("━━━━━━━━━━━━━━━━━━━━");
            console.log("🔐 PAIRING CODE");
            console.log("👉 " + code);
            console.log("━━━━━━━━━━━━━━━━━━━━");
            console.log("WhatsApp > Linked Devices");
            console.log("Link with phone number instead");
            console.log("━━━━━━━━━━━━━━━━━━━━\n");

        } catch (e) {
            console.log("PAIRING ERROR:", e.message);
        }
    }

    /*
    ==============================
           CONNECTION
    ==============================
    */

    sock.ev.on("connection.update", update => {

        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log("╭────────────────────╮");
            console.log("│   🤖 BOT CONNECTED  │");
            console.log("╰────────────────────╯");
        }

        if (connection === "close") {

            const status =
                lastDisconnect?.error?.output?.statusCode;

            if (status !== DisconnectReason.loggedOut) {
                console.log("🔄 Reconnecting...");
                startBot();
            } else {
                console.log("❌ Logged out.");
            }
        }
    });

    /*
    ==============================
             MESSAGES
    ==============================
    */

    sock.ev.on("messages.upsert", async ({ messages }) => {

        try {

            const msg = messages[0];

            if (!msg.message) return;
            if (msg.key.fromMe) return;

            const jid = msg.key.remoteJid;
            const sender = msg.key.participant || jid;

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                "";

            if (!text) return;

            const prefix = config.PREFIX || ".";

            if (!text.startsWith(prefix)) return;

            const args = text
                .slice(prefix.length)
                .trim()
                .split(/\s+/);

            const command =
                args.shift()?.toLowerCase();

            const fullText = args.join(" ");

            /*
            ==============================
                    MENU
            ==============================
            */

            if (command === "menu") {

                const menu = `
╭━━━〔 👥 GROUP COMMANDS 〕━━━╮

│ .tagall
│ .hidetag
│ .admins
│ .groupinfo
│ .getpp
│ .promote
│ .demote
│ .kick
│ .add
│ .setname
│ .setdesc
│ .open
│ .close
│ .welcome on/off
│ .goodbye on/off
│ .antilink on/off
│ .mute
│ .unmute

╰━━━━━━━━━━━━━━━━━━━━━━╯


╭━━━〔 👑 OWNER COMMANDS 〕━━━╮

│ .owner
│ .restart
│ .shutdown
│ .update
│ .setprefix
│ .mode public
│ .mode private
│ .block
│ .unblock
│ .ban
│ .unban
│ .broadcast
│ .join
│ .leave
│ .setbio
│ .setname
│ .setpp
│ .eval

╰━━━━━━━━━━━━━━━━━━━━━━╯


╭━━━〔 📥 DOWNLOAD COMMANDS 〕━━━╮

│ .song <title>
│ .play <title>
│ .audio <title>
│ .video <title>

╰━━━━━━━━━━━━━━━━━━━━━━╯

        🤖 ${config.BOT_NAME}
`;

                await sock.sendMessage(jid, {
                    text: menu
                });

                return;
            }

            /*
            ==============================
                 OWNER COMMANDS
            ==============================
            */

            const ownerCommands = [
                "owner",
                "restart",
                "shutdown",
                "update",
                "setprefix",
                "mode",
                "block",
                "unblock",
                "ban",
                "unban",
                "broadcast",
                "join",
                "leave",
                "setbio",
                "setname",
                "setpp",
                "eval"
            ];

            if (ownerCommands.includes(command)) {

                if (!isOwner(sender)) {

                    await sock.sendMessage(jid, {
                        text: "❌ Owner only command."
                    });

                    return;
                }
            }

            if (command === "owner") {

                await sock.sendMessage(jid, {
                    text:
                        `👑 *BOT OWNER*\n\n` +
                        `📞 +${config.OWNER_NUMBER}\n` +
                        `🤖 ${config.BOT_NAME}`
                });

                return;
            }

            if (command === "restart") {

                await sock.sendMessage(jid, {
                    text: "🔄 Restarting bot..."
                });

                setTimeout(() => {
                    process.exit(0);
                }, 1500);

                return;
            }

            if (command === "shutdown") {

                await sock.sendMessage(jid, {
                    text: "🛑 Shutting down..."
                });

                setTimeout(() => {
                    process.exit(0);
                }, 1000);

                return;
            }

            if (command === "setprefix") {

                if (!args[0]) {
                    await sock.sendMessage(jid, {
                        text: "Example: .setprefix !"
                    });
                    return;
                }

                config.PREFIX = args[0];

                await sock.sendMessage(jid, {
                    text:
                        `✅ Prefix changed to: ${config.PREFIX}`
                });

                return;
            }

            if (command === "mode") {

                const mode = args[0]?.toLowerCase();

                if (!["public", "private"].includes(mode)) {
                    await sock.sendMessage(jid, {
                        text:
                            "Example:\n.mode public\n.mode private"
                    });
                    return;
                }

                config.MODE = mode;

                await sock.sendMessage(jid, {
                    text:
                        `✅ Bot mode: ${mode}`
                });

                return;
            }

            if (command === "block") {

                const target =
                    msg.message.extendedTextMessage
                        ?.contextInfo?.mentionedJid?.[0];

                if (!target) {
                    await sock.sendMessage(jid, {
                        text:
                            "❌ Mention a user."
                    });
                    return;
                }

                await sock.updateBlockStatus(
                    target,
                    "block"
                );

                await sock.sendMessage(jid, {
                    text: "✅ User blocked."
                });

                return;
            }

            if (command === "unblock") {

                const target =
                    msg.message.extendedTextMessage
                        ?.contextInfo?.mentionedJid?.[0];

                if (!target) {
                    await sock.sendMessage(jid, {
                        text:
                            "❌ Mention a user."
                    });
                    return;
                }

                await sock.updateBlockStatus(
                    target,
                    "unblock"
                );

                await sock.sendMessage(jid, {
                    text: "✅ User unblocked."
                });

                return;
            }

            /*
            ==============================
                  GROUP COMMAND CHECK
            ==============================
            */

            const groupCommands = [
                "tagall",
                "hidetag",
                "admins",
                "groupinfo",
                "getpp",
                "promote",
                "demote",
                "kick",
                "add",
                "setname",
                "setdesc",
                "open",
                "close",
                "welcome",
                "goodbye",
                "antilink",
                "mute",
                "unmute"
            ];

            if (groupCommands.includes(command)) {

                if (!isGroup(jid)) {

                    await sock.sendMessage(jid, {
                        text:
                            "❌ This command is only for groups."
                    });

                    return;
                }

                const admin =
                    await isAdmin(
                        sock,
                        jid,
                        sender
                    );

                if (!admin && !isOwner(sender)) {

                    await sock.sendMessage(jid, {
                        text:
                            "❌ Admin only command."
                    });

                    return;
                }
            }

            /*
            ==============================
                    TAG ALL
            ==============================
            */

            if (command === "tagall") {

                const metadata =
                    await sock.groupMetadata(jid);

                const mentions =
                    metadata.participants.map(
                        p => p.id
                    );

                let text =
                    "📢 *TAG ALL*\n\n";

                mentions.forEach((user, i) => {
                    text +=
                        `${i + 1}. @${getNumber(user)}\n`;
                });

                await sock.sendMessage(jid, {
                    text,
                    mentions
                });

                return;
            }

            /*
            ==============================
                    HIDETAG
            ==============================
            */

            if (command === "hidetag") {

                const metadata =
                    await sock.groupMetadata(jid);

                const mentions =
                    metadata.participants.map(
                        p => p.id
                    );

                await sock.sendMessage(jid, {
                    text:
                        fullText || "📢 Attention everyone!",
                    mentions
                });

                return;
            }

            /*
            ==============================
                     ADMINS
            ==============================
            */

            if (command === "admins") {

                const metadata =
                    await sock.groupMetadata(jid);

                const admins =
                    metadata.participants
                        .filter(p => p.admin);

                const mentions =
                    admins.map(p => p.id);

                let text =
                    "👑 *GROUP ADMINS*\n\n";

                admins.forEach((admin, i) => {
                    text +=
                        `${i + 1}. @${getNumber(admin.id)}\n`;
                });

                await sock.sendMessage(jid, {
                    text,
                    mentions
                });

                return;
            }

            /*
            ==============================
                  GROUP INFO
            ==============================
            */

            if (command === "groupinfo") {

                const metadata =
                    await sock.groupMetadata(jid);

                await sock.sendMessage(jid, {
                    text:
                        `👥 *GROUP INFO*\n\n` +
                        `📛 Name: ${metadata.subject}\n` +
                        `👤 Members: ${metadata.participants.length}\n` +
                        `🆔 ${jid}`
                });

                return;
            }

            /*
            ==============================
                 PROMOTE / DEMOTE
            ==============================
            */

            if (
                command === "promote" ||
                command === "demote"
            ) {

                const mentioned =
                    msg.message.extendedTextMessage
                        ?.contextInfo?.mentionedJid;

                if (!mentioned?.length) {

                    await sock.sendMessage(jid, {
                        text:
                            `❌ Mention a user.\nExample: ${prefix}${command} @user`
                    });

                    return;
                }

                await sock.groupParticipantsUpdate(
                    jid,
                    mentioned,
                    command
                );

                await sock.sendMessage(jid, {
                    text:
                        `✅ ${command} completed.`
                });

                return;
            }

            /*
            ==============================
                    KICK
            ==============================
            */

            if (command === "kick") {

                const mentioned =
                    msg.message.extendedTextMessage
                        ?.contextInfo?.mentionedJid;

                if (!mentioned?.length) {

                    await sock.sendMessage(jid, {
                        text:
                            `❌ Mention a user.`
                    });

                    return;
                }

                await sock.groupParticipantsUpdate(
                    jid,
                    mentioned,
                    "remove"
                );

                await sock.sendMessage(jid, {
                    text: "✅ User removed."
                });

                return;
            }

            /*
            ==============================
                     ADD
            ==============================
            */

            if (command === "add") {

                if (!args[0]) {

                    await sock.sendMessage(jid, {
                        text:
                            `Example: ${prefix}add 947XXXXXXXX`
                    });

                    return;
                }

                const number =
                    args[0].replace(/[^0-9]/g, "");

                await sock.groupParticipantsUpdate(
                    jid,
                    [`${number}@s.whatsapp.net`],
                    "add"
                );

                await sock.sendMessage(jid, {
                    text:
                        "✅ Add request completed."
                });

                return;
            }

            /*
            ==============================
                 SET GROUP NAME
            ==============================
            */

            if (command === "setname") {

                if (!fullText) {
                    await sock.sendMessage(jid, {
                        text:
                            `Example: ${prefix}setname My Group`
                    });
                    return;
                }

                if (isGroup(jid)) {

                    await sock.groupUpdateSubject(
                        jid,
                        fullText
                    );

                    await sock.sendMessage(jid, {
                        text:
                            "✅ Group name updated."
                    });
                }

                return;
            }

            /*
            ==============================
                 SET GROUP DESCRIPTION
            ==============================
            */

            if (command === "setdesc") {

                if (!fullText) {
                    await sock.sendMessage(jid, {
                        text:
                            `Example: ${prefix}setdesc Welcome`
                    });
                    return;
                }

                await sock.groupUpdateDescription(
                    jid,
                    fullText
                );

                await sock.sendMessage(jid, {
                    text:
                        "✅ Group description updated."
                });

                return;
            }

            /*
            ==============================
                    OPEN / CLOSE
            ==============================
            */

            if (
                command === "open" ||
                command === "close"
            ) {

                await sock.groupSettingUpdate(
                    jid,
                    command === "close"
                        ? "announcement"
                        : "not_announcement"
                );

                await sock.sendMessage(jid, {
                    text:
                        command === "close"
                            ? "🔒 Group closed."
                            : "🔓 Group opened."
                });

                return;
            }

            /*
            ==============================
                 WELCOME / GOODBYE
            ==============================
            */

            if (
                command === "welcome" ||
                command === "goodbye" ||
                command === "antilink"
            ) {

                const value =
                    args[0]?.toLowerCase();

                if (!["on", "off"].includes(value)) {

                    await sock.sendMessage(jid, {
                        text:
                            `Example: ${prefix}${command} on`
                    });

                    return;
                }

                const db = loadGroups();

                if (!db[jid])
                    getGroupData(jid);

                db[jid][command] =
                    value === "on";

                saveGroups(db);

                await sock.sendMessage(jid, {
                    text:
                        `✅ ${command}: ${value}`
                });

                return;
            }

            /*
            ==============================
                    MUTE / UNMUTE
            ==============================
            */

            if (
                command === "mute" ||
                command === "unmute"
            ) {

                await sock.groupSettingUpdate(
                    jid,
                    command === "mute"
                        ? "announcement"
                        : "not_announcement"
                );

                await sock.sendMessage(jid, {
                    text:
                        command === "mute"
                            ? "🔇 Group muted."
                            : "🔊 Group unmuted."
                });

                return;
            }

            /*
            ==============================
                 DOWNLOAD COMMANDS (YOUTUBE)
            ==============================
            */

            if (["song", "play", "audio"].includes(command)) {

                if (!fullText) {
                    await sock.sendMessage(jid, {
                        text: `❌ සින්දුවේ නම හෝ Link එක ලබාදෙන්න.\n*Example:* ${prefix}${command} Nanda Malini`
                    });
                    return;
                }

                await sock.sendMessage(jid, {
                    text: `🔍 *${fullText}* සින්දුව සොයමින් පවතී...`
                });

                const search = await yts(fullText);
                const video = search.videos[0];

                if (!video) {
                    await sock.sendMessage(jid, {
                        text: "❌ සින්දුව සොයාගැනීමට නොහැකි විය."
                    });
                    return;
                }

                const captionText =
                    `🎶 *${config.BOT_NAME} MUSIC DOWNLOADER* 🎶\n\n` +
                    `📌 *නම:* ${video.title}\n` +
                    `⏱️ *කාලය:* ${video.timestamp}\n` +
                    `👁️ *Views:* ${video.views}\n` +
                    `🔗 *Link:* ${video.url}\n\n` +
                    `⬇️ *Audio එක Download වෙමින් පවතී...*`;

                await sock.sendMessage(jid, {
                    image: { url: video.thumbnail },
                    caption: captionText
                });

                const filePath = `./${Date.now()}.mp3`;
                const stream = ytdl(video.url, { filter: "audioonly", quality: "highestaudio" });
                const writeStream = fs.createWriteStream(filePath);

                stream.pipe(writeStream);

                writeStream.on("finish", async () => {
                    await sock.sendMessage(jid, {
                        audio: { url: filePath },
                        mimetype: "audio/mp4",
                        fileName: `${video.title}.mp3`,
                        ptt: false
                    });

                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                });

                writeStream.on("error", async (err) => {
                    console.error("Audio Write Error:", err);
                    await sock.sendMessage(jid, { text: "❌ Download කිරීමේදී දෝෂයක් සිදු විය." });
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                });

                return;
            }

            if (command === "video") {

                if (!fullText) {
                    await sock.sendMessage(jid, {
                        text: `❌ වීඩියෝවේ නම හෝ Link එක ලබාදෙන්න.\n*Example:* ${prefix}video Nanda Malini`
                    });
                    return;
                }

                await sock.sendMessage(jid, {
                    text: `🔍 *${fullText}* වීඩියෝව සොයමින් පවතී...`
                });

                const search = await yts(fullText);
                const video = search.videos[0];

                if (!video) {
                    await sock.sendMessage(jid, {
                        text: "❌ වීඩියෝව සොයාගැනීමට නොහැකි විය."
                    });
                    return;
                }

                const captionText =
                    `🎬 *${config.BOT_NAME} VIDEO DOWNLOADER* 🎬\n\n` +
                    `📌 *නම:* ${video.title}\n` +
                    `⏱️ *කාලය:* ${video.timestamp}\n` +
                    `👁️ *Views:* ${video.views}\n` +
                    `🔗 *Link:* ${video.url}\n\n` +
                    `⬇️ *Video එක Download වෙමින් පවතී...*`;

                await sock.sendMessage(jid, {
                    image: { url: video.thumbnail },
                    caption: captionText
                });

                const filePath = `./${Date.now()}.mp4`;
                const stream = ytdl(video.url, { quality: "18" }); // Format 18 (Medium quality mp4)
                const writeStream = fs.createWriteStream(filePath);

                stream.pipe(writeStream);

                writeStream.on("finish", async () => {
                    await sock.sendMessage(jid, {
                        video: { url: filePath },
                        caption: `🎬 *${video.title}*\n\n🤖 ${config.BOT_NAME}`,
                        mimetype: "video/mp4"
                    });

                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                });

                writeStream.on("error", async (err) => {
                    console.error("Video Write Error:", err);
                    await sock.sendMessage(jid, { text: "❌ Download කිරීමේදී දෝෂයක් සිදු විය." });
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                });

                return;
            }

        } catch (error) {

            console.error(
                "MESSAGE ERROR:",
                error
            );

            try {
                await sock.sendMessage(
                    messages?.[0]?.key?.remoteJid,
                    {
                        text:
                            "❌ Command එක execute කිරීමේදී error එකක් ආවා."
                    }
                );
            } catch {}
        }
    });
}

startBot();

