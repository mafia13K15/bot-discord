const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  EmbedBuilder, REST, Routes, PermissionFlagsBits,
  ChannelType
} = require('discord.js');

// ════════════════════════════════════════════════
//  ⚙️  CONFIG — modifie uniquement cette section
// ════════════════════════════════════════════════
const TOKEN = process.env.TOKEN;
const PREFIX         = '!';
const TWITCH_USER    = 'kazzix_chill';
const TIKTOK_USER    = 'kazzix_chill';
const TWITCH_API_ID  = 'TON_TWITCH_CLIENT_ID';
const TWITCH_SECRET  = 'TON_TWITCH_SECRET';
const CHECK_INTERVAL = 2 * 60 * 1000;
// ════════════════════════════════════════════════

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Stockage en mémoire ──────────────────────────────────────────────────────
const notifChannels = new Map(); // guildId -> channelId
const messageCount  = new Map(); // userId  -> count (classement activité)
let   twitchToken   = null;
let   wasLive       = false;

// ════════════════════════════════════════════════
//  SLASH COMMANDS
// ════════════════════════════════════════════════
const slashCommands = [

  // ── Stream ──────────────────────────────────────
  new SlashCommandBuilder()
    .setName('stream')
    .setDescription('Affiche les liens de stream de kazzix_chill'),

  // ── Mini-jeux ───────────────────────────────────
  new SlashCommandBuilder()
    .setName('pileouface')
    .setDescription('Lance une pièce !'),

  // ── Classement ──────────────────────────────────
  new SlashCommandBuilder()
    .setName('top')
    .setDescription('Classement des membres les plus actifs'),

  // ── Stats membre ────────────────────────────────
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Affiche les stats d\'un membre')
    .addUserOption(o => o.setName('membre').setDescription('Membre (optionnel)').setRequired(false)),

  // ── Info serveur ────────────────────────────────
  new SlashCommandBuilder()
    .setName('serveur')
    .setDescription('Affiche les infos du serveur'),

  // ── Userinfo ────────────────────────────────────
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Infos détaillées sur un membre')
    .addUserOption(o => o.setName('membre').setDescription('Membre (optionnel)').setRequired(false)),

  // ── Avatar ──────────────────────────────────────
  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Affiche l\'avatar d\'un membre')
    .addUserOption(o => o.setName('membre').setDescription('Membre (optionnel)').setRequired(false)),

  // ── Ancienneté ──────────────────────────────────
  new SlashCommandBuilder()
    .setName('anciennete')
    .setDescription('Depuis combien de temps un membre est sur le serveur')
    .addUserOption(o => o.setName('membre').setDescription('Membre (optionnel)').setRequired(false)),

  // ── Aide ────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('aide')
    .setDescription('Affiche toutes les commandes disponibles'),

  // ── ADMIN ────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('setup-notifs')
    .setDescription('(Admin) Crée le salon de notifications stream')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('annonce')
    .setDescription('(Admin) Envoie une annonce dans le salon actuel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('message').setDescription('Ton annonce').setRequired(true))
    .addBooleanOption(o => o.setName('ping').setDescription('Ping @everyone ?').setRequired(false)),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('(Admin) Supprime des messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('nombre').setDescription('Nombre de messages à supprimer (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('(Admin) Expulse un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à expulser').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('(Admin) Bannit un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à bannir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('(Admin) Rend muet un membre 10 minutes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à mute').setRequired(true)),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('(Admin) Retire le mute d\'un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Membre à unmute').setRequired(true)),

];

// ─── Enregistrement slash ─────────────────────────────────────────────────────
async function registerSlash(guildId) {
  const rest = new REST().setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, guildId),
    { body: slashCommands.map(c => c.toJSON()) }
  );
  console.log(`✅ Slash commands enregistrées → serveur ${guildId}`);
}

// ════════════════════════════════════════════════
//  TWITCH
// ════════════════════════════════════════════════
async function getTwitchToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_API_ID}&client_secret=${TWITCH_SECRET}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  const data = await res.json();
  return data.access_token;
}

