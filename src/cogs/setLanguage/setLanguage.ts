import { IModule } from "@sb-types/ModuleLoader/ModuleLoader";
import { Plugin } from "@cogs/plugin";
import { Message, GuildMember, User } from "discord.js";
import * as help from "@utils/help";
import * as i18n from "@utils/ez-i18n";
import { startsWith } from "@utils/text";
import * as utils from "@utils/utils";
import * as UserPreferences from "@utils/userPreferences";
import * as GuildPreferences from "@utils/guildPreferences";
import { IHashMap, createHashMap } from "@sb-types/Types";
import { messageToExtra } from "@utils/failToDetail";
import { DateTime } from "luxon";
import { intlAcceptsTimezone } from "@utils/extensions";
import { default as fetch } from "node-fetch";
import * as getLogger from "loggy";
import { URL } from "url";
import { get, storeValue } from "@utils/cache";
import { createConfirmationMessage } from "@utils/interactive";

const BASE_PREFIX = "!sb_lang";
const CMD = {
	SWITCH: `${BASE_PREFIX} switch`,
	TIMEZONE: `${BASE_PREFIX} timezone`,
	CODES: `${BASE_PREFIX} codes`,
	GUILDS_SWITCH: `${BASE_PREFIX} guild switch`,
	GUILDS_TIMEZONE: `${BASE_PREFIX} guild timezone`,
	GUILDS_ENFORCE: `${BASE_PREFIX} guild enforce`
};
const HELP_CATEGORY = "LANGUAGE";
const CACHE_OWNER = "snowball.setlanguage.locations";

interface ISetLanguageCommandOptions {
	no_lazy: boolean;
	crowdinLink: string;
	flags: IHashMap<string>;
	googleApiKey?: string;
}

