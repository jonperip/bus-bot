require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getUser(data, userId) {
  if (!data[userId]) data[userId] = { stops: [], schedules: [] };
  return data[userId];
}

// ─── BOT SETUP ───────────────────────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error('❌ TELEGRAM_BOT_TOKEN not set'); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });

// Track conversation state per user
const userState = {};

// Active notification timers per user
const activeTimers = {};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const LOAD_EMOJI = { SEA: '🟢', SDA: '🟡', LSD: '🔴' };

function formatMinutes(ms) {
  if (ms == null) return null;
  const mins = Math.round(ms / 60000);
  if (mins <= 0) return 'Arr';
  return `${mins} min`;
}

function formatBus(service) {
  const slots = [service.next, service.next2, service.next3].filter(Boolean);
  if (!slots.length) return `*Bus ${service.no}* — No data`;
  const times = slots.map(s => {
    const t = formatMinutes(s.duration_ms);
    const load = LOAD_EMOJI[s.load] || '';
    const type = s.type === 'DD' ? '🚌🚌' : '';
    return t ? `${load}${t}${type}` : null;
  }).filter(Boolean).join('  |  ');
  return `*Bus ${service.no}*: ${times}`;
}

async function fetchArrivals(stopCode, busFilter) {
  const res = await fetch(`https://arrivelah2.busrouter.sg/?id=${stopCode}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  let services = data.services || [];
  if (busFilter && busFilter.length > 0) {
    services = services.filter(s => busFilter.includes(s.no));
  }
  if (!services.length) return '⚠️ No arrival data found.';
  const lines = services.map(formatBus).join('\n');
  const now = new Date().toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' });
  return `${lines}\n\n_Updated at ${now} SGT_`;
}

// ─── KEYBOARDS ───────────────────────────────────────────────────────────────
function mainKeyboard(userId) {
  const data = loadData();
  const user = getUser(data, userId);
  const stopButtons = user.stops.map(stop => ([{
    text: `🚌 ${stop.label}`,
    callback_data: `check:${stop.stopCode}:${stop.buses.join(',')}`,
  }]));
  return {
    inline_keyboard: [
      ...stopButtons,
      [{ text: '➕ Add Bus Stop', callback_data: 'add_stop' }],
      ...(user.stops.length > 0 ? [[
        { text: '🗑 Remove a Stop', callback_data: 'remove_stop' },
        { text: '🔔 Set Notifications', callback_data: 'set_notif' },
      ]] : []),
    ]
  };
}

function backHomeButton() {
  return { inline_keyboard: [[{ text: '⬅️ Back to Home', callback_data: 'home' }]] };
}

// ─── /help ───────────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
`📖 *SG Bus Arrival Bot — User Guide*

━━━━━━━━━━━━━━━━━━━
🚀 *Getting Started*
━━━━━━━━━━━━━━━━━━━
Type /start to open the main menu at any time.

━━━━━━━━━━━━━━━━━━━
➕ *Adding a Bus Stop*
━━━━━━━━━━━━━━━━━━━
1. Tap *➕ Add Bus Stop*
2. Enter the *5-digit bus stop code*
   • Found on the sign at the bus stop pole
   • Or look it up at businterchange.net/sgbus
3. The bot shows all buses at that stop
4. Type the bus numbers you want (e.g. \`4, 12\`)
   • Or type \`all\` to track every bus at the stop
5. Your stop is saved and appears as a button!

━━━━━━━━━━━━━━━━━━━
🚌 *Checking Arrivals*
━━━━━━━━━━━━━━━━━━━
• Tap any saved stop button to see live timings
• Tap *🔄 Refresh* to get the latest update
• Tap *⬅️ Back* to return to the main menu

*Reading the timings:*
🟢 Seats available
🟡 Standing room available
🔴 Limited standing room
🚌🚌 Double deck bus
\`Arr\` = Bus is arriving now!

━━━━━━━━━━━━━━━━━━━
🗑 *Removing a Bus Stop*
━━━━━━━━━━━━━━━━━━━
1. Tap *🗑 Remove a Stop*
2. Tap the stop you want to delete
3. It's gone instantly

━━━━━━━━━━━━━━━━━━━
🔔 *Setting Notifications*
━━━━━━━━━━━━━━━━━━━
Get automatic bus updates during your commute hours!

1. Tap *🔔 Set Notifications*
2. Choose which stop to get notified for
3. Enter a *start time* (e.g. \`07:00\`)
4. Enter an *end time* (e.g. \`09:00\`)
5. Enter how often to update in *seconds* (e.g. \`120\` = every 2 mins)
6. Bot will send you live timings automatically during that window
7. Tap *🔕 Stop Notifications* anytime to cancel

⚠️ Notifications use 24-hour format and Singapore time (SGT).

━━━━━━━━━━━━━━━━━━━
💡 *Tips*
━━━━━━━━━━━━━━━━━━━
• You can save multiple stops (home, work, school etc.)
• Your stops are saved permanently — even if the bot restarts
• Each user has their own personal list of stops
• Minimum notification interval is 10 seconds

━━━━━━━━━━━━━━━━━━━
🆘 *Commands*
━━━━━━━━━━━━━━━━━━━
/start — Open main menu
/help — Show this guide`,
    { parse_mode: 'Markdown', disable_web_page_preview: true }
  );
});