async function checkTwitchLive() {
  try {
    if (!twitchToken) twitchToken = await getTwitchToken();
    const res = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${TWITCH_USER}`,
      { headers: { 'Client-ID': TWITCH_API_ID, 'Authorization': `Bearer ${twitchToken}` } }
    );
    const data   = await res.json();
    const stream = data.data?.[0];

    if (stream && !wasLive) {
      wasLive = true;
      for (const [, channelId] of notifChannels.entries()) {
        const channel = client.channels.cache.get(channelId);
        if (!channel) continue;
        const embed = new EmbedBuilder()
          .setTitle(`🔴 kazzix_chill est EN LIVE sur Twitch !`)
          .setDescription(`**${stream.title}**\n🎮 ${stream.game_name}`)
          .setURL(`https://twitch.tv/${TWITCH_USER}`)
          .setColor(0x9146ff)
          .addFields(
            { name: '👥 Viewers',  value: `${stream.viewer_count}`,                                          inline: true },
            { name: '📺 Regarder', value: `[Clique ici](https://twitch.tv/${TWITCH_USER})`,                  inline: true },
            { name: '🎵 TikTok',   value: `[tiktok.com/@${TIKTOK_USER}](https://tiktok.com/@${TIKTOK_USER})`, inline: true },
          )
          .setTimestamp();
        channel.send({ content: '@everyone 🔴 Le live vient de commencer !', embeds: [embed] });
      }
    } else if (!stream) {
      wasLive = false;
    }
  } catch (err) {
    console.error('Erreur Twitch API :', err.message);
    twitchToken = null;
  }
}

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════

