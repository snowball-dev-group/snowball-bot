import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Plugin } from "../plugin";
import { Message, Guild, DiscordAPIError } from "discord.js";
import { command } from "@utils/help";
import * as Premium from "@utils/premium";
import * as Utils from "@utils/utils";
import * as i18n from "@utils/ez-i18n";
import * as GuildPreferences from "@utils/guildPreferences";
import * as Interactive from "@utils/interactive";
import { messageToExtra } from "@utils/failToDetail";
import { DateTime } from "luxon";
import * as timestring from "timestring";
import * as getLogger from "loggy";

const PREMIUMCTRL_PREFIX = `!premiumctl`;
const ALLOWED_TO_CONTROL = [$botConfig.botOwner];
const HELP_CATEGORY = "PREMIUM";

const isChat = (msg: Message) => msg.channel.type === "text";
const isPluginAdmin = (msg: Message) => isChat(msg) && ALLOWED_TO_CONTROL.indexOf(msg.author.id) !== -1;
const serverAdminCheck = (msg: Message) => isChat(msg) && msg.member && msg.member.permissions.has(["ADMINISTRATOR", "MANAGE_CHANNELS", "MANAGE_GUILD", "MANAGE_ROLES"]);

interface IPluginConfig { whoCanGive: string[]; }

