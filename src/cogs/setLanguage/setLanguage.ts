import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, GuildMember } from "discord.js";
import { command, Category } from "../utils/help";
import { localizeForUser, getPrefsNames, forceUserLanguageUpdate, forceGuildEnforceUpdate, forceGuildLanguageUpdate, generateLocalizedEmbed, getUserLanguage } from "../utils/ez-i18n";
import { startsOrEqual, slice } from "../utils/text";
import { EmbedType, getLogger } from "../utils/utils";
import { setPreferenceValue as setUserPref } from "../utils/userPrefs";
import { setPreferenceValue as setGuildPref, getPreferenceValue as getGuildPref } from "../utils/guildPrefs";

const BASE_PREFIX = "!sb_lang";
const CMD = {
	SWITCH: `${BASE_PREFIX} switch`,
	CODES: `${BASE_PREFIX} codes`,
	GUILDS_SWITCH: `${BASE_PREFIX} guild switch`,
	GUILDS_ENFORCE: `${BASE_PREFIX} guild enforce`
};

@command(Category.Language, slice(BASE_PREFIX, 1), "loc:LANGUAGE_META_DEFAULT")
@command(Category.Language, slice(CMD.SWITCH, 1), "loc:LANGUAGE_META_SWITCH", {
	"loc:LANGUAGE_META_SWITCH_ARG0": {
		optional: false,
		description: "loc:LANGUAGE_META_SWITCH_ARG0_DESC"
	}
})
class SetLanguageCommand extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.setlanguage";
	}

	prefs = getPrefsNames();
	log = getLogger("SetLanguage");
	noLazy = false;
	crowdinLink: string;

	constructor(options) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		});
		if(options) {
			this.noLazy = !!options["no_lazy"];
			this.crowdinLink = options.crowdinLink;
		} else { throw new Error("No options found"); }
	}

	async init() {
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
			for(const m of g.members.values()) {
				await getUserLanguage(m);
			}
		}
		this.log("info", `Started language update for ${$discordBot.users.size} users`);
		for(const m of $discordBot.users.values()) {
			await forceUserLanguageUpdate(m);
		}
		this.log("ok", "Sync done, poor DB");
	}

	async onMessage(msg: Message) {
		if(msg.channel.type !== "dm" && msg.channel.type !== "text") {
			return;
		}
		if(msg.content === BASE_PREFIX) {
			return this.getCurrentLang(msg);
		} else if(startsOrEqual(CMD.SWITCH, msg.content)) {
			await this.switchLanguage(msg);
		} else if(startsOrEqual(CMD.GUILDS_SWITCH, msg.content)) {
			return await this.guildSwitch(msg);
		} else if(startsOrEqual(CMD.GUILDS_ENFORCE, msg.content)) {
			return await this.guildEnforce(msg);
		} else if(startsOrEqual(CMD.CODES, msg.content)) {
			await this.getCodes(msg);
		}
	}

	async getCurrentLang(msg: Message) {
		const u = msg.member || msg.author;
		let str = await localizeForUser(u, "LANGUAGE_CURRENTLANG", {
			lang: `${await localizeForUser(u, "+NAME")} (${await localizeForUser(u, "+COUNTRY")})`,
			coverage: await localizeForUser(u, "+COVERAGE")
		});
		if(!(await localizeForUser(u, "+COMMUNITY_MANAGED") === "false")) {
			const userLangCode = await getUserLanguage(u);
			str += "\n\n";
			str += await localizeForUser(u, "LANGUAGE_COMMUNITYMANAGED", {
				crowdinLink: `${this.crowdinLink}/${userLangCode}`
			});
		}
		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, u, {
				custom: true,
				string: str
			})
		});
	}

	async switchLanguage(msg: Message) {
		const u = msg.member || msg.author;
		if(msg.content === CMD.SWITCH) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, u, {
					key: "LANGUAGE_SWITCH_USAGE",
					formatOptions: {
						prefix: CMD.SWITCH,
						codesCmd: CMD.CODES
					}
				})
			});
			return;
		}
		if(msg.channel.type !== "dm") {
			const enforcingEnabled = await getGuildPref(msg.guild, this.prefs.guildEnforce, true);
			if(enforcingEnabled) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_ENFORCEDLANG")
				});
				return;
			}
		}
		const lang = msg.content.slice(CMD.SWITCH.length).trim();
		if(!$localizer.languageExists(lang)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, u, "LANGUAGE_SWITCH_ERRLANGNOTFOUND")
			});
			return;
		}
		await setUserPref(u, this.prefs.user, lang);
		await forceUserLanguageUpdate(u);
		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, u, {
				key: "LANGUAGE_SWITCH_DONE",
				formatOptions: {
					lang: `${await localizeForUser(u, "+NAME")} (${await localizeForUser(u, "+COUNTRY")})`
				}
			})
		});
	}

	async getCodes(msg: Message) {
		const u = msg.member || msg.author;
		let str = `# ${await localizeForUser(u, "LANGUAGE_CODES_HEADER")}\n\n`;
		const langs = $localizer.loadedLanguages;
		for(const lang of langs) {
			str += `* ${lang}: `;
			str += await $localizer.getString(lang, "+NAME");
			str += ` (${await $localizer.getString(lang, "+COUNTRY")})`;
			str += ` - ${(await $localizer.getString(lang, "+COVERAGE"))}%`;
			str += `${!(await $localizer.getString(lang, "+COMMUNITY_MANAGED") === "false") ? ` ${await localizeForUser(u, "LANGUAGE_CODES_ITEM_CM")}` : ""}\n`;
		}
		msg.channel.send(str, {
			code: "md",
			split: true
		});
	}

	isAdmin(member: GuildMember) {
		return member.permissions.has(["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"], true);
	}

	async guildSwitch(msg: Message) {
		if(msg.channel.type !== "text") {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_ONLYGUILDS")
			});
			return;
		}
		if(!this.isAdmin(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_NOPERMISSIONS")
			});
			return;
		}
		if(msg.content === CMD.GUILDS_SWITCH) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "LANGUAGE_GUILD_SWITCH_USAGE",
					formatOptions: {
						prefix: CMD.GUILDS_SWITCH,
						codesCmd: CMD.CODES
					}
				})
			});
			return;
		}
		const lang = msg.content.slice(CMD.GUILDS_SWITCH.length).trim();
		if(!$localizer.languageExists(lang)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_SWITCH_ERRLANGNOTFOUND")
			});
			return;
		}
		const enforcingEnabled = await getGuildPref(msg.guild, this.prefs.guildEnforce, true);
		await setGuildPref(msg.guild, this.prefs.guild, lang);
		await forceGuildLanguageUpdate(msg.guild);
		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: enforcingEnabled ? "LANGUAGE_GUILD_SWITCH_DONE" : "LANGUAGE_GUILD_SWITCH_DONE_ENFORCING",
				formatOptions: {
					lang: `${$localizer.getString(lang, "+NAME")} (${$localizer.getString(lang, "+COUNTRY")})`
				}
			})
		});
	}

	async guildEnforce(msg: Message) {
		if(msg.channel.type !== "text") {
			msg.channel.send("", {
				// LANGUAGE_GUILD_SWITCH_ONLYGUILDS => "Это работает только в гильдиях"
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_ONLYGUILDS")
			});
			return;
		}
		if(!this.isAdmin(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_NOPERMISSIONS")
			});
			return;
		}
		if(msg.content === CMD.GUILDS_ENFORCE) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "LANGUAGE_GUILD_ENFORCE_USAGE")
			});
			return;
		}
		const arg = msg.content.slice(CMD.GUILDS_ENFORCE.length).trim();
		if(!["true", "false"].includes(arg)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "LANGUAGE_GUILD_ENFORCE_ARGERR")
			});
			return;
		}
		const enforcingEnabled = await getGuildPref(msg.guild, this.prefs.guildEnforce, true);
		const shouldEnableEnforcing = arg === "true";
		if((enforcingEnabled && shouldEnableEnforcing) || (!enforcingEnabled && !shouldEnableEnforcing)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "LANGUAGE_GUILD_ENFORCE_ALREADY",
					formatOptions: {
						enforcingEnabled: enforcingEnabled
					}
				})
			});
			return;
		}
		await setGuildPref(msg.guild, this.prefs.guildEnforce, shouldEnableEnforcing);
		await forceGuildEnforceUpdate(msg.guild);
		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: "LANGUAGE_GUILD_ENFORCE_CHANGED",
				formatOptions: {
					enabled: shouldEnableEnforcing
				}
			})
		});
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = SetLanguageCommand;