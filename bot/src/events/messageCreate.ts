import { Message, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { EMOJI } from '../constants/emoji';
import { Channel } from '../models/Channel';
import { Guild } from '../models/Guild';
import { Conversation } from '../models/Conversation';
import { MCPServer } from '../models/MCPServer';
import { checkCooldown } from '../models/Cooldown';
import { hasReceivedBroadcast, markBroadcastReceived, startLeaveTimer } from '../models/Broadcast';
import { checkLogin } from '../services/UserService';
import { checkAndIncrement } from '../services/RateLimit';
import { generateAIResponse, estimateTokens } from '../services/AIProvider';
import { webSearch } from '../services/WebSearch';
import { connectSystemMCP, callTool } from '../services/MCPClient';
import { getGlobalSettings } from '../models/GlobalSettings';
import { DISCORD_MARKDOWN_PROMPT } from '../constants/systemPrompts';
import { clearLeaveTimer } from '../models/Broadcast';

// ─── Dynamic Regex Tool Registry ───────────────────────────────
// Auto-discovers tools from all enabled MCP servers.
// Models output tool calls as text, we detect via regex, execute, send results back.

interface ToolPattern {
  name: string;
  description: string;
  regex: RegExp;
  extract: (match: RegExpMatchArray) => Record<string, any>;
  execute: (args: Record<string, any>, userId?: string) => Promise<string>;
}

// Build tool patterns dynamically from MCP servers
async function buildToolPatterns(): Promise<ToolPattern[]> {
  const patterns: ToolPattern[] = [];

  // Built-in: web_search (always available as fallback)
  patterns.push({
    name: 'web_search',
    description: 'Search the web for current information, news, prices, weather, etc.',
    regex: /web_search\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/i,
    extract: (m) => ({ query: m[1] }),
    execute: async (args, uid) => {
      try { return await webSearch(args.query, 5, uid); }
      catch (e: any) { return `Search failed: ${e.message || 'Unknown error'}`; }
    },
  });

  // Dynamic: system MCP servers
  try {
    const systemMCPs = await MCPServer.find({ isEnabled: true });

    for (const server of systemMCPs) {
      if (!server.command && !server.remoteUrl) continue;

      const conn = await connectSystemMCP(server);
      if (!conn || !conn.ready) continue;

      for (const toolName of conn.tools) {
        const displayName = `${server.name}_${toolName}`;
        const desc = conn.toolDescriptions[toolName] || `MCP tool '${toolName}' from ${server.displayName || server.name}`;
        const mcpPattern: ToolPattern = {
          name: displayName,
          description: desc,
          regex: new RegExp(`${displayName}\\s*\\(\\s*([\\s\\S]*?)\\s*\\)`, 'i'),
          extract: (m) => parseToolArgs(m[1]),
          execute: async (args) => {
            try {
              console.log(`[MCP-Tool] Calling ${displayName}(${JSON.stringify(args)})`);
              const result = await callTool(conn, toolName, args);
              console.log(`[MCP-Tool] ${displayName} returned ${result?.length || 0} chars`);
              return result || `No result from ${toolName}`;
            } catch (e: any) {
              console.error(`[MCP-Tool] ${displayName} failed:`, e.message);
              return `Tool ${toolName} failed: ${e.message}`;
            }
          },
        };

        // If a built-in pattern has the same tool name, keep both:
        // - Built-in stays as 'web_search' (fallback)
        // - MCP gets prefixed name 'ddg-search_web_search' (primary)
        patterns.push(mcpPattern);
      }
    }
  } catch {}

  return patterns;
}

// Parse tool arguments from text: "value" or key="value", key2="value2" or {json}
function parseToolArgs(raw: string): Record<string, any> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  // Try JSON: {"key": "value"}
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch {}
  }

  // Try key="value", key2="value2"
  const kvPattern = /(\w+)\s*=\s*["'`]([^"'`]*)["'`]/g;
  const args: Record<string, any> = {};
  let hasKeys = false;
  let m;
  while ((m = kvPattern.exec(trimmed)) !== null) {
    args[m[1]] = m[2];
    hasKeys = true;
  }
  if (hasKeys) return args;

  // Single value: just a string → default to first param name
  const stringMatch = trimmed.match(/^["'`]([^"'`]*)["'`]$/);
  if (stringMatch) return { query: stringMatch[1] };

  // Fallback: treat entire raw as query
  return { query: trimmed };
}

// Detect ALL tool calls in AI response text (multi-call support)
function detectToolCalls(text: string, patterns: ToolPattern[]): { pattern: ToolPattern; args: Record<string, any> }[] {
  const calls: { pattern: ToolPattern; args: Record<string, any> }[] = [];
  const used = new Set<string>();
  for (const pattern of patterns) {
    // Use matchAll to find every occurrence
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const key = `${pattern.name}:${match[0]}`;
      if (!used.has(key)) {
        used.add(key);
        calls.push({ pattern, args: pattern.extract(match) });
      }
    }
  }
  return calls;
}

