import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, TextChannel, GuildMember } from "discord.js";
import { command } from "../utils/help";
import { localizeForUser, generateLocalizedEmbed } from "../utils/ez-i18n";
import { simpleCmdParse, canBeSnowflake } from "../utils/text";
import { EmbedType, getLogger, escapeDiscordMarkdown } from "../utils/utils";
import { setPreferenceValue as setGuildPref, getPreferenceValue as getGuildPref, removePreference as delGuildPref } from "../utils/guildPrefs";
import * as parseTime from "timestring";
import * as moment from "moment-timezone";
import { createConfirmationMessage } from "../utils/interactive";

const POSSIBLE_CHAT_ROOMS = ["admins", "admin-channel", "admin_channel", "admins-chat", "admins_chat", "admin", "mod-channel", "mods-channel", "mods", "mods-chat", "mod_chat", "chat", "general"];
const HELP_CATEGORY = "WHITELIST";

export enum WHITELIST_STATE {
	/**
	 * Guild is listed in plugin options and cannot be left by bot itself
	 */
	IMMORTAL,
	/**
	 * Guild is listed in options and cannot be left by bot iteself
	 */
	UNLIMITED,
	/**
	 * Guild has limited time that can expire, then bot should leave guild
	 */
	LIMITED,
	/**
	 * Guild has limited time (trial) that can expire, then bot should leave guild
	 */
	TRIAL,
	/**
	 * Guild had limited time (trial) that expired, so bot should leave guild
	 */
	TRIAL_EXPIRED,
	/**
	 * Guild had limited time that expired, so bot should leave guild
	 */
	EXPIRED,
	/**
	 * Guild is banned to join, bot should leave this guild immediately without any warnings
	 */
	BANNED,
	/**
	 * Guild has unknown status, so bot deciding to leave or stay on guild
	 */
	UNKNOWN,
	/**
	 * Whitelist is disabled and guild on bypass
	 */
	BYPASS
}

enum WhitelistModes {
	Whitelist = 2,
	TrialAllowed = 4,
	NoBotFarms = 8,
	NoLowMembers = 16,
	NoMaxMembers = 32
}

interface IParsedMode {
	whitelist: boolean;
	noBotFarms: boolean;
	trialAllowed: boolean;
	noLowMembers: boolean;
	noMaxMembers: boolean;
}

const allowedModes = ["whitelist", "nobotfarms", "trial", "nolowmembers", "nomaxmembers"];

function isBotAdmin(msg: Message) {
	return msg.author.id === $botConfig.botOwner;
}

function isServerAdmin(msg: Message) {
	return msg.channel.type === "text" && (msg.member.permissions.has(["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_ROLES", "MANAGE_CHANNELS"]) || msg.author.id === $botConfig.botOwner);
}

