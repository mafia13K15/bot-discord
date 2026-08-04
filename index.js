// ============================================================
//  BOT DISCORD "COMMUNAUTÉ" - VERSION CORRIGÉE ET COMPLÈTE
//  Configuration automatique du serveur : rôles, salons,
//  permissions, bouton d'acceptation, tickets, niveaux,
//  logs, anti-spam, modération, info et fun.
//
//  INSTALLATION :
//   1. npm install discord.js
//   2. node index.js                  -> config.json créé
//   3. Collez votre token dans config.json
//   4. Invitez le bot avec la permission "Administrator"
//   5. Dans votre serveur : !setup
//      (ou !newserver pour créer un serveur neuf)
// ============================================================

const {
  Client, GatewayIntentBits, EmbedBuilder, ActivityType,
  PermissionsBitField, ChannelType, ActionRowBuilder,
  ButtonBuilder, ButtonStyle
} = require('discord.js');
const fs = require('fs');

// ------------------------------------------------------------
// 1. CONFIGURATION
// ------------------------------------------------------------
let config = {};
if (fs.existsSync('./config.json')) {
  config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
  // Clés ajoutées dans les nouvelles versions (compatibilité)
  config.logs = config.logs || {};
  config.welcome = config.welcome || {};
  config.rules = config.rules || {};
  config.roles_moderation = config.roles_moderation || [];
} else {
  config = {
    token: process.env.TOKEN,   // <-- VOTRE TOKEN ICI
    prefix: "!",
    logs: {},                          // guildId -> salon de logs
    welcome: {},                       // guildId -> salon de bienvenue
    rules: {},                         // guildId -> message du règlement
    autorole: null,                    // ID du rôle automatique (optionnel)
    roles_moderation: [],              // IDs de rôles supplémentaires autorisés
    server_owner_id: null,             // créateur d'un serveur via !newserver
    server_owner_guild_id: null        // serveur créé via !newserver
  };
  fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
  console.log('config.json créé. Collez votre token dans le champ "token" puis relancez le bot.');
}

let warns = {};
if (fs.existsSync('./warns.json')) warns = JSON.parse(fs.readFileSync('./warns.json', 'utf8'));

let xpData = {};
if (fs.existsSync('./xp.json')) xpData = JSON.parse(fs.readFileSync('./xp.json', 'utf8'));

const PREFIX = config.prefix || '!';
const saveConfig = () => fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
const saveWarns  = () => fs.writeFileSync('./warns.json', JSON.stringify(warns, null, 2));
const saveXp     = () => fs.writeFileSync('./xp.json', JSON.stringify(xpData, null, 2));

// ------------------------------------------------------------
// 2. CRÉATION DU CLIENT (intents obligatoires)
// ------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,          // accès aux serveurs
    GatewayIntentBits.GuildMessages,   // lire les messages
    GatewayIntentBits.MessageContent,  // lire le contenu (obligatoire !)
    GatewayIntentBits.GuildMembers     // liste des membres
  ]
});

// ------------------------------------------------------------
// 3. CONSTANTES
// ------------------------------------------------------------
const antiSpam = new Map();            // user_id -> liste de timestamps
const LIMITE_MSG = 4;                  // messages max...
const FENETRE_MS = 5000;               // ...en 5 secondes
const MUTE_SPAM_MIN = 10;              // minutes de timeout

const NOMS_ROLES_STAFF = ['👑 Owner', '🛡️ Staff', '🛡️ Modo'];
const NOMS_ROLES_ADMIN = ['👑 Owner', '🛡️ Staff'];

// ------------------------------------------------------------
// 4. FONCTIONS UTILITAIRES
// ------------------------------------------------------------
function estStaff(membre) {
  return membre.roles.cache.some(r => NOMS_ROLES_STAFF.includes(r.name));
}
function estAdmin(membre) {
  return membre.roles.cache.some(r => NOMS_ROLES_ADMIN.includes(r.name))
    || membre.permissions.has(PermissionsBitField.Flags.Administrator);
}
async function envoyerLog(guild, embed) {
  if (!config.logs || !config.logs[guild.id]) return;
  const salon = guild.channels.cache.get(config.logs[guild.id]);
  if (salon) await salon.send({ embeds: [embed] }).catch(() => {});
}
function getWelcomeChannel(guild) {
  if (!config.welcome || !config.welcome[guild.id]) return null;
  return guild.channels.cache.get(config.welcome[guild.id]) || null;
}