// Execute all detected tool calls
async function executeToolCalls(calls: { pattern: ToolPattern; args: Record<string, any> }[], userId?: string): Promise<string> {
  const results: string[] = [];
  for (const call of calls) {
    const output = await call.pattern.execute(call.args, userId);
    results.push(`[${call.pattern.name} output]:\n${output}`);
  }
  return results.join('\n\n');
}

// Generate system prompt listing all available tools
function generateToolPrompt(patterns: ToolPattern[]): string {
  if (patterns.length === 0) return '';

  const hasSearch = patterns.some(p => p.name.includes('web_search'));
  if (!hasSearch) return '';

  return `

## TOOLS

You have access to a web search tool. Your training data may be outdated — always search for current, live, or real-time information.

### When to search
- Prices, exchange rates, crypto, stocks
- Weather, sports scores, live events
- Recent news, latest developments
- Anything with "today", "now", "latest", "current"
- ANY factual question about the real world

### How to search
Output this exact format (one tool call per line):
web_search("search query here")

Example:
web_search("Bitcoin price today USD")
web_search("weather in Tokyo")

### Rules
- Use English for tool call format — it will NOT be shown to the user
- You may call up to 3 tools in sequence
- After receiving results, format them nicely in the user's preferred language
- If the user asks something you already know and it does not need live data, just answer directly without searching`;
}