// Formate une durée en ms → "X jours, Y heures, Z minutes"
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d} jour${d > 1 ? 's' : ''}`);
  if (h > 0) parts.push(`${h} heure${h > 1 ? 's' : ''}`);
  if (m > 0) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  return parts.join(', ') || 'moins d\'une minute';
}

// Embed TOP classement
function buildTopEmbed(guild) {
  const sorted = [...messageCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sorted.length === 0) {
    return new EmbedBuilder()
      .setTitle('🏆 Classement des membres les plus actifs')
      .setDescription('Pas encore de données ! Commencez à écrire 😄')
      .setColor(0xf1c40f);
  }

  const medals = ['🥇', '🥈', '🥉'];
  const desc   = sorted.map(([id, count], i) => {
    const medal = medals[i] || `**${i + 1}.**`;
    return `${medal} <@${id}> — **${count}** message${count > 1 ? 's' : ''}`;
  }).join('\n');

  return new EmbedBuilder()
    .setTitle('🏆 Classement des membres les plus actifs')
    .setDescription(desc)
    .setColor(0xf1c40f)
    .setFooter({ text: `Serveur : ${guild.name}` })
    .setTimestamp();
}

// ════════════════════════════════════════════════
//  EVENTS
// ════════════════════════════════════════════════

client.once('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  client.user.setActivity('kazzix_chill 🎮', { type: 3 });
  for (const guild of client.guilds.cache.values()) {
    await registerSlash(guild.id).catch(console.error);
  }
  setInterval(checkTwitchLive, CHECK_INTERVAL);
});

// ─── Comptage des messages pour le classement ─────────────────────────────────
client.on('messageCreate', async message => {
  if (!message.author.bot) {
    const prev = messageCount.get(message.author.id) || 0;
    messageCount.set(message.author.id, prev + 1);
  }

  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
  const isMod   = message.member.permissions.has(PermissionFlagsBits.ManageMessages);

  // ── !pileouface ────────────────────────────────────────────────────────────
  if (command === 'pileouface') {
    const result = Math.random() < 0.5 ? '🪙 Pile !' : '🔵 Face !';
    const embed  = new EmbedBuilder()
      .setTitle('🪙 Pile ou Face')
      .setDescription(`<@${message.author.id}> a lancé la pièce...\n\n# ${result}`)
      .setColor(Math.random() < 0.5 ? 0xf1c40f : 0x3498db)
      .setTimestamp();
    message.reply({ embeds: [embed] });
  }

  // ── !stream ────────────────────────────────────────────────────────────────
  if (command === 'stream') {
    const embed = new EmbedBuilder()
      .setTitle('📺 Retrouve kazzix_chill en live !')
      .setColor(0x9146ff)
      .addFields(
        { name: '🟣 Twitch', value: `[twitch.tv/${TWITCH_USER}](https://twitch.tv/${TWITCH_USER})`,       inline: true },
        { name: '🎵 TikTok', value: `[tiktok.com/@${TIKTOK_USER}](https://tiktok.com/@${TIKTOK_USER})`,  inline: true },
      );
    message.reply({ embeds: [embed] });
  }

  // ── !top ───────────────────────────────────────────────────────────────────
  if (command === 'top') {
    message.reply({ embeds: [buildTopEmbed(message.guild)] });
  }

  // ── !stats ─────────────────────────────────────────────────────────────────
  if (command === 'stats') {
    const target = message.mentions.users.first() ?? message.author;
    const member = await message.guild.members.fetch(target.id).catch(() => null);
    const count  = messageCount.get(target.id) || 0;
    const rank   = [...messageCount.entries()].sort((a, b) => b[1] - a[1]).findIndex(([id]) => id === target.id) + 1;

    const embed = new EmbedBuilder()
      .setTitle(`📊 Stats de ${target.username}`)
      .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      .setColor(0x5865f2)
      .addFields(
        { name: '💬 Messages envoyés', value: `${count}`,                                                              inline: true },
        { name: '🏆 Classement',       value: count > 0 ? `#${rank}` : 'Non classé',                                  inline: true },
        { name: '📅 Arrivé le',        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,                   inline: true },
        { name: '⏳ Ancienneté',       value: formatDuration(Date.now() - member.joinedTimestamp),                    inline: true },
        { name: '🎨 Pseudo serveur',   value: member.displayName,                                                     inline: true },
        { name: '🏷️ Rôles',           value: `${member.roles.cache.size - 1}`,                                       inline: true },
      )
      .setTimestamp();
    message.reply({ embeds: [embed] });
  }

  // ── !serveur ───────────────────────────────────────────────────────────────
  if (command === 'serveur') {
    const g = message.guild;
    const embed = new EmbedBuilder()
      .setTitle(`📋 ${g.name}`)
      .setThumbnail(g.iconURL({ dynamic: true }))
      .setColor(0x5865f2)
      .addFields(
        { name: '👑 Propriétaire',  value: `<@${g.ownerId}>`,                               inline: true },
        { name: '👥 Membres',       value: `${g.memberCount}`,                               inline: true },
        { name: '💬 Salons',        value: `${g.channels.cache.size}`,                       inline: true },
        { name: '😀 Émojis',        value: `${g.emojis.cache.size}`,                         inline: true },
        { name: '🏆 Boosts',        value: `Niveau ${g.premiumTier} (${g.premiumSubscriptionCount} boosts)`, inline: true },
        { name: '📅 Créé le',       value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
      )
      .setFooter({ text: `ID : ${g.id}` });
    message.reply({ embeds: [embed] });
  }

  // ── !userinfo ──────────────────────────────────────────────────────────────
  if (command === 'userinfo') {
    const target = message.mentions.users.first() ?? message.author;
    const member = await message.guild.members.fetch(target.id).catch(() => null);
    const roles  = member.roles.cache.filter(r => r.id !== message.guild.id).map(r => `<@&${r.id}>`).join(' ') || 'Aucun';
    const embed  = new EmbedBuilder()
      .setTitle(`👤 ${target.username}`)
      .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      .setColor(member.displayHexColor || 0x5865f2)
      .addFields(
        { name: '🪪 ID',            value: target.id,                                               inline: true },
        { name: '🤖 Bot ?',         value: target.bot ? 'Oui' : 'Non',                              inline: true },
        { name: '📅 Compte créé',   value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`,   inline: true },
        { name: '📥 A rejoint le',  value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,    inline: true },
        { name: '🎨 Pseudo serveur',value: member.displayName,                                      inline: true },
        { name: `🏷️ Rôles (${member.roles.cache.size - 1})`, value: roles },
      );
    message.reply({ embeds: [embed] });
  }

  // ── !avatar ────────────────────────────────────────────────────────────────
  if (command === 'avatar') {
    const target    = message.mentions.users.first() ?? message.author;
    const avatarURL = target.displayAvatarURL({ dynamic: true, size: 1024 });
    const embed     = new EmbedBuilder()
      .setTitle(`🖼️ Avatar de ${target.username}`)
      .setImage(avatarURL)
      .setColor(0x5865f2)
      .addFields({ name: 'Télécharger', value: `[Lien direct](${avatarURL})` });
    message.reply({ embeds: [embed] });
  }

  // ── !anciennete ────────────────────────────────────────────────────────────
  if (command === 'anciennete') {
    const target = message.mentions.users.first() ?? message.author;
    const member = await message.guild.members.fetch(target.id).catch(() => null);
    const duree  = formatDuration(Date.now() - member.joinedTimestamp);
    const embed  = new EmbedBuilder()
      .setTitle(`⏳ Ancienneté de ${target.username}`)
      .setDescription(`<@${target.id}> est sur ce serveur depuis **${duree}**\n📅 Arrivé le <t:${Math.floor(member.joinedTimestamp / 1000)}:D>`)
      .setColor(0x5865f2);
    message.reply({ embeds: [embed] });
  }

  // ── !annonce (admin) ───────────────────────────────────────────────────────
  if (command === 'annonce') {
    if (!isAdmin) return message.reply('❌ Réservé aux admins.');
    const texte = args.join(' ');
    if (!texte) return message.reply('❌ Usage : `!annonce <message>`');
    const embed = new EmbedBuilder()
      .setTitle('📢 Annonce')
      .setDescription(texte)
      .setColor(0xe74c3c)
      .setFooter({ text: `Annonce par ${message.author.username}` })
      .setTimestamp();
    message.channel.send({ content: '@everyone', embeds: [embed] });
    message.delete().catch(() => {});
  }

  // ── !clear (admin/modo) ────────────────────────────────────────────────────
  if (command === 'clear') {
    if (!isMod) return message.reply('❌ Réservé aux modérateurs.');
    const nb = parseInt(args[0]);
    if (isNaN(nb) || nb < 1 || nb > 100) return message.reply('❌ Usage : `!clear <1-100>`');
    await message.channel.bulkDelete(nb + 1, true).catch(() => {});
    const msg = await message.channel.send(`🧹 **${nb}** message(s) supprimé(s).`);
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  }

  // ── !kick ──────────────────────────────────────────────────────────────────
  if (command === 'kick') {
    if (!isAdmin) return message.reply('❌ Réservé aux admins.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const raison = args.slice(1).join(' ') || 'Aucune raison';
    await target.kick(raison).catch(() => {});
    message.channel.send(`✅ **${target.user.username}** a été expulsé. Raison : ${raison}`);
  }

  // ── !ban ───────────────────────────────────────────────────────────────────
  if (command === 'ban') {
    if (!isAdmin) return message.reply('❌ Réservé aux admins.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    const raison = args.slice(1).join(' ') || 'Aucune raison';
    await target.ban({ reason: raison }).catch(() => {});
    message.channel.send(`🔨 **${target.user.username}** a été banni. Raison : ${raison}`);
  }

  // ── !mute ──────────────────────────────────────────────────────────────────
  if (command === 'mute') {
    if (!isAdmin) return message.reply('❌ Réservé aux admins.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    await target.timeout(10 * 60 * 1000, 'Mute par un admin').catch(() => {});
    message.channel.send(`🔇 **${target.user.username}** a été mis en sourdine 10 minutes.`);
  }

  // ── !unmute ────────────────────────────────────────────────────────────────
  if (command === 'unmute') {
    if (!isAdmin) return message.reply('❌ Réservé aux admins.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Mentionne un membre.');
    await target.timeout(null).catch(() => {});
    message.channel.send(`🔊 **${target.user.username}** n'est plus en sourdine.`);
  }

  // ── !aide ──────────────────────────────────────────────────────────────────
  if (command === 'aide') {
    const embed = new EmbedBuilder()
      .setTitle('📖 Toutes les commandes')
      .setColor(0x5865f2)
      .addFields(
        { name: '🎮 Mini-jeux',         value: '`!pileouface`' },
        { name: '📺 Stream',            value: '`!stream`' },
        { name: '🏆 Classement',        value: '`!top`' },
        { name: '📊 Stats & Infos',     value: '`!stats [@membre]`\n`!userinfo [@membre]`\n`!avatar [@membre]`\n`!anciennete [@membre]`\n`!serveur`' },
        { name: '🛡️ Admin seulement',  value: '`!annonce <texte>`\n`!clear <nombre>`\n`!kick @membre`\n`!ban @membre`\n`!mute @membre`\n`!unmute @membre`' },
        { name: '💡 Slash commands',    value: 'Toutes les commandes sont aussi disponibles avec `/`' },
      )
      .setFooter({ text: 'Bot de kazzix_chill' });
    message.reply({ embeds: [embed] });
  }
});

// ════════════════════════════════════════════════
//  SLASH COMMANDS HANDLER
// ════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // /setup-notifs
  if (commandName === 'setup-notifs') {
    let channel = interaction.guild.channels.cache.find(
      c => c.name === 'live-notifs' && c.type === ChannelType.GuildText
    );
    if (!channel) {
      channel = await interaction.guild.channels.create({
        name: 'live-notifs',
        type: ChannelType.GuildText,
        topic: '🔴 Notifications de live pour kazzix_chill',
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
        ],
      });
    }
    notifChannels.set(interaction.guild.id, channel.id);
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle('✅ Salon configuré !').setDescription(`Notifs dans <#${channel.id}>`).setColor(0x57f287)
    ], ephemeral: true });
  }

  // /pileouface
  if (commandName === 'pileouface') {
    const result = Math.random() < 0.5 ? '🪙 Pile !' : '🔵 Face !';
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle('🪙 Pile ou Face').setDescription(`<@${interaction.user.id}> a lancé la pièce...\n\n# ${result}`).setColor(0xf1c40f).setTimestamp()
    ]});
  }

  // /stream
  if (commandName === 'stream') {
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle('📺 Retrouve kazzix_chill en live !').setColor(0x9146ff)
        .addFields(
          { name: '🟣 Twitch', value: `[twitch.tv/${TWITCH_USER}](https://twitch.tv/${TWITCH_USER})`,      inline: true },
          { name: '🎵 TikTok', value: `[tiktok.com/@${TIKTOK_USER}](https://tiktok.com/@${TIKTOK_USER})`, inline: true },
        )
    ]});
  }

  // /top
  if (commandName === 'top') {
    await interaction.reply({ embeds: [buildTopEmbed(interaction.guild)] });
  }

  // /stats
  if (commandName === 'stats') {
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const count  = messageCount.get(target.id) || 0;
    const rank   = [...messageCount.entries()].sort((a, b) => b[1] - a[1]).findIndex(([id]) => id === target.id) + 1;
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle(`📊 Stats de ${target.username}`).setThumbnail(target.displayAvatarURL({ dynamic: true })).setColor(0x5865f2)
        .addFields(
          { name: '💬 Messages', value: `${count}`, inline: true },
          { name: '🏆 Rang',     value: count > 0 ? `#${rank}` : 'Non classé', inline: true },
          { name: '📅 Arrivé',   value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true },
          { name: '⏳ Ancienneté', value: formatDuration(Date.now() - member.joinedTimestamp), inline: true },
        ).setTimestamp()
    ]});
  }

  // /serveur
  if (commandName === 'serveur') {
    const g = interaction.guild;
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle(`📋 ${g.name}`).setThumbnail(g.iconURL({ dynamic: true })).setColor(0x5865f2)
        .addFields(
          { name: '👑 Propriétaire', value: `<@${g.ownerId}>`, inline: true },
          { name: '👥 Membres',      value: `${g.memberCount}`, inline: true },
          { name: '💬 Salons',       value: `${g.channels.cache.size}`, inline: true },
          { name: '😀 Émojis',       value: `${g.emojis.cache.size}`, inline: true },
          { name: '🏆 Boosts',       value: `Niveau ${g.premiumTier} (${g.premiumSubscriptionCount} boosts)`, inline: true },
          { name: '📅 Créé le',      value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
        ).setFooter({ text: `ID : ${g.id}` })
    ]});
  }

  // /userinfo
  if (commandName === 'userinfo') {
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const roles  = member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => `<@&${r.id}>`).join(' ') || 'Aucun';
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle(`👤 ${target.username}`).setThumbnail(target.displayAvatarURL({ dynamic: true })).setColor(member.displayHexColor || 0x5865f2)
        .addFields(
          { name: '🪪 ID',             value: target.id, inline: true },
          { name: '🤖 Bot ?',          value: target.bot ? 'Oui' : 'Non', inline: true },
          { name: '📅 Compte créé',    value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`, inline: true },
          { name: '📥 A rejoint le',   value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true },
          { name: '🎨 Pseudo serveur', value: member.displayName, inline: true },
          { name: `🏷️ Rôles (${member.roles.cache.size - 1})`, value: roles },
        )
    ]});
  }

  // /avatar
  if (commandName === 'avatar') {
    const target    = interaction.options.getUser('membre') ?? interaction.user;
    const avatarURL = target.displayAvatarURL({ dynamic: true, size: 1024 });
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle(`🖼️ Avatar de ${target.username}`).setImage(avatarURL).setColor(0x5865f2)
        .addFields({ name: 'Télécharger', value: `[Lien direct](${avatarURL})` })
    ]});
  }

  // /anciennete
  if (commandName === 'anciennete') {
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const duree  = formatDuration(Date.now() - member.joinedTimestamp);
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle(`⏳ Ancienneté de ${target.username}`)
        .setDescription(`<@${target.id}> est sur ce serveur depuis **${duree}**\n📅 Arrivé le <t:${Math.floor(member.joinedTimestamp / 1000)}:D>`)
        .setColor(0x5865f2)
    ]});
  }

  // /annonce
  if (commandName === 'annonce') {
    const texte = interaction.options.getString('message');
    const ping  = interaction.options.getBoolean('ping') ?? false;
    const embed = new EmbedBuilder()
      .setTitle('📢 Annonce')
      .setDescription(texte)
      .setColor(0xe74c3c)
      .setFooter({ text: `Annonce par ${interaction.user.username}` })
      .setTimestamp();
    await interaction.channel.send({ content: ping ? '@everyone' : '', embeds: [embed] });
    await interaction.reply({ content: '✅ Annonce envoyée !', ephemeral: true });
  }

  // /clear
  if (commandName === 'clear') {
    const nb = interaction.options.getInteger('nombre');
    await interaction.channel.bulkDelete(nb, true).catch(() => {});
    await interaction.reply({ content: `🧹 **${nb}** message(s) supprimé(s).`, ephemeral: true });
  }

  // /kick
  if (commandName === 'kick') {
    const target = interaction.options.getMember('membre');
    const raison = interaction.options.getString('raison') || 'Aucune raison';
    await target.kick(raison).catch(() => {});
    await interaction.reply(`✅ **${target.user.username}** a été expulsé. Raison : ${raison}`);
  }

  // /ban
  if (commandName === 'ban') {
    const target = interaction.options.getMember('membre');
    const raison = interaction.options.getString('raison') || 'Aucune raison';
    await target.ban({ reason: raison }).catch(() => {});
    await interaction.reply(`🔨 **${target.user.username}** a été banni. Raison : ${raison}`);
  }

  // /mute
  if (commandName === 'mute') {
    const target = interaction.options.getMember('membre');
    await target.timeout(10 * 60 * 1000, 'Mute par un admin').catch(() => {});
    await interaction.reply(`🔇 **${target.user.username}** a été mis en sourdine 10 minutes.`);
  }

  // /unmute
  if (commandName === 'unmute') {
    const target = interaction.options.getMember('membre');
    await target.timeout(null).catch(() => {});
    await interaction.reply(`🔊 **${target.user.username}** n'est plus en sourdine.`);
  }

  // /aide
  if (commandName === 'aide') {
    await interaction.reply({ embeds: [
      new EmbedBuilder().setTitle('📖 Toutes les commandes').setColor(0x5865f2)
        .addFields(
          { name: '🎮 Mini-jeux',        value: '`/pileouface` `!pileouface`' },
          { name: '📺 Stream',           value: '`/stream` `!stream`' },
          { name: '🏆 Classement',       value: '`/top` `!top`' },
          { name: '📊 Stats & Infos',    value: '`/stats` `/userinfo` `/avatar` `/anciennete` `/serveur`\n(et leurs équivalents `!`)' },
          { name: '🛡️ Admin seulement', value: '`/annonce` `/clear` `/kick` `/ban` `/mute` `/unmute` `/setup-notifs`' },
        ).setFooter({ text: 'Bot de kazzix_chill' })
    ]});
  }
});

// ─── Lancement ────────────────────────────────────────────────────────────────
client.login(TOKEN);