// ------------------------------------------------------------
// 5. CONFIGURATION COMPLÈTE DU SERVEUR (rôles + salons + perms)
// ------------------------------------------------------------
async function setupGuild(guild, utilisateur) {
  const roles = {};
  const resultats = { roles: 0, salons: 0, categories: 0 };

  async function obtenirRole(nom, options) {
    let r = guild.roles.cache.find(rr => rr.name === nom);
    if (!r) {
      r = await guild.roles.create({ name: nom, ...options });
      resultats.roles++;
    }
    return r;
  }
  async function obtenirCategorie(nom) {
    let c = guild.channels.cache.find(ch => ch.name === nom && ch.type === ChannelType.GuildCategory);
    if (!c) {
      c = await guild.channels.create({ name: nom, type: ChannelType.GuildCategory });
      resultats.categories++;
    }
    return c;
  }
  async function obtenirSalon(nom, type, categorie) {
    let ch = guild.channels.cache.find(c => c.name === nom && c.type === type);
    if (!ch) {
      ch = await guild.channels.create({ name: nom, type: type, parent: categorie ? categorie.id : undefined });
      resultats.salons++;
    }
    return ch;
  }
  async function defPerms(channel, liste) {
    for (const o of liste) {
      await channel.permissionOverwrites.create(o.role, o.perms);
    }
  }

  // ----- RÔLES -----
  roles.owner  = await obtenirRole('👑 Owner', { color: 0xf1c40f, hoist: true, permissions: [PermissionsBitField.Flags.Administrator], mentionable: false });
  roles.staff  = await obtenirRole('🛡️ Staff', { color: 0xe74c3c, hoist: true, permissions: [PermissionsBitField.Flags.Administrator], mentionable: false });
  roles.modo   = await obtenirRole('🛡️ Modo', { color: 0x3498db, hoist: true, permissions: [PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.BanMembers, PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageNicknames], mentionable: false });
  roles.membre = await obtenirRole('✅ Membre', { color: 0x2ecc71, hoist: true, mentionable: false });

  // Ordre des rôles (Owner en haut, Membre en bas) — non bloquant
  try {
    const posMax = guild.roles.highest.position;
    await roles.owner.setPosition(posMax);
    await roles.staff.setPosition(posMax - 1);
    await roles.modo.setPosition(posMax - 2);
    await roles.membre.setPosition(posMax - 3);
  } catch (e) {}

  // Donner Owner + Staff au propriétaire
  const cibleOwner = guild.members.cache.get(guild.ownerId)
    || (config.server_owner_id ? guild.members.cache.get(config.server_owner_id) : null)
    || (utilisateur ? guild.members.cache.get(utilisateur.id) : null);
  if (cibleOwner) {
    await cibleOwner.roles.add([roles.owner.id, roles.staff.id]).catch(() => {});
  }

  const toutMonde = guild.roles.everyone;
  const bot = guild.members.me;

  // ----- 📢 INFORMATIONS -----
  const catInfos = await obtenirCategorie('📢 INFORMATIONS');
  await defPerms(catInfos, [
    { role: toutMonde, perms: { ViewChannel: true, SendMessages: false } }
  ]);

  const reglement = await obtenirSalon('reglement', ChannelType.GuildText, catInfos);
  await defPerms(reglement, [
    { role: toutMonde, perms: { ViewChannel: true, SendMessages: false, ReadMessageHistory: true } },
    { role: roles.modo, perms: { SendMessages: true } },
    { role: roles.staff, perms: { SendMessages: true } }
  ]);
  if (bot) await defPerms(reglement, [{ role: bot, perms: { SendMessages: true } }]);

  const annonces = await obtenirSalon('annonces', ChannelType.GuildText, catInfos);
  await defPerms(annonces, [
    { role: toutMonde, perms: { ViewChannel: true, SendMessages: false } },
    { role: roles.membre, perms: { SendMessages: false } },
    { role: roles.modo, perms: { SendMessages: true } },
    { role: roles.staff, perms: { SendMessages: true } }
  ]);
  if (bot) await defPerms(annonces, [{ role: bot, perms: { SendMessages: true } }]);

  const bienvenue = await obtenirSalon('bienvenue', ChannelType.GuildText, catInfos);
  await defPerms(bienvenue, [
    { role: toutMonde, perms: { ViewChannel: true, SendMessages: false } },
    { role: roles.modo, perms: { SendMessages: true } },
    { role: roles.staff, perms: { SendMessages: true } }
  ]);
  if (bot) await defPerms(bienvenue, [{ role: bot, perms: { SendMessages: true } }]);

  const aide = await obtenirSalon('aide', ChannelType.GuildText, catInfos);
  await defPerms(aide, [
    { role: toutMonde, perms: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } }
  ]);

  // ----- 💬 DISCUSSIONS -----
  const catDisc = await obtenirCategorie('💬 DISCUSSIONS');
  await defPerms(catDisc, [
    { role: toutMonde, perms: { ViewChannel: false } },
    { role: roles.membre, perms: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } },
    { role: roles.modo, perms: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } },
    { role: roles.staff, perms: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } }
  ]);
  for (const nom of ['discussion-generale', 'gaming', 'musique', 'films-series', 'memes-partage', 'commandes-du-bot', 'suggestions']) {
    await obtenirSalon(nom, ChannelType.GuildText, catDisc);
  }

  // ----- 🎤 VOCAUX -----
  const catVocal = await obtenirCategorie('🎤 VOCAUX');
  await defPerms(catVocal, [
    { role: toutMonde, perms: { ViewChannel: false, Connect: false } },
    { role: roles.membre, perms: { ViewChannel: true, Connect: true, Speak: true } },
    { role: roles.modo, perms: { ViewChannel: true, Connect: true, Speak: true } },
    { role: roles.staff, perms: { ViewChannel: true, Connect: true, Speak: true } }
  ]);
  for (const nom of ['vocal-general', 'vocal-gaming', 'vocal-musique', 'vocal-detente', 'vocal-etudes', 'vocal-events']) {
    await obtenirSalon(nom, ChannelType.GuildVoice, catVocal);
  }
  const vocalStaff = await obtenirSalon('vocal-staff', ChannelType.GuildVoice, catVocal);
  await defPerms(vocalStaff, [
    { role: toutMonde, perms: { ViewChannel: false, Connect: false } },
    { role: roles.membre, perms: { ViewChannel: false, Connect: false } },
    { role: roles.modo, perms: { ViewChannel: true, Connect: true, Speak: true } },
    { role: roles.staff, perms: { ViewChannel: true, Connect: true, Speak: true } }
  ]);

  // ----- 🛡️ MODÉRATION -----
  const catMod = await obtenirCategorie('🛡️ MODÉRATION');
  await defPerms(catMod, [
    { role: toutMonde, perms: { ViewChannel: false } },
    { role: roles.modo, perms: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } },
    { role: roles.staff, perms: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } }
  ]);
  const salonLogs = await obtenirSalon('logs', ChannelType.GuildText, catMod);
  await defPerms(salonLogs, [
    { role: roles.modo, perms: { SendMessages: false } },
    { role: roles.staff, perms: { SendMessages: true } }
  ]);
  if (bot) await defPerms(salonLogs, [{ role: bot, perms: { SendMessages: true } }]);
  await obtenirSalon('moderation', ChannelType.GuildText, catMod);
  await obtenirSalon('rapports', ChannelType.GuildText, catMod);

  // ----- 🎫 TICKETS -----
  const catTickets = await obtenirCategorie('🎫 TICKETS');
  await defPerms(catTickets, [
    { role: toutMonde, perms: { ViewChannel: false } },
    { role: roles.modo, perms: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } },
    { role: roles.staff, perms: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } }
  ]);

  // Sauvegarde des salons importants (par serveur)
  config.logs[guild.id] = salonLogs.id;
  config.welcome[guild.id] = bienvenue.id;
  saveConfig();

  // ----- Message du règlement + bouton d'acceptation -----
  const embedRegles = new EmbedBuilder()
    .setTitle('📜 Règlement du serveur')
    .setDescription('Bienvenue ! Pour accéder à tous les salons, lisez le règlement puis cliquez sur le bouton ci-dessous pour devenir **Membre**.')
    .setColor(0x2ecc71)
    .addFields(
      { name: '1. Respect', value: "Respectez tous les membres. Pas d'insultes, de harcèlement ou de discrimination.", inline: false },
      { name: '2. Pas de spam', value: 'Pas de spam, de flood ou de publicité non autorisée.', inline: false },
      { name: '3. Contenu', value: 'Pas de contenu NSFW, illégal ou choquant.', inline: false },
      { name: '4. Écoutez le staff', value: 'Les décisions du staff sont à respecter. Toute contestation se fait en privé avec le staff.', inline: false }
    );
  const bouton = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('devenir_membre').setLabel('✅ Accepter et devenir membre').setStyle(ButtonStyle.Success)
  );
  if (config.rules[guild.id]) {
    try {
      const ancien = await reglement.messages.fetch(config.rules[guild.id]);
      await ancien.delete();
    } catch (e) {}
  }
  const msgRegles = await reglement.send({ embeds: [embedRegles], components: [bouton] });
  config.rules[guild.id] = msgRegles.id;
  saveConfig();

  return resultats;
}

