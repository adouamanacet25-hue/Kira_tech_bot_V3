// ============================================================
//  KIRA TECH BOT 🌐  v2  -  by Mr Kira Tech
//  Telegram (Telegraf) + WhatsApp (Baileys, multi-sessions)
//
//  Variables d'environnement Render :
//    TELEGRAM_TOKEN   (obligatoire)  token BotFather
//    TG_CHANNEL_ID    (optionnel)    id de la chaîne Telegram (-100...) pour « Vérifier ✅ »
//    DATA_DIR         (optionnel)    ex: /var/data (disque persistant Render)
//    TZ_NAME          (optionnel)    défaut Africa/Brazzaville
//    APP_URL          (optionnel)    URL publique si RENDER_EXTERNAL_URL absent
//    PORT / RENDER_EXTERNAL_URL      fournis par Render
// ============================================================
import express from 'express';
import { Telegraf } from 'telegraf';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';

// ───────────────────────── CONFIG ─────────────────────────
const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) { console.error('❌ TELEGRAM_TOKEN manquant (Render > Environment).'); process.exit(1); }
const PORT = process.env.PORT || 3000;
const TZ = process.env.TZ_NAME || 'Africa/Brazzaville';
const DATA_DIR = process.env.DATA_DIR || path.resolve('./data');
const SESS_DIR = path.join(DATA_DIR, 'sessions');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(SESS_DIR, { recursive: true });

const BOT_USERNAME = 'Kira_tech_bot';
const BOT_LINK = `https://t.me/${BOT_USERNAME}`;
const AUTHOR = 'Mr Kira Tech';
const IMG_TG = 'https://i.ibb.co/wN35ZdRS/9-D288-DC7-3-E3-F-49-E4-BFAB-8-C59-D2-F53-FAD.jpg';
const IMG_WA = 'https://i.ibb.co/hJqtxPrb/52-C1-EBD9-25-DC-44-E8-894-E-BE9755-E9-CB2-A.jpg';
const IMG_EXTRA = 'https://i.ibb.co/fVx9TFpv/5-A210-D08-145-E-43-C7-8-EB4-C60-FF6490-A39.jpg';

const LINKS = {
  tgChannel: 'https://t.me/+mQ3aQpCsEqI0YmY0',
  tgGroup: 'https://t.me/+2JDC_Be4_ww1N2Vk',
  waChannel: 'https://whatsapp.com/channel/0029Vb7WJzp84OmBD0fEEJ2X',
  waGroup: 'https://chat.whatsapp.com/IP0nFB79rMDF0nvFSMXtDR?s=cl&p=i&mlu=0&ilr=4',
};
const FOOTER = '\n\n> power by Mr Kira tech 🌐';
const logger = pino({ level: 'silent' });

