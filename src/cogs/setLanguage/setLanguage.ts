import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, GuildMember } from "discord.js";
import { categoryLocalizedName, command } from "../utils/help";
import { localizeForUser, getPrefsNames, forceUserLanguageUpdate, forceGuildEnforceUpdate, forceGuildLanguageUpdate, generateLocalizedEmbed, getUserLanguage } from "../utils/ez-i18n";
import { startsWith } from "../utils/text";
import { EmbedType } from "../utils/utils";
import { setPreferenceValue as setUserPref } from "../utils/userPrefs";
import { setPreferenceValue as setGuildPref, getPreferenceValue as getGuildPref } from "../utils/guildPrefs";
import { IHashMap, createHashMap } from "../../types/Types";
import * as getLogger from "loggy";
import { messageToExtra } from "../utils/failToDetail";

const BASE_PREFIX = "!sb_lang";
const CMD = {
	SWITCH: `${BASE_PREFIX} switch`,
	CODES: `${BASE_PREFIX} codes`,
	GUILDS_SWITCH: `${BASE_PREFIX} guild switch`,
	GUILDS_ENFORCE: `${BASE_PREFIX} guild enforce`
};
const HELP_CATEGORY = "LANGUAGE";

interface ISetLanguageCommandOptions {
	no_lazy: boolean;
	crowdinLink: string;
	flags: IHashMap<string>;
}