// ------------------------------------------------------------
// 6. CONTRÔLE D'ACCÈS DES COMMANDES
// ------------------------------------------------------------
const PERMISSIONS_REQUISES = {
  kick: PermissionsBitField.Flags.KickMembers,
  ban: PermissionsBitField.Flags.BanMembers,
  unban: PermissionsBitField.Flags.BanMembers,
  clear: PermissionsBitField.Flags.ManageMessages,
  warn: PermissionsBitField.Flags.KickMembers,
  delwarns: PermissionsBitField.Flags.KickMembers,
  mute: PermissionsBitField.Flags.ModerateMembers,
  unmute: PermissionsBitField.Flags.ModerateMembers,
  say: PermissionsBitField.Flags.ManageMessages
};
const COMMANDES_ADMIN = ['setup', 'newserver', 'setlogs', 'setwelcome', 'setautorole'];

// ------------------------------------------------------------
// 7. ÉVÉNEMENT : BOT PRÊT
// ------------------------------------------------------------
client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag} (ID : ${client.user.id})`);
  console.log(`Préfixe : ${PREFIX}`);
  client.user.setActivity(`${PREFIX}help`, { type: ActivityType.Watching });
});

// ------------------------------------------------------------
// 8. ÉVÉNEMENT : MESSAGE REÇU (anti-spam + XP + commandes)
// ------------------------------------------------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ---- Anti-spam ----
  const maintenant = Date.now();
  const ts = antiSpam.get(message.author.id) || [];
  const recents = ts.filter(t => maintenant - t <= FENETRE_MS);
  recents.push(maintenant);
  antiSpam.set(message.author.id, recents);

  if (message.guild && recents.length >= LIMITE_MSG) {
    try {
      await message.member.timeout(MUTE_SPAM_MIN * 60 * 1000, 'Spam détecté');
      await message.channel.send(`${message.author} a été rendu muet ${MUTE_SPAM_MIN} minutes pour spam.`);
      antiSpam.delete(message.author.id);
    } catch (e) {}
  }

  // ---- Système de niveaux (XP) ----
  if (message.guild) {
    const uid = message.author.id;
    if (!xpData[uid]) xpData[uid] = { xp: 0, niveau: 0, derniere: 0 };
    if (maintenant - (xpData[uid].derniere || 0) >= 30000) { // 1 gain d'XP / 30 s
      xpData[uid].xp += Math.floor(Math.random() * 10) + 5;   // 5 à 14 XP
      xpData[uid].derniere = maintenant;
      const nouveauNiveau = Math.floor(Math.sqrt(xpData[uid].xp / 50));
      if (nouveauNiveau > xpData[uid].niveau) {
        xpData[uid].niveau = nouveauNiveau;
        saveXp();
        message.channel.send(`${message.author} a atteint le niveau **${nouveauNiveau}** ! 🎉`).catch(() => {});
      } else {
        saveXp();
      }
    }
  }

  // ---- Lecture des commandes ----
  if (!message.content.startsWith(PREFIX)) return;
  if (!message.guild) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commande = args.shift().toLowerCase();

  // ---- Contrôle d'accès : modération (rôle Staff/Modo OU permission) ----
  if (PERMISSIONS_REQUISES[commande]) {
    const aRole = estStaff(message.member) || (config.roles_moderation || []).some(id => message.member.roles.cache.has(id));
    const aPerm = message.member.permissions.has(PERMISSIONS_REQUISES[commande]);
    if (!aRole && !aPerm) {
      return message.channel.send("Vous n'avez pas les permissions (rôle Modo/Staff ou permission Discord requise).");
    }
  }
  // ---- Contrôle d'accès : commandes d'administration ----
  if (COMMANDES_ADMIN.includes(commande) && !estAdmin(message.member)
      && message.author.id !== message.guild.ownerId && message.author.id !== config.server_owner_id) {
    return message.channel.send("Vous n'avez pas les permissions (rôle Staff/Owner ou permission Administrateur requise).");
  }

  // ============================================================
  //  COMMANDES DE CONFIGURATION
  // ============================================================

  if (commande === 'setup') {
    const attente = await message.channel.send('Configuration du serveur en cours... cela peut prendre quelques secondes.');
    try {
      const resultats = await setupGuild(message.guild, message.author);
      const embed = new EmbedBuilder()
        .setTitle('✅ Serveur configuré avec succès !')
        .setColor(0x2ecc71)
        .addFields(
          { name: '👑 Rôles créés', value: '👑 Owner, 🛡️ Staff, 🛡️ Modo, ✅ Membre', inline: false },
          { name: '📁 Salons créés', value: `Catégories : 📢 INFORMATIONS, 💬 DISCUSSIONS, 🎤 VOCAUX, 🛡️ MODÉRATION, 🎫 TICKETS\nSalons texte et vocaux : ${resultats.salons}`, inline: false },
          { name: '🔐 Accès', value: 'Les nouveaux membres doivent cliquer sur le bouton dans **#reglement** pour obtenir le rôle Membre et accéder aux salons.', inline: false }
        );
      await attente.edit({ content: null, embeds: [embed] });
    } catch (e) {
      console.error(e);
      await attente.edit(`❌ Erreur pendant la configuration : ${e.message}\nVérifiez que le bot a bien la permission **Administrator**.`);
    }
    return;
  }

  if (commande === 'newserver' || commande === 'creerserveur') {
    if (client.guilds.cache.size >= 10) {
      return message.channel.send('Le bot ne peut créer un nouveau serveur que s\'il est présent dans moins de 10 serveurs.');
    }
    const nom = args.join(' ') || 'La Communauté';
    try {
      const nouveau = await client.guilds.create({ name: nom });
      config.server_owner_id = message.author.id;
      config.server_owner_guild_id = nouveau.id;
      saveConfig();
      await setupGuild(nouveau, message.author);
      const salon = nouveau.channels.cache.find(c => c.name === 'bienvenue') || nouveau.channels.cache.first();
      const invite = await salon.createInvite({ maxAge: 0, maxUses: 0 });
      try {
        await message.author.send(`✅ Serveur **${nom}** créé et configuré !\nInvitation : ${invite.url}\nEn rejoignant, vos rôles **👑 Owner** et **🛡️ Staff** seront attribués automatiquement.`);
      } catch (e) {
        await message.channel.send(`✅ Serveur créé et configuré ! Invitation (vos MP étant fermés) : ${invite.url}`);
      }
      await message.channel.send('✅ Serveur créé et configuré ! L\'invitation vous a été envoyée en message privé.');
    } catch (e) {
      console.error(e);
      await message.channel.send(`❌ Erreur lors de la création du serveur : ${e.message}`);
    }
    return;
  }

  if (commande === 'setlogs') {
    const salon = message.mentions.channels.first() || message.channel;
    config.logs[message.guild.id] = salon.id;
    saveConfig();
    return message.channel.send(`Les logs iront dans ${salon}.`);
  }

  if (commande === 'setwelcome') {
    const salon = message.mentions.channels.first() || message.channel;
    config.welcome[message.guild.id] = salon.id;
    saveConfig();
    return message.channel.send(`Les messages de bienvenue iront dans ${salon}.`);
  }

  if (commande === 'setautorole') {
    const role = message.mentions.roles.first();
    if (!role) return message.channel.send(`Mentionnez un rôle : \`${PREFIX}setautorole @Rôle\``);
    config.autorole = role.id;
    saveConfig();
    return message.channel.send(`Rôle automatique : ${role}.`);
  }

  // ============================================================
  //  COMMANDES D'INFORMATION (tout le monde)
  // ============================================================

  if (commande === 'help' || commande === 'aide' || commande === 'h') {
    const embed = new EmbedBuilder()
      .setTitle('Aide du bot')
      .setDescription(`Préfixe : **${PREFIX}**`)
      .setColor(0x3498db)
      .addFields(
        { name: '⚙️ Configuration', value: '`setup` (tout configurer), `newserver`, `setlogs`, `setwelcome`, `setautorole`', inline: false },
        { name: '🛡️ Modération', value: '`kick`, `ban`, `unban`, `clear`, `warn`, `warnings`, `delwarns`, `mute`, `unmute`, `say`', inline: false },
        { name: '🎫 Tickets', value: '`ticket [sujet]` — ouvre un ticket privé avec le staff', inline: false },
        { name: '📊 Niveaux', value: '`level [@membre]`, `top` — classement XP du serveur', inline: false },
        { name: 'ℹ️ Informations', value: '`ping`, `userinfo`, `serverinfo`, `avatar`, `uptime`', inline: false },
        { name: '🎉 Fun', value: '`8ball`, `dice`, `coinflip`, `slap`, `hug`', inline: false }
      );
    return message.channel.send({ embeds: [embed] });
  }

  if (commande === 'ping') {
    return message.channel.send(`Pong ! Latence : **${client.ws.ping} ms**`);
  }

  if (commande === 'uptime') {
    const secondes = Math.floor(client.uptime / 1000);
    const heures = Math.floor(secondes / 3600);
    const minutes = Math.floor((secondes % 3600) / 60);
    return message.channel.send(`Le bot est en ligne depuis **${heures}h ${minutes}min ${secondes % 60}s**.`);
  }

  if (commande === 'userinfo' || commande === 'ui' || commande === 'info') {
    const membre = message.mentions.members.first() || message.member;
    const embed = new EmbedBuilder()
      .setTitle(`Informations sur ${membre.displayName}`)
      .setColor(0x3498db)
      .setThumbnail(membre.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "Nom d'utilisateur", value: membre.user.username, inline: true },
        { name: 'Pseudo sur le serveur', value: membre.displayName, inline: true },
        { name: 'ID', value: membre.id, inline: false },
        { name: 'Compte créé le', value: membre.user.createdAt.toLocaleDateString('fr-FR'), inline: true },
        { name: 'A rejoint le serveur le', value: membre.joinedAt ? membre.joinedAt.toLocaleDateString('fr-FR') : 'Inconnu', inline: true },
        { name: 'Rôles', value: membre.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(', ') || 'Aucun', inline: false }
      );
    return message.channel.send({ embeds: [embed] });
  }

  if (commande === 'serverinfo' || commande === 'si' || commande === 'serveur') {
    const guild = message.guild;
    const proprietaire = await guild.fetchOwner();
    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setColor(0x2ecc71)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'Propriétaire', value: proprietaire.toString(), inline: true },
        { name: 'ID', value: guild.id, inline: true },
        { name: 'Membres', value: `${guild.memberCount}`, inline: true },
        { name: 'Salons', value: `${guild.channels.cache.size}`, inline: true },
        { name: 'Rôles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Créé le', value: guild.createdAt.toLocaleDateString('fr-FR'), inline: true }
      );
    return message.channel.send({ embeds: [embed] });
  }

  if (commande === 'avatar' || commande === 'pp') {
    const membre = message.mentions.members.first() || message.member;
    const embed = new EmbedBuilder()
      .setTitle(`Avatar de ${membre.displayName}`)
      .setColor(0x9b59b6)
      .setImage(membre.user.displayAvatarURL({ size: 1024 }));
    return message.channel.send({ embeds: [embed] });
  }

  // ============================================================
  //  COMMANDES DE MODÉRATION (Staff / Modo)
  // ============================================================

  if (commande === 'kick') {
    const membre = message.mentions.members.first();
    if (!membre) return message.channel.send(`Mentionnez un membre : \`${PREFIX}kick @membre raison\``);
    const raison = args.slice(1).join(' ') || 'Aucune raison donnée';
    if (membre.id === message.author.id) return message.channel.send('Vous ne pouvez pas vous expulser vous-même.');
    if (membre.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
      return message.channel.send('Impossible : ce membre a un rôle égal ou supérieur au vôtre.');
    }
    await membre.kick(`Par ${message.author.tag} : ${raison}`);
    await message.channel.send(`${membre} a été expulsé. Raison : ${raison}`);
    const embed = new EmbedBuilder().setTitle('👢 Expulsion').setColor(0xe74c3c).setDescription(`**${membre.user.tag}** a été expulsé par ${message.author}\nRaison : ${raison}`).setTimestamp();
    return envoyerLog(message.guild, embed);
  }

  if (commande === 'ban') {
    const membre = message.mentions.members.first();
    if (!membre) return message.channel.send(`Mentionnez un membre : \`${PREFIX}ban @membre raison\``);
    const raison = args.slice(1).join(' ') || 'Aucune raison donnée';
    if (membre.id === message.author.id) return message.channel.send('Vous ne pouvez pas vous bannir vous-même.');
    if (membre.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
      return message.channel.send('Impossible : ce membre a un rôle égal ou supérieur au vôtre.');
    }
    await membre.ban({ reason: `Par ${message.author.tag} : ${raison}` });
    await message.channel.send(`${membre} a été banni. Raison : ${raison}`);
    const embed = new EmbedBuilder().setTitle('🔨 Bannissement').setColor(0xe74c3c).setDescription(`**${membre.user.tag}** a été banni par ${message.author}\nRaison : ${raison}`).setTimestamp();
    return envoyerLog(message.guild, embed);
  }

  if (commande === 'unban') {
    const pseudo = args.join(' ');
    if (!pseudo) return message.channel.send(`Utilisation : \`${PREFIX}unban pseudo\``);
    const bannis = await message.guild.bans.fetch();
    const cible = bannis.find(b => b.user.tag === pseudo || b.user.username === pseudo);
    if (!cible) return message.channel.send('Utilisateur introuvable dans la liste des bannis.');
    await message.guild.members.unban(cible.user);
    await message.channel.send(`${cible.user.tag} a été débanni.`);
    const embed = new EmbedBuilder().setTitle('✅ Débannissement').setColor(0x2ecc71).setDescription(`**${cible.user.tag}** a été débanni par ${message.author}`).setTimestamp();
    return envoyerLog(message.guild, embed);
  }

  if (commande === 'clear' || commande === 'purge') {
    let nombre = parseInt(args[0], 10);
    if (isNaN(nombre) || nombre < 1) nombre = 5;
    if (nombre > 100) nombre = 100;
    try {
      await message.channel.bulkDelete(nombre, true);
      await message.delete().catch(() => {});
      const conf = await message.channel.send(`${nombre} messages supprimés.`);
      setTimeout(() => conf.delete().catch(() => {}), 3000);
    } catch (e) {
      return message.channel.send('Erreur : les messages de plus de 14 jours ne peuvent pas être supprimés en masse.');
    }
  }

  if (commande === 'warn') {
    const membre = message.mentions.members.first();
    if (!membre) return message.channel.send(`Mentionnez un membre : \`${PREFIX}warn @membre raison\``);
    const raison = args.slice(1).join(' ') || 'Aucune raison donnée';
    const uid = membre.id;
    if (!warns[uid]) warns[uid] = [];
    warns[uid].push({
      raison: raison,
      moderateur: message.author.tag,
      date: new Date().toLocaleString('fr-FR')
    });
    saveWarns();
    await message.channel.send(`${membre} a été averti (avertissement n°${warns[uid].length}). Raison : ${raison}`);
    try { await membre.send(`Vous avez reçu un avertissement sur ${message.guild.name} : ${raison}`); } catch (e) {}
    const embed = new EmbedBuilder().setTitle('⚠️ Avertissement').setColor(0xf1c40f).setDescription(`**${membre.user.tag}** averti par ${message.author}\nRaison : ${raison}`).setTimestamp();
    return envoyerLog(message.guild, embed);
  }

  if (commande === 'warnings' || commande === 'warns') {
    const membre = message.mentions.members.first() || message.member;
    const liste = warns[membre.id] || [];
    if (liste.length === 0) return message.channel.send(`${membre.displayName} n'a aucun avertissement.`);
    const embed = new EmbedBuilder()
      .setTitle(`Avertissements de ${membre.displayName}`)
      .setColor(0xe67e22);
    liste.forEach((w, i) => {
      embed.addFields({ name: `#${i + 1} — ${w.date}`, value: `Raison : ${w.raison}\nPar : ${w.moderateur}`, inline: false });
    });
    return message.channel.send({ embeds: [embed] });
  }

  if (commande === 'delwarns' || commande === 'clearwarns') {
    const membre = message.mentions.members.first();
    if (!membre) return message.channel.send(`Mentionnez un membre : \`${PREFIX}delwarns @membre\``);
    warns[membre.id] = [];
    saveWarns();
    return message.channel.send(`Tous les avertissements de ${membre} ont été supprimés.`);
  }

  if (commande === 'mute' || commande === 'silence') {
    const membre = message.mentions.members.first();
    if (!membre) return message.channel.send(`Mentionnez un membre : \`${PREFIX}mute @membre [durée en minutes] [raison]\``);
    const duree = parseInt(args[1], 10) || 10;
    const raison = args.slice(2).join(' ') || 'Aucune raison donnée';
    await membre.timeout(duree * 60 * 1000, `Par ${message.author.tag} : ${raison}`);
    await message.channel.send(`${membre} est muet pendant **${duree} minute(s)**. Raison : ${raison}`);
    const embed = new EmbedBuilder().setTitle('🔇 Mute').setColor(0xe67e22).setDescription(`**${membre.user.tag}** muet par ${message.author} pendant ${duree} min\nRaison : ${raison}`).setTimestamp();
    return envoyerLog(message.guild, embed);
  }

  if (commande === 'unmute') {
    const membre = message.mentions.members.first();
    if (!membre) return message.channel.send(`Mentionnez un membre : \`${PREFIX}unmute @membre\``);
    await membre.timeout(null);
    await message.channel.send(`${membre} peut reparler.`);
    const embed = new EmbedBuilder().setTitle('🔊 Unmute').setColor(0x2ecc71).setDescription(`**${membre.user.tag}** a été démute par ${message.author}`).setTimestamp();
    return envoyerLog(message.guild, embed);
  }

  if (commande === 'say') {
    const texte = args.join(' ');
    if (!texte) return message.channel.send(`Utilisation : \`${PREFIX}say votre message\``);
    await message.delete().catch(() => {});
    return message.channel.send(texte);
  }

  // ============================================================
  //  TICKETS (tout le monde)
  // ============================================================

  if (commande === 'ticket' || commande === 'support') {
    const sujet = args.join(' ') || 'Demande d\'aide';
    const catTickets = message.guild.channels.cache.find(c => c.name === '🎫 TICKETS' && c.type === ChannelType.GuildCategory);
    const rModo = message.guild.roles.cache.find(r => r.name === '🛡️ Modo');
    const rStaff = message.guild.roles.cache.find(r => r.name === '🛡️ Staff');
    const rOwner = message.guild.roles.cache.find(r => r.name === '👑 Owner');
    const overwrites = [
      { id: message.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];
    for (const r of [rModo, rStaff, rOwner]) {
      if (r) overwrites.push({ id: r.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
    }
    const pseudoPropre = message.author.username.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
    const salon = await message.guild.channels.create({
      name: `ticket-${pseudoPropre}-${Math.floor(Math.random() * 1000)}`,
      type: ChannelType.GuildText,
      parent: catTickets ? catTickets.id : undefined,
      permissionOverwrites: overwrites,
      topic: message.author.id   // ID du créateur, utilisé pour la fermeture
    });
    const boutonFermer = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('fermer_ticket').setLabel('🔒 Fermer le ticket').setStyle(ButtonStyle.Danger)
    );
    await salon.send({ content: `${message.author}, votre ticket est ouvert. Le staff va vous répondre ici.\nSujet : **${sujet}**`, components: [boutonFermer] });
    await message.channel.send(`✅ Votre ticket a été créé : ${salon}`);
    const embedLog = new EmbedBuilder().setTitle('🎫 Ticket ouvert').setColor(0x3498db).setDescription(`${message.author} a ouvert un ticket : ${salon}\nSujet : ${sujet}`).setTimestamp();
    return envoyerLog(message.guild, embedLog);
  }

  // ============================================================
  //  NIVEAUX / XP (tout le monde)
  // ============================================================

  if (commande === 'level' || commande === 'niveau' || commande === 'rank') {
    const cible = message.mentions.members.first() || message.member;
    const data = xpData[cible.id] || { xp: 0, niveau: 0 };
    const prochain = 50 * Math.pow(data.niveau + 1, 2);
    const pourcent = Math.min(100, Math.round((data.xp / prochain) * 100));
    const embed = new EmbedBuilder()
      .setTitle(`Niveau de ${cible.displayName}`)
      .setColor(0x9b59b6)
      .setThumbnail(cible.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Niveau', value: `${data.niveau}`, inline: true },
        { name: 'XP total', value: `${data.xp}`, inline: true },
        { name: `Progression vers le niveau ${data.niveau + 1}`, value: `${data.xp}/${prochain} XP (${pourcent}%)`, inline: false }
      );
    return message.channel.send({ embeds: [embed] });
  }

  if (commande === 'top' || commande === 'leaderboard' || commande === 'classement') {
    const classement = Object.entries(xpData).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
    if (classement.length === 0) return message.channel.send('Aucune donnée XP pour le moment. Parlez dans les salons pour gagner de l\'XP !');
    const lignes = [];
    for (let i = 0; i < classement.length; i++) {
      const [uid, data] = classement[i];
      const user = client.users.cache.get(uid) || await client.users.fetch(uid).catch(() => null);
      lignes.push(`**${i + 1}.** ${user ? user.tag : uid} — Niveau ${data.niveau} (${data.xp} XP)`);
    }
    const embed = new EmbedBuilder()
      .setTitle('🏆 Top 10 du classement')
      .setDescription(lignes.join('\n'))
      .setColor(0xf1c40b);
    return message.channel.send({ embeds: [embed] });
  }

  // ============================================================
  //  COMMANDES FUN (tout le monde)
  // ============================================================

  const REPONSES_8BALL = [
    'Oui.', 'Non.', 'Peut-être.', "C'est certain.", 'Très douteux.',
    'Absolument.', 'Demande plus tard.', 'Mes sources disent non.'
  ];

  if (commande === '8ball' || commande === 'question') {
    const question = args.join(' ');
    if (!question) return message.channel.send(`Posez une question : \`${PREFIX}8ball votre question\``);
    const reponse = REPONSES_8BALL[Math.floor(Math.random() * REPONSES_8BALL.length)];
    return message.channel.send(`Question : ${question}\nRéponse : **${reponse}**`);
  }

  if (commande === 'dice' || commande === 'de') {
    const faces = parseInt(args[0], 10) || 6;
    if (faces < 2) return message.channel.send('Le dé doit avoir au moins 2 faces.');
    return message.channel.send(`Vous avez obtenu : **${Math.floor(Math.random() * faces) + 1}**`);
  }

  if (commande === 'coinflip' || commande === 'pf') {
    const resultat = Math.random() < 0.5 ? 'Pile' : 'Face';
    return message.channel.send(`Résultat : **${resultat}**`);
  }

  if (commande === 'slap') {
    const cible = message.mentions.members.first() || message.member;
    return message.channel.send(`${message.author} donne une baffe à ${cible} !`);
  }

  if (commande === 'hug') {
    const cible = message.mentions.members.first() || message.member;
    return message.channel.send(`${message.author} fait un câlin à ${cible}.`);
  }

  // ============================================================
  //  COMMANDE INCONNUE
  // ============================================================

  if (commande.length > 0) {
    return message.channel.send(`Commande inconnue. Tapez \`${PREFIX}help\` pour voir la liste des commandes.`);
  }
});