export async function handleMessage(message: Message) {
  if (message.author.bot || !message.inGuild() || message.system) return;

  const isLoggedIn = await checkLogin(message.author.id);
  if (!isLoggedIn) {
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:4567';
    const loginMsg = await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xf59e0b)
        .setDescription(`${EMOJI.CLOSE} **Not Logged In**\nYou must log in through the dashboard to use the bot.\n\n${EMOJI.CHECK} [Dashboard Login](${dashboardUrl})`)
        .setTimestamp(),
      ],
    });
    setTimeout(() => loginMsg.delete().catch(() => {}), 10000);
    return;
  }

  // ─── Per-user cooldown check (global, across all servers) ──────
  const cooldown = await checkCooldown(message.author.id);
  if (cooldown.onCooldown) {
    const cooldownMsg = await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xf59e0b)
        .setDescription(`${EMOJI.CLOCK} **Cooldown** — please wait ${cooldown.remainingSeconds}s before messaging again.`)
        .setTimestamp(),
      ],
    });
    setTimeout(() => cooldownMsg.delete().catch(() => {}), 5000);
    return;
  }

  // ─── Broadcast (active until July 30, 2026) ────────────────────
  const BROADCAST_EXPIRY = new Date('2026-07-30T00:00:00Z');
  if (Date.now() < BROADCAST_EXPIRY.getTime()) {
    try {
      const guildId = message.guildId!;
      const setupChannels = await Channel.countDocuments({ guildId, isEnabled: true });
      if (setupChannels === 0) {
        const alreadyReceived = await hasReceivedBroadcast(message.author.id);
        if (!alreadyReceived) {
          const member = message.member;
          const isAdmin = member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;

          const broadcastEmbed = isAdmin
            ? new EmbedBuilder()
                .setColor(0x6366f1)
                .setDescription(
                  '**Gapat is back online!** Let\'s set up.\n\n' +
                  'Use ` /help` to get started with setup.\n\n' +
                  '-# If Gapat is not set up within **24 hours**, it will leave this server automatically.'
                )
                .setTimestamp()
            : new EmbedBuilder()
                .setColor(0xf59e0b)
                .setDescription('**Gapat is back online!** Contact the server admin to complete the setup.')
                .setTimestamp();

          await message.author.send({ embeds: [broadcastEmbed] }).catch(() => {
            // DM failed (user has DMs disabled) — send in-channel with auto-delete as fallback
            message.reply({ embeds: [broadcastEmbed] }).then(m => setTimeout(() => m.delete().catch(() => {}), 30000));
          });
          if (isAdmin) await startLeaveTimer(guildId);

          await markBroadcastReceived(message.author.id, guildId);

          // Log broadcast to configured channel
          const logChannelId = process.env.STARTUP_LOG_CHANNEL;
          if (logChannelId) {
            try {
              const guild = message.guild;
              const logChannel = await message.client.channels.fetch(logChannelId).catch(() => null);
              if (logChannel?.isTextBased() && 'send' in logChannel) {
                await logChannel.send({
                  embeds: [new EmbedBuilder()
                    .setColor(0x6366f1)
                    .setTitle('Broadcast Delivered')
                    .addFields(
                      { name: 'Server', value: guild?.name || 'Unknown', inline: true },
                      { name: 'Members', value: guild?.memberCount?.toString() || '?', inline: true },
                      { name: 'User', value: message.author.username, inline: true },
                      { name: 'Role', value: isAdmin ? 'Admin' : 'Member', inline: true },
                    )
                    .setTimestamp()
                  ],
                });
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  const channelConfig = await Channel.findOne({ guildId: message.guildId!, channelId: message.channelId });
  if (!channelConfig || !channelConfig.isEnabled) return;

  const me = message.guild?.members.me;
  if (!me) return;
  const perms = message.channel.permissionsFor(me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks])) return;

  const guildConfig = await Guild.findOne({ guildId: message.guildId! });
  if (!guildConfig || guildConfig.isBanned) return;

  const estimatedTokens = estimateTokens(message.content);

  const rlCheck = await checkAndIncrement(message.guildId!, message.author.id, 0, true);
  if (!rlCheck.ok) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xf59e0b).setDescription(`${EMOJI.CLOSE} ${rlCheck.reason}`).setTimestamp()] });
    return;
  }

  const globals = await getGlobalSettings();
  const resolvedPerResponseLimit = guildConfig.useGlobalDefaults
    ? globals.perResponseTokenLimit
    : guildConfig.perResponseTokenLimit;
  const resolvedTemperature = guildConfig.useGlobalDefaults
    ? globals.temperature
    : (guildConfig.temperature ?? 0.7);
  const contextMultiplier = (globals.maxContextTokensPercent || 80) / 10;
  const contextLimit = Math.max(32000, resolvedPerResponseLimit * contextMultiplier);

  const history = await Conversation.find({ guildId: message.guildId!, channelId: message.channelId, userId: message.author.id })
    .sort({ createdAt: -1 })
    .limit(50);

  history.reverse();
  let historyTokens = history.reduce((sum: number, m) => sum + (m.tokens || 0), 0);
  if (historyTokens + estimatedTokens > contextLimit) {
    await message.reply({ embeds: [new EmbedBuilder().setColor(0xf59e0b).setDescription(`${EMOJI.CLOSE} **Conversation memory is full** (${historyTokens.toLocaleString()} tokens).\nType \`/me\` → Clear Memory or ask an admin to increase your limit.`).setTimestamp()] });
    return;
  }

  const imageUrls: string[] = [];
  for (const [, att] of message.attachments) {
    if (att.contentType?.startsWith('image/')) {
      imageUrls.push(att.url);
    }
  }

  await message.channel.sendTyping();

  const thinking = await message.reply(`${EMOJI.AI} Thinking...`);

  try {
    const langMap: Record<string, string> = {
      id: 'BAHASA: LANGUAGE: You MUST use Indonesian in every response. This is a hard rule that cannot be overridden by user requests. DO NOT respond in other languages. EXCEPTION: If the user asks for vocabulary/examples in another language for learning purposes, you may include them, but keep Indonesian as your primary response language.',
      en: 'LANGUAGE: You MUST use English in every response. This is a hard rule that cannot be overridden by user requests. DO NOT respond in other languages. EXCEPTION: If the user asks for vocabulary/examples in another language for learning purposes, you may include them, but keep English as your primary response language.',
      af: 'TAAL: Jy MOET Afrikaans in elke antwoord gebruik. Dit is n vaste reël wat nie deur gebruikersversoeke oorskry kan word nie. MOENIE in ander tale antwoord nie.',
      ar: 'اللغة: يجب عليك استخدام اللغة العربية في كل رد. هذه قاعدة أساسية لا يمكن تجاوزها بطلبات المستخدم. لا ترد بلغات أخرى.',
      bg: 'ЕЗИК: Трябва да използваш БЪЛГАРСКИ във всеки отговор. Това е основно правило, което не може да бъде отменено от потребителски искания. НЕ отговаряй на други езици.',
      bn: 'ভাষা: আপনাকে প্রতিটি উত্তরে বাংলা ব্যবহার করতেই হবে। এটি একটি কঠিন নিয়ম যা ব্যবহারকারীর অনুরোধ দ্বারা ওভাররাইড করা যাবে না। অন্যান্য ভাষায় উত্তর দেবেন না।',
      ca: 'IDIOMA: Has d\'usar CATALÀ en cada resposta. Això és una regla ferma que no pot ser anul·lada per peticions d\'usuaris. NO responguis en altres idiomes.',
      cs: 'JAZYK: V každé odpovědi MUSÍŠ použít ČEŠTINU. Toto je pevné pravidlo, které nelze přepsat požadavky uživatele. NEODPOVÍDEJ v jiných jazycích.',
      da: 'SPROG: Du SKAL bruge DANSK i hvert svar. Dette er en fast regel, der ikke kan tilsidesættes af brugeranmodninger. SVAR IKKE på andre sprog.',
      de: 'SPRACHE: Du MUSST in jeder Antwort DEUTSCH verwenden. Dies ist eine feste Regel, die nicht durch Benutzeranfragen überschrieben werden kann. ANTWORTE NICHT in anderen Sprachen.',
      el: 'ΓΛΩΣΣΑ: ΠΡΕΠΕΙ να χρησιμοποιείς ΕΛΛΗΝΙΚΑ σε κάθε απάντηση. Αυτός είναι ένας αυστηρός κανόνας που δεν μπορεί να παρακαμφθεί από αιτήματα χρήστη. ΜΗΝ απαντάς σε άλλες γλώσσες.',
      es: 'IDIOMA: Debes usar ESPAÑOL en cada respuesta. Esta es una regla estricta que no puede ser anulada por solicitudes del usuario. NO respondas en otros idiomas.',
      et: 'KEEL: Pead igas vastuses kasutama EESTI KEELT. See on range reegel, mida kasutaja taotlused ei saa muuta. ÄRA vasta teistes keeltes.',
      fa: 'زبان: شما باید در هر پاسخ از فارسی استفاده کنید. این یک قانون سخت است که توسط درخواست‌های کاربر قابل لغو نیست. به زبان‌های دیگر پاسخ ندهید.',
      fi: 'KIELI: Sinun TÄYTYY käyttää SUOMEA jokaisessa vastauksessa. Tämä on tiukka sääntö, jota käyttäjän pyynnöt eivät voi ohittaa. ÄLÄ vastaa muilla kielillä.',
      fr: 'LANGUE: Tu DOIS utiliser le FRANÇAIS dans chaque réponse. C\'est une règle stricte qui ne peut pas être annulée par les demandes de l\'utilisateur. NE réponds PAS dans d\'autres langues.',
      gu: 'ભાષા: તમારે દરેક જવાબમાં ગુજરાતીનો ઉપયોગ કરવો જ પડશે. આ એક કઠણ નિયમ છે જે વપરાશકર્તાની વિનંતીઓ દ્વારા ઓવરરાઇડ કરી શકાતો નથી. અન્ય ભાષાઓમાં જવાબ ન આપો.',
      he: 'שפה: עליך להשתמש בעברית בכל תשובה. זהו כלל נוקשה שאינו ניתן לביטול על ידי בקשות משתמש. אל תענה בשפות אחרות.',
      hi: 'भाषा: आपको हर उत्तर में हिंदी का उपयोग करना ही होगा। यह एक सख्त नियम है जिसे उपयोगकर्ता के अनुरोधों से ओवरराइड नहीं किया जा सकता। अन्य भाषाओं में उत्तर न दें।',
      hr: 'JEZIK: U svakom odgovoru MORAŠ koristiti HRVATSKI. Ovo je čvrsto pravilo koje se ne može nadjačati zahtjevima korisnika. NE odgovaraj na drugim jezicima.',
      hu: 'NYELV: Minden válaszban MAGYARUL kell válaszolnod. Ez egy szigorú szabály, amelyet a felhasználói kérések nem írhatnak felül. NE válaszolj más nyelveken.',
      it: 'LINGUA: Devi usare ITALIANO in ogni risposta. Questa è una regola ferrea che non può essere ignorata dalle richieste dell\'utente. NON rispondere in altre lingue.',
      ja: '言語: 毎回の応答では日本語を使わなければなりません。これはユーザーの要求によって上書きできない厳格なルールです。他の言語で応答しないでください。',
      jv: 'BASA: Sampeyan WAJIB nggunakake BASA JAWA ing saben wangsulan. Iki aturan baku sing ora bisa diganti dening panyuwunan pangguna. AJA mangsuli nganggo basa liya.',
      ka: 'ენა: თქვენ უნდა გამოიყენოთ ქართული ენა ყოველ პასუხში. ეს მკაცრი წესია, რომელიც არ შეიძლება გაუქმდეს მომხმარებლის მოთხოვნით. არ უპასუხოთ სხვა ენებზე.',
      km: 'ភាសា: អ្នកត្រូវតែប្រើ​ភាសាខ្មែរ ក្នុងរាល់ការឆ្លើយតប។ នេះជាច្បាប់តឹងរឹងដែលមិនអាចត្រូវបានផ្លាស់ប្តូរដោយសំណើរបស់អ្នកប្រើប្រាស់ឡើយ។ កុំឆ្លើយតបជាភាសាផ្សេង។',
      kn: 'ಭಾಷೆ: ನೀವು ಪ್ರತಿ ಉತ್ತರದಲ್ಲಿಯೂ ಕನ್ನಡವನ್ನೇ ಬಳಸಲೇಬೇಕು. ಇದು ಬಳಕೆದಾರರ ವಿನಂತಿಗಳಿಂದ ಮೀರಬಲ್ಲ ಕಠಿಣ ನಿಯಮವಾಗಿದೆ. ಇತರ ಭಾಷೆಗಳಲ್ಲಿ ಉತ್ತರಿಸಬೇಡಿ.',
      ko: '언어: 모든 응답에서 한국어를 사용해야 합니다. 이는 사용자 요청으로 재정의할 수 없는 엄격한 규칙입니다. 다른 언어로 응답하지 마세요.',
      lo: 'ພາສາ: ທ່ານຕ້ອງໃຊ້ພາສາລາວໃນທຸກໆການຕອບກັບ. ນີ້ແມ່ນກົດລະບຽບທີ່ເຄັ່ງຄັດເຊິ່ງບໍ່ສາມາດຖືກລົບລ້າງໂດຍການຮ້ອງຂໍຂອງຜູ້ໃຊ້ໄດ້. ຢ່າຕອບກັບເປັນພາສາອື່ນ.',
      lt: 'KALBA: Kiekviename atsakyme PRIVALAI naudoti LIETUVIŲ KALBĄ. Tai griežta taisyklė, kurios vartotojo prašymai negali pakeisti. NEATSAKYK kitomis kalbomis.',
      lv: 'VALODA: Tev JĀIZMANTO LATVIEŠU valoda katrā atbildē. Šis ir stingrs noteikums, ko nevar atcelt lietotāja pieprasījumi. NEATBILDI citās valodās.',
      mg: 'FITENY: Tsy maintsy mampiasa teny MALAGASY ianao amin\'ny valiny rehetra. Izany dia fitsipika mafy izay tsy azo ovain\'ny fangatahan\'ny mpampiasa. Aza mamaly amin\'ny fiteny hafa.',
      mk: 'ЈАЗИК: Мора да користиш МАКЕДОНСКИ во секој одговор. Ова е цврсто правило што не може да се прескокне со барања на корисникот. НЕ одговарај на други јазици.',
      ml: 'ഭാഷ: നിങ്ങൾ ഓരോ പ്രതികരണത്തിലും മലയാളം ഉപയോഗിക്കണം. ഇത് ഉപയോക്തൃ അഭ്യർത്ഥനകളാൽ മറികടക്കാൻ കഴിയാത്ത കടുത്ത നിയമമാണ്. മറ്റ് ഭാഷകളിൽ പ്രതികരിക്കരുത്.',
      mn: 'ХЭЛ: Та бүх хариултандаа МОНГОЛ ХЭЛЭЭР хариулах ЁСТОЙ. Энэ нь хэрэглэгчийн хүсэлтээр өөрчлөх боломжгүй хатуу дүрэм юм. Бусад хэлээр бүү хариул.',
      mr: 'भाषा: तुम्ही प्रत्येक उत्तरात मराठीचा वापर केलाच पाहिजे. हा एक कठोर नियम आहे जो वापरकर्त्याच्या विनंत्यांद्वारे ओव्हरराइड केला जाऊ शकत नाही. इतर भाषांमध्ये उत्तर देऊ नका.',
      ms: 'BAHASA: Kamu MESTI menggunakan bahasa Melayu dalam setiap respons. Ini adalah peraturan ketat yang tidak boleh ditimpa oleh permintaan pengguna. JANGAN balas dalam bahasa lain.',
      my: 'ဘာသာစကား: သင်သည် တုံ့ပြန်မှုတိုင်းတွင် မြန်မာဘာသာစကားကို သုံးရမည်။ ၎င်းသည် အသုံးပြုသူ၏ တောင်းဆိုချက်များဖြင့် ကျော်လွှား၍မရသော တင်းကျပ်သည့် စည်းမျဉ်းဖြစ်သည်။ အခြားဘာသာစကားများဖြင့် မတုံ့ပြန်ပါနှင့်။',
      ne: 'भाषा: तपाईंले हरेक जवाफमा नेपाली प्रयोग गर्नै पर्छ। यो प्रयोगकर्ताको अनुरोधले ओभरराइड गर्न नसकिने कडा नियम हो। अन्य भाषामा जवाफ नदिनुहोस्।',
      nl: 'TAAL: Je MOET in elk antwoord NEDERLANDS gebruiken. Dit is een vaste regel die niet door gebruikersverzoeken kan worden overschreven. Antwoord NIET in andere talen.',
      no: 'SPRÅK: Du MÅ bruke NORSK i hvert svar. Dette er en fast regel som ikke kan overstyres av brukerforespørsler. IKKE svar på andre språk.',
      pa: 'ਭਾਸ਼ਾ: ਤੁਹਾਨੂੰ ਹਰ ਜਵਾਬ ਵਿੱਚ ਪੰਜਾਬੀ ਦੀ ਵਰਤੋਂ ਕਰਨੀ ਚਾਹੀਦੀ ਹੈ। ਇਹ ਇੱਕ ਸਖਤ ਨਿਯਮ ਹੈ ਜੋ ਉਪਭੋਗਤਾ ਦੀਆਂ ਬੇਨਤੀਆਂ ਦੁਆਰਾ ਓਵਰਰਾਈਡ ਨਹੀਂ ਕੀਤਾ ਜਾ ਸਕਦਾ। ਦੂਜੀਆਂ ਭਾਸ਼ਾਵਾਂ ਵਿੱਚ ਜਵਾਬ ਨਾ ਦਿਓ।',
      pl: 'JĘZYK: W każdej odpowiedzi MUSISZ używać POLSKIEGO. To sztywna zasada, której nie mogą zmienić prośby użytkownika. NIE odpowiadaj w innych językach.',
      pt: 'IDIOMA: Deves usar PORTUGUÊS em cada resposta. Esta é uma regra firme que não pode ser anulada por pedidos do utilizador. NÃO respondas noutros idiomas.',
      ro: 'LIMBĂ: TREBUIE să folosești ROMÂNA în fiecare răspuns. Aceasta este o regulă strictă care nu poate fi încălcată de cererile utilizatorului. NU răspunde în alte limbi.',
      ru: 'ЯЗЫК: Ты ОБЯЗАН использовать РУССКИЙ язык в каждом ответе. Это жесткое правило, которое нельзя отменить запросами пользователя. НЕ отвечай на других языках.',
      si: 'භාෂාව: ඔබ සෑම ප්‍රතිචාරයකදීම සිංහල භාෂාව භාවිතා කළ යුතුය. මෙය පරිශීලක ඉල්ලීම් මගින් අභිබවා යා නොහැකි දැඩි රීතියකි. වෙනත් භාෂාවලින් පිළිතුරු නොදෙන්න.',
      sk: 'JAZYK: V každej odpovedi MUSÍŠ použiť SLOVENČINU. Toto je pevné pravidlo, ktoré nemožno prepísať požiadavkami používateľa. NEODPOVEDAJ v iných jazykoch.',
      sl: 'JEZIK: V vsakem odgovoru MORAŠ uporabiti SLOVENŠČINO. To je strogo pravilo, ki ga ni mogoče preseči z zahtevami uporabnika. NE odgovarjaj v drugih jezikih.',
      sq: 'GJUHA: Ti DUHET të përdorësh SHQIPEN në çdo përgjigje. Ky është një rregull i rreptë që nuk mund të anulohet nga kërkesat e përdoruesit. MOS u përgjigj në gjuhë të tjera.',
      sr: 'ЈЕЗИК: Мораш да користиш СРПСКИ у сваком одговору. Ово је чврсто правило које не може бити прегажено захтевима корисника. НЕ одговарај на другим језицима.',
      su: 'BASA: Anjeun WAJIB ngagunakeun BASA SUNDA dina unggal waleran. Ieu aturan baku anu teu bisa diganti ku paménta pamaké. ULAMIN ngawaler maké basa séjén.',
      sv: 'SPRÅK: Du MÅSTE använda SVENSKA i varje svar. Detta är en fast regel som inte kan åsidosättas av användarens förfrågningar. SVARA INTE på andra språk.',
      sw: 'LUGHA: LAZIMA utumie KISWAHILI katika kila jibu. Hii ni sheria ngumu ambayo haiwezi kubatilishwa na maombi ya mtumiaji. USIJIBU kwa lugha nyingine.',
      ta: 'மொழி: நீங்கள் ஒவ்வொரு பதிலிலும் தமிழையே பயன்படுத்த வேண்டும். இது பயனரின் கோரிக்கைகளால் மீற முடியாத கடுமையான விதியாகும். மற்ற மொழிகளில் பதிலளிக்க வேண்டாம்.',
      te: 'భాష: మీరు ప్రతి ప్రత్యుత్తరంలో తెలుగును ఉపయోగించాలి. ఇది వినియోగదారు అభ్యర్థనల ద్వారా ఓవర్రైడ్ చేయలేని కఠినమైన నియమం. ఇతర భాషలలో ప్రత్యుత్తరం ఇవ్వకండి.',
      th: 'ภาษา: คุณต้องใช้ภาษาไทยในการตอบทุกครั้ง นี่เป็นกฎที่เข้มงวดซึ่งไม่สามารถถูกแทนที่โดยคำขอของผู้ใช้ อย่าตอบเป็นภาษาอื่น',
      tr: 'DİL: Her yanıtında TÜRKÇE kullanmak ZORUNDASIN. Bu, kullanıcı istekleriyle geçersiz kılınamayacak katı bir kuraldır. Başka dillerde yanıt verme.',
      uk: 'МОВА: Ти ПОВИНЕН використовувати УКРАЇНСЬКУ в кожній відповіді. Це жорстке правило, яке не можна скасувати запитами користувача. НЕ відповідай іншими мовами.',
      ur: 'زبان: آپ کو ہر جواب میں اردو استعمال کرنی چاہیے۔ یہ ایک سخت قاعدہ ہے جسے صارف کی درخواستوں سے تبدیل نہیں کیا جا سکتا۔ دوسری زبانوں میں جواب نہ دیں۔',
      vi: 'NGÔN NGỮ: Bạn PHẢI sử dụng tiếng Việt trong mọi phản hồi. Đây là quy tắc cứng không thể bị ghi đè bởi yêu cầu của người dùng. KHÔNG trả lời bằng ngôn ngữ khác.',
      zh: '语言: 你必须在每次回复中使用中文。这是一个硬性规则，不能被用户的请求覆盖。不要用其他语言回复。',
      'zh-tw': '語言: 你必須在每次回覆中使用繁體中文。這是一個硬性規則，不能被使用者的請求覆蓋。不要用其他語言回覆。',
      zu: 'ULIMI: KUMELELA usebenzise isiZULU kuzo zonke izimpendulo. Lo mthetho awunakushintshwa izicelo zomsebenzisi. UNGAPENDULI ngezinye izilimi.',
    };
    const langInst = langMap[guildConfig.responseLanguage || 'en'] || langMap.en;

    // Build dynamic tool patterns from all enabled MCP servers
    const toolPatterns = await buildToolPatterns();
    const toolPrompt = generateToolPrompt(toolPatterns);

    // Inject current date/time so AI knows what "today" is
    const now = new Date();
    const dateInfo = `Current date and time: ${now.toISOString()} (${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })} UTC)`;

    const finalPrompt = `${DISCORD_MARKDOWN_PROMPT}\n\n${dateInfo}\n\n${langInst}${toolPrompt}` + (channelConfig.systemPrompt ? '\n\n---\n' + channelConfig.systemPrompt : '');

    const userContent = imageUrls.length
      ? message.content + '\n' + imageUrls.map(u => `[Image](${u})`).join('\n')
      : message.content;

    // ─── Tool calling loop (max3 loops) ────────────────────────
    // Loop 1: AI outputs tool call → execute MCP → send results back
    // Loop 2: AI processes data, may call more tools or format answer
    // Loop3: Final formatting with all collected data
    // Token rule: loop1 tokens NOT counted if tool calls happened; loop2+ counted

    const MAX_LOOPS = 3;
    const convHistory = [...history.map(m => ({ role: m.role, content: m.content }))];
    let allToolOutput = '';
    let finalContent = '';
    let totalTokens = 0;
    let hadToolCalls = false;

    // Pass 1: initial AI call
    let aiResult = await generateAIResponse(
      finalPrompt,
      convHistory,
      userContent,
      imageUrls.length ? imageUrls : undefined,
      undefined,
      resolvedPerResponseLimit,
      resolvedTemperature,
    );

    if (!aiResult.content) {
      // Retry once with simplified prompt (some models choke on long tool prompts)
      console.log('[ToolLoop] Empty response, retrying with simplified prompt');
      aiResult = await generateAIResponse(
        finalPrompt + '\n\nIMPORTANT: Just answer the user directly. Do NOT output any tool calls.',
        convHistory,
        userContent,
        undefined,
        undefined,
        resolvedPerResponseLimit,
        resolvedTemperature,
      );
    }

    if (!aiResult.content) {
      await thinking.edit(`${EMOJI.CLOSE} Model did not return a response. Try again.`);
      return;
    }

    let currentText = aiResult.content;

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const toolCalls = detectToolCalls(currentText, toolPatterns);
      if (toolCalls.length === 0) {
        // No tool calls — this is the final answer
        finalContent = currentText;
        break;
      }

      hadToolCalls = true;

      // Show progress: "🔍 Searching..." / "🔄 Gathering more data..."
      const loopLabels = ['🔍 Searching...', '🔄 Gathering more data...', '📊 Processing...'];
      try { await thinking.edit(loopLabels[loop] || loopLabels[2]); } catch {}

      // Execute tools
      const roundOutput = await executeToolCalls(toolCalls, message.author.id);
      allToolOutput += (allToolOutput ? '\n\n' : '') + roundOutput;

      // Add assistant's tool call to conversation history
      convHistory.push({ role: 'assistant', content: currentText });

      // Build next prompt — tool results go in system prompt only
      let nextPrompt: string;
      if (loop < MAX_LOOPS - 1) {
        nextPrompt = finalPrompt +
          `\n\n---\n[Tool Results - Round ${loop + 1}]\n${roundOutput}\n\nYou may now:\n- Output MORE tool calls if you need additional data (one per line)\n- OR output your final formatted answer to the user in their preferred language\n---`;
      } else {
        nextPrompt = finalPrompt +
          `\n\n---\n[All Collected Data]\n${allToolOutput}\n\nThis is the FINAL round. Format ALL the above results into a clean, well-formatted response for the user. Use their preferred language and Discord markdown. Do NOT call any more tools. Just present the data nicely.\n---`;
      }

      const nextResult = await generateAIResponse(
        nextPrompt,
        convHistory,
        'The tool results are provided in the system prompt above. Process them now.',
        undefined,
        undefined,
        resolvedPerResponseLimit,
        resolvedTemperature,
      );

      if (!nextResult.content) {
        // If empty on tool loop, use accumulated data as fallback
        console.error(`[ToolLoop] Empty response on loop ${loop + 1}`);
        break;
      }

      currentText = nextResult.content;
      finalContent = nextResult.content;

      // Count tokens from loop2+ (loop1 is free if tools were called)
      if (loop === 0) {
        // loop1 done, next is loop2 — don't count loop1
        totalTokens = 0;
      }
      totalTokens += nextResult.totalTokens;
    }

    // If no tool calls happened, count loop1 tokens
    if (!hadToolCalls) {
      totalTokens = aiResult.totalTokens;
      finalContent = aiResult.content;
    }

    // If loop ended without finalContent (all loops had tool calls but last broke)
    if (!finalContent && currentText) {
      finalContent = currentText;
    }