// ─── /start ──────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const userId = String(msg.chat.id);
  bot.sendMessage(msg.chat.id,
    `👋 *SG Bus Arrival Bot*\n\nCheck live Singapore bus timings!\n\nTap *➕ Add Bus Stop* to get started.\n\n🟢 Seats  🟡 Standing  🔴 Limited`,
    { parse_mode: 'Markdown', reply_markup: mainKeyboard(userId) }
  );
});

// ─── CALLBACK HANDLER ────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const userId = String(chatId);
  const cbData = query.data;

  await bot.answerCallbackQuery(query.id);

  // ── Home ──
  if (cbData === 'home') {
    userState[userId] = null;
    return bot.editMessageText(
      `👋 *SG Bus Arrival Bot*\n\nCheck live Singapore bus timings!\n\n🟢 Seats  🟡 Standing  🔴 Limited`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainKeyboard(userId) }
    );
  }

  // ── Check bus arrival ──
  if (cbData.startsWith('check:')) {
    const [, stopCode, busesStr] = cbData.split(':');
    const buses = busesStr ? busesStr.split(',').filter(Boolean) : [];
    await bot.editMessageText(`⏳ Fetching arrivals…`,
      { chat_id: chatId, message_id: msgId });
    try {
      const text = await fetchArrivals(stopCode, buses);
      return bot.editMessageText(text, {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Refresh', callback_data: cbData }],
            [{ text: '⬅️ Back', callback_data: 'home' }],
          ]
        }
      });
    } catch (e) {
      return bot.editMessageText(`❌ Error: ${e.message}`,
        { chat_id: chatId, message_id: msgId, reply_markup: backHomeButton() });
    }
  }

  // ── Add stop ──
  if (cbData === 'add_stop') {
    userState[userId] = { step: 'await_stop_code' };
    return bot.editMessageText(
      `➕ *Add a Bus Stop*\n\nPlease type the *5-digit bus stop code*.\n\nYou can find it on the bus stop pole, or at businterchange.net/sgbus`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: backHomeButton() }
    );
  }

  // ── Remove stop ──
  if (cbData === 'remove_stop') {
    const data = loadData();
    const user = getUser(data, userId);
    if (!user.stops.length) {
      return bot.editMessageText(`You have no saved stops.`,
        { chat_id: chatId, message_id: msgId, reply_markup: backHomeButton() });
    }
    const buttons = user.stops.map(stop => ([{
      text: `🗑 ${stop.label}`,
      callback_data: `do_remove:${stop.stopCode}:${stop.buses.join(',')}`,
    }]));
    buttons.push([{ text: '⬅️ Back', callback_data: 'home' }]);
    return bot.editMessageText(`Which stop do you want to remove?`,
      { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: buttons } });
  }

  if (cbData.startsWith('do_remove:')) {
    const [, stopCode, busesStr] = cbData.split(':');
    const data = loadData();
    const user = getUser(data, userId);
    user.stops = user.stops.filter(s => !(s.stopCode === stopCode && s.buses.join(',') === busesStr));
    saveData(data);
    return bot.editMessageText(`✅ Stop removed!`,
      { chat_id: chatId, message_id: msgId, reply_markup: mainKeyboard(userId) });
  }

  // ── Notifications ──
  if (cbData === 'set_notif') {
    userState[userId] = { step: 'await_notif_stop' };
    const data = loadData();
    const user = getUser(data, userId);
    const buttons = user.stops.map(stop => ([{
      text: `🚌 ${stop.label}`,
      callback_data: `notif_stop:${stop.stopCode}:${stop.buses.join(',')}`,
    }]));
    buttons.push([{ text: '⬅️ Back', callback_data: 'home' }]);
    return bot.editMessageText(
      `🔔 *Set Notifications*\n\nWhich stop do you want notifications for?`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
    );
  }

  if (cbData.startsWith('notif_stop:')) {
    const [, stopCode, busesStr] = cbData.split(':');
    userState[userId] = { step: 'await_notif_start', stopCode, buses: busesStr };
    return bot.editMessageText(
      `🕐 What time should notifications *start*?\n\nReply with time in 24hr format, e.g. \`07:00\``,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: backHomeButton() }
    );
  }

  if (cbData.startsWith('cancel_notif:')) {
    const [, stopCode] = cbData.split(':');
    if (activeTimers[userId]) {
      clearInterval(activeTimers[userId]);
      delete activeTimers[userId];
    }
    return bot.editMessageText(`🔕 Notifications cancelled.`,
      { chat_id: chatId, message_id: msgId, reply_markup: mainKeyboard(userId) });
  }
});

