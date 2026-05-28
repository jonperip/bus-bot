require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Add or remove bus stops here. Each entry: { label, stopCode, buses }
// buses: array of bus service numbers to show (empty = show all buses)
const BUS_STOPS = [
  {
    label: '🚌 Bus 4 — Carissa Park (98309)',
    stopCode: '98309',
    buses: ['4'],             // only show Bus 4
  },
  // Example of a second stop — uncomment & edit to add more:
  // {
  //   label: '🚌 All buses — Tampines Int (75009)',
  //   stopCode: '75009',
  //   buses: [],             // empty = show all buses at stop
  // },
];
// ──────────────────────────────────────────────────────────────────────────────

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌  TELEGRAM_BOT_TOKEN not set in .env');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LOAD_EMOJI = { SEA: '🟢', SDA: '🟡', LSD: '🔴' };
const TYPE_LABEL = { SD: 'Single Deck', DD: 'Double Deck', BD: 'Bendy' };

function formatMinutes(ms) {
  if (ms == null) return null;
  const mins = Math.round(ms / 60000);
  if (mins <= 0) return 'Arr';
  return `${mins} min`;
}

function formatBus(service) {
  const slots = [service.next, service.subsequent, service.next2, service.next3]
    .filter(Boolean);

  if (!slots.length) return `*Bus ${service.no}* — No data`;

  const times = slots
    .map(s => {
      const t = formatMinutes(s.duration_ms);
      const load = LOAD_EMOJI[s.load] || '';
      const type = s.type === 'DD' ? ' 🚌🚌' : '';
      return t ? `${load} ${t}${type}` : null;
    })
    .filter(Boolean)
    .join('  |  ');

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

// ─── Main keyboard ────────────────────────────────────────────────────────────

function mainKeyboard() {
  const buttons = BUS_STOPS.map(stop => ([{
    text: stop.label,
    callback_data: `stop:${stop.stopCode}:${stop.buses.join(',')}`,
  }]));

  buttons.push([{ text: '➕ Add / Edit Bus Stops', callback_data: 'help_edit' }]);

  return { inline_keyboard: buttons };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👋 *SG Bus Arrival Bot*\n\nTap a button below to check live bus timings!\n\n🟢 Seats Available  🟡 Standing  🔴 Limited Standing\n🚌🚌 Double Deck bus`,
    { parse_mode: 'Markdown', reply_markup: mainKeyboard() }
  );
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  const data   = query.data;

  // Answer the callback to remove "loading" spinner
  await bot.answerCallbackQuery(query.id);

  if (data === 'help_edit') {
    const helpText =
      `*Adding more bus stops*\n\n` +
      `Open \`bot.js\` and find the \`BUS_STOPS\` array near the top.\n\n` +
      `Each entry looks like:\n` +
      `\`\`\`\n{ label: '...', stopCode: '98309', buses: ['4'] }\n\`\`\`\n\n` +
      `• *label* — button text shown in Telegram\n` +
      `• *stopCode* — 5-digit SG bus stop code\n` +
      `• *buses* — services to show (empty \`[]\` = all)\n\n` +
      `Find stop codes at: [businterchange.net](https://businterchange.net/sgbus)\n\n` +
      `Save the file and restart the bot. 🎉`;

    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown', disable_web_page_preview: true });
    return;
  }

  if (data.startsWith('stop:')) {
    const [, stopCode, busesStr] = data.split(':');
    const buses = busesStr ? busesStr.split(',').filter(Boolean) : [];

    // Find stop label
    const stop = BUS_STOPS.find(s => s.stopCode === stopCode) || { label: stopCode };

    // Show a "fetching…" edit first for snappy UX
    await bot.editMessageText(
      `⏳ Fetching arrivals for ${stop.label}…`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
    );

    try {
      const text = await fetchArrivals(stopCode, buses);
      const refreshButton = {
        inline_keyboard: [
          [{ text: '🔄 Refresh', callback_data: data }],
          [{ text: '⬅️ Back', callback_data: 'back_home' }],
        ],
      };
      bot.editMessageText(
        `*${stop.label}*\n\n${text}`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: refreshButton }
      );
    } catch (err) {
      bot.editMessageText(
        `❌ Error fetching arrivals: ${err.message}`,
        { chat_id: chatId, message_id: msgId }
      );
    }
    return;
  }

  if (data === 'back_home') {
    bot.editMessageText(
      `👋 *SG Bus Arrival Bot*\n\nTap a button below to check live bus timings!\n\n🟢 Seats Available  🟡 Standing  🔴 Limited Standing\n🚌🚌 Double Deck bus`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainKeyboard() }
    );
  }
});

console.log('🚌 SG Bus Bot is running…  Press Ctrl+C to stop.');
