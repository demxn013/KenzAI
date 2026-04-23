// modules/emojis/emoji.js
// /emoji steal | remove — bulk custom emoji copy/delete (paste <:name:id> / <a:name:id>)

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");

/** Max emojis processed per invocation (slash string allows up to 6000 chars). */
const EMOJI_BATCH_CAP = 30;

/** Delay between Discord API calls to reduce rate limits. */
const OP_DELAY_MS = 350;

const CUSTOM_EMOJI_RE = /<a?:([^:<>]+):(\d+)>/g;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse all custom emoji tokens; dedupe by snowflake (first occurrence wins for name).
 * @param {string} raw
 * @returns {{ id: string, name: string, animated: boolean }[]}
 */
function parseCustomEmojiTags(raw) {
  if (!raw || typeof raw !== "string") return [];
  const byId = new Map();
  let m;
  CUSTOM_EMOJI_RE.lastIndex = 0;
  while ((m = CUSTOM_EMOJI_RE.exec(raw)) !== null) {
    const name = m[1];
    const id = m[2];
    const animated = m[0].startsWith("<a:");
    if (!byId.has(id)) byId.set(id, { id, name, animated });
  }
  return [...byId.values()];
}

/**
 * Discord emoji names: 2–32 chars, [a-zA-Z0-9_]
 * @param {string} name
 * @returns {string}
 */
function sanitizeEmojiName(name) {
  let s = String(name)
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (s.length > 32) s = s.slice(0, 32);
  if (s.length < 2) {
    s = `e_${String(name).replace(/\W/g, "").slice(0, 6) || "x"}`.slice(0, 32);
  }
  if (s.length < 2) s = "em";
  return s.slice(0, 32);
}

function hasExpressionPerms(member) {
  if (!member || !member.permissions) return false;
  return member.permissions.any(
    PermissionsBitField.Flags.ManageGuildExpressions |
      PermissionsBitField.Flags.CreateGuildExpressions
  );
}

function buildSummaryEmbed({ title, okLines, skipLines, failLines, color }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color ?? 0x5865f2)
    .setTimestamp(new Date());

  const okText = okLines.length
    ? okLines.slice(0, 20).join("\n") + (okLines.length > 20 ? `\n… +${okLines.length - 20} more` : "")
    : "—";
  const skipText = skipLines.length
    ? skipLines.slice(0, 15).join("\n") + (skipLines.length > 15 ? `\n… +${skipLines.length - 15} more` : "")
    : "—";
  const failText = failLines.length
    ? failLines.slice(0, 15).join("\n") + (failLines.length > 15 ? `\n… +${failLines.length - 15} more` : "")
    : "—";

  embed.addFields(
    { name: "Done", value: okText.slice(0, 1024) || "—", inline: false },
    { name: "Skipped", value: skipText.slice(0, 1024) || "—", inline: false },
    { name: "Failed", value: failText.slice(0, 1024) || "—", inline: false }
  );
  return embed;
}

const emojisOption = (sub) =>
  sub
    .addStringOption((opt) =>
      opt
        .setName("emojis")
        .setDescription(
          `Paste custom emojis (<:name:id> or <a:name:id>). Up to ${EMOJI_BATCH_CAP} per run.`
        )
        .setRequired(true)
        .setMaxLength(6000)
    );

module.exports = {
  data: new SlashCommandBuilder()
    .setName("emoji")
    .setDescription("Manage custom emojis in this server")
    .addSubcommand((sub) =>
      emojisOption(
        sub
          .setName("steal")
          .setDescription("Copy emojis from other servers the bot is in into this server")
      )
    )
    .addSubcommand((sub) =>
      emojisOption(
        sub
          .setName("remove")
          .setDescription("Delete emojis from this server (by pasted <:name:id> tokens)")
      )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const raw = interaction.options.getString("emojis", true);

    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ This command can only be used in a server.",
        ephemeral: true,
      });
    }

    const member = interaction.member;
    if (!hasExpressionPerms(member)) {
      return interaction.reply({
        content:
          "❌ You need **Manage Expressions** (or **Create Expressions**) to use this command.",
        ephemeral: true,
      });
    }

    const me = interaction.guild.members.me;
    if (!me || !hasExpressionPerms(me)) {
      return interaction.reply({
        content:
          "❌ I need **Manage Expressions** or **Create Expressions** in this server to add or remove emojis.",
        ephemeral: true,
      });
    }

    const parsedAll = parseCustomEmojiTags(raw);
    if (parsedAll.length === 0) {
      return interaction.reply({
        content:
          "❌ No custom emoji tags found. Paste tags like `<:name:123456789>` or `<a:name:123456789>` (from emoji picker or another message).",
        ephemeral: true,
      });
    }

    const truncated = parsedAll.length > EMOJI_BATCH_CAP;
    const parsed = parsedAll.slice(0, EMOJI_BATCH_CAP);

    await interaction.deferReply({ ephemeral: true });

    if (sub === "steal") {
      await runSteal(interaction, parsed, truncated);
    } else if (sub === "remove") {
      await runRemove(interaction, parsed, truncated);
    } else {
      await interaction.editReply({ content: "❌ Unknown subcommand." });
    }
  },
};

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ id: string, name: string, animated: boolean }[]} parsed
 * @param {boolean} truncated
 */