@help.command(HELP_CATEGORY, BASE_PREFIX.slice(1), "loc:LANGUAGE_META_DEFAULT")
@help.command(HELP_CATEGORY, CMD.SWITCH.slice(1), "loc:LANGUAGE_META_SWITCH", {
	"loc:LANGUAGE_META_SWITCH_ARG0": {
		optional: false,
		description: "loc:LANGUAGE_META_SWITCH_ARG0_DESC"
	}
})
@help.command(HELP_CATEGORY, CMD.CODES.slice(1), "loc:LANGUAGE_META_CODES")
@help.command(HELP_CATEGORY, CMD.GUILDS_SWITCH.slice(1), "loc:LANGUAGE_META_GUILDSWITCH", {
	"loc:LANGUAGE_META_SWITCH_ARG0": {
		optional: false,
		description: "loc:LANGUAGE_META_SWITCH_ARG0_DESC"
	}
})
@help.command(HELP_CATEGORY, CMD.GUILDS_ENFORCE.slice(1), "loc:LANGUAGE_META_GUILDENFORCE", {
	"loc:LANGUAGE_META_GUILDENFORCE_ARG0": {
		optional: false,
		values: [ "true", "false" ],
		description: "loc:LANGUAGE_META_GUILDENFORCE_ARG0_DESC"
	}
})
export class SetLanguageCommand extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.setlanguage";
	}

	private readonly _prefs = i18n.getPreferencesNames();
	private readonly _log = getLogger("SetLanguage");
	private readonly _flags: IHashMap<string> = Object.create(null);
	private readonly _noLazy: boolean;
	private readonly _crowdinLink: string;
	private readonly _googleMapsApiKey?: string;

	constructor(options: ISetLanguageCommandOptions) {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		});

		if (!options) { throw new Error("No options found"); }

		this._noLazy = !!options["no_lazy"];
		this._crowdinLink = options.crowdinLink;
		this._googleMapsApiKey = options.googleApiKey;
		this._flags = createHashMap(options.flags);
	}

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error("This module is not pending initialization");
		}

		if (!this._noLazy) {
			this._log("warn", "Lazy loading enabled, not going to do anything");

			return;
		}

		this._log("info", "Syncing...");
		for (const g of $discordBot.guilds.values()) {
			this._log("info", `Updating language for guild "${g.name}"`);
			await i18n.forceGuildLanguageUpdate(g);
			this._log("info", `Updating enforcing status for guild "${g.name}"`);
			await i18n.forceGuildEnforceUpdate(g);
			this._log("info", `-- Started language update for ${g.members.size} members`);
			for (const m of g.members.values()) { await i18n.getUserLanguage(m); }
		}

		this._log("info", `Started language update for ${$discordBot.users.size} users`);

		for (const m of $discordBot.users.values()) { await i18n.getUserLanguage(m); }

		this._log("ok", "Sync done, poor DB");
	}

	private async _onMessage(msg: Message) {
		if (msg.channel.type !== "dm" && msg.channel.type !== "text") { return; }
		
		if (!startsWith(msg.content, BASE_PREFIX)) { return; }
		
		try {
			if (msg.content === BASE_PREFIX) {
				return await this._getCurrentLang(msg);
			} else if (startsWith(msg.content, CMD.SWITCH)) {
				return await this._changeLanguage(msg);
			} else if (startsWith(msg.content, CMD.TIMEZONE)) {
				return await this._timezone(msg);
			} else if (startsWith(msg.content, CMD.GUILDS_SWITCH)) {
				return await this._changeGuildLanguage(msg);
			} else if (startsWith(msg.content, CMD.GUILDS_TIMEZONE)) {
				return await this._guildTimezone(msg);
			} else if (startsWith(msg.content, CMD.GUILDS_ENFORCE)) {
				return await this._guildEnforce(msg);
			} else if (startsWith(msg.content, CMD.CODES)) {
				return await this._getCodes(msg);
			} else {
				return await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member || msg.author, {
						key: "LANGUAGE_UNKNOWNCOMMAND",
						formatOptions: {
							cmd_switch: CMD.SWITCH,
							cmd_codes: CMD.CODES,
							resolved_category: await i18n.localizeForUser(msg.member || msg.author, help.categoryLocalizedName(HELP_CATEGORY))
						}
					})
				});
			}
		} catch (err) {
			this._log("err", `Error running command "${msg.content}"`, err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
		}
	}

	private async _getCurrentLang(msg: Message) {
		const u = msg.member || msg.author;
		const langCode = await i18n.getUserLanguage(u);

		let str = $localizer.getFormattedString(langCode, "LANGUAGE_CURRENTLANG", {
			lang: `${$localizer.getString(langCode, "+NAME")} (${$localizer.getString(langCode, "+COUNTRY")})`,
			coverage: $localizer.getString(langCode, "+COVERAGE")
		});

		if (!($localizer.getString(langCode, "+COMMUNITY_MANAGED") === "false")) {
			str += "\n\n";
			str += $localizer.getFormattedString(langCode, "LANGUAGE_COMMUNITYMANAGED", {
				crowdinLink: `${this._crowdinLink}/${$localizer.getString(langCode, "+CROWDIN_CODE")}`
			});
		}

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, u, {
				custom: true,
				string: str
			}, { thumbUrl: this._flags[langCode] || undefined })
		});
	}

	private async _changeLanguage(msg: Message) {
		const u = msg.member || msg.author;
		if (msg.content === CMD.SWITCH) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, u, {
					key: "LANGUAGE_SWITCH_USAGE",
					formatOptions: {
						prefix: CMD.SWITCH,
						codesCmd: CMD.CODES
					}
				})
			});
		}

		if (msg.channel.type !== "dm") {
			const enforcingEnabled = await GuildPreferences.getPreferenceValue(msg.guild, this._prefs.guildEnforce, true);
			if (enforcingEnabled) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "LANGUAGE_GUILD_ENFORCEDLANG")
				});
			}
		}

		const lang = msg.content.slice(CMD.SWITCH.length).trim();
		if (!$localizer.languageExists(lang)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, u, "LANGUAGE_SWITCH_ERRLANGNOTFOUND")
			});
		}

		await UserPreferences.setPreferenceValue(u, this._prefs.user, lang);
		await i18n.forceUserLanguageUpdate(u);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(utils.EmbedType.OK, u, {
				key: "LANGUAGE_SWITCH_DONE",
				formatOptions: {
					lang: `${await i18n.localizeForUser(u, "+NAME")} (${await i18n.localizeForUser(u, "+COUNTRY")})`
				}
			})
		});
	}

	private async _getCodes(msg: Message) {
		const u = msg.member || msg.author;
		let str = `# ${await i18n.localizeForUser(u, "LANGUAGE_CODES_HEADER")}\n\n`;

		const langs = $localizer.loadedLanguages;
		for (const lang of langs) {
			str += `* ${lang}: `;
			str += $localizer.getString(lang, "+NAME");
			str += ` (${$localizer.getString(lang, "+COUNTRY")})`;
			str += ` - ${($localizer.getString(lang, "+COVERAGE"))}%`;
			str += `${!($localizer.getString(lang, "+COMMUNITY_MANAGED") === "false") ? ` ${await i18n.localizeForUser(u, "LANGUAGE_CODES_ITEM_CM")}` : ""}\n`;
		}

		return msg.channel.send(str, {
			code: "md",
			split: true
		});
	}

	private async _changeGuildLanguage(msg: Message) {
		if (msg.channel.type !== "text") {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "LANGUAGE_GUILD_ONLYGUILDS")
			});
		}

		if (!SetLanguageCommand._isAdmin(msg.member)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "LANGUAGE_GUILD_NOPERMISSIONS")
			});
		}

		if (msg.content === CMD.GUILDS_SWITCH) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msg.member, {
					key: "LANGUAGE_GUILD_SWITCH_USAGE",
					formatOptions: {
						prefix: CMD.GUILDS_SWITCH,
						codesCmd: CMD.CODES
					}
				})
			});
		}

		const lang = msg.content.slice(CMD.GUILDS_SWITCH.length).trim();
		if (!$localizer.languageExists(lang)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "LANGUAGE_SWITCH_ERRLANGNOTFOUND")
			});
		}

		const enforcingState = await GuildPreferences.getPreferenceValue(msg.guild, this._prefs.guildEnforce, true);
		await GuildPreferences.setPreferenceValue(msg.guild, this._prefs.guild, lang);
		await i18n.forceGuildLanguageUpdate(msg.guild);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(utils.EmbedType.OK, msg.member, {
				key: enforcingState ? "LANGUAGE_GUILD_SWITCH_DONE" : "LANGUAGE_GUILD_SWITCH_DONE_ENFORCING",
				formatOptions: {
					lang: `${$localizer.getString(lang, "+NAME")} (${$localizer.getString(lang, "+COUNTRY")})`
				}
			})
		});
	}

	private async _guildEnforce(msg: Message) {
		if (msg.channel.type !== "text") {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "LANGUAGE_GUILD_ONLYGUILDS")
			});
		}

		if (!SetLanguageCommand._isAdmin(msg.member)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "LANGUAGE_GUILD_NOPERMISSIONS")
			});
		}

		if (msg.content === CMD.GUILDS_ENFORCE) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msg.member, "LANGUAGE_GUILD_ENFORCE_USAGE")
			});
		}

		const arg = msg.content.slice(CMD.GUILDS_ENFORCE.length).trim();
		if (![ "true", "false" ].includes(arg)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "LANGUAGE_GUILD_ENFORCE_ARGERR")
			});
		}

		const enforcingState = await GuildPreferences.getPreferenceValue(msg.guild, this._prefs.guildEnforce, true);
		const newEnforcingState = arg === "true";

		if (enforcingState === newEnforcingState) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msg.member, {
					key: "LANGUAGE_GUILD_ENFORCE_ALREADY",
					formatOptions: {
						enforcingEnabled: enforcingState
					}
				})
			});
		}

		await GuildPreferences.setPreferenceValue(msg.guild, this._prefs.guildEnforce, newEnforcingState);
		await i18n.forceGuildEnforceUpdate(msg.guild);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(utils.EmbedType.OK, msg.member, {
				key: "LANGUAGE_GUILD_ENFORCE_CHANGED",
				formatOptions: {
					enabled: newEnforcingState
				}
			})
		});
	}

	// #region Timezones Stuff

	private async _timezone(msg: Message) {
		const msgAuthor = await utils.getMessageMemberOrAuthor(msg);
		if (!msgAuthor) { return; }

		const userTimezone = await i18n.getUserTimezone(msgAuthor);

		if (msg.content === CMD.TIMEZONE) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msgAuthor, {
					custom: true,
					string: await SetLanguageCommand._timezoneCurrentTime(
						await i18n.localizeForUser(msgAuthor, "LANGUAGE_TIMEZONE_CURRENT@USER", {
							timezone: userTimezone
						}
					), msgAuthor, userTimezone)
				})
			});
		}

		let newTZ = msg.content.slice(CMD.TIMEZONE.length);

		if (!intlAcceptsTimezone(newTZ)) {
			const result = await SetLanguageCommand._timezoneFallback(msg, msgAuthor, newTZ, this._googleMapsApiKey);
			if (!result) { return; }
			newTZ = result;
		}

		await UserPreferences.setPreferenceValue(msgAuthor, this._prefs.userTimezone, newTZ);

		newTZ = await i18n.forceUserTimezoneUpdate(msgAuthor);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msgAuthor, {
				custom: true,
				string: await SetLanguageCommand._timezoneCurrentTime(
					await i18n.localizeForUser(msgAuthor, "LANGUAGE_TIMEZONE_DONE@USER", {
						newTimezone: newTZ
					}
				), msgAuthor, newTZ)
			})
		});
	}

	private async _guildTimezone(msg: Message) {
		const msgMember = await utils.getMessageMember(msg);
		if (!msgMember) { return; }

		if (!SetLanguageCommand._isAdmin(msgMember)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msgMember, "LANGUAGE_GUILD_NOPERMISSIONS")
			});
		}

		const guildTimezone = await i18n.getGuildTimezone(msgMember.guild);

		if (msg.content === CMD.TIMEZONE) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msgMember, {
					custom: true,
					string: await SetLanguageCommand._timezoneCurrentTime(
						await i18n.localizeForUser(msgMember, "LANGUAGE_TIMEZONE_CURRENT@GUILD", {
							timezone: guildTimezone
						}
					), msgMember, guildTimezone)
				})
			});
		}

		let newTZ = msg.content.slice(CMD.GUILDS_TIMEZONE.length);

		if (!intlAcceptsTimezone(newTZ)) {
			const result = await SetLanguageCommand._timezoneFallback(msg, msgMember, newTZ, this._googleMapsApiKey);
			if (!result) { return; }
			newTZ = result;
		}

		await GuildPreferences.setPreferenceValue(msgMember.guild, this._prefs.userTimezone, newTZ);

		newTZ = await i18n.forceGuildTimezoneUpdate(msgMember.guild);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, msgMember, {
				custom: true,
				string: await SetLanguageCommand._timezoneCurrentTime(
					await i18n.localizeForUser(msgMember, "LANGUAGE_TIMEZONE_DONE@GUILD", {
						newTimezone: newTZ
					}
				), msgMember, newTZ)
			})
		});
	}

	private static async _timezoneFallback(msg: Message, msgAuthor: GuildMember | User, newTZ: string, apiKey?: string) : Promise<string | undefined> {
		if (!apiKey) {
			await msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msgAuthor, "LANGUAGE_TIMEZONE_INVALID")
			});

			return;
		}

		// do we have cache for this?

		const cached = await get<string>(CACHE_OWNER, newTZ.toLowerCase());

		if (cached == null) {
			// resolving address with google maps

			const findResp = await SetLanguageCommand._sendGoogleMapsReq<IGoogleGeocodingResponse>("geocode", apiKey, {
				address: newTZ,
				language: await i18n.localizeForUser(msgAuthor, "+SHORT_CODE")
			});

			if (findResp.status !== "OK" || findResp.results.length === 0) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msgAuthor, "LANGUAGE_TIMEZONE_NOT_FOUND")
				});

				return;
			}

			const selectedAddress = findResp.results[0]; // first one

			const confirmationEmbed = await i18n.generateLocalizedEmbed(utils.EmbedType.Question, msgAuthor, {
				key: "LANGUAGE_TIMEZONE_CONFIRMATION@FOUND_ADDRESS",
				formatOptions: { address: selectedAddress.formatted_address }
			});

			const confirmation = await createConfirmationMessage(confirmationEmbed, msg);

			if (!confirmation) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msgAuthor, "LANGUAGE_TIMEZONE_CANCELED@FOUND_ADDRESS")
				});

				return;
			}

			// trying to resolve timezone

			const timezoneResp = await SetLanguageCommand._sendGoogleMapsReq<IGoogleTimezoneResponse>("timezone", apiKey, {
				timestamp: (Date.now() / 1000).toFixed(0),
				location: `${selectedAddress.geometry.location.lat},${selectedAddress.geometry.location.lng}`
			});

			if (timezoneResp.status !== "OK" || !intlAcceptsTimezone(timezoneResp.timeZoneId)) {
				await msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msgAuthor, "LANGUAGE_TIMEZONE_APIERR@TIMEZONE_RESOLVE", {
						universalTitle: await i18n.localizeForUser(msgAuthor, "LANGUAGE_TIMEZONE_CANCELED_TITLE")
					})
				});

				return;
			}

			storeValue(CACHE_OWNER, newTZ, timezoneResp.timeZoneId, 604800);

			newTZ = timezoneResp.timeZoneId;
		} else { newTZ = cached; }

		return newTZ;
	}

	private static async _sendGoogleMapsReq<T>(apiType: string, apiKey: string, query: { [key: string]: string }) : Promise<T> {
		const uri = new URL(`https://maps.googleapis.com/maps/api/${apiType}/json`);
		
		for (const key in query) { uri.searchParams.set(key, query[key]); }

		uri.searchParams.set("key", apiKey);

		const resp = await fetch(uri.toString());

		if (resp.status !== 200) { throw new Error(`Invalid response code`); }

		return resp.json();
	}

	private static async _timezoneCurrentTime(str: string, msgAuthor: GuildMember | User, timezone: string) {
		str += `\n\n${await i18n.localizeForUser(msgAuthor, "LANGUAGE_TIMEZONE_TIME", {
			currentTime: DateTime.local().setLocale(await i18n.getUserLanguage(msgAuthor)).setZone(timezone).toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS)
		})}`;

		return str;
	}

	// #endregion

	private static _isAdmin(member: GuildMember) {
		return member.permissions.has([ "ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES" ], true);
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error("This module is not pending unload");
		}
		this.unhandleEvents();

		return true;
	}
}

interface IGoogleGeocodingResponse extends IGoogleResponse {
	results: Array<{
		formatted_address: string;
		geometry: {
			location: {
				lat: number;
				lng: number;
			}
		}
	}>;
}

interface IGoogleTimezoneResponse extends IGoogleResponse {
	timeZoneId: string;
	timeZoneName: string;
}

interface IGoogleResponse {
	status: string;
}


module.exports = SetLanguageCommand;
