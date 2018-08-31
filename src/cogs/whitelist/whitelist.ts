import { IModule } from "@sb-types/ModuleLoader/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, TextChannel, GuildMember, User } from "discord.js";
import { command } from "@utils/help";
import { localizeForUser, generateLocalizedEmbed, toUserLocaleString } from "@utils/ez-i18n";
import { canBeSnowflake } from "@utils/text";
import { parse as parseCmd, ICommandParseResult } from "@utils/command";
import { EmbedType, escapeDiscordMarkdown, getMessageMember } from "@utils/utils";
import { setPreferenceValue as setGuildPref, getPreferenceValue as getGuildPref, removePreference as delGuildPref } from "@utils/guildPreferences";
import * as parseTime from "timestring";
import * as getLogger from "loggy";
import { createConfirmationMessage } from "@utils/interactive";
import { DateTime } from "luxon";
import { ErrorMessages } from "@sb-types/Consts";
import { WhitelistUserPreferences } from "@cogs/whitelist/consts";

const POSSIBLE_CHAT_ROOMS = ["admins", "admin-channel", "admin_channel", "admins-chat", "admins_chat", "admin", "mod-channel", "mods-channel", "mods", "mods-chat", "mod_chat", "chat", "general"];

const HELP_CATEGORY = "WHITELIST";