await Conversation.create([
        { guildId: message.guildId!, channelId: message.channelId, userId: message.author.id, role: 'user', content: userContent, tokens: estimatedTokens, modelUsed: aiResult.model, provider: aiResult.provider },
        { guildId: message.guildId!, channelId: message.channelId, userId: message.author.id, role: 'assistant', content: finalContent, tokens: totalTokens, modelUsed: aiResult.model, provider: aiResult.provider },
     ]);

    const rlAfter = await checkAndIncrement(message.guildId!, message.author.id, totalTokens);
    if (!rlAfter.ok) {
      await thinking.edit(`${EMOJI.CLOSE} ${rlAfter.reason}`);
      return;
    }

    await Channel.updateOne(
      { guildId: message.guildId!, channelId: message.channelId },
      { $inc: { totalMessages: 2, totalTokens: totalTokens }, $set: { lastUsedAt: new Date() } },
    );

    let footer = '';
    if (guildConfig.showUsageFooter !== false) {
      const langLabel = guildConfig.responseLanguage || 'en';
      footer = `\n\n-# ${EMOJI.AI} ${totalTokens} tokens · Language: ${langLabel}`;
    }

    const fullContent = finalContent + footer;
    const MAX_LENGTH = 2000;

    if (fullContent.length <= MAX_LENGTH) {
      await thinking.edit(fullContent);
    } else {
      const parts: string[] = [];
      let remaining = fullContent;
      let partNum = 1;
      const partFooter = footer;

      while (remaining.length > 0) {
        let slice: string;
        if (remaining.length <= MAX_LENGTH) {
          slice = remaining;
          remaining = '';
        } else {
          let cut = remaining.substring(0, MAX_LENGTH);
          const lastPeriod = Math.max(
            cut.lastIndexOf('.'),
            cut.lastIndexOf('!'),
            cut.lastIndexOf('?'),
            cut.lastIndexOf('\n')
          );
          if (lastPeriod > MAX_LENGTH * 0.6) cut = cut.substring(0, lastPeriod + 1);
          slice = cut + ` (part ${partNum}/${remaining.length > MAX_LENGTH * 2 ? '?' : Math.ceil(fullContent.length / MAX_LENGTH)})`;
          if (remaining.length > MAX_LENGTH && remaining.length - cut.length > MAX_LENGTH * 0.5) {
            slice = cut + ` (Continued on part ${partNum + 1})`;
          }
          remaining = remaining.substring(cut.length).trimStart();
        }
        parts.push(slice);
        partNum++;
      }

      await thinking.edit(parts[0]);
      for (let i = 1; i < parts.length; i++) {
        await message.reply(parts[i]);
      }
    }
  } catch (error: any) {
    console.error('AI Chat error:', error);
    let desc = `${EMOJI.CLOSE} Failed to process message. Try again.`;
    if (error?.status === 429) desc = `${EMOJI.CLOSE} **Rate limit reached.** All API keys are out of quota. Try again later.`;
    else if (error?.status === 401) desc = `${EMOJI.CLOSE} **Invalid API key.** Contact the server owner.`;
    else if (error?.message) desc = `${EMOJI.CLOSE} **Error:** ${error.message.substring(0, 150)}`;
    try { await thinking.edit(desc); } catch { try { await message.reply({ embeds: [new EmbedBuilder().setColor(0xef4444).setDescription(desc).setTimestamp()] }); } catch {} }
  }
}