// ───────────────────────── UTILS ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const num = (j) => (j || '').split('@')[0].split(':')[0];
const toJid = (n) => `${num(n)}@s.whatsapp.net`;
const linked = (c) => !!(c && (c.registered || c.account)); // session réellement liée à WhatsApp
const fmtDate = (d = new Date()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.hour}:${p.minute} / ${p.day} / ${p.month} / ${p.year}`;
};
async function getJson(u) { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); return r.json(); }
async function getBuf(u) { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return Buffer.from(await r.arrayBuffer()); }

// Images : téléchargées UNE fois puis gardées en mémoire (évite les échecs d'URL côté Telegram)
const imgCache = new Map();
async function getImg(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const b = Buffer.from(await r.arrayBuffer());
    imgCache.set(url, b); return b;
  } catch (e) { console.error('⚠️ image indisponible', url, e.message); return null; }
}

// ───────────────────────── BASE DE DONNÉES (JSON) ─────────────────────────
let db = { users: {}, connected: {}, settings: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch {}
let saveTimer;
const saveDb = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) { console.error('saveDb', e.message); } }, 500);
};
const settingsOf = (n) => (db.settings[n] ||= { prefix: '.', name: 'KIRA TECH B0T🌹', image: IMG_WA, antidelete: false, groups: {}, mem: {}, count: 0 });
const groupOf = (s, jid) => (s.groups[jid] ||= { welcome: true, goodbye: true, antilink: false, antispam: false, antitag: false });

// ═════════════════════════════════════════════════════════════
//                  CONTENUS (listes de 50, etc.)
// ═════════════════════════════════════════════════════════════
const J = [
  'Pourquoi les plongeurs plongent-ils toujours en arrière ? Sinon ils tombent dans le bateau 😂',
  'Mon wifi et moi, c’est compliqué : on n’a aucune connexion 📶', 'Je ne suis pas en retard, c’est le temps qui est en avance ⏰',
  'Un informaticien ne se perd jamais, il est juste en mode debug 🐛', 'Pourquoi les poissons détestent l’ordinateur ? À cause du net 🐟',
  'Je voulais perdre du poids, mais mon frigo a dit non 🍔', 'Le lundi prouve que le week-end est trop court 😭',
  'Mon lit et moi, c’est stable : je ne le quitte jamais 🛏️', 'Qu’est-ce qui est jaune et qui attend ? Jonathan 🍌',
  'Mon téléphone est à 1 % : lui aussi vit dangereusement 🔋', 'Pourquoi le livre de maths est triste ? Il a trop de problèmes 📚',
  'Je suis au régime : je regarde la nourriture mais je ne la touche pas… 5 secondes 🍕', 'Mon compte en banque est comme mon ex : il ne me répond plus 💸',
  'Un escargot qui traverse la route : « Quel turbo ! » 🐌', 'Le réveil ne sonne pas, il me harcèle ⏰',
  'Pourquoi les squelettes ne vont pas aux soirées ? Ils n’ont personne avec qui danser 💀', 'Mon cerveau a 50 onglets ouverts, dont 3 qui font de la musique 🧠',
  'Je ne ronfle pas, je rêve que je suis une moto 🏍️', 'Les devoirs : je les ferai demain. Demain : « Pourquoi pas demain ? » 📝',
  'Pourquoi les canards sont toujours à l’heure ? Ils sont dans l’étang 🦆', 'Le chargeur qui marche seulement dans un angle précis : c’est de l’art 🔌',
  'Je suis un expert en rien, mais passionné par tout 🤓', 'La pizza ne juge pas, elle comprend 🍕', 'Mon réseau est si lent que le message arrive avec les cheveux gris 👴',
  'On m’a dit de suivre mes rêves. Ils sont allés dormir 😴', 'Pourquoi la tomate rougit ? Elle a vu la salade se déshabiller 🍅',
  'Je ne suis pas paresseux, je suis en économie d’énergie 🔋', 'Quand le Wi-Fi coupe, la famille se parle. Quelle horreur 😱', 'Je cuisine comme je chante : avec courage mais sans talent 🍳',
  'Mon chat me regarde comme si je lui devais de l’argent 🐱', 'Pourquoi le café est toujours en colère ? Parce qu’on le prend sans cesse 😤☕',
  'Je suis nul en géographie : je me perds même dans mon salon 🗺️', 'La seule salle de sport que je fréquente : celle de mon frigo 🏋️',
  'J’ai arrêté le sport : mes muscles étaient trop timides 💪', 'Un jour sans rire est un jour perdu, alors je ris de mes dettes 😂', 'Je dors peu, mais j’y mets de la qualité 😴',
  'Un aveugle entre dans un bar… puis dans une table, puis dans une chaise 🍺', 'Mon chien aboie contre l’aspirateur : lui au moins assume ses peurs 🐶',
  'Pourquoi les maths sont toujours tristes ? Elles ont trop de problèmes 😔', 'Le zéro dit au huit : « Belle ceinture ! » 🎀',
  'Je cherche un travail où l’on dort et où l’on est payé 💼', 'Ma maison est propre à 90 % : les 10 % c’est là où je vis 🏠',
  'Les SMS : « J’arrive dans 5 min » (j’ai pas encore pris ma douche) 🚿', 'Je suis allergique au lundi. Symptômes : tristesse et café ☕',
  'Pourquoi les voleurs aiment les bibliothèques ? Il y a beaucoup de livres à emprunter 📖', 'Je suis tellement fauché que mon portefeuille fait de l’écho 🪙',
  'Mon avenir est si brillant que je dois mettre des lunettes… et un loyer à payer 😎', 'Les mots de passe : « Ah non, il y a déjà une majuscule, un chiffre, un symbole… » 🔐',
  'Quand je dis « 5 minutes », c’est une unité de mesure élastique ⏳', 'J’ai un cœur d’or… mais un forfait d’argent 💛', 'La vie est belle, surtout quand la batterie est à 100 % 🔋',
];
const COMPLIMENTS = [
  'Tu as un sourire qui illumine le groupe ✨', 'Ton énergie est contagieuse 🔥', 'Tu es plus utile que tu ne le crois 💎', 'Ta présence rend ce groupe meilleur 🌹',
  'Tu as un cœur en or 👑', 'Tu es la preuve que la bonne humeur existe 😄', 'Tu es brillant(e) et ça se voit 🌟', 'Quelle belle personne tu fais ! 💫', 'Tu inspires les gens autour de toi 🚀',
  'Ta gentillesse est rare, garde-la 🤍', 'Tu rends les journées plus belles 🌞', 'Ton rire est le meilleur des sons 🎶', 'Tu as un talent que le monde attend 🎯', 'Tu es courageux(se) plus que tu ne l’imagines 🦁',
  'Tu as un style unique 😎', 'Avec toi, rien n’est ennuyeux 🎉', 'Tu es un(e) véritable ami(e) 🫶', 'Ton intelligence est impressionnante 🧠', 'Tu as une aura incroyable ✨',
  'Tu fais bouger les choses 🌍', 'Tu es une source de motivation 🔋', 'Tes idées sont géniales 💡', 'Tu as une belle âme 🕊️', 'Tu es plus fort(e) que tes problèmes 💪',
  'Tu mérites tout le bonheur du monde 🌈', 'Ta bonne humeur est un cadeau 🎁', 'Tu es quelqu’un de précieux 💍', 'On est chanceux de t’avoir ici 🍀', 'Ta créativité n’a pas de limite 🎨',
  'Tu es toujours là quand il faut 🤝', 'Tu transformes les galères en rigolades 😂', 'Tu es un roi / une reine 👑', 'Ton calme est impressionnant 🧘', 'Tu as du charisme à revendre 🔥',
  'Tu rends le monde plus doux 🍯', 'Tu es un modèle de persévérance 🏆', 'Tu brilles même sans lumière 🌙', 'Ton avis compte vraiment 🗣️', 'Tu es authentique et ça se sent 💯',
  'Ta voix apaise 🎤', 'Tu fais honneur à ta famille 🏡', 'Tu es plein(e) de ressources 🧰', 'Tu as le don de motiver les autres 📣', 'Tu es drôle sans même essayer 🤣',
  'Ton sens de l’humour est top 😆', 'Tu es une belle surprise chaque jour 🎊', 'Ton courage inspire 🛡️', 'Tu es en train de devenir une légende 🌟', 'Ton cœur est immense ❤️', 'Tu es tout simplement génial(e) 🙌',
];
const STUPID = [
  'Si un poulet traverse la route, a-t-il un passeport ? 🐔', 'Combien de temps dure une minute de silence ? 🤫', 'Si je ne dis rien, est-ce que je parle quand même ? 🤔',
  'Peut-on se noyer dans une piscine de sable ? 🏖️', 'Quelle est la couleur du vent ? 🌬️', 'Un escargot peut-il perdre sa maison au Monopoly ? 🐌',
  'Si on coupe un cercle en deux, a-t-on deux demi-lunes ? 🌙', 'Les fantômes ont-ils peur d’eux-mêmes ? 👻', 'Un miroir peut-il se voir sans se regarder ? 🪞', 'Si le temps c’est de l’argent, la montre est-elle une banque ? ⌚',
];
const IMAGINE = [
  'Tu te réveilles et tu es la seule personne éveillée dans la ville entière 🌆', 'Tu reçois une lettre d’une version de toi venue du futur 💌', 'Tu trouves une porte secrète chez toi qui mène à une forêt magique 🌲',
  'Tu peux parler aux animaux pendant 24h 🦜', 'Tu diriges un royaume où tout est en bonbons 🍭', 'Tu découvres que tu peux voler, mais seulement la nuit 🌙', 'Tu es piégé dans un jeu vidéo dont tu dois finir le niveau final 🎮',
  'Tu gagnes un voyage sur la lune avec un inconnu 🚀', 'Tu trouves une lampe magique, mais le génie est en grève 🧞', 'Ton ombre se met à vivre sa propre vie 👤', 'Tu peux arrêter le temps 10 secondes par jour ⏱️',
  'Tu hérites d’une île déserte et d’un perroquet qui parle 🏝️', 'Tu te réveilles dans un manga, personnage principal 🎌', 'Tu peux voyager dans le passé mais pas en revenir 🕰️', 'Un robot sonne à ta porte et dit être ton cousin 🤖',
  'Il pleut des pièces d’or pendant une minute 💰', 'Tu deviens invisible quand tu es gêné(e) 🫥', 'Tu découvres que ton chat dirige une organisation secrète 🐱', 'Tu es le dernier humain sur Terre et ton téléphone sonne 📱',
  'Tu peux entendre les pensées des gens, mais seulement leurs mauvaises blagues 🧠', 'Tu as un dragon de compagnie, mais il a peur du feu 🐉', 'Tu marches sur un nuage comme sur un matelas ☁️', 'Tu es élu président de ton quartier, avec un seul vote : le tien 🗳️',
  'Tu trouves une carte au trésor dans un vieux livre 🗺️', 'Ta voiture se met à parler et critique ta conduite 🚗', 'Tu te transformes en oiseau à chaque éternuement 🐦', 'Tu apprends que tu es un super-héros… sans pouvoir 🦸',
  'La lune te fait un clin d’œil et te donne un rendez-vous 🌕', 'Tu entres dans un tableau et tu y vis une aventure 🖼️', 'Tu perds tes clés dans un autre monde 🔑', 'Ta maison devient un vaisseau spatial à minuit 🛸',
  'Tu gagnes le droit de refaire une journée de ta vie 🔁', 'Chaque mensonge que tu dis se transforme en papillon 🦋', 'Tu ouvres le frigo et tu tombes dans un restaurant 5 étoiles 🍽️', 'Un fantôme te demande de l’aide pour ses impôts 👻',
  'Tu deviens le plus grand détective de ta ville 🕵️', 'Tu possèdes une montre qui ralentit les mauvais moments ⌚', 'Tu peux changer de visage pendant une heure 🎭', 'Tu navigues sur un fleuve de chocolat 🍫',
  'Tu te perds dans une bibliothèque infinie 📚', 'Tu trouves un portail vers l’an 3000 🔮', 'Toutes les langues du monde te deviennent familières 🌍', 'Tu es invité à un bal avec des dieux grecs 🏛️',
  'Un arbre te confie un secret millénaire 🌳', 'Tu fais pousser des fleurs en chantant 🌸', 'Tu es le gardien d’un phare au bout du monde 🌊', 'Ton réveil sonne… dans 100 ans ⏰', 'Tu rencontres ton futur toi, mais il est fauché 😅', 'Tu peux téléporter ton lit n’importe où 🛏️',
];
const MANGA = [
  { t: 'One Piece', i: '🏴‍☠️ Luffy et son équipage cherchent le One Piece. Aventure, amitié et rêves immenses. ~1100+ chapitres.' },
  { t: 'Attack on Titan', i: '⚔️ L’humanité enfermée derrière des murs face aux titans. Intrigue, mystère et choix moraux. 139 chapitres.' },
  { t: 'Death Note', i: '📓 Un lycéen trouve un carnet qui tue. Duel d’intelligence avec le détective L. 108 chapitres.' },
  { t: 'Hunter x Hunter', i: '🎣 Gon part à la recherche de son père, un Hunter légendaire. Stratégie et univers riche.' },
  { t: 'Jujutsu Kaisen', i: '👻 Itadori avale un doigt maudit. Combats de malédictions et sorciers.' },
  { t: 'Naruto', i: '🍥 Un ninja rejeté rêve de devenir Hokage. Persévérance et amitié. 700 chapitres.' },
  { t: 'Demon Slayer', i: '🗡️ Tanjiro devient chasseur de démons pour sauver sa sœur. Émotion et combats. 205 chapitres.' },
  { t: 'Dr. Stone', i: '🧪 L’humanité pétrifiée, un génie reconstruit la civilisation grâce à la science.' },
  { t: 'Haikyuu!!', i: '🏐 Un petit joueur rêve de dominer le volley. Esprit d’équipe et dépassement.' },
  { t: 'Fullmetal Alchemist', i: '⚗️ Deux frères cherchent la pierre philosophale. Chef-d’œuvre complet en 108 chapitres.' },
  { t: 'Bleach', i: '🗡️ Ichigo devient Shinigami pour protéger les siens. Combats et univers spirituel.' },
  { t: 'Chainsaw Man', i: '🪚 Denji fusionne avec son chien-démon tronçonneuse. Sombre, rythmé et déjanté.' },
  { t: 'Spy x Family', i: '🕵️ Un espion, une tueuse et une télépathe forment une fausse famille. Comédie et action.' },
  { t: 'Vinland Saga', i: '🛡️ Vikings, vengeance et quête de sens. Récit mature et profond.' },
  { t: 'Blue Lock', i: '⚽ 300 attaquants, un seul deviendra le meilleur de Japon. Football intense.' },
];

// ═════════════════════════════════════════════════════════════
//                     PARTIE WHATSAPP (BAILEYS)
// ═════════════════════════════════════════════════════════════
const sessions = new Map(); // number -> { sock, pending, open }
const recent = new Map();   // jid -> [keys]
const cache = new Map();    // id -> message (antidelete)
const lastCmd = new Map();  // `${number}:${jid}` -> { name, args }
const lastText = new Map(); // anti-spam
const stats = {};           // stats groupes (.kirabot)

const withFooter = (t) => t + FOOTER;

async function waImage(sock, jid, url, caption, quoted) {
  const buf = await getImg(url);
  if (buf) { try { return await sock.sendMessage(jid, { image: buf, caption: withFooter(caption) }, { quoted }); } catch (e) { console.error('waImage', e.message); } }
  return sock.sendMessage(jid, { text: withFooter(caption) }, { quoted });
}

// ── Registre de commandes : cat, nom, description COURTE (pour le menu WhatsApp)
const CMDS = {};
const CATS = [['GROUP', '👥'], ['FUN', '🎭'], ['GENERAL', '⚙️'], ['AI', '🧠'], ['TOOLS', '🧰'], ['SYSTEM', '🖥️']];
function cmd(cat, name, desc, opts, run) {
  if (typeof opts === 'function') { run = opts; opts = {}; }
  CMDS[name] = { cat, name, desc, ...opts, run };
}

// ── MENU WHATSAPP (design différent du menu Telegram)
function menuText(s) {
  const total = Object.keys(CMDS).length;
  let t =
`╭━━━━━━━━━━━━━━━━━━━━━━⬣
┃  ▉ *${s.name}* ▉
╰━━━━━━━━━━━━━━━━━━━━━━⬣

