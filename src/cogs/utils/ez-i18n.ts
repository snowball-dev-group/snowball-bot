import { GuildMember, User, Guild } from "discord.js";
import { getPreferenceValue as getUserPreferenceValue, setPreferenceValue as setUserPreferenceValue } from "./userPrefs";
import { getPreferenceValue as getGuildPreferenceValue, setPreferenceValue as setGuildPreferenceValue } from "./guildPrefs";
import { EmbedType, IEmbedOptions, generateEmbed } from "./utils";
import { IFormatMessageVariables, HumanizerUnitToConvert } from "../../types/Localizer";
import { IHumanizerOptionsOverrides } from "../../types/Humanizer";
import { INullableHashMap } from "../../types/Types";

export type UserIdentify = User | GuildMember;
const PREFERENCE_USER_LANGUAGE = ":language";
const PREFERENCE_GUILD_LANGUAGE = ":language";
const PREFERENCE_GUILD_ENFORCE = ":enforce_lang";
const DEFAULT_LANGUAGE = $localizer.defaultLanguage;
const DEFAULT_ENFORCE_STATUS = false;

// <userId, languageCode>
const usersCache: INullableHashMap<string> = Object.create(null);
// <guildId, enforcingMode>
const guildEnforceCache: INullableHashMap<boolean> = Object.create(null);
// <guildId, languageCode>
const guildsCache: INullableHashMap<string> = Object.create(null);

export function getPrefsNames() {
	return {
		guild: PREFERENCE_GUILD_LANGUAGE,
		guildEnforce: PREFERENCE_GUILD_ENFORCE,
		user: PREFERENCE_USER_LANGUAGE
	};
}

export async function getGuildLanguage(guild: Guild) {
	const cached = guildsCache[guild.id];
	return cached ? cached : forceGuildLanguageUpdate(guild);
}

export async function isGuildEnforceEnabled(guild: Guild) {
	const cached = guildEnforceCache[guild.id];
	return cached ? cached : forceGuildEnforceUpdate(guild);
}

export async function getUserLanguage(user: UserIdentify) {
	if(user instanceof GuildMember && await isGuildEnforceEnabled(user.guild)) {
		// no need in updating cache and checking user caching
		// as guild enforces their language
		return getGuildLanguage(user.guild);
	}
	const cached = usersCache[user.id];
	return cached ? cached : forceUserLanguageUpdate(user);
}

export async function localizeForUser(user: UserIdentify, str: string, formatOpts?: IFormatMessageVariables) {
	const lang = await getUserLanguage(user);
	return formatOpts ? $localizer.getFormattedString(lang, str, formatOpts) : $localizer.getString(lang, str);
}

export async function localizeForGuild(guild: Guild, str: string, formatOpts?: IFormatMessageVariables) {
	const lang = await getGuildLanguage(guild);
	return formatOpts ? $localizer.getFormattedString(lang, str, formatOpts) : $localizer.getString(lang, str);
}

export async function humanizeDurationForUser(user: UserIdentify, duration: number, unit: HumanizerUnitToConvert = "ms", humanizerOptions?: IHumanizerOptionsOverrides) {
	return $localizer.humanizeDuration(await getUserLanguage(user), duration, unit, humanizerOptions);
}

export async function humanizeDurationForGuild(guild: Guild, duration: number, unit: HumanizerUnitToConvert = "ms", humanizerOptions?: IHumanizerOptionsOverrides) {
	$localizer.humanizeDuration(await getGuildLanguage(guild), duration, unit, humanizerOptions);
}

export async function forceGuildEnforceUpdate(guild: Guild): Promise<boolean> {
	const enforcingStatus = await getGuildPreferenceValue(guild, PREFERENCE_GUILD_ENFORCE, true);
	if(!enforcingStatus) {
		// no enforcing status found
		await setGuildPreferenceValue(guild, PREFERENCE_GUILD_ENFORCE, DEFAULT_ENFORCE_STATUS);
		return guildEnforceCache[guild.id] = DEFAULT_ENFORCE_STATUS;
	}
	guildEnforceCache[guild.id] = enforcingStatus;
	return enforcingStatus;
}

