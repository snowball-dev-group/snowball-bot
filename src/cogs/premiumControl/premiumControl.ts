import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, DiscordAPIError } from "discord.js";
import { command, Category } from "../utils/help";
import { init, checkPremium, givePremium, deletePremium, isPremium as isPremiumUser } from "../utils/premium";
import { getLogger, EmbedType, escapeDiscordMarkdown, resolveGuildRole } from "../utils/utils";
import { generateLocalizedEmbed, localizeForUser, humanizeDurationForUser } from "../utils/ez-i18n";
import { setPreferenceValue as setGuildPref, getPreferenceValue as getGuildPref, removePreference as delGuildPref } from "../utils/guildPrefs";
import { createConfirmationMessage } from "../utils/interactive";
import * as timestring from "timestring";
import * as moment from "moment-timezone";
import { messageToExtra } from "../utils/failToDetail";

const PREMIUMCTRL_PREFIX = `!premiumctl`;

const whoCan = [$botConfig.botOwner];

function isAdm(msg: Message) {
	return isChat(msg) && whoCan.indexOf(msg.author.id) !== -1;
}

function checkServerAdmin(msg: Message) {
	return isChat(msg) && msg.member && msg.member.hasPermission(["ADMINISTRATOR", "MANAGE_CHANNELS", "MANAGE_GUILD", "MANAGE_ROLES"]);
}

function isChat(msg: Message) {
	return msg.channel.type === "text";
}

interface IPlgCfg {
	whoCanGive: string[];
}