async function runSteal(interaction, parsed, truncated) {
  const guild = interaction.guild;
  const client = interaction.client;

  const okLines = [];
  const skipLines = [];
  const failLines = [];

  let i = 0;
  for (const { id, name } of parsed) {
    if (i++ > 0) await sleep(OP_DELAY_MS);

    const src = client.emojis.cache.get(id);
    if (!src) {
      skipLines.push(`\`${id}\` — not visible to the bot (wrong id or bot not in that server)`);
      continue;
    }
    if (src.managed) {
      skipLines.push(`${src} — managed (integration); cannot copy`);
      continue;
    }

    let baseName = sanitizeEmojiName(name);
    let created = null;
    let lastErr = null;

    for (let attempt = 0; attempt < 6 && !created; attempt++) {
      const tryName =
        attempt === 0 ? baseName : sanitizeEmojiName(`${baseName}_${attempt + 1}`);
      try {
        created = await guild.emojis.create({
          attachment: src.url,
          name: tryName,
          reason: `Emoji steal by ${interaction.user.tag} (${interaction.user.id})`,
        });
      } catch (err) {
        lastErr = err;
      }
    }

    if (created) {
      okLines.push(`${created} \`${created.name}\``);
    } else {
      const msg = lastErr?.message || String(lastErr);
      failLines.push(`\`${sanitizeEmojiName(name)}\` (${id}): ${msg.slice(0, 120)}`);
    }
  }

  const title =
    "Emoji steal — done" + (truncated ? ` (first ${EMOJI_BATCH_CAP} only)` : "");
  const embed = buildSummaryEmbed({
    title,
    okLines,
    skipLines,
    failLines,
    color: 0x57f287,
  });
  if (truncated) {
    embed.setFooter({ text: `More than ${EMOJI_BATCH_CAP} tags were pasted; run again for the rest.` });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ id: string, name: string, animated: boolean }[]} parsed
 * @param {boolean} truncated
 */
async function runRemove(interaction, parsed, truncated) {
  const guild = interaction.guild;

  const okLines = [];
  const skipLines = [];
  const failLines = [];

  let i = 0;
  for (const { id } of parsed) {
    if (i++ > 0) await sleep(OP_DELAY_MS);

    const emoji = guild.emojis.cache.get(id);
    if (!emoji) {
      skipLines.push(`\`${id}\` — not in this server`);
      continue;
    }
    if (emoji.managed) {
      skipLines.push(`${emoji} — managed; cannot delete via bot`);
      continue;
    }

    try {
      const tag = emoji.toString();
      const nm = emoji.name;
      await emoji.delete(
        `Emoji remove by ${interaction.user.tag} (${interaction.user.id})`
      );
      okLines.push(`Removed ${tag} \`${nm}\``);
    } catch (err) {
      failLines.push(`\`${id}\`: ${String(err?.message || err).slice(0, 120)}`);
    }
  }

  const title =
    "Emoji remove — done" + (truncated ? ` (first ${EMOJI_BATCH_CAP} only)` : "");
  const embed = buildSummaryEmbed({
    title,
    okLines,
    skipLines,
    failLines,
    color: 0xed4245,
  });
  if (truncated) {
    embed.setFooter({ text: `More than ${EMOJI_BATCH_CAP} tags were pasted; run again for the rest.` });
  }

  await interaction.editReply({ embeds: [embed] });
}