@command(HELP_CATEGORY, `${PREMIUMCTRL_PREFIX.slice(1)} checkout`, "loc:PREMIUMCTL_META_CHECKOUT", {
	"loc:PREMIUMCTL_META_MENTION": {
		optional: true,
		description: "loc:PREMIUMCTL_META_CHECKOUT_ARG0_DESC",
		specialCheck: isPluginAdmin
	}
}, isChat)
@command(HELP_CATEGORY, `${PREMIUMCTRL_PREFIX.slice(1)} give`, "", {
	"loc:PREMIUMCTL_META_MENTION": {
		optional: false,
		description: "loc:PREMIUMCTL_META_GIVE_ARG0_DESC"
	},
	"loc:PREMIUMCTL_META_GIVE_ARG1": {
		optional: false,
		description: "loc:PREMIUMCTL_META_GIVE_ARG1_DESC"
	}
}, isPluginAdmin)
@command(HELP_CATEGORY, `${PREMIUMCTRL_PREFIX.slice(1)} renew`, "loc:PREMIUMCTL_META_RENEW", {
	"loc:PREMIUMCTL_META_MENTION": {
		optional: false,
		description: "loc:PREMIUMCTL_META_RENEW_ARG0_DESC"
	},
	"loc:PREMIUMCTL_META_RENEW_ARG1": {
		optional: false,
		description: "loc:PREMIUMCTL_META_RENEW_ARG1_DESC"
	}
}, isPluginAdmin)
@command(HELP_CATEGORY, `${PREMIUMCTRL_PREFIX.slice(1)} delete`, "loc:PREMIUMCTL_META_DELETE", {
	"loc:PREMIUMCTL_META_MENTION": {
		optional: false,
		description: "loc:PREMIUMCTL_META_DELETE_ARG0_DESC"
	}
}, isPluginAdmin)
@command(HELP_CATEGORY, `${PREMIUMCTRL_PREFIX.slice(1)} role`, "loc:PREMIUMCTL_META_ROLE", {
	"loc:PREMIUMCTL_META_ROLE_ARG0": {
		optional: false,
		description: "loc:PREMIUMCTL_META_ROLE_ARG0_DESC",
		values: ["loc:PREMIUMCTL_META_ROLE_ARG0_VALUES0", "none"]
	}
}, serverAdminCheck)
@command(HELP_CATEGORY, `${PREMIUMCTRL_PREFIX.slice(1)} resync`, "loc:PREMIUMCTL_META_RESYNC", undefined, isPluginAdmin)
class PremiumControl extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.premiumctl";
	}

	private readonly log = getLogger("PremiumControl");

	constructor(cfg: IPluginConfig) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		}, true);

		if (!cfg) { return; }
		
		for (const w of cfg.whoCanGive) {
			!ALLOWED_TO_CONTROL.includes(w) && ALLOWED_TO_CONTROL.push(w);
		}

		// this.init();
	}

	// ================================
	// MESSAGE HANDLING
	// ================================

	private async onMessage(msg: Message) {
		if (msg.channel.type !== "text") { return; }
		if (!msg.content || !msg.content.startsWith(PREMIUMCTRL_PREFIX)) { return; }

		const args = msg.content.split(" ");
		if (args.length === 1 && args[0] === PREMIUMCTRL_PREFIX) { return; }

		args.shift();

		try {
			switch (args.shift()) {
				// give <#12345678901234>, 1mth
				case "give": return this.cmd_give(msg, args);
				// remove <#12345678901234>
				case "remove": return this.cmd_remove(msg);
				// renew <#12345678901234>, 1mth
				case "renew": return this.cmd_renew(msg, args);
				// checkout <#12345678901234>
				case "checkout": return this.cmd_checkout(msg);
				// resync
				case "resync": return this.cmd_resync(msg);
				// role
				case "role": return this.cmd_role(msg, args);
			}
		} catch (err) {
			this.log("err", `Error due running command \`${msg.content}\`:`, err);
			
			$snowball.captureException(err, { extra: messageToExtra(msg) });

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_STARTFAILED")
			});
		}
	}

	// ================================
	// MAIN COMMANDS
	// ================================

	private async cmd_role(msg: Message, args: string[]) {
		if (!serverAdminCheck(msg)) {
			// NO PERMISSIONS

			return;
		}

		const botMember = msg.guild.members.get($discordBot.user.id);

		if (!botMember) {
			throw new Error("Unexpected behaviour, should have botMember set as GuildMember but got nothing");
		}

		if (!botMember.permissions.has("MANAGE_ROLES")) {
			return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_NOPERMS")
			});
		}

		if (args.length === 0) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, {
					key: "PREMIUMCTL_SETROLE_DESC",
					formatOptions: {
						prefix: PREMIUMCTRL_PREFIX
					}
				})
			});
		}

		// premiumctl:role
		if (args[0].toLowerCase() !== "none") {
			const role = Utils.resolveGuildRole(args[0], msg.guild, false);
			if (!role) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_NOTFOUND")
				});
			}

			if (role.managed) {
				return msg.channel.send("" , {
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_MANAGED")
				});
			}

			if (role.position > botMember.roles.highest.position) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_ROLEHIGHER")
				});
			}

			const confirmationEmbed = await i18n.generateLocalizedEmbed(Utils.EmbedType.Question, msg.member, {
				key: "PREMIUMCTL_SETROLE_SETCONFIRMATION",
				formatOptions: {
					roleName: Utils.escapeDiscordMarkdown(role.name, true)
				}
			});
			const confirmation = await Interactive.createConfirmationMessage(confirmationEmbed, msg);

			if (!confirmation) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
				});
			}

			const currentPremiumRole = await GuildPreferences.getPreferenceValue(msg.guild, "premiumctl:role");

			if (currentPremiumRole) {
				const premiumRole = msg.guild.roles.get(currentPremiumRole);

				if (premiumRole) {
					const progMsg = <Message> await msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_SETROLE_NONEREMOVING")
					});

					for (const member of msg.guild.members.values()) {
						try {
							await member.roles.remove(premiumRole);
						} catch (err) {
							this.log("err", `Failed to unassign current premium role from user "${member.displayName}" on guild "${msg.guild.name}"`);
						}
					}

					await progMsg.delete();
				}
			}

			await GuildPreferences.setPreferenceValue(msg.guild, "premiumctl:role", role.id);

			msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_SETROLE_DONE")
			});

			return this.performGuildSync(msg.guild);
		} else {
			const currentPremiumRole = await GuildPreferences.getPreferenceValue(msg.guild, "premiumctl:role");
			if (!currentPremiumRole) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, "PREMIUMCTL_SETROLE_ERR_NOTSET")
				});
			}

			const premiumRole = msg.guild.roles.get(currentPremiumRole);
			if (premiumRole) {
				const confirmationEmbed = await i18n.generateLocalizedEmbed(Utils.EmbedType.Question, msg.member, {
					key: "PREMIUMCTL_SETROLE_SETCONFIRMATION",
					formatOptions: {
						roleName: Utils.escapeDiscordMarkdown(premiumRole.name, true)
					}
				});

				const confirmation = await Interactive.createConfirmationMessage(confirmationEmbed, msg);
				if (!confirmation) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
					});
				}

				const removingMsg = <Message> await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_SETROLE_NONEREMOVING")
				});

				for (const member of msg.guild.members.values()) {
					try {
						await member.roles.remove(premiumRole);
					} catch (err) {
						this.log("err", `Failed to unassign premium role from user "${member.displayName}" on guild "${msg.guild.name}"`);
					}
				}

				await removingMsg.delete();
			}

			return GuildPreferences.removePreference(msg.guild, "premiumctl:role");
		}
	}

	private async cmd_resync(msg: Message) {
		const _pgMsg = <Message> await msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_SYNCING")
		});

		await this.performGuildsSync();

		return _pgMsg.edit("", {
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_SYNC_DONE")
		});
	}

	private async cmd_give(msg: Message, args: string[], internalCall = false) {
		if (!isPluginAdmin(msg)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_ERR_PERMS")
			});
		}

		// args: ["<#12345678901234>,", "1mth"]
		if (!internalCall) {
			args = args.join(" ").split(",").map(arg => arg.trim()); // args: ["<#12345678901234>", "1mth"]

			if (args.length !== 2) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, {
						key: "PREMIUMCTL_GIVE_USAGE",
						formatOptions: {
							prefix: PREMIUMCTRL_PREFIX
						}
					})
				});
			}

			if (msg.mentions.users.size !== 1) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_MENTIONS")
				});
			}
		}

		// we have already checked if message contains at least one mention
		// FIXME: still add additional check in case, more handling is nice
		const subscriber = msg.mentions.users.first()!;

		let currentPremium = await Premium.checkPremium(subscriber);

		if (currentPremium) {
			const dtString = await i18n.toUserLocaleString(msg.member, currentPremium.due_to, DateTime.DATETIME_FULL);

			const confirmationEmbed = await i18n.generateLocalizedEmbed(Utils.EmbedType.Question, msg.member, {
				key: "PREMIUMCTL_GIVE_CONFIRMATION",
				formatOptions: {
					untilDate: dtString,
					prefix: PREMIUMCTRL_PREFIX
				}
			});

			const confirmation = await Interactive.createConfirmationMessage(confirmationEmbed, msg);

			if (!confirmation) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
				});
			}
		}

		const cDate = DateTime.local().plus({
			seconds: timestring(args[1])
		});

		let dtString = await i18n.toUserLocaleString(msg.member, cDate, DateTime.DATETIME_FULL);

		let confirmationEmbed = await i18n.generateLocalizedEmbed(Utils.EmbedType.Question, msg.member, {
			key: "PREMIUMCTL_GIVE_CONFIRMATION1",
			formatOptions: {
				username: Utils.escapeDiscordMarkdown(subscriber.username),
				untilDate: dtString
			}
		});

		let confirmation = await Interactive.createConfirmationMessage(confirmationEmbed, msg);

		if (!confirmation) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
			});
		}

		const _cMsg = <Message> await msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_PLSWAIT")
		});

		const complete = await Premium.givePremium(subscriber, cDate.toJSDate(), true);

		if (!complete) {
			return _cMsg.edit("", {
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_GIVE_ERR_CONSOLE")
			});
		}

		await _cMsg.edit("", {
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_LOADING")
		});

		currentPremium = await Premium.checkPremium(subscriber);

		if (!currentPremium) {
			return _cMsg.edit("", {
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_GIVE_ERR_INTERNAL")
			});
		}

		dtString = await i18n.toUserLocaleString(msg.member, currentPremium.due_to, DateTime.DATETIME_FULL);

		const dtSubString = await i18n.toUserLocaleString(msg.member, currentPremium.subscribed_at, DateTime.DATETIME_FULL);

		let msgStr = `${Utils.escapeDiscordMarkdown(subscriber.username)}\n----------------\n`;

		msgStr += `${await i18n.localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
			subscribedAt: dtSubString
		})}\n`;

		msgStr += await i18n.localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
			validUntil: dtString
		});

		await _cMsg.edit("", {
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_FINALCONFIRMATION")
		});

		confirmationEmbed = await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, {
			custom: true,
			string: msgStr
		});

		confirmation = await Interactive.createConfirmationMessage(confirmationEmbed, msg);

		if (!confirmation) {
			return _cMsg.edit("", {
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_SMTNGWNTWRNG")
			});
		}
		

		return _cMsg.edit("", {
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_GIVE_DONE")
		});
	}

	private async cmd_renew(msg: Message, args: string[]) {
		if (!isPluginAdmin(msg)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_PERMS")
			});
		}
		// args: ["<#12345678901234>,", "1mth"]
		args = args.join(" ").split(",").map(arg => arg.trim()); // args: ["<#12345678901234>", "1mth"]
		if (args.length !== 2) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, {
					key: "PREMIUMCTL_RENEW_USAGE",
					formatOptions: {
						prefix: PREMIUMCTRL_PREFIX
					}
				})
			});
		}
		if (msg.mentions.users.size !== 1) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_MENTIONS")
			});
		}

		const subscriber = msg.mentions.users.first()!;
		let currentPremium = await Premium.checkPremium(subscriber);

		if (!currentPremium) {
			const _redirectMsg = <Message> await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, "PREMIUMCTL_GIVE_REDIRECT")
			});

			setTimeout(() => _redirectMsg.delete(), 5000);

			return this.cmd_give(msg, args, true);
		}

		const cDate = DateTime.fromMillis(Date.now()).plus({
			seconds: timestring(args[1])
		});

		let dtString = await i18n.toUserLocaleString(msg.member, cDate, DateTime.DATETIME_FULL);

		let confirmationEmbed = await i18n.generateLocalizedEmbed(Utils.EmbedType.Question, msg.member, {
			key: "PREMIUMCTL_RENEW_CONFIRMATION",
			formatOptions: {
				username: Utils.escapeDiscordMarkdown(subscriber.username),
				untilDate: dtString
			}
		});

		let confirmation = await Interactive.createConfirmationMessage(confirmationEmbed, msg);
		if (!confirmation) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
			});
		}

		let complete = false;

		try {
			complete = await Premium.givePremium(subscriber, cDate.toJSDate(), false);
		} catch (err) {
			if ((<Error> err).name === "ERR_PREMIUM_DIFFLOW") {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_TIMEDIFF0")
				});
			}

			return;
		}

		const _cMsg = <Message> await msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_RENEW_PROGRESS_STARTED")
		});

		if (!complete) {
			return _cMsg.edit("", {
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_CONSOLE")
			});
		}

		await _cMsg.edit("", {
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_LOADING")
		});

		currentPremium = await Premium.checkPremium(subscriber);

		if (!currentPremium) {
			return _cMsg.edit("", {
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_UNKNOWN")
			});
		}

		dtString = await i18n.toUserLocaleString(msg.member, currentPremium.due_to, DateTime.DATETIME_FULL);
		const dtSubString = await i18n.toUserLocaleString(msg.member, currentPremium.subscribed_at, DateTime.DATETIME_FULL);

		let msgStr = `${Utils.escapeDiscordMarkdown(subscriber.username)}\n----------------\n`;
		msgStr += `${await i18n.localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
			subscribedAt: dtSubString
		})}\n`;
		msgStr += await i18n.localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
			validUntil: dtString
		});

		await _cMsg.edit("", {
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_FINALCONFIRMATION")
		});
		confirmationEmbed = await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, {
			custom: true,
			string: msgStr
		});
		confirmation = await Interactive.createConfirmationMessage(confirmationEmbed, msg);
		if (!confirmation) {
			return _cMsg.edit("", {
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_SMTNGWNTWRNG")
			});
		}
		

		return _cMsg.edit("", {
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_RENEW_DONE")
		});
	}

	private async cmd_checkout(msg: Message) {
		if (isPluginAdmin(msg) && msg.mentions.users.size > 1) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, "PREMIUMCTL_CHECKOUT_ERR_MENTIONS")
			});
		} else if (!isPluginAdmin(msg) && msg.mentions.users.size !== 0) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, "PREMIUMCTL_CHECKOUT_ERR_NOTADM")
			});
		}

		const subscriber = msg.mentions.users.size === 0 ? msg.author : msg.mentions.users.first();

		if (!subscriber) { return; }

		const currentPremium = await Premium.checkPremium(subscriber);

		if (!currentPremium) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_CHECKOUT_ERR_NOTPREMIUMUSER")
			});
		}

		const dtString = await i18n.toUserLocaleString(msg.member, currentPremium.due_to, DateTime.DATETIME_FULL);
		const dtSubString = await i18n.toUserLocaleString(msg.member, currentPremium.subscribed_at, DateTime.DATETIME_FULL);
		const durString = await i18n.humanizeDurationForUser(msg.member, currentPremium.due_to.getTime() - Date.now());

		let msgStr = "";
		msgStr += `${await i18n.localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
			subscribedAt: dtSubString
		})}\n`;
		msgStr += `${await i18n.localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
			validUntil: dtString
		})}\n`;
		msgStr += await i18n.localizeForUser(msg.member, "PREMIUMCTL_CHECKOUT_VALIDTIME", {
			validTime: durString
		});

		msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, {
				custom: true,
				string: msgStr
			}, { author: { name: subscriber.tag } })
		});
	}

	private async cmd_remove(msg: Message) {
		if (!isPluginAdmin(msg)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Error, msg.member, "PREMIUMCTL_ERR_PERMS")
			});
		}
		if (msg.mentions.users.size !== 1) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_MENTION")
			});
		}

		const subscriber = msg.mentions.users.first();

		if (!subscriber) { return; }

		const currentPremium = await Premium.checkPremium(subscriber);
		if (!currentPremium) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_NOTPREMIUMUSER")
			});
		}

		const dtString = await i18n.toUserLocaleString(msg.member, currentPremium.due_to, DateTime.DATETIME_FULL);
		const dtSubString = await i18n.toUserLocaleString(msg.member, currentPremium.subscribed_at, DateTime.DATETIME_FULL);
		const durString = await i18n.humanizeDurationForUser(msg.member, currentPremium.due_to.getTime() - Date.now());

		const sep = "----------------";
		let msgStr = `${Utils.escapeDiscordMarkdown(subscriber.username)}\n${sep}\n`;
		msgStr += `${await i18n.localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
			subscribedAt: dtSubString
		})}\n`;
		msgStr += `${await i18n.localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
			validUntil: dtString
		})}\n`;
		msgStr += `${await i18n.localizeForUser(msg.member, "PREMIUMCTL_CHECKOUT_VALIDTIME", {
			validTime: durString
		})}\n`;
		msgStr += `${sep}\n`;
		msgStr += await i18n.localizeForUser(msg.member, "PREMIUMCTL_REMOVE_CONFIRMATION");

		const confirmationEmbed = await i18n.generateLocalizedEmbed(Utils.EmbedType.Question, msg.member, {
			custom: true,
			string: msgStr
		});
		const confirmation = await Interactive.createConfirmationMessage(confirmationEmbed, msg);

		if (!confirmation) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
			});
		}

		try {
			await Premium.deletePremium(subscriber);
		} catch (err) {
			if ((<Error> err).name === "PREMIUM_ALRDYNTSUB") {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_ALREADYUNSUBBED")
				});
			}

			return;
		}

		msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(Utils.EmbedType.OK, msg.member, "PREMIUMCTL_REMOVE_DONE")
		});
	}

	// ================================
	// MISC STUFF
	// ================================

	public async performGuildSync(guild: Guild, noLog = false) {
		const logPrefix = `Sync (${guild.id}):`;

		if (!guild.available) {
			this.log("warn", logPrefix, `Guild "${guild.name}" is unavailable`);

			return;
		}

		const guildPremiumRole = await GuildPreferences.getPreferenceValue(guild, "premiumctl:role");
		if (!guildPremiumRole) {
			return {
				done: false,
				err: "noPremiumRole"
			};
		}

		if (!noLog) { this.log("info", logPrefix, `Started role sync on "${guild.name}"`); }

		let done = 0;
		let reused = 0;
		let fetched = 0;

		const premiumRole = guild.roles.get(guildPremiumRole);

		// checks

		if (!premiumRole) {
			this.log("warn", logPrefix, "Premium role was deleted on guild", guild.id);

			return GuildPreferences.removePreference(guild, "premiumctl:role");
		}

		if (!guild.me.permissions.has("MANAGE_ROLES")) {
			this.log("warn", logPrefix, "Bot has no permission to manage roles on guild", guild.id);

			return GuildPreferences.removePreference(guild, "premiumctl:role");
		}

		if (premiumRole.managed) {
			this.log("warn", logPrefix, "Premium role is managed, means controlled by integration", guild.id);

			return GuildPreferences.removePreference(guild, "premiumctl:role");
		}

		const highestBotsRole = guild.me.roles.highest;

		if (premiumRole.position >= highestBotsRole.position) {
			this.log("warn", logPrefix, "Premium role is above bot's one, so bot can't give it");

			return GuildPreferences.removePreference(guild, "premiumctl:role");
		}

		// sync

		for (const member of guild.members.values()) {
			const highestMemberRole = member.roles.highest;
			if (highestMemberRole && (highestMemberRole.position >= highestBotsRole.position)) {
				// we can't give role to member because this member has role highness that ours
				done++;
				continue;
			}

			const premiumResponse = await Premium.getPremium(member);

			// counting
			if (premiumResponse.source === "db") {
				fetched++;
			} else {
				reused++;
			}

			if (premiumResponse.result && !member.roles.has(guildPremiumRole)) {
				try {
					if (!noLog) { this.log("info", logPrefix, `${member.id} (${member.user.tag}) has no premium role, adding...`); }
					await member.roles.add(premiumRole, await i18n.localizeForGuild(member.guild, "PREMIUMCTL_AUDITLOG_PREMIUM"));
				} catch (err) {
					if (err instanceof DiscordAPIError) {
						let breakSync = false;
						switch (err.code) {
							case 10011: {
								// role was deleted, deleting ctl pref
								await GuildPreferences.removePreference(guild, "permiumctl:role");
								breakSync = true;
							} break;
						}

						if (breakSync) { break; }
					}
					this.log("err", logPrefix, `Failed to assign premium role to member "${member.displayName}"...`);
				}
				done++;
			} else if (!premiumResponse.result && member.roles.has(guildPremiumRole)) {
				try {
					if (!noLog) { this.log("info", logPrefix, `${member.id} (${member.user.tag}) has premium role without premium, removing...`); }
					await member.roles.remove(premiumRole, await i18n.localizeForGuild(member.guild, "PREMIUMCTL_AUDITLOG_NOTPREMIUM"));
					done++;
				} catch (err) {
					this.log("err", logPrefix, `Failed to unassign premium role from member "${member.displayName}"...`);
				}
			} else {
				done++;
			}
		}

		const donePerc = (done / guild.members.size) * 100;
		if (donePerc < 50) {
			if (!noLog) { this.log("warn", logPrefix, "Errors due syncing for more than 50% members of guild"); }

			return {
				done: false,
				err: "moreThan50PercFailed"
			};
		}

		if (!noLog) { this.log("ok", logPrefix, `Sync complete without errors: ${fetched} fetched, ${reused} reused`); }

		return {
			done: true,
			err: undefined
		};
	}

	public async performGuildsSync(noLog = false) {
		if (!noLog) { this.log("info", "Performing role sync in guilds..."); }

		const guilds = Array.from($discordBot.guilds.values()).sort((g1, g2) => {
			return g1.memberCount - g2.memberCount;
		});

		for (const guild of guilds) {
			try {
				await this.performGuildSync(guild, noLog);
			} catch (err) {
				this.log("err", `Role sync failed at guild "${guild.name}"`, err);
				$snowball.captureException(err, { extra: { guildId: guild.id } });
			}
		}
	}

	// ================================
	// PLUGIN FUNCTIONS
	// ================================

	private roleSyncInterval: NodeJS.Timer;

	public async init() {
		const subpluginInit = await Premium.init();
		if (!subpluginInit) {
			this.log("err", "Subplugin initalization failed");

			return;
		}
		this.roleSyncInterval = setInterval(() => this.performGuildsSync(true), 3600000);
		await this.performGuildsSync();
		this.handleEvents();
	}

	public async unload() {
		clearInterval(this.roleSyncInterval);
		this.unhandleEvents();

		return true;
	}
}

module.exports = PremiumControl;