@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} checkout`, "loc:PREMIUMCTL_META_CHECKOUT", {
	"loc:PREMIUMCTL_META_MENTION": {
		optional: true,
		description: "loc:PREMIUMCTL_META_CHECKOUT_ARG0_DESC",
		specialCheck: isAdm
	}
}, isChat)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} give`, "", {
	"loc:PREMIUMCTL_META_MENTION": {
		optional: false,
		description: "loc:PREMIUMCTL_META_GIVE_ARG0_DESC"
	},
	"loc:PREMIUMCTL_META_GIVE_ARG1": {
		optional: false,
		description: "loc:PREMIUMCTL_META_GIVE_ARG1_DESC"
	}
}, isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} renew`, "loc:PREMIUMCTL_META_RENEW", {
	"loc:PREMIUMCTL_META_MENTION": {
		optional: false,
		description: "loc:PREMIUMCTL_META_RENEW_ARG0_DESC"
	},
	"loc:PREMIUMCTL_META_RENEW_ARG1": {
		optional: false,
		description: "loc:PREMIUMCTL_META_RENEW_ARG1_DESC"
	}
}, isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} delete`, "loc:PREMIUMCTL_META_DELETE", {
	"loc:PREMIUMCTL_META_MENTION": {
		optional: false,
		description: "loc:PREMIUMCTL_META_DELETE_ARG0_DESC"
	}
}, isAdm)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} role`, "loc:PREMIUMCTL_META_ROLE", {
	"loc:PREMIUMCTL_META_ROLE_ARG0": {
		optional: false,
		description: "loc:PREMIUMCTL_META_ROLE_ARG0_DESC",
		values: ["loc:PREMIUMCTL_META_ROLE_ARG0_VALUES0", "none"]
	}
}, checkServerAdmin)
@command(Category.Premium, `${PREMIUMCTRL_PREFIX.slice(1)} resync`, "loc:PREMIUMCTL_META_RESYNC", undefined, isAdm)
class PremiumControl extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.premiumctl";
	}

	log = getLogger("PremiumControl");

	constructor(cfg) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		}, true);

		if(cfg) {
			for(const w of (cfg as IPlgCfg).whoCanGive) {
				if(!whoCan.includes(w)) { whoCan.push(w); }
			}
		}

		// this.init();
	}

	// ================================
	// MESSAGE HANDLING
	// ================================

	async onMessage(msg: Message) {
		if(msg.channel.type !== "text") { return; }
		if(!msg.content || !msg.content.startsWith(PREMIUMCTRL_PREFIX)) { return; }
		const args = msg.content.split(" ");
		if(args.length === 1 && args[0] === PREMIUMCTRL_PREFIX) {
			return;
		}
		args.shift();
		try {
			switch(args.shift()) {
				// give <#12345678901234>, 1mth
				case "give": return await this.givePremium(msg, args);
				// remove <#12345678901234>
				case "remove": return await this.removePremium(msg);
				// renew <#12345678901234>, 1mth
				case "renew": return await this.renewPremium(msg, args);
				// checkout <#12345678901234>
				case "checkout": return await this.checkoutPremium(msg);
				// resync
				case "resync": return await this.runResync(msg);
				// role
				case "role": return await this.setPremiumRole(msg, args);
			}
		} catch(err) {
			this.log("err", "Error due running command `", msg.content + "`:", err);
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_STARTFAILED")
			});
			$snowball.captureException(err, { extra: messageToExtra(msg) });
		}
	}

	// ================================
	// MAIN COMMANDS
	// ================================

	async setPremiumRole(msg: Message, args: string[]) {
		if(!checkServerAdmin(msg)) {
			// NO PERMISSIONS
			return;
		}
		
		const botMember = msg.guild.members.get($discordBot.user.id);
		
		if(!botMember) {
			throw new Error("Unexpected behaviour, should have botMember set as GuildMember but got nothing");
		}

		if(!botMember.permissions.hasPermission("MANAGE_ROLES")) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_NOPERMS")
			});
			return;
		}

		// premiumctl:role
		if(args[0].toLowerCase() !== "none") {
			const role = await resolveGuildRole(args[0], msg.guild, false);
			if(!role) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_NOTFOUND")
				});
				return;
			}

			if(role.managed) {
				msg.channel.send("" , {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_MANAGED")
				});
				return;
			}

			if(role.calculatedPosition > botMember.highestRole.calculatedPosition) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_SETROLE_ROLEHIGHER")
				});
				return;
			}

			const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
				key: "PREMIUMCTL_SETROLE_SETCONFIRMATION",
				formatOptions: {
					roleName: escapeDiscordMarkdown(role.name, true)
				}
			});
			const confirmation = await createConfirmationMessage(confirmationEmbed, msg);

			if(!confirmation) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
				});
				return;
			}

			const currentPremiumRole = await getGuildPref(msg.guild, "premiumctl:role");
			if(currentPremiumRole) {
				const premiumRole = msg.guild.roles.get(currentPremiumRole);
				if(premiumRole) {
					const progMsg = (await msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_SETROLE_NONEREMOVING")
					})) as Message;
					for(const member of msg.guild.members.values()) {
						try {
							await member.removeRole(premiumRole);
						} catch(err) {
							this.log("err", `Failed to unassign current premium role from user "${member.displayName}" on guild "${msg.guild.name}"`);
						}
					}
					await progMsg.delete();
				}
			}

			await setGuildPref(msg.guild, "premiumctl:role", role.id);

			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_SETROLE_DONE")
			});

			this.performGuildSync(msg.guild);
		} else {
			const currentPremiumRole = await getGuildPref(msg.guild, "premiumctl:role");
			if(!currentPremiumRole) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_SETROLE_ERR_NOTSET")
				});
				return;
			}

			const premiumRole = msg.guild.roles.get(currentPremiumRole);
			if(premiumRole) {
				const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
					key: "PREMIUMCTL_SETROLE_SETCONFIRMATION",
					formatOptions: {
						roleName: escapeDiscordMarkdown(premiumRole.name, true)
					}
				});

				const confirmation = await createConfirmationMessage(confirmationEmbed, msg);
				if(!confirmation) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
					});
					return;
				}

				const removingMsg = (await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_SETROLE_NONEREMOVING")
				})) as Message;

				for(const member of msg.guild.members.values()) {
					try {
						await member.removeRole(premiumRole);
					} catch(err) {
						this.log("err", `Failed to unassign premium role from user "${member.displayName}" on guild "${msg.guild.name}"`);
					}
				}

				await removingMsg.delete();
			}

			await delGuildPref(msg.guild, "premiumctl:role");
		}
	}

	async runResync(msg: Message) {
		const _pgMsg = (await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_SYNCING")
		})) as Message;
		await this.performGuildsSync();
		_pgMsg.edit("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_SYNC_DONE")
		});
	}

	async givePremium(msg: Message, args: string[], internalCall = false) {
		if(!isAdm(msg)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_ERR_PERMS")
			});
			return;
		}
		// args: ["<#12345678901234>,", "1mth"]
		if(!internalCall) {
			args = args.join(" ").split(",").map(arg => arg.trim()); // args: ["<#12345678901234>", "1mth"]
			if(args.length !== 2) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
						key: "PREMIUMCTL_GIVE_USAGE",
						formatOptions: {
							prefix: PREMIUMCTRL_PREFIX
						}
					})
				});
				return;
			}
			if(msg.mentions.users.size !== 1) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_MENTIONS")
				});
				return;
			}
		}

		const subscriber = msg.mentions.users.first();
		let currentPremium = await checkPremium(subscriber);
		if(currentPremium) {
			const dtString = moment(currentPremium.due_to, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
			const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
				key: "PREMIUMCTL_GIVE_CONFIRMATION",
				formatOptions: {
					untilDate: dtString,
					prefix: PREMIUMCTRL_PREFIX
				}
			});
			const confirmation = await createConfirmationMessage(confirmationEmbed, msg);
			if(!confirmation) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
				});
				return;
			}
		}

		const cDate = new Date(Date.now() + (timestring(args[1]) * 1000));
		let dtString = moment(cDate, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
		let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			key: "PREMIUMCTL_GIVE_CONFIRMATION1",
			formatOptions: {
				username: escapeDiscordMarkdown(subscriber.username),
				untilDate: dtString
			}
		});
		let confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
			});
			return;
		}

		const _cMsg = (await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_PLSWAIT")
		})) as Message;

		const complete = await givePremium(subscriber, cDate, true);

		if(!complete) {
			_cMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_GIVE_ERR_CONSOLE")
			});
			return;
		}

		await _cMsg.edit("", {
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_LOADING")
		});

		currentPremium = await checkPremium(subscriber);

		if(!currentPremium) {
			_cMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_GIVE_ERR_INTERNAL")
			});
			return;
		}

		dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
		const dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");

		let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n----------------\n`;
		msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
			subscribedAt: dtSubString
		})) + "\n";
		msgStr += await localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
			validUntil: dtString
		});

		await _cMsg.edit("", {
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_FINALCONFIRMATION")
		});
		confirmationEmbed = await generateLocalizedEmbed(EmbedType.Information, msg.member, {
			custom: true,
			string: msgStr
		});
		confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if(!confirmation) {
			_cMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_SMTNGWNTWRNG")
			});
			return;
		}
		_cMsg.edit("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_GIVE_DONE")
		});
	}

	async renewPremium(msg: Message, args: string[]) {
		if(!isAdm(msg)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_PERMS")
			});
			return;
		}
		// args: ["<#12345678901234>,", "1mth"]
		args = args.join(" ").split(",").map(arg => arg.trim()); // args: ["<#12345678901234>", "1mth"]
		if(args.length !== 2) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREMIUMCTL_RENEW_USAGE",
					formatOptions: {
						prefix: PREMIUMCTRL_PREFIX
					}
				})
			});
			return;
		}
		if(msg.mentions.users.size !== 1) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_MENTIONS")
			});
			return;
		}

		const subscriber = msg.mentions.users.first();
		let currentPremium = await checkPremium(subscriber);

		if(!currentPremium) {
			const _redirectMsg = await (msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_GIVE_REDIRECT")
			})) as Message;
			setTimeout(() => _redirectMsg.delete(), 5000);
			await this.givePremium(msg, args, true);
			return;
		}

		let cDate = new Date(currentPremium.due_to.getTime() + (timestring(args[1]) * 1000));
		let dtString = moment(cDate, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
		let confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			key: "PREMIUMCTL_RENEW_CONFIRMATION",
			formatOptions: {
				username: escapeDiscordMarkdown(subscriber.username),
				untilDate: dtString
			}
		});
		let confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_CANCELED")
			});
			return;
		}

		let complete = false;
		try {
			complete = await givePremium(subscriber, cDate, false);
		} catch(err) {
			if((err as Error).name === "ERR_PREMIUM_DIFFLOW") {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_TIMEDIFF0")
				});
			}
			return;
		}

		const _cMsg = (await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_RENEW_PROGRESS_STARTED")
		})) as Message;

		if(!complete) {
			_cMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_CONSOLE")
			});
			return;
		}

		await _cMsg.edit("", {
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_LOADING")
		});

		currentPremium = await checkPremium(subscriber);

		if(!currentPremium) {
			_cMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_RENEW_ERR_UNKNOWN")
			});
			return;
		}

		dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
		const dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");

		let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n----------------\n`;
		msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
			subscribedAt: dtSubString
		})) + "\n";
		msgStr += await localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
			validUntil: dtString
		});

		await _cMsg.edit("", {
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "PREMIUMCTL_GIVE_FINALCONFIRMATION")
		});
		confirmationEmbed = await generateLocalizedEmbed(EmbedType.Information, msg.member, {
			custom: true,
			string: msgStr
		});
		confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if(!confirmation) {
			_cMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_SMTNGWNTWRNG")
			});
			return;
		}
		_cMsg.edit("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_RENEW_DONE")
		});
	}

	async checkoutPremium(msg: Message) {
		if(isAdm(msg) && msg.mentions.users.size > 1) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_CHECKOUT_ERR_MENTIONS")
			});
			return;
		} else if(!isAdm(msg) && msg.mentions.users.size !== 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_CHECKOUT_ERR_NOTADM")
			});
			return;
		}

		const subscriber = msg.mentions.users.size === 0 ? msg.author : msg.mentions.users.first();

		const currentPremium = await checkPremium(subscriber);

		if(!currentPremium) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_CHECKOUT_ERR_NOTPREMIUMUSER")
			});
			return;
		}

		const dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
		const dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
		const durString = await humanizeDurationForUser(msg.member, currentPremium.due_to.getTime() - Date.now());

		let msgStr = "";
		msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
			subscribedAt: dtSubString
		})) + "\n";
		msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
			validUntil: dtString
		})) + "\n";
		msgStr += await localizeForUser(msg.member, "PREMIUMCTL_CHECKOUT_VALIDTIME", {
			validTime: durString
		});

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
				custom: true,
				string: msgStr
			}, {
					author: {
						name: subscriber.tag
					}
				})
		});
	}

	async removePremium(msg: Message) {
		if(!isAdm(msg)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREMIUMCTL_ERR_PERMS")
			});
			return;
		}
		if(msg.mentions.users.size !== 1) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_MENTION")
			});
			return;
		}

		const subscriber = msg.mentions.users.first();

		const currentPremium = await checkPremium(subscriber);
		if(!currentPremium) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_NOTPREMIUMUSER")
			});
			return;
		}

		const dtString = moment(currentPremium.due_to).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
		const dtSubString = moment(currentPremium.subscribed_at).tz("Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
		const durString = await humanizeDurationForUser(msg.member, currentPremium.due_to.getTime() - Date.now());

		const sep = "----------------";
		let msgStr = `${escapeDiscordMarkdown(subscriber.username)}\n${sep}\n`;
		msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_SUBBEDAT", {
			subscribedAt: dtSubString
		})) + "\n";
		msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_VLDUNTL", {
			validUntil: dtString
		})) + "\n";
		msgStr += (await localizeForUser(msg.member, "PREMIUMCTL_CHECKOUT_VALIDTIME", {
			validTime: durString
		})) + "\n";
		msgStr += `${sep}\n`;
		msgStr += await localizeForUser(msg.member, "PREMIUMCTL_REMOVE_CONFIRMATION");

		const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			custom: true,
			string: msgStr
		});
		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_ERR_CANCELED")
			});
			return;
		}

		try {
			await deletePremium(subscriber);
		} catch(err) {
			if((err as Error).name === "PREMIUM_ALRDYNTSUB") {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREMIUMCTL_REMOVE_ERR_ALREADYUNSUBBED")
				});
			}
			return;
		}

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "PREMIUMCTL_REMOVE_DONE")
		});
	}

	// ================================
	// MISC STUFF
	// ================================

	async performGuildSync(guild: Guild, noLog = false) {
		if(!noLog) { this.log("info", `Started role sync on guild "${guild.name}"`); }
		const guildPremiumRole = await getGuildPref(guild, "premiumctl:role");
		if(!guildPremiumRole) {
			if(!noLog) { this.log("warn", "Guild doesn't has premium role"); }
			return {
				done: false,
				err: "noPremiumRole"
			};
		}

		let done = 0;

		const premiumRole = guild.roles.get(guildPremiumRole);

		// checks

		if(!premiumRole) {
			this.log("warn", "Premium role was deleted on guild", guild.id);
			await delGuildPref(guild, "premiumctl:role");
			return;
		}

		if(!guild.me.permissions.hasPermission("MANAGE_ROLES")) {
			this.log("warn", "Bot doesn't has permission to manage roles on guild", guild.id);
			await delGuildPref(guild, "premiumctl:role");
			return;
		}

		if(premiumRole.managed) {
			this.log("warn", "Premium role is managed, means controlled by integration", guild.id);
			await delGuildPref(guild, "premiumctl:role");
			return;
		}

		if(premiumRole.calculatedPosition >= guild.me.highestRole.calculatedPosition) {
			this.log("warn", "Premium role is above bot's one, so bot can't give it");
			await delGuildPref(guild, "premiumctl:role");
			return;
		}

		// sync

		for(const member of guild.members.values()) {
			if(member.highestRole.calculatedPosition >= guild.me.highestRole.calculatedPosition) {
				// we can't give role to member because this member has role highness that ours
				done++;
				continue;
			}

			const isPremium = await isPremiumUser(member);
			if(isPremium && !member.roles.has(guildPremiumRole)) {
				try {
					await member.addRole(premiumRole);
					done++;
				} catch(err) {
					if(err instanceof DiscordAPIError) {
						let breakSync = false;
						switch(err.code) {
							case 10011: {
								// role was deleted, deleting ctl pref
								await delGuildPref(guild, "permiumctl:role");
								breakSync = true;
							} break;
						}

						if(breakSync) { break; }
					}
					this.log("err", `Failed to assign premium role to member "${member.displayName}"...`);
				}
			} else if(!isPremium && member.roles.has(guildPremiumRole)) {
				try {
					await member.removeRole(premiumRole);
					done++;
				} catch(err) {
					this.log("err", `Failed to unassign premium role from member "${member.displayName}"...`);
				}
			} else {
				done++;
			}
		}

		let donePerc = (done / guild.members.size) * 100;
		if(donePerc < 50) {
			if(!noLog) { this.log("warn", "Errors due syncing for more than 50% members of guild"); }
			return {
				done: false,
				err: "moreThan50PercFailed"
			};
		}

		if(!noLog) { this.log("ok", "Sync complete without errors"); }
		return {
			done: true,
			err: undefined
		};
	}

	async performGuildsSync(noLog = false) {
		if(!noLog) { this.log("info", "Performing role sync in guilds..."); }
		for(const guild of $discordBot.guilds.values()) {
			try {
				await this.performGuildSync(guild, noLog);
			} catch(err) {
				this.log("err", `Role sync failed at guild "${guild.name}"`, err);
				$snowball.captureException(err, { extra: { guildId: guild.id } });
			}
		}
	}

	// ================================
	// PLUGIN FUNCTIONS
	// ================================

	roleSyncInterval: NodeJS.Timer;

	async init() {
		const subpluginInit = await init();
		if(!subpluginInit) {
			this.log("err", "Subplugin initalization failed");
			return;
		}
		this.roleSyncInterval = setInterval(() => this.performGuildsSync(true), 3600000);
		await this.performGuildsSync();
		this.handleEvents();
	}

	async unload() {
		clearInterval(this.roleSyncInterval);
		this.unhandleEvents();
		return true;
	}
}

module.exports = PremiumControl;