const ALLOWED_MODES = ["whitelist", "nobotfarms", "trial", "nolowmembers", "nomaxmembers"];

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

	private readonly _log = getLogger("Whitelist");

	private readonly _alwaysWhitelisted: string[] = [];
	private readonly _minMembersRequired: number = 50;
	private readonly _maxMembersAllowed: number = 25000;
	private readonly _botsThreshold: number = 70;
	private readonly _defaultMode = WhitelistModes.NoBotFarms
		| WhitelistModes.NoLowMembers
		| WhitelistModes.NoMaxMembers
		| WhitelistModes.TrialAllowed
		| WhitelistModes.Whitelist;
	private readonly _signupUrl: string = "no_link";
	private readonly _trialTime: number = 86400000;
	private _currentMode: IParsedMode | undefined = undefined;

	constructor(options: any) {
		super({
			"message": (msg: Message) => this._onMessage(msg),
			"guildCreate": (guild: Guild) => this._onJoinedGuild(guild)
		});

		if (options) {
			{
				const alwaysWhitelisted = options.always_whitelisted;
				if (alwaysWhitelisted && alwaysWhitelisted instanceof Array) {
					for (const g of <string[]> alwaysWhitelisted) {
						this._alwaysWhitelisted.push(g);
					}
				}
			}
			{
				const minMembers = options.min_members;
				if (minMembers !== undefined && typeof minMembers === "number") {
					this._minMembersRequired = Math.max(0, minMembers);
				}
			}
			{
				const maxMembers = options.max_members;
				if (maxMembers !== undefined && typeof maxMembers === "number") {
					this._maxMembersAllowed = Math.max(0, maxMembers);
				}
			}
			{
				const botsThreshold = options.bots_threshold;
				if (botsThreshold !== undefined && typeof botsThreshold === "number") {
					this._botsThreshold = Math.max(0, Math.min(100, botsThreshold));
				}
			}
			{
				const defaultMode = options.default_mode;
				if (defaultMode !== undefined && typeof defaultMode === "number") {
					this._defaultMode = defaultMode;
				}
			}
			{
				const url = options.signup_url;
				if (url !== undefined && typeof url === "string") {
					this._signupUrl = url;
				} else { throw new Error("No sign up link provided"); }
			}
			{
				const trialTime = options.trial_time;
				if (trialTime !== undefined && typeof trialTime === "number") {
					this._trialTime = options.trial_time;
				}
			}
		} else { throw new Error("Setup required"); }

		this._log("info", "Whitelist module is here to protect your mod");
		this._log("info", " Required members to stay:", this._minMembersRequired, "-", this._maxMembersAllowed);
		this._log("info", " Always whitelisted servers:");

		for (const whitelistedId of this._alwaysWhitelisted) {
			const found = !!$discordBot.guilds.get(whitelistedId);
			this._log(found ? "ok" : "warn", "  -", whitelistedId, found ? "(found)" : "(not found)");
		}
	}

	private async _fetchCurrentMode() {
		let mode = <number | undefined> await getGuildPref("global", WhitelistUserPreferences.MODE, true);
		if (typeof mode !== "number") { mode = this._defaultMode; }
		this._currentMode = Whitelist._parseMode(mode);

		return this._currentMode;
	}

	private async _onJoinedGuild(guild: Guild) {
		this._log("info", `Joined guild "${guild.name}" (${guild.members.size} members)`);
		const whitelistStatus = await this.getWhitelistStatus(guild);
		if (whitelistStatus.state === WHITELIST_STATE.UNKNOWN || whitelistStatus.state === WHITELIST_STATE.BYPASS) {
			// how about to give guild limited time?
			// or check if it full of boooooooootz
			await this._tryToGiveTrial(guild);
		} else if (whitelistStatus.state === WHITELIST_STATE.TRIAL_EXPIRED) {
			this._leaveGuild(guild, "WHITELIST_LEAVE_TRIALEXPIRED1");
		} else if (whitelistStatus.state === WHITELIST_STATE.EXPIRED) {
			this._leaveGuild(guild, "WHITELIST_LEAVE_EXPIRED1");
		} else if (whitelistStatus.state === WHITELIST_STATE.BANNED) {
			this._leaveGuild(guild);
		}
	}

	public async isWhitelisted(guild: Guild): Promise<boolean> {
		const status = await this.getWhitelistStatus(guild);

		return status.state === WHITELIST_STATE.IMMORTAL || status.state === WHITELIST_STATE.UNLIMITED;
	}

	public async getWhitelistStatus(guild: Guild): Promise<IWhitelistState> {
		let mode = this._currentMode;
		if (!mode) { mode = await this._fetchCurrentMode(); }

		let ok = false;
		let state: WHITELIST_STATE | undefined = WHITELIST_STATE.UNKNOWN;
		let until: number | null = null;

		if (this._alwaysWhitelisted.includes(guild.id)) {
			ok = true;
			state = WHITELIST_STATE.IMMORTAL;

			return { ok, state, until };
		}

		const whitelistStatus = <WHITELIST_STATE> await getGuildPref(guild, WhitelistUserPreferences.STATUS, true);
		const whitelistedUntil = <number | null> await getGuildPref(guild, WhitelistUserPreferences.EXPIRATION, true);

		if (whitelistStatus == null) {
			return { ok, state, until };
		}

		if (whitelistStatus === WHITELIST_STATE.BANNED) {
			state = WHITELIST_STATE.BANNED;
		} else if (!mode.whitelist) {
			ok = true;
			state = WHITELIST_STATE.BYPASS;
		} else if (whitelistStatus === WHITELIST_STATE.UNLIMITED) {
			ok = true;
			state = WHITELIST_STATE.UNLIMITED;
		} else if (whitelistedUntil && whitelistedUntil < Date.now()) {
			state = whitelistStatus === WHITELIST_STATE.TRIAL ? WHITELIST_STATE.TRIAL_EXPIRED : WHITELIST_STATE.EXPIRED;
			until = whitelistedUntil;
		} else {
			ok = true;
			state = whitelistStatus;
			until = whitelistedUntil;
		}

		return { ok, state, until };
	}

	private _checkInterval: NodeJS.Timer;

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error("Module is not pending initialization");
		}

		this._currentMode = await this._fetchCurrentMode();
		this._checkInterval = setInterval(() => this._doCheckGuilds(), 1800000);

		await this._doCheckGuilds();
	}

	private async _doCheckGuilds() {
		for (const guild of $discordBot.guilds.values()) {
			const whitelistStatus = await this.getWhitelistStatus(guild);
			if (whitelistStatus.state === WHITELIST_STATE.EXPIRED) {
				await this._leaveGuild(guild, "WHITELIST_LEAVE_EXPIRED");
			} else if (whitelistStatus.state === WHITELIST_STATE.TRIAL_EXPIRED) {
				await this._leaveGuild(guild, "WHITELIST_LEAVE_TRIALEXPIRED");
			} else if (whitelistStatus.state === WHITELIST_STATE.BANNED) {
				await this._leaveGuild(guild);
			} else if (whitelistStatus.state === WHITELIST_STATE.UNKNOWN) {
				await this._tryToGiveTrial(guild);
			}
		}
	}

	private async _getBotsPercentage(guild: Guild) {
		let bots = 0;

		const members = await guild.members.fetch();

		for (const member of members.values()) {
			if (member.user.bot) { bots++; }
		}

		return Math.round((bots / guild.members.size) * 100);
	}

	private async _tryToGiveTrial(guild: Guild) {
		let mode = this._currentMode;
		if (!mode) { mode = await this._fetchCurrentMode(); }

		let reasonToLeave: string | undefined;

		if (mode.noBotFarms && await this._getBotsPercentage(guild) > this._botsThreshold) {
			reasonToLeave = "WHITELIST_LEAVE_BOTFARM";
		} else if (mode.noLowMembers && guild.members.size < this._minMembersRequired) {
			reasonToLeave = "WHITELIST_LEAVE_NOMEMBERS";
		} else if (mode.noMaxMembers && guild.members.size > this._maxMembersAllowed) {
			reasonToLeave = "WHITELIST_LEAVE_MANYMEMBERS";
		}

		if (reasonToLeave) {
			return this._leaveGuild(guild, reasonToLeave);
		}

		if (!mode.whitelist) { return; }

		await setGuildPref(guild, WhitelistUserPreferences.STATUS, WHITELIST_STATE.TRIAL);

		const endDate = Date.now() + this._trialTime;
		await setGuildPref(guild, WhitelistUserPreferences.EXPIRATION, endDate);

		this._log("info", `Activated trial on guild "${guild.name}"`);
	}

	private async _notify(guild: Guild, embed: any) {
		let notificationChannel: TextChannel | undefined = undefined;

		for (const possibleChannel of POSSIBLE_CHAT_ROOMS) {
			notificationChannel = <TextChannel> guild.channels.find((ch) => {
				return ch.name.includes(possibleChannel) && ch.type === "text";
			});
			if (notificationChannel) { break; }
		}

		if (!notificationChannel) { return; }

		try {
			await notificationChannel.send({ embed });
		} catch (err) {
			this._log("warn", `Failed to send message to channel ${notificationChannel.name} (${notificationChannel.id})`);

			$snowball.captureException(err, {
				level: "warning",
				extra: { guildId: guild, embed }
			});
		}
	}

	private async _leaveGuild(guild: Guild, reason?: string) {
		if (reason) {
			await this._notify(
				guild,
				await generateLocalizedEmbed(
					EmbedType.Warning,
					guild, {
						key: reason,
						formatOptions: {
							serverName: escapeDiscordMarkdown(guild.name, true),
							formUrl: this._signupUrl
						}
					}
				)
			);
		}

		await guild.leave();
		this._log("ok", `Left guild "${guild.name}"`);
	}

	private static _isAdmin(m: GuildMember) {
		return m.permissions.has([
			"ADMINISTRATOR",
			"MANAGE_GUILD",
			"MANAGE_ROLES",
			"MANAGE_CHANNELS"
		]) || m.id === $botConfig.botOwner;
	}

	private async _onMessage(msg: Message) {
		const author = await getMessageMember(msg);
		if (!author) { return; }

		if (msg.content === "!sb_pstatus" && Whitelist._isAdmin(author)) {
			return this._statusCmd(msg, author);
		}

		if (msg.author.id !== $botConfig.botOwner) { return; }

		const cmd = parseCmd(msg.content);

		if (cmd.command !== "!whitelist") { return; }

		if (cmd.subCommand === "activate") {
			return this._activateCmd(msg, author, cmd);
		} else if (cmd.subCommand === "deactivate") {
			return this._deactivateCmd(msg, author, cmd);
		} else if (cmd.subCommand === "ban") {
			if (!cmd.arguments || cmd.arguments.length !== 1) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, author, "WHITELIST_BAN_USAGE")
				});
			}

			if (!canBeSnowflake(cmd.arguments[0].value)) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, author, "WHITELIST_ACTIVATE_WRONGID")
				});
			}

			const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, author, {
				key: "WHITELIST_BAN_CONFIRM",
				formatOptions: {
					serverId: cmd.arguments[0].value
				}
			}), msg);

			if (!confirmation) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.OK, author, "WHITELIST_CANCELED")
				});
			}

			await delGuildPref(cmd.arguments[0].value, WhitelistUserPreferences.EXPIRATION);
			await setGuildPref(cmd.arguments[0].value, WhitelistUserPreferences.STATUS, WHITELIST_STATE.BANNED);

			const currentGuild = $discordBot.guilds.get(cmd.arguments[0].value);
			if (currentGuild) {
				await currentGuild.leave();
			}

			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.OK, author, {
					key: "WHITELIST_BANNED",
					formatOptions: {
						serverId: cmd.arguments[0].value
					}
				})
			});
		} else if (cmd.subCommand === "mode") {
			const modes = await this._fetchCurrentMode();
			if (cmd.arguments && cmd.arguments.length === 2) {
				if (!["on", "off"].includes(cmd.arguments[0].value) || !ALLOWED_MODES.includes(cmd.arguments[1].value)) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Information, author, {
							key: "WHITELIST_MODE_USAGE",
							formatOptions: {
								"modes": ALLOWED_MODES.join(", ")
							}
						})
					});
				}

				const modeVal = cmd.arguments[0].value === "on";
				const selectedMode = ((arg: string) => {
					switch (arg) {
						case "nobotfarms": return "noBotFarms";
						case "trial": return "trialAllowed";
						case "nolowmembers": return "noLowMembers";
						case "nomaxmembers": return "noMaxMembers";
						default: return "whitelist";
					}
				})(cmd.arguments[1].value);

				if (modeVal === modes[selectedMode]) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Warning,
							author, {
								key: "WHITELIST_MODE_ALREADY",
								formatOptions: {
									mode: selectedMode,
									status: modeVal
								}
							}
						)
					});
				}

				modes[selectedMode] = modeVal;

				await setGuildPref("global", WhitelistUserPreferences.MODE, Whitelist._convertToMode(modes));

				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.OK, author, {
						key: "WHITELIST_MODE_CHANGED",
						formatOptions: {
							mode: selectedMode,
							enabled: modeVal
						}
					})
				});
			} else if (cmd.arguments && cmd.arguments.length < 2) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Information, author, {
						key: "WHITELIST_MODE_USAGE",
						formatOptions: {
							"modes": ALLOWED_MODES.join(", ")
						}
					})
				});
			}
		}
	}

	private async _statusCmd(msg: Message, author: User | GuildMember) {
		const whitelistInfo = await this.getWhitelistStatus(msg.guild);

		let str = `# ${await localizeForUser(
			author, "WHITELIST_INFO_HEADER", {
				guildName: escapeDiscordMarkdown(msg.guild.name, true)
			}
		)}\n`;

		str += `${await localizeForUser(author, "WHITELIST_INFO_STATUS")} `;

		switch (whitelistInfo.state) {
			case WHITELIST_STATE.BANNED: {
				str += await localizeForUser(author, "WHITELIST_INFO_STATUS_BANNED");
			} break;
			case WHITELIST_STATE.IMMORTAL: {
				str += await localizeForUser(author, "WHITELIST_INFO_STATUS_IMMORTAL");
			} break;
			case WHITELIST_STATE.LIMITED: {
				str += await localizeForUser(author, "WHITELIST_INFO_STATUS_LIMITED");
			} break;
			case WHITELIST_STATE.TRIAL: {
				str += await localizeForUser(author, "WHITELIST_INFO_STATUS_TRIAL");
			} break;
			case WHITELIST_STATE.UNLIMITED: {
				str += await localizeForUser(author, "WHITELIST_INFO_STATUS_UNLIMITED");
			} break;
			case WHITELIST_STATE.BYPASS: {
				str += await localizeForUser(author, "WHITELIST_INFO_STATUS_BYPASS");
			}
		}

		if ((whitelistInfo.state === WHITELIST_STATE.LIMITED || whitelistInfo.state === WHITELIST_STATE.TRIAL) && whitelistInfo.until) {
			str += "\n";

			str += await localizeForUser(author, "WHITELIST_INFO_UNTIL", {
				endDate: await toUserLocaleString(
					author,
					whitelistInfo.until,
					DateTime.DATE_FULL
				)
			});
		}

		return msg.channel.send(str, {
			code: "md"
		});
	}

	private async _activateCmd(msg: Message, author: User | GuildMember, cmd: ICommandParseResult) {
		if (!cmd.arguments || cmd.arguments.length !== 2) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, author, "WHITELIST_ACTIVATE_USAGE")
			});
		}

		if (!canBeSnowflake(cmd.arguments[0].value)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, author, "WHITELIST_ACTIVATE_WRONGID")
			});
		}

		if (cmd.arguments[1].value === "forever") {
			const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, author, {
				key: "WHITELIST_ACTIVATE_CONFIRM_FOREVER",
				formatOptions: {
					serverId: cmd.arguments[0].value
				}
			}), msg);

			if (!confirmation) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.OK, author, "WHITELIST_CANCELED")
				});
			}

			await setGuildPref(cmd.arguments[0].value, WhitelistUserPreferences.STATUS, WHITELIST_STATE.UNLIMITED);
		} else {
			const time = parseTime(cmd.arguments[1].value, "ms");
			const endTime = new Date(Date.now() + time);

			const endString = await toUserLocaleString(author, endTime, DateTime.DATETIME_FULL);

			const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Progress, author, {
				key: "WHITELIST_ACTIVATE_CONFIRM_LIMITED",
				formatOptions: {
					timeString: endString,
					serverId: cmd.arguments[0].value
				}
			}), msg);

			if (!confirmation) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.OK, author, "WHITELIST_CANCELED")
				});
			}

			await setGuildPref(cmd.arguments[0].value, WhitelistUserPreferences.EXPIRATION, endTime);
			await setGuildPref(cmd.arguments[0].value, WhitelistUserPreferences.STATUS, WHITELIST_STATE.LIMITED);
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, author, {
				key: "WHITELIST_ACTIVATED",
				formatOptions: {
					serverId: cmd.arguments[0].value
				}
			})
		});
	}

	private async _deactivateCmd(msg: Message, author: User | GuildMember, cmd: ICommandParseResult) {
		if (!cmd.arguments || cmd.arguments.length === 0) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error, author,
					"WHITELIST_DEACTIVATE_USAGE"
				)
			});
		}

		if (!canBeSnowflake(cmd.arguments[0].value)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error, author,
					"WHITELIST_ACTIVATE_WRONGID"
				)
			});
		}

		const confirmation = await createConfirmationMessage(
			await generateLocalizedEmbed(
				EmbedType.Progress, author, {
					key: "WHITELIST_DEACTIVATE_CONFIRM",
					formatOptions: {
						serverId: cmd.arguments[0].value
					}
				}
			), msg
		);

		if (!confirmation) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.OK, author, "WHITELIST_CANCELED")
			});
		}

		await delGuildPref(cmd.arguments[0].value, WhitelistUserPreferences.EXPIRATION);
		await delGuildPref(cmd.arguments[0].value, WhitelistUserPreferences.STATUS);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, author, {
				key: "WHITELIST_DEACTIVATED",
				formatOptions: {
					serverId: cmd.arguments[0].value
				}
			})
		});
	}

	private static _parseMode(modeInt: WhitelistModes): IParsedMode {
		return {
			whitelist: (modeInt & WhitelistModes.Whitelist) === WhitelistModes.Whitelist,
			noBotFarms: (modeInt & WhitelistModes.NoBotFarms) === WhitelistModes.NoBotFarms,
			trialAllowed: (modeInt & WhitelistModes.TrialAllowed) === WhitelistModes.TrialAllowed,
			noLowMembers: (modeInt & WhitelistModes.NoLowMembers) === WhitelistModes.NoLowMembers,
			noMaxMembers: (modeInt & WhitelistModes.NoMaxMembers) === WhitelistModes.NoMaxMembers
		};
	}

	private static _convertToMode(parsedMode: IParsedMode): WhitelistModes {
		let modeInt = 0;

		if (parsedMode.whitelist) { modeInt |= WhitelistModes.Whitelist; }
		if (parsedMode.trialAllowed) { modeInt |= WhitelistModes.TrialAllowed; }
		if (parsedMode.noBotFarms) { modeInt |= WhitelistModes.NoBotFarms; }
		if (parsedMode.noLowMembers) { modeInt |= WhitelistModes.NoLowMembers; }
		if (parsedMode.noMaxMembers) { modeInt |= WhitelistModes.NoMaxMembers; }

		return modeInt;
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error(ErrorMessages.NOT_PENDING_UNLOAD);
		}

		if (this._checkInterval) {
			clearInterval(this._checkInterval);
		}

		this.unhandleEvents();

		return true;
	}
}

export default Whitelist;

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

const enum WhitelistModes {
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

interface IWhitelistState {
	ok: boolean;
	state: WHITELIST_STATE;
	until: null | number;
}