@command(HELP_CATEGORY, BASE_PREFIX.slice(1), "loc:LANGUAGE_META_DEFAULT")
@command(HELP_CATEGORY, CMD.SWITCH.slice(1), "loc:LANGUAGE_META_SWITCH", {
	"loc:LANGUAGE_META_SWITCH_ARG0": {
		optional: false,
		description: "loc:LANGUAGE_META_SWITCH_ARG0_DESC"
	}
})
@command(HELP_CATEGORY, CMD.CODES.slice(1), "loc:LANGUAGE_META_CODES")
@command(HELP_CATEGORY, CMD.GUILDS_SWITCH.slice(1), "loc:LANGUAGE_META_GUILDSWITCH", {
	"loc:LANGUAGE_META_SWITCH_ARG0": {
		optional: false,
		description: "loc:LANGUAGE_META_SWITCH_ARG0_DESC"
	}
})
@command(HELP_CATEGORY, CMD.GUILDS_ENFORCE.slice(1), "loc:LANGUAGE_META_GUILDENFORCE", {
	"loc:LANGUAGE_META_GUILDENFORCE_ARG0": {
		optional: false,
		values: ["true", "false"],
		description: "loc:LANGUAGE_META_GUILDENFORCE_ARG0_DESC"
	}
})
class SetLanguageCommand extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.setlanguage";
	}

	private readonly prefs = getPreferencesNames();
	private readonly log = getLogger("SetLanguage");
	private readonly flags: IHashMap<string> = Object.create(null);
	private readonly noLazy: boolean;
	private readonly crowdinLink: string;

	constructor(options: ISetLanguageCommandOptions) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		});
		if(options) {
			this.noLazy = !!options["no_lazy"];
			this.crowdinLink = options.crowdinLink;
			this.flags = createHashMap(options.flags);
		} else { throw new Error("No options found"); }
	}

	public async init() {
		if(!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error("This module is not pending initialization");
		}

		if(!this.noLazy) {
			this.log("warn", "Lazy loading enabled, not going to do anything");
			return;
		}

		this.log("info", "Syncing...");
		for(const g of $discordBot.guilds.values()) {
			this.log("info", `Updating language for guild "${g.name}"`);
			await forceGuildLanguageUpdate(g);
			this.log("info", `Updating enforcing status for guild "${g.name}"`);
			await forceGuildEnforceUpdate(g);
			this.log("info", `-- Started language update for ${g.members.size} members`);
			for(const m of g.members.values()) { await getUserLanguage(m); }
		}
		this.log("info", `Started language update for ${$discordBot.users.size} users`);
		for(const m of $discordBot.users.values()) { await getUserLanguage(m); }
		this.log("ok", "Sync done, poor DB");
	}

	private async onMessage(msg: Message) {
		if(msg.channel.type !== "dm" && msg.channel.type !== "text") { return; }
		if(!startsWith(msg.content, BASE_PREFIX)) { return; }
		try {
			if(msg.content === BASE_PREFIX) {
				return await this.getCurrentLang(msg);
			} else if(startsWith(msg.content, CMD.SWITCH)) {
				return await this.switchLanguage(msg);
			} else if(startsWith(msg.content, CMD.GUILDS_SWITCH)) {
				return await this.guildSwitch(msg);
			} else if(startsWith(msg.content, CMD.GUILDS_ENFORCE)) {
				return await this.guildEnforce(msg);
			} else if(startsWith(msg.content, CMD.CODES)) {
				return await this.getCodes(msg);
			} else {
				return await msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member || msg.author, {
						key: "LANGUAGE_UNKNOWNCOMMAND",
						formatOptions: {
							cmd_switch: CMD.SWITCH,
							cmd_codes: CMD.CODES,
							resolved_category: await localizeForUser(msg.member || msg.author, categoryLocalizedName(HELP_CATEGORY))
						}
					})
				});
			}
		} catch (err) {
			this.log("err", `Error running command "${msg.content}"`, err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
		}
	}

	private async getCurrentLang(msg: Message) {
		const u = msg.member || msg.author;
		const langCode = await getUserLanguage(u);

		let str = $localizer.getFormattedString(langCode, "LANGUAGE_CURRENTLANG", {
			lang: `${$localizer.getString(langCode, "+NAME")} (${$localizer.getString(langCode, "+COUNTRY")})`,
			coverage: $localizer.getString(langCode, "+COVERAGE")
		});

		if(!($localizer.getString(langCode, "+COMMUNITY_MANAGED") === "false")) {
			str += "\n\n";
			str += $localizer.getFormattedString(langCode, "LANGUAGE_COMMUNITYMANAGED", {
				crowdinLink: `${this.crowdinLink}/${$localizer.getString(langCode, "+CROWDIN_CODE")}`
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.Information, u, {
				custom: true,
				string: str
			}, { thumbUrl: this.flags[langCode] || undefined })
		});
	}

	private async switchLanguage(msg: Message) {
		const u = msg.member || msg.author;
		if(msg.content === CMD.SWITCH) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, u, {
					key: "LANGUAGE_SWITCH_USAGE",
					formatOptions: {
						prefix: CMD.SWITCH,
						codesCmd: CMD.CODES
					}
				})
			});
		}

		if(msg.channel.type !== "dm") {
			const enforcingEnabled = await getGuildPref(msg.guild, this.prefs.guildEnforce, true);
			if(enforcingEnabled) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_ENFORCEDLANG")
				});
			}
		}

		const lang = msg.content.slice(CMD.SWITCH.length).trim();
		if(!$localizer.languageExists(lang)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, u, "LANGUAGE_SWITCH_ERRLANGNOTFOUND")
			});
		}

		await setUserPref(u, this.prefs.user, lang);
		await forceUserLanguageUpdate(u);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, u, {
				key: "LANGUAGE_SWITCH_DONE",
				formatOptions: {
					lang: `${await localizeForUser(u, "+NAME")} (${await localizeForUser(u, "+COUNTRY")})`
				}
			})
		});
	}

	private async getCodes(msg: Message) {
		const u = msg.member || msg.author;
		let str = `# ${await localizeForUser(u, "LANGUAGE_CODES_HEADER")}\n\n`;

		const langs = $localizer.loadedLanguages;
		for(const lang of langs) {
			str += `* ${lang}: `;
			str += $localizer.getString(lang, "+NAME");
			str += ` (${$localizer.getString(lang, "+COUNTRY")})`;
			str += ` - ${($localizer.getString(lang, "+COVERAGE"))}%`;
			str += `${!($localizer.getString(lang, "+COMMUNITY_MANAGED") === "false") ? ` ${await localizeForUser(u, "LANGUAGE_CODES_ITEM_CM")}` : ""}\n`;
		}

		return msg.channel.send(str, {
			code: "md",
			split: true
		});
	}

	private async guildSwitch(msg: Message) {
		if(msg.channel.type !== "text") {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_ONLYGUILDS")
			});
		}

		if(!SetLanguageCommand._isAdmin(msg.member)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_NOPERMISSIONS")
			});
		}

		if(msg.content === CMD.GUILDS_SWITCH) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "LANGUAGE_GUILD_SWITCH_USAGE",
					formatOptions: {
						prefix: CMD.GUILDS_SWITCH,
						codesCmd: CMD.CODES
					}
				})
			});
		}

		const lang = msg.content.slice(CMD.GUILDS_SWITCH.length).trim();
		if(!$localizer.languageExists(lang)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_SWITCH_ERRLANGNOTFOUND")
			});
		}

		const enforcingState = await getGuildPref(msg.guild, this.prefs.guildEnforce, true);
		await setGuildPref(msg.guild, this.prefs.guild, lang);
		await forceGuildLanguageUpdate(msg.guild);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: enforcingState ? "LANGUAGE_GUILD_SWITCH_DONE" : "LANGUAGE_GUILD_SWITCH_DONE_ENFORCING",
				formatOptions: {
					lang: `${$localizer.getString(lang, "+NAME")} (${$localizer.getString(lang, "+COUNTRY")})`
				}
			})
		});
	}

	private async guildEnforce(msg: Message) {
		if(msg.channel.type !== "text") {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_ONLYGUILDS")
			});
		}

		if(!SetLanguageCommand._isAdmin(msg.member)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_NOPERMISSIONS")
			});
		}

		if(msg.content === CMD.GUILDS_ENFORCE) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "LANGUAGE_GUILD_ENFORCE_USAGE")
			});
		}

		const arg = msg.content.slice(CMD.GUILDS_ENFORCE.length).trim();
		if(!["true", "false"].includes(arg)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_ENFORCE_ARGERR")
			});
		}

		const enforcingState = await getGuildPref(msg.guild, this.prefs.guildEnforce, true);
		const newEnforcingState = arg === "true";

		if(enforcingState === newEnforcingState) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "LANGUAGE_GUILD_ENFORCE_ALREADY",
					formatOptions: {
						enforcingEnabled: enforcingState
					}
				})
			});
		}

		await setGuildPref(msg.guild, this.prefs.guildEnforce, newEnforcingState);
		await forceGuildEnforceUpdate(msg.guild);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: "LANGUAGE_GUILD_ENFORCE_CHANGED",
				formatOptions: {
					enabled: newEnforcingState
				}
			})
		});
	}

	private static _isAdmin(member: GuildMember) {
		return member.permissions.has(["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"], true);
	}

	public async unload() {
		if(!$modLoader.isPendingUnload(this.signature)) {
			throw new Error("This module is not pending unload");
		}
		this.unhandleEvents();
		return true;
	}
}

module.exports = SetLanguageCommand;