// ─── MESSAGE HANDLER (text input) ────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const userId = String(chatId);
  const text = msg.text.trim();
  const state = userState[userId];
  if (!state) return;

  // ── Step 1: Waiting for bus stop code ──
  if (state.step === 'await_stop_code') {
    if (!/^\d{5}$/.test(text)) {
      return bot.sendMessage(chatId, `❌ That doesn't look right. Please enter a *5-digit* bus stop code (numbers only).`,
        { parse_mode: 'Markdown' });
    }
    // Verify stop exists
    try {
      const res = await fetch(`https://arrivelah2.busrouter.sg/?id=${text}`);
      const json = await res.json();
      if (!json.services || json.services.length === 0) {
        return bot.sendMessage(chatId, `❌ No buses found for stop *${text}*. Please check the code and try again.`,
          { parse_mode: 'Markdown' });
      }
      userState[userId] = { step: 'await_bus_numbers', stopCode: text, availableBuses: json.services.map(s => s.no) };
      const busList = json.services.map(s => s.no).join(', ');
      bot.sendMessage(chatId,
        `✅ Found stop *${text}*!\n\nBuses available: *${busList}*\n\nWhich bus numbers do you want to track?\n• Type bus numbers separated by commas (e.g. \`4, 12\`)\n• Or type \`all\` to track all buses`,
        { parse_mode: 'Markdown' });
    } catch (e) {
      bot.sendMessage(chatId, `❌ Couldn't reach the bus API. Please try again.`);
    }
    return;
  }

  // ── Step 2: Waiting for bus numbers ──
  if (state.step === 'await_bus_numbers') {
    let buses = [];
    if (text.toLowerCase() === 'all') {
      buses = [];
    } else {
      buses = text.split(',').map(b => b.trim()).filter(Boolean);
      const invalid = buses.filter(b => !state.availableBuses.includes(b));
      if (invalid.length) {
        return bot.sendMessage(chatId,
          `❌ These buses don't stop here: *${invalid.join(', ')}*\n\nAvailable: *${state.availableBuses.join(', ')}*`,
          { parse_mode: 'Markdown' });
      }
    }
    const label = buses.length > 0
      ? `Bus ${buses.join('/')} (${state.stopCode})`
      : `All buses (${state.stopCode})`;

    const data = loadData();
    const user = getUser(data, userId);

    // Check for duplicate
    const exists = user.stops.find(s => s.stopCode === state.stopCode && s.buses.join(',') === buses.join(','));
    if (exists) {
      userState[userId] = null;
      return bot.sendMessage(chatId, `⚠️ You already have this stop saved!`,
        { reply_markup: mainKeyboard(userId) });
    }

    user.stops.push({ label, stopCode: state.stopCode, buses });
    saveData(data);
    userState[userId] = null;

    bot.sendMessage(chatId, `✅ *${label}* added!\n\nTap it anytime to check live arrivals.`,
      { parse_mode: 'Markdown', reply_markup: mainKeyboard(userId) });
    return;
  }

  // ── Notification: start time ──
  if (state.step === 'await_notif_start') {
    if (!/^\d{2}:\d{2}$/.test(text)) {
      return bot.sendMessage(chatId, `❌ Please use 24hr format like \`07:00\` or \`18:30\``, { parse_mode: 'Markdown' });
    }
    userState[userId] = { ...state, step: 'await_notif_end', startTime: text };
    return bot.sendMessage(chatId, `🕐 What time should notifications *stop*?\n\nReply with time in 24hr format, e.g. \`09:00\``,
      { parse_mode: 'Markdown' });
  }

  // ── Notification: end time ──
  if (state.step === 'await_notif_end') {
    if (!/^\d{2}:\d{2}$/.test(text)) {
      return bot.sendMessage(chatId, `❌ Please use 24hr format like \`09:00\``, { parse_mode: 'Markdown' });
    }
    userState[userId] = { ...state, step: 'await_notif_interval', endTime: text };
    return bot.sendMessage(chatId,
      `⏱ How often should I send updates? (in seconds)\n\nE.g. type \`60\` for every minute, \`300\` for every 5 minutes`,
      { parse_mode: 'Markdown' });
  }

  // ── Notification: interval ──
  if (state.step === 'await_notif_interval') {
    const interval = parseInt(text);
    if (isNaN(interval) || interval < 10) {
      return bot.sendMessage(chatId, `❌ Please enter a number of seconds (minimum 10).`);
    }

    const { stopCode, buses: busesStr, startTime, endTime } = state;
    const buses = busesStr ? busesStr.split(',').filter(Boolean) : [];
    userState[userId] = null;

    // Cancel any existing timer
    if (activeTimers[userId]) clearInterval(activeTimers[userId]);

    bot.sendMessage(chatId,
      `✅ *Notifications set!*\n\n🚏 Stop: ${stopCode}\n🕐 From: ${startTime} to ${endTime}\n⏱ Every: ${interval} seconds\n\nI'll send you updates during that window every day.`,
      { parse_mode: 'Markdown', reply_markup: {
        inline_keyboard: [[{ text: '🔕 Cancel Notifications', callback_data: `cancel_notif:${stopCode}` }]]
      }}
    );

    // Start the interval
    activeTimers[userId] = setInterval(async () => {
      const now = new Date().toLocaleTimeString('en-SG', {
        timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false
      });
      if (now >= startTime && now <= endTime) {
        try {
          const arrivalText = await fetchArrivals(stopCode, buses);
          bot.sendMessage(chatId, `🔔 *Bus Update*\n\n${arrivalText}`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔕 Stop Notifications', callback_data: `cancel_notif:${stopCode}` }]] }
          });
        } catch (e) {
          console.error('Notification fetch error:', e.message);
        }
      } else if (now > endTime) {
        clearInterval(activeTimers[userId]);
        delete activeTimers[userId];
        bot.sendMessage(chatId, `🔕 Notifications ended for today. Set them again tomorrow if needed!`);
      }
    }, interval * 1000);

    return;
  }
});

console.log('🚌 SG Bus Bot is running…  Press Ctrl+C to stop.');