@command(HELP_CATEGORY, "sb_pstatus", "loc:WHITELIST_META_PSTATUS", undefined, isServerAdmin)
@command(HELP_CATEGORY, "whitelist", "loc:WHITELIST_META_WHITELIST", {
	"loc:WHITELIST_META_WHITELIST_ARG0": {
		optional: false,
		description: "loc:WHITELIST_META_WHITELIST_ARG0_DESC",
		values: ["ban", "activate", "deactivate", "mode"]
	},
	"loc:WHITELIST_META_WHITELIST_ARG1": {
		optional: false,
		description: "loc:WHITELIST_META_WHITELIST_ARG1_DESC"
	}
}, isBotAdmin)
export class Whitelist extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.whitelist";
	}

	log = getLogger("Whitelist");

	alwaysWhitelisted: string[] = [];
	minMembersRequired = 50;
	maxMembersAllowed = 25000;
	botsThreshold = 70;
	defaultMode = WhitelistModes.NoBotFarms
				| WhitelistModes.NoLowMembers
				| WhitelistModes.NoMaxMembers
				| WhitelistModes.TrialAllowed
				| WhitelistModes.Whitelist;
	currentMode: IParsedMode | undefined = undefined;
	signupUrl = "no_link";
	trialTime = 86400000;

	constructor(options) {
		super({
			"message": (msg: Message) => this.onMessage(msg),
			"guildCreate": (guild: Guild) => this.joinedGuild(guild)
		});
		if(options) {
			{
				const alwaysWhitelisted = options["always_whitelisted"];
				if(alwaysWhitelisted && alwaysWhitelisted instanceof Array) {
					for(const g of alwaysWhitelisted as string[]) {
						this.alwaysWhitelisted.push(g);
					}
				}
			}
			{
				const minMembers = options["min_members"];
				if(minMembers !== undefined && typeof minMembers === "number") {
					this.minMembersRequired = Math.max(0, minMembers);
				}
			}
			{
				const maxMembers = options["max_members"];
				if(maxMembers !== undefined && typeof maxMembers === "number") {
					this.maxMembersAllowed = Math.max(0, maxMembers);
				}
			}
			{
				const botsThreshold = options["bots_threshold"];
				if(botsThreshold !== undefined && typeof botsThreshold === "number") {
					this.botsThreshold = Math.max(0, Math.min(100, botsThreshold));
				}
			}
			{
				const defaultMode = options["default_mode"];
				if(defaultMode !== undefined && typeof defaultMode === "number") {
					this.defaultMode = defaultMode;
				}
			}
			{
				const url = options["signup_url"];
				if(url !== undefined && typeof url === "string") {
					this.signupUrl = url;
				} else { throw new Error("No sign up link provided"); }
			}
			{
				const trialTime = options["trial_time"];
				if(trialTime !== undefined && typeof trialTime === "number") {
					this.trialTime = options["trial_time"];
				}
			}
		} else { throw new Error("Setup required"); }

		this.log("info", "Whitelist module is here to protect your mod");
		this.log("info", " Required members to stay:", this.minMembersRequired, "-", this.maxMembersAllowed);
		this.log("info", " Always whitelisted servers:");
		for(const whitelistedId of this.alwaysWhitelisted) {
			const found = !!$discordBot.guilds.get(whitelistedId);
			this.log(found ? "ok" : "warn", "  -", whitelistedId, found ? "(found)" : "(not found)");
		}
	}

	async fetchCurrentMode() {
		let mode = await getGuildPref("global", "whitelist:mode", true) as number | undefined;
		if(typeof mode !== "number") { mode = this.defaultMode; }
		this.currentMode = this.parseMode(mode);
		return this.currentMode;
	}

	async joinedGuild(guild: Guild) {
		this.log("info", `Joined guild "${guild.name}" (${guild.members.size} members)`);
		const whitelistStatus = await this.isWhitelisted(guild);
		if(whitelistStatus.state === WHITELIST_STATE.UNKNOWN || whitelistStatus.state === WHITELIST_STATE.BYPASS) {
			// how about to give guild limited time?
			// or check if it full of boooooooootz
			await this.tryToGiveTrial(guild);
		} else if(whitelistStatus.state === WHITELIST_STATE.TRIAL_EXPIRED) {
			this.leaveGuild(guild, "WHITELIST_LEAVE_TRIALEXPIRED1");
		} else if(whitelistStatus.state === WHITELIST_STATE.EXPIRED) {
			this.leaveGuild(guild, "WHITELIST_LEAVE_EXPIRED1");
		} else if(whitelistStatus.state === WHITELIST_STATE.BANNED) {
			this.leaveGuild(guild);
		}
	}

	async isWhitelisted(guild: Guild): Promise<{
		ok: boolean,
		state: WHITELIST_STATE,
		until: null | number;
	}> {
		let mode = this.currentMode;
		if(!mode) { mode = await this.fetchCurrentMode(); }
		if(this.alwaysWhitelisted.includes(guild.id)) {
			return {
				ok: true,
				state: WHITELIST_STATE.IMMORTAL,
				until: null
			};
		}
		const whitelistStatus = await getGuildPref(guild, "whitelist:status", true) as WHITELIST_STATE;
		const whitelistedUntil = await getGuildPref(guild, "whitelist:until", true) as number | null;
		if(!whitelistStatus) {
			return {
				ok: false,
				state: WHITELIST_STATE.UNKNOWN,
				until: null
			};
		}
		if(whitelistStatus === WHITELIST_STATE.BANNED) {
			return {
				ok: false,
				state: WHITELIST_STATE.BANNED,
				until: null
			};
		} else if(!mode.whitelist) {
			return {
				ok: true,
				state: WHITELIST_STATE.BYPASS,
				until: null
			};
		} else if(whitelistStatus === WHITELIST_STATE.UNLIMITED) {
			return {
				ok: true,
				state: WHITELIST_STATE.UNLIMITED,
				until: null
			};
		} 
		if(whitelistedUntil && whitelistedUntil < Date.now()) {
			return {
				ok: false,
				state: whitelistStatus === WHITELIST_STATE.TRIAL ? WHITELIST_STATE.TRIAL_EXPIRED : WHITELIST_STATE.EXPIRED,
				until: whitelistedUntil
			};
		}
		return {
			ok: true,
			state: whitelistStatus,
			until: whitelistedUntil
		};
	}

	checkInterval: NodeJS.Timer;

	async init() {
		this.currentMode = await this.fetchCurrentMode();
		this.checkInterval = setInterval(() => this.checkGuilds(), 1800000);
		await this.checkGuilds();
	}

	async checkGuilds() {
		for(const g of $discordBot.guilds.values()) {
			const whitelistStatus = await this.isWhitelisted(g);
			if(whitelistStatus.state === WHITELIST_STATE.EXPIRED) {
				await this.leaveGuild(g, "WHITELIST_LEAVE_EXPIRED");
			} else if(whitelistStatus.state === WHITELIST_STATE.TRIAL_EXPIRED) {
				await this.leaveGuild(g, "WHITELIST_LEAVE_TRIALEXPIRED");
			} else if(whitelistStatus.state === WHITELIST_STATE.BANNED) {
				await this.leaveGuild(g);
			} else if(whitelistStatus.state === WHITELIST_STATE.UNKNOWN) {
				await this.tryToGiveTrial(g);
			}
		}
	}

	calculateBotsPercentage(guild: Guild) {
		let bots = 0;

		for(const member of guild.members.values()) {
			if(member.user.bot) { bots++; }
		}

		return Math.round((bots / guild.members.size) * 100);
	}

	async tryToGiveTrial(guild: Guild) {
		let mode = this.currentMode;
		if(!mode) { mode = await this.fetchCurrentMode(); }
		if(mode.noBotFarms && this.calculateBotsPercentage(guild) > this.botsThreshold) {
			await this.leaveGuild(guild, "WHITELIST_LEAVE_BOTFARM");
			return;
		} else if(mode.noLowMembers && guild.members.size < this.minMembersRequired) {
			await this.leaveGuild(guild, "WHITELIST_LEAVE_NOMEMBERS");
			return;
		} else if(mode.noMaxMembers && guild.members.size > this.maxMembersAllowed) {
			await this.leaveGuild(guild, "WHITELIST_LEAVE_MANYMEMBERS");
			return;
		}
		if(mode.whitelist) {
			await setGuildPref(guild, "whitelist:status", WHITELIST_STATE.TRIAL);
			const endDate = Date.now() + this.trialTime;
			await setGuildPref(guild, "whitelist:until", endDate);
			this.log("info", `Activated trial on guild "${guild.name}"`);
		}
	}

	async sendMsg(guild: Guild, embed) {
		let chToSendMessage: TextChannel | undefined = undefined;

		for(const toCheck of POSSIBLE_CHAT_ROOMS) {
			chToSendMessage = (guild.channels.find((ch) => {
				return ch.name.includes(toCheck) && ch.type === "text";
			})) as TextChannel;
			if(chToSendMessage) { break; }
		}

		if(chToSendMessage) {
			try {
				await chToSendMessage.send("", { embed });
			} catch(err) {
				$snowball.captureException(err, {
					level: "warning",
					extra: { guildId: guild, embed }
				});
				this.log("warn", `Failed to send message to channel ${chToSendMessage.name} (${chToSendMessage.id})`);
			}
		}
	}

	async leaveGuild(guild: Guild, reason?: string) {
		if(reason) {
			await this.sendMsg(guild, await generateLocalizedEmbed(EmbedType.Warning, guild.owner, {
				key: reason,
				formatOptions: {
					serverName: escapeDiscordMarkdown(guild.name, true),
					formUrl: this.signupUrl
				}
			}));
		}

		await guild.leave();
		this.log("ok", `Left guild "${guild.name}"`);
	}

	isAdmin(m: GuildMember) {
		return m.permissions.has(["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_ROLES", "MANAGE_CHANNELS"]) || m.id === $botConfig.botOwner;
	}

	async onMessage(msg: Message) {
		if(msg.content === "!sb_pstatus" && this.isAdmin(msg.member)) {
			const whitelistInfo = await this.isWhitelisted(msg.guild);
			let str = "#" + (await localizeForUser(msg.member, "WHITELIST_INFO_HEADER", {
				guildName: escapeDiscordMarkdown(msg.guild.name, true)
			})) + "\n";
			str += (await localizeForUser(msg.member, "WHITELIST_INFO_STATUS")) + " ";
			switch(whitelistInfo.state) {
				case WHITELIST_STATE.BANNED: {
					str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_BANNED");
				} break;
				case WHITELIST_STATE.IMMORTAL: {
					str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_IMMORTAL");
				} break;
				case WHITELIST_STATE.LIMITED: {
					str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_LIMITED");
				} break;
				case WHITELIST_STATE.TRIAL: {
					str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_TRIAL");
				} break;
				case WHITELIST_STATE.UNLIMITED: {
					str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_UNLIMITED");
				} break;
				case WHITELIST_STATE.BYPASS: {
					str += await localizeForUser(msg.member, "WHITELIST_INFO_STATUS_BYPASS");
				}
			}
			if(whitelistInfo.state === WHITELIST_STATE.LIMITED || whitelistInfo.state === WHITELIST_STATE.TRIAL) {
				str += "\n";
				const endString = moment(whitelistInfo.state, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");
				str += await localizeForUser(msg.member, "WHITELIST_INFO_UNTIL", {
					endDate: endString
				});
			}
			await msg.channel.send(str, {
				code: "md"
			});
			return;
		}

		if(msg.author.id !== $botConfig.botOwner) { return; }

		const cmd = simpleCmdParse(msg.content);

		if(cmd.command !== "!whitelist") { return; }

		const u = msg.member || msg.author;

		if(cmd.subCommand === "activate") {
			if(cmd.args && cmd.args.length === 2) {
				if(!canBeSnowflake(cmd.args[0])) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_ACTIVATE_WRONGID")
					});
					return;
				}
				if(cmd.args[1] === "forever") {
					const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, u, {
						key: "WHITELIST_ACTIVATE_CONFIRM_FOREVER",
						formatOptions: {
							serverId: cmd.args[0]
						}
					}), msg);
					if(!confirmation) {
						msg.channel.send("", {
							embed: await generateLocalizedEmbed(EmbedType.OK, u, "WHITELIST_CANCELED")
						});
						return;
					}
					await setGuildPref(cmd.args[0], "whitelist:status", WHITELIST_STATE.UNLIMITED);
				} else {
					const time = parseTime(cmd.args[1], "ms");
					const endTime = new Date(Date.now() + time);

					const endString = moment(endTime, "Europe/Moscow").format("D.MM.YYYY HH:mm:ss (UTCZ)");

					const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, u, {
						key: "WHITELIST_ACTIVATE_CONFIRM_LIMITED",
						formatOptions: {
							timeString: endString,
							serverId: cmd.args[0]
						}
					}), msg);

					if(!confirmation) {
						msg.channel.send("", {
							embed: await generateLocalizedEmbed(EmbedType.OK, u, "WHITELIST_CANCELED")
						});
						return;
					}

					await setGuildPref(cmd.args[0], "whitelist:until", endTime);
					await setGuildPref(cmd.args[0], "whitelist:status", WHITELIST_STATE.LIMITED);
				}

				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.OK, u, {
						key: "WHITELIST_ACTIVATED",
						formatOptions: {
							serverId: cmd.args[0]
						}
					})
				});
			} else {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_ACTIVATE_USAGE")
				});
			}
		} else if(cmd.subCommand === "deactivate") {
			if(cmd.args && cmd.args.length === 1) {
				if(!canBeSnowflake(cmd.args[0])) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_ACTIVATE_WRONGID")
					});
					return;
				}

				const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, u, {
					key: "WHITELIST_DEACTIVATE_CONFIRM",
					formatOptions: {
						serverId: cmd.args[0]
					}
				}), msg);

				if(!confirmation) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.OK, u, "WHITELIST_CANCELED")
					});
					return;
				}

				await delGuildPref(cmd.args[0], "whitelist:until");
				await delGuildPref(cmd.args[0], "whitelist:status");

				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.OK, u, {
						key: "WHITELIST_DEACTIVATED",
						formatOptions: {
							serverId: cmd.args[0]
						}
					})
				});
			} else {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_DEACTIVATE_USAGE")
				});
			}
		} else if(cmd.subCommand === "ban") {
			if(cmd.args && cmd.args.length === 1) {
				if(!canBeSnowflake(cmd.args[0])) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_ACTIVATE_WRONGID")
					});
					return;
				}

				const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, u, {
					key: "WHITELIST_BAN_CONFIRM",
					formatOptions: {
						serverId: cmd.args[0]
					}
				}), msg);

				if(!confirmation) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.OK, u, "WHITELIST_CANCELED")
					});
					return;
				}

				await delGuildPref(cmd.args[0], "whitelist:until");
				await setGuildPref(cmd.args[0], "whitelist:status", WHITELIST_STATE.BANNED);

				const currentGuild = $discordBot.guilds.get(cmd.args[0]);
				if(currentGuild) {
					await currentGuild.leave();
				}

				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.OK, u, {
						key: "WHITELIST_BANNED",
						formatOptions: {
							serverId: cmd.args[0]
						}
					})
				});
			} else {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, u, "WHITELIST_BAN_USAGE")
				});
			}
		} else if(cmd.subCommand === "mode") {
			const modes = await this.fetchCurrentMode();
			if(cmd.args && cmd.args.length === 2) {
				if(!["on", "off"].includes(cmd.args[0]) || !allowedModes.includes(cmd.args[1])) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Information, u, {
							key: "WHITELIST_MODE_USAGE",
							formatOptions: {
								"modes": allowedModes.join(", ")
							}
						})
					});
					return;
				}

				const modeVal = cmd.args[0] === "on";
				const selectedMode = ((arg) => {
					switch(arg) {
						case "nobotfarms": return "noBotFarms";
						case "trial": return "trialAllowed";
						case "nolowmembers": return "noLowMembers";
						case "nomaxmembers": return "noMaxMembers";
						default: return "whitelist";
					}
				})(cmd.args[1]);

				if(modeVal && !!modes[selectedMode]) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Warning, u, {
							key: "WHITELIST_MODE_ALREADYENABLED",
							formatOptions: {
								mode: selectedMode
							}
						})
					});
					return;
				} else if(!modeVal && !modes[selectedMode]) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Warning, u, {
							key: "WHITELIST_MODE_ALREADYDISABLED",
							formatOptions: {
								mode: selectedMode
							}
						})
					});
					return;
				}

				modes[selectedMode] = modeVal;

				await setGuildPref("global", "whitelist:mode", this.convertToMode(modes));

				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.OK, u, {
						key: "WHITELIST_MODE_CHANGED",
						formatOptions: {
							mode: selectedMode,
							enabled: modeVal
						}
					})
				});
			} else if(cmd.args && cmd.args.length < 2) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, u, {
						key: "WHITELIST_MODE_USAGE",
						formatOptions: {
							"modes": allowedModes.join(", ")
						}
					})
				});
				return;
			}
		}
	}

	parseMode(mode: WhitelistModes): IParsedMode {
		return {
			whitelist: (mode & WhitelistModes.Whitelist) === WhitelistModes.Whitelist,
			noBotFarms: (mode & WhitelistModes.NoBotFarms) === WhitelistModes.NoBotFarms,
			trialAllowed: (mode & WhitelistModes.TrialAllowed) === WhitelistModes.TrialAllowed,
			noLowMembers: (mode & WhitelistModes.NoLowMembers) === WhitelistModes.NoLowMembers,
			noMaxMembers: (mode & WhitelistModes.NoMaxMembers) === WhitelistModes.NoMaxMembers
		};
	}

	convertToMode(parsedMode: IParsedMode): WhitelistModes {
		let m = 0;
		if(parsedMode.whitelist) { m |= WhitelistModes.Whitelist; }
		if(parsedMode.trialAllowed) { m |= WhitelistModes.TrialAllowed; }
		if(parsedMode.noBotFarms) { m |= WhitelistModes.NoBotFarms; }
		if(parsedMode.noLowMembers) { m |= WhitelistModes.NoLowMembers; }
		if(parsedMode.noMaxMembers) { m |= WhitelistModes.NoMaxMembers; }
		return m;
	}

	async unload() {
		if(this.checkInterval) {
			clearInterval(this.checkInterval);
		}
		this.unhandleEvents();
		return true;
	}
}

module.exports = Whitelist;