╭──〔 📡 *INFOS BOT* 〕
┃ ✅ BOT ➜ Connecté 🤖
┃ 🟢 STATUS ➜ OPEN
┃ 📅 DATE ➜ ${fmtDate()}
┃ ▰▰▰▰▰▰▰▰▰▰
┃ ➠ Auteur : ${AUTHOR} 🌐
┃ ➠ Prefix : [ ${s.prefix} ]
┃ ➠ Total Cmds : [ ${total} ]
╰──────────────────⬣
`;
  for (const [cat, ico] of CATS) {
    t += `\n> ╢ ${ico} *${cat}* ♰\n╭▰▰▰▰▰▰▰◈\n`;
    for (const x of Object.values(CMDS).filter((k) => k.cat === cat)) t += `┆❏ *${s.prefix}${x.name}* ➜ ${x.desc}\n`;
    t += '╰▰▰▰▰▰▰▰◈\n';
  }
  t += `\n═══════════════════\n        END…… 🌐\n═══════════════════\n🤖 Teste mon bot Telegram :\n${BOT_LINK}\n📢 Ma chaîne : ${LINKS.waChannel}`;
  return t;
}

// ── Helpers
const isAdminIn = (meta, jid) => !!meta?.participants?.find((p) => num(p.id) === num(jid))?.admin;
function targetOf(ctx) {
  const ci = ctx.msg.extendedTextMessage?.contextInfo;
  if (ci?.mentionedJid?.length) return ci.mentionedJid[0];
  if (ci?.participant && ci?.quotedMessage) return ci.participant;
  const n = (ctx.args.find((a) => /^\+?\d{6,15}$/.test(a)) || '').replace('+', '');
  return n ? toJid(n) : null;
}
async function downloadQuotedOrSelf(ctx, type) {
  const ci = ctx.msg.extendedTextMessage?.contextInfo;
  const holder = ci?.quotedMessage?.[type]
    ? { key: { remoteJid: ctx.jid, id: ci.stanzaId, participant: ci.participant }, message: ci.quotedMessage }
    : ctx.msg[type] ? ctx.m : null;
  if (!holder) return null;
  return downloadMediaMessage(holder, 'buffer', {}, { logger, reuploadRequest: ctx.sock.updateMediaMessage });
}
const toSticker = (buf) => sharp(buf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
const extraImg = (c, text) => waImage(c.sock, c.jid, IMG_EXTRA, text, c.m);

// ═══════════════ GROUP ═══════════════
const G = { group: true };
const GA = { group: true, admin: true, owner: true };

cmd('GROUP', 'add', 'ajoute un numéro 👤', GA, async (c) => {
  const n = (c.args[0] || '').replace(/\D/g, ''); if (!n) return c.reply('Usage : .add 242XXXXXXXX');
  await c.sock.groupParticipantsUpdate(c.jid, [toJid(n)], 'add'); c.react('👤');
});
const toggle = (name, desc, key, react) =>
  cmd('GROUP', name, desc, GA, (c) => {
    const g = groupOf(c.s, c.jid); g[key] = !g[key]; saveDb(); c.react(react);
    c.reply(`${name.toUpperCase()} ➜ ${g[key] ? 'activé ✅' : 'désactivé ❌'}`);
  });
toggle('antilink', 'supprime les liens + avertit ⚠️', 'antilink', '⚠️');
toggle('antispam', 'supprime les messages répétés 🚫', 'antispam', '🚫');
toggle('antitag', 'désactive le tag 🏷', 'antitag', '🏷');
toggle('goodbye', 'message d’au revoir 🫂', 'goodbye', '🫂');
cmd('GROUP', 'del', 'supprime les 10 derniers messages 🗑', GA, async (c) => {
  for (const k of (recent.get(c.jid) || []).slice(-10)) { try { await c.sock.sendMessage(c.jid, { delete: k }); await sleep(400); } catch {} }
  recent.set(c.jid, []);
});
cmd('GROUP', 'ppgroup', 'photo du groupe 🌆', G, async (c) => {
  try { await waImage(c.sock, c.jid, await c.sock.profilePictureUrl(c.jid, 'image'), c.meta.subject, c.m); } catch { c.reply('Ce groupe n’a pas de photo.'); }
});
cmd('GROUP', 'groupinfo', 'infos du groupe 🎤', G, (c) =>
  c.reply(`🎤 *${c.meta.subject}*\n👥 Membres : ${c.meta.participants.length}\n👑 Admins : ${c.meta.participants.filter((p) => p.ad