export async function forceUserLanguageUpdate(user: UserIdentify): Promise<string> {
	const preferedLanguage: string | undefined = await getUserPreferenceValue(user, PREFERENCE_USER_LANGUAGE);
	if(!preferedLanguage) {
		// user has no language set
		// let set it to the current guilds language
		if(user instanceof GuildMember) {
			// yeah, we could set guild's language
			// as user comes from some of the guilds
			const guildLanguage = await getGuildLanguage(user.guild);
			await setUserPreferenceValue(user, PREFERENCE_USER_LANGUAGE, guildLanguage);
			return usersCache[user.id] = guildLanguage;
		}
		// oh, seems we can't set guild's language
		// let's use default localizer's language!
		await setUserPreferenceValue(user, PREFERENCE_USER_LANGUAGE, DEFAULT_LANGUAGE);
		return usersCache[user.id] = DEFAULT_LANGUAGE;
	}
	return usersCache[user.id] = preferedLanguage;
}

export async function forceGuildLanguageUpdate(guild: Guild): Promise<string> {
	const guildLanguage = await getGuildPreferenceValue(guild, PREFERENCE_GUILD_LANGUAGE);
	if(!guildLanguage) {
		await setGuildPreferenceValue(guild, PREFERENCE_GUILD_LANGUAGE, DEFAULT_LANGUAGE);
		return guildsCache[guild.id] = DEFAULT_LANGUAGE;
	}
	return guildsCache[guild.id] = guildLanguage;
}

interface ILocalizedEmbedString {
	key: string;
	formatOptions: IFormatMessageVariables;
}

interface ICustomString {
	custom: boolean;
	string: string;
}

function isCustomString(obj: any): obj is ICustomString {
	return "custom" in obj && obj["custom"] === true && "string" in obj && !("formattingOptions" in obj) && !("key" in obj);
}

export async function generateLocalizedEmbed(type: EmbedType, user: UserIdentify, descriptionKey: string | ILocalizedEmbedString | ICustomString, options: IEmbedOptions = {}) {
	switch(type) {
		case EmbedType.Error: {
			if(options.errorTitle) { break; }
			options.errorTitle = await localizeForUser(user, "EMBED_ERROR");
		} break;
		case EmbedType.Information: {
			if(options.informationTitle) { break; }
			options.informationTitle = await localizeForUser(user, "EMBED_INFORMATION");
		} break;
		case EmbedType.OK: {
			if(options.okTitle) { break; }
			options.okTitle = await localizeForUser(user, "EMBED_SUCCESS");
		} break;
		case EmbedType.Tada: {
			if(options.tadaTitle) { break; }
			options.tadaTitle = await localizeForUser(user, "EMBED_TADA");
		} break;
		case EmbedType.Progress: {
			if(options.progressTitle) { break; }
			options.progressTitle = await localizeForUser(user, "EMBED_PROGRESS");
		} break;
		case EmbedType.Question: {
			if(options.questionTitle) { break; }
			options.questionTitle = await localizeForUser(user, "EMBED_QUESTION");
		} break;
		case EmbedType.Warning: {
			if(options.warningTitle) { break; }
			options.warningTitle = await localizeForUser(user, "EMBED_WARNING");
		} break;
	}
	if(typeof descriptionKey === "string" && descriptionKey.startsWith("custom:")) {
		descriptionKey = descriptionKey.slice("custom:".length);
		return generateEmbed(type, descriptionKey, options);
	} else {
		if(typeof descriptionKey === "string") {
			return generateEmbed(type, await localizeForUser(user, descriptionKey), options);
		} else {
			if(isCustomString(descriptionKey)) {
				return generateEmbed(type, descriptionKey.string, options);
			} else {
				return generateEmbed(type, await localizeForUser(user, descriptionKey.key, descriptionKey.formatOptions), options);
			}
		}
	}
}