// ------------------------------------------------------------
// 9. BOUTONS (acceptation du règlement + fermeture des tickets)
// ------------------------------------------------------------

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // ---- Bouton "Accepter et devenir membre" ----
  if (interaction.customId === 'devenir_membre') {
    const roleMembre = interaction.guild.roles.cache.find(r => r.name === '✅ Membre');
    if (!roleMembre) {
      return interaction.reply({ content: 'Rôle Membre introuvable. Lancez `!setup` d\'abord.', ephemeral: true });
    }
    if (interaction.member.roles.cache.has(roleMembre.id)) {
      return interaction.reply({ content: 'Vous êtes déjà membre ! ✅', ephemeral: true });
    }
    await interaction.member.roles.add(roleMembre, 'Acceptation du règlement');
    await interaction.reply({ content: 'Bienvenue ! Vous avez maintenant accès à tous les salons du serveur. 🎉', ephemeral: true });

    const salonWelcome = getWelcomeChannel(interaction.guild);
    if (salonWelcome) {
      await salonWelcome.send(`👋 Bienvenue **${interaction.user}** dans la communauté ! Vous avez accepté le règlement.`).catch(() => {});
    }
  }

  // ---- Bouton "Fermer le ticket" ----
  if (interaction.customId === 'fermer_ticket') {
    const estPermis = estStaff(interaction.member)
      || interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)
      || interaction.channel.topic === interaction.user.id;
    if (!estPermis) {
      return interaction.reply({ content: 'Seul le staff (ou le créateur du ticket) peut fermer ce ticket.', ephemeral: true });
    }
    await interaction.reply({ content: '🔒 Fermeture du ticket dans 5 secondes...' });
    setTimeout(async () => {
      const embed = new EmbedBuilder()
        .setTitle('🎫 Ticket fermé')
        .setColor(0xe74c3c)
        .setDescription(`Ticket fermé par ${interaction.user.tag}`)
        .setTimestamp();
      await envoyerLog(interaction.guild, embed);
      await interaction.channel.delete().catch(() => {});
    }, 5000);
  }
});

