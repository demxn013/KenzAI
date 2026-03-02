# KenzAI Discord Bot — User Guide

Welcome! This README is for **Discord users and staff** who want to know what commands exist, what they do, and when to use them.

---

## Quick Start

1. Type `/` in Discord to open slash commands.
2. Pick a command from this bot (for example `/application`, `/member view`, `/points balance`).
3. Fill command options if needed.
4. For interactive commands, use the buttons/select menus the bot shows.

---

## Command List (User-Friendly)

## 👋 Basic

### `/ping`
Checks whether the bot is online.

**Use it for:** quick health check.

---

## 📝 Applications

### `/application`
Posts the application starter panel so users can open an application ticket.

**What happens next:**
- User clicks **Apply**.
- Bot opens a ticket + modal questions.
- Staff can accept/reject.
- On acceptance, user/member records and roles are updated.

**Use it for:** onboarding new members.

---

## 🏛️ Empire Info

### `/yazanaki`
Shows Yazanaki Empire summary information (leadership + population stats).

**Use it for:** a quick public overview of the empire.

---

## 🆔 Empire ID System

### `/empireid reserve`
Reserve a YZNK ID number.

### `/empireid update`
Update who an ID belongs to (Discord and/or Minecraft).

### `/empireid view`
View details for one Empire ID.

### `/empireid lookup`
Find a user's Empire ID by Discord or Minecraft identity.

### `/empireid list`
List IDs (can be filtered).

### `/empireid stats`
Show ID system statistics.

**Use it for:** ID assignment and record keeping.

---

## 🎖️ Draft System

### `/draft view`
View one member's draft status.

### `/draft list`
List active drafts.

### `/draft cancel`
Cancel a draft and promote to Citizen.

### `/draft complete`
Force-complete a draft (with outcome).

### `/draft stats`
Show draft system totals.

### `/draft config`
Show current draft timing/settings.

### `/draft toggle-testing`
Switch testing mode on/off (short test durations).

**Use it for:** managing draft progress, reminders, and completion.

---

## 🧑 Member Management

### `/member view`
View a member profile by Discord user or Minecraft username.

### `/member kick`
Kick a member from Yazanaki Empire (reapply cooldown applies).

### `/member ban`
Permanently ban a member from Yazanaki clans.

**Use it for:** member moderation and lookups.

---

## 🏰 Clan Commands

### `/clan add`
Create/register a new clan.

### `/clan edit`
Edit clan info (name, abbreviation, roles, flag, server, mode).

### `/clan remove`
Delete a clan entry.

### `/clan view`
View one clan.

### `/clan list`
List all clans.

### `/clan sync-residents`
One-time sync of resident counts from member records.

**Use it for:** clan setup and maintenance.

---

## ⚖️ Judiciary / Court

### `/court ...`
Main legal workflow command with grouped subcommands (case lifecycle):

- **case**: create/view/list/assign/dismiss
- **investigation**: add findings, verify findings, complete investigation
- **verdict**: propose/finalize verdict decisions
- **signoff**: approval/rejection and status tracking
- **enforcement**: execute/verify/close/pardon

**Use it for:** structured judicial case handling.

> Note: Many court actions are restricted to specific judiciary roles.

---

## 🔗 Account Linking

### `/link username:<minecraft_name>`
Link your Discord account to your Minecraft username.

**Use it for:** identity sync across bot systems.

### `/autolink-test ...` (staff/debug)
Troubleshooting command set for checking/forcing/bulk autolink.

**Use it for:** diagnosing link issues (typically admins/staff only).

---

## 💎 Points Economy

### `/points balance`
See your current points.

### `/points shop`
Open the rewards shop menu.

### `/points checkin`
Claim periodic check-in rewards.

### `/points invite`
Get your invite link and earn points from valid invites.

### `/points add` (admin)
Grant points manually.

**Use it for:** rewards, progression, and engagement perks.

---

## 🎮 Server Stats

### `/server`
Shows supported game servers and buttons for server/team/player stats.

**Use it for:** viewing in-game server data (for configured servers).

---

## 🧩 Roles Configuration (Staff/Admin)

### `/roles add`
Add current guild to role detection config.

### `/roles update`
Refresh role detection from Discord.

### `/roles remove`
Remove a guild from role detection.

### `/roles list`
List configured guilds.

### `/roles view`
View this guild's role config.

### `/roles categorize`
Set a role as rank/status category.

**Use it for:** maintaining role mapping and detection behavior.

---

## Who can use what?

In general:
- **Everyone:** `/ping`, `/yazanaki`, `/link`, most `/points` user actions, and viewing commands.
- **Staff/Admin:** moderation/config commands like `/member kick`, `/member ban`, `/clan ...`, `/roles ...`, `/autolink-test`, and most `/court` actions.

If a command fails due to permissions, contact server staff.

---

## Common user flows

### New member applying
1. Staff runs `/application` to post the apply panel.
2. User clicks Apply and submits modal.
3. Staff reviews ticket and accepts/rejects.

### Linking your account
1. Run `/link username:<your_mc_name>`.
2. Confirm bot response.
3. Use linked systems (member lookup, server tools, etc.).

### Earning points
1. Run `/points checkin` regularly.
2. Use `/points invite` and invite valid members.
3. Spend with `/points shop`.

---

## Need help?

If you're unsure which command to use, start with:
- `/yazanaki` for overview,
- `/member view` for person lookups,
- `/points balance` for economy,
- `/application` for onboarding.

Then follow the buttons/prompts from the bot.