// ------------------------------------------------------------
// 10. LOGS : MESSAGE SUPPRIMÉ
// ------------------------------------------------------------
client.on('messageDelete', async (message) => {
  if (!message.guild || (message.author && message.author.bot)) return;
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .setColor(0xe74c3c)
    .addFields(
      { name: 'Auteur', value: message.author ? message.author.toString() : 'Inconnu', inline: true },
      { name: 'Salon', value: message.channel.toString(), inline: true },
      { name: 'Contenu', value: (message.content || '(sans contenu)').slice(0, 1000), inline: false }
    )
    .setTimestamp();
  await envoyerLog(message.guild, embed);
});

// ------------------------------------------------------------
// 11. ÉVÉNEMENT : MEMBRE REJOINT (bienvenue en MP + autorole)
// ------------------------------------------------------------
client.on('guildMemberAdd', async (membre) => {
  if (membre.user.bot) return;

  // Message privé de bienvenue
  try {
    const embedDM = new EmbedBuilder()
      .setTitle(`👋 Bienvenue sur ${membre.guild.name} !`)
      .setColor(0x2ecc71)
      .setThumbnail(membre.guild.iconURL({ size: 256 }))
      .setDescription('Merci d\'avoir rejoint notre communauté !\n\nPour accéder à tous les salons :\n1. Lisez le règlement dans **#reglement**\n2. Cliquez sur le bouton **"✅ Accepter et devenir membre"**\n\nBonne visite ! 🎉')
      .setTimestamp();
    await membre.send({ embeds: [embedDM] });
  } catch (e) { /* l'utilisateur bloque les MP */ }

  // Si le serveur a été créé via !newserver, on donne Owner + Staff au créateur
  if (config.server_owner_guild_id === membre.guild.id && config.server_owner_id === membre.id) {
    const rOwner = membre.guild.roles.cache.find(r => r.name === '👑 Owner');
    const rStaff = membre.guild.roles.cache.find(r => r.name === '🛡️ Staff');
    if (rOwner) await membre.roles.add(rOwner, 'Créateur du serveur').catch(() => {});
    if (rStaff) await membre.roles.add(rStaff, 'Créateur du serveur').catch(() => {});
  }

  // Rôle automatique (si configuré avec !setautorole)
  if (config.autorole) {
    const role = membre.guild.roles.cache.get(config.autorole);
    if (role) {
      try { await membre.roles.add(role, 'Rôle automatique'); } catch (e) {}
    }
  }

  // Log du membre rejoint
  const embedLog = new EmbedBuilder()
    .setTitle('👋 Membre rejoint')
    .setColor(0x2ecc71)
    .setDescription(`**${membre.user.tag}** (${membre.id}) a rejoint le serveur.\nCompte créé le : ${membre.user.createdAt.toLocaleDateString('fr-FR')}`)
    .setThumbnail(membre.user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
  await envoyerLog(membre.guild, embedLog);
});

// ------------------------------------------------------------
// 12. ÉVÉNEMENT : MEMBRE PARTI (log)
// ------------------------------------------------------------
client.on('guildMemberRemove', (membre) => {
  if (membre.user.bot) return;
  const embed = new EmbedBuilder()
    .setTitle('👋 Membre parti')
    .setColor(0xe67e22)
    .setDescription(`**${membre.user.tag}** (${membre.id}) a quitté le serveur.`)
    .setTimestamp();
  envoyerLog(membre.guild, embed);
});

// ------------------------------------------------------------
// 13. LANCEMENT DU BOT
// ------------------------------------------------------------
if (config.token === 'COLLEZ_VOTRE_TOKEN_ICI') {
  console.log('ERREUR : ouvrez config.json et collez votre token dans le champ "token".');
} else {
  console.log('Démarrage du bot...');
  client.login(config.token);
}