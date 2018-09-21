import * as UserPreferences from "@utils/userPreferences";
import * as GuildPreferences from "@utils/guildPreferences";
import * as utils from "@utils/utils";
import * as getLogger from "loggy";
import { GuildMember, User, Guild } from "discord.js";
import { IFormatMessageVariables } from "@sb-types/Localizer/HumanizerInterfaces";
import { IHumanizerOptionsOverrides, Unit } from "@sb-types/Localizer/Humanizer";
import { INullableHashMap } from "@sb-types/Types";
import { intlAcceptsTimezone } from "@utils/extensions";
import { DateTime } from "luxon";

export type UserIdentify = User | GuildMember;
const LOG = getLogger("Utils:EZ-I18N");
const PREFERENCE_USER_LANGUAGE = ":language";
const PREFERENCE_USER_TIMEZONE = ":timezone";
const PREFERENCE_GUILD_LANGUAGE = ":language";
const PREFERENCE_GUILD_TIMEZONE = ":timezone";
const PREFERENCE_GUILD_ENFORCE = ":enforce_lang";
const DEFAULT_LANGUAGE = $localizer.defaultLanguage;
const DEFAULT_TIMEZONE = (() => {
	// ! You might want to override this
	const DEFAULT_TZ = "UTC";

	// TODO: make property in localizer

	const enVal = process.env["I18N_DEFAULT_TIMEZONE"];
	if (!enVal) { return DEFAULT_TZ; }

	// checking if valid
	if (!intlAcceptsTimezone(enVal)) {
		return DEFAULT_TZ;
	}

	return enVal;
})();
const DEFAULT_ENFORCE_STATUS = (() => {
	// ! You might want to override this
	const DEFAULT_ENFORCE = false;

	// trying to get from process env
	const enVal = process.env["I18N_DEFAULT_ENFORCE"];
	if (!enVal) { return DEFAULT_ENFORCE; }

	switch (enVal.toLowerCase()) {
		case "true": return true;
		case "false": return false;
	}

	return DEFAULT_ENFORCE;
})();

// <userId, languageCode>
const usersCache: INullableHashMap<string> = Object.create(null);
// <guildId, enforcingMode>
const guildEnforceCache: INullableHashMap<boolean> = Object.create(null);
// <guildId, languageCode>
const guildsCache: INullableHashMap<string> = Object.create(null);
// <userId, timezone>
const usersTimezonesCache: INullableHashMap<string> = Object.create(null);
// <guildId, timezone>
const guildTimezonesCache: INullableHashMap<string> = Object.create(null);

export function getPreferencesNames() {
	return {
		guild: PREFERENCE_GUILD_LANGUAGE,
		guildTimezone: PREFERENCE_GUILD_TIMEZONE,
		guildEnforce: PREFERENCE_GUILD_ENFORCE,
		user: PREFERENCE_USER_LANGUAGE,
		userTimezone: PREFERENCE_GUILD_TIMEZONE
	};
}

// #region Users API

// #region   Localization / Getters

// #region     Localization

export async function localizeForUser(user: UserIdentify, str: string, formatOpts?: IFormatMessageVariables) {
	const lang = await getUserLanguage(user);

	return formatOpts ? $localizer.getFormattedString(lang, str, formatOpts) : $localizer.getString(lang, str);
}

export async function humanizeDurationForUser(user: UserIdentify, duration: number, unit: Unit = "ms", humanizerOptions?: IHumanizerOptionsOverrides) {
	return $localizer.humanizeDuration(await getUserLanguage(user), duration, unit, humanizerOptions);
}

export async function toUserLocaleString(user: UserIdentify, date: Date | DateTime | number, options?: Intl.DateTimeFormatOptions) {
	if (typeof date === "number") {
		date = DateTime.fromMillis(date);
	} else if (date instanceof Date) {
		date = DateTime.fromJSDate(date);
	}

	return date
		.setZone(await getUserTimezone(user))
		.setLocale(await getUserLanguage(user))
		.toLocaleString(options);
}

// #endregion

// #region     Getters

export async function getUserLanguage(user: UserIdentify) {
	if (user instanceof GuildMember && await isGuildEnforceEnabled(user.guild)) {
		// no need in updating cache and checking user caching
		// as guild enforces their language

		return getGuildLanguage(user.guild);
	}

	const cached = usersCache[user.id];

	return cached ? cached : forceUserLanguageUpdate(user);
}

export async function getUserTimezone(user: UserIdentify) {
	const cached = usersTimezonesCache[user.id];

	return cached ? cached : forceUserTimezoneUpdate(user);
}

// #endregion

// #region   Force Updates

export async function forceUserLanguageUpdate(user: UserIdentify): Promise<string> {
	let preferredLanguage: string | undefined = await UserPreferences.getPreferenceValue(user, PREFERENCE_USER_LANGUAGE);
	if (!preferredLanguage) {
		// user has no language set
		// let set it to the current guilds language
		if (user instanceof GuildMember) {
			// yeah, we could set guild's language
			// as user comes from some of the guilds
			const guildLanguage = await getGuildLanguage(user.guild);
			await UserPreferences.setPreferenceValue(user, PREFERENCE_USER_LANGUAGE, guildLanguage);

			return usersCache[user.id] = guildLanguage;
		}
		// oh, seems we can't set guild's language
		// let's use default localizer's language!
		await UserPreferences.setPreferenceValue(user, PREFERENCE_USER_LANGUAGE, DEFAULT_LANGUAGE);

		return usersCache[user.id] = DEFAULT_LANGUAGE;
	}

	if (!$localizer.languageExists(preferredLanguage)) {
		LOG(
			"warn",
			`Cannot find preferred language "${preferredLanguage}" of user ${user.id}, "${DEFAULT_LANGUAGE}" will be used instead`
		);

		preferredLanguage = DEFAULT_LANGUAGE;
	}

	return usersCache[user.id] = preferredLanguage;
}

export async function forceUserTimezoneUpdate(user: UserIdentify): Promise<string> {
	const preferredTimezone: string | undefined = await UserPreferences.getPreferenceValue(user, PREFERENCE_USER_TIMEZONE);
	if (!preferredTimezone) {
		if (user instanceof GuildMember) {
			const guildTimezone = await getGuildTimezone(user.guild);
			await UserPreferences.setPreferenceValue(user, PREFERENCE_USER_TIMEZONE, guildTimezone);

			return usersTimezonesCache[user.id] = guildTimezone;
		}
		await UserPreferences.setPreferenceValue(user, PREFERENCE_USER_TIMEZONE, DEFAULT_TIMEZONE);

		return usersTimezonesCache[user.id] = DEFAULT_TIMEZONE;
	}

	return usersTimezonesCache[user.id] = preferredTimezone;
}

// #endregion

// #endregion

// #endregion

// #region Guilds API

// #region   Localization / Getters

// #region    Localization

export async function localizeForGuild(guild: Guild, str: string, formatOpts?: IFormatMessageVariables) {
	const lang = await getGuildLanguage(guild);

	return formatOpts ? $localizer.getFormattedString(lang, str, formatOpts) : $localizer.getString(lang, str);
}

export async function humanizeDurationForGuild(guild: Guild, duration: number, unit: Unit = "ms", humanizerOptions?: IHumanizerOptionsOverrides) {
	$localizer.humanizeDuration(await getGuildLanguage(guild), duration, unit, humanizerOptions);
}

export async function toGuildLocaleString(guild: Guild, date: Date | DateTime | number, options?: Intl.DateTimeFormatOptions) {
	if (typeof date === "number") {
		date = DateTime.fromMillis(date);
	} else if (date instanceof Date) {
		date = DateTime.fromJSDate(date);
	}

	return date
		.setZone(await getGuildTimezone(guild))
		.setLocale(await getGuildLanguage(guild))
		.toLocaleString(options);
}

// #endregion

// #region    Getters

export async function getGuildLanguage(guild: Guild) {
	const cached = guildsCache[guild.id];

	return cached ? cached : forceGuildLanguageUpdate(guild);
}

export async function getGuildTimezone(guild: Guild) {
	const cached = guildTimezonesCache[guild.id];

	return cached ? cached : forceGuildTimezoneUpdate(guild);
}

// #endregion

// #endregion

// #region   Enforce

export async function isGuildEnforceEnabled(guild: Guild) {
	const cached = guildEnforceCache[guild.id];

	return cached ? cached : forceGuildEnforceUpdate(guild);
}

// #endregion

// #region   Force Updates

export async function forceGuildLanguageUpdate(guild: Guild): Promise<string> {
	let guildLanguage = await GuildPreferences.getPreferenceValue(guild, PREFERENCE_GUILD_LANGUAGE);
	if (!guildLanguage) {
		await GuildPreferences.setPreferenceValue(guild, PREFERENCE_GUILD_LANGUAGE, DEFAULT_LANGUAGE);

		return guildsCache[guild.id] = DEFAULT_LANGUAGE;
	}

	if (!$localizer.languageExists(guildLanguage)) {
		LOG(
			"warn",
			`Cannot find preferred language "${guildLanguage}" of guild ${guild.id}, "${DEFAULT_LANGUAGE}" will be used instead`
		);

		guildLanguage = DEFAULT_LANGUAGE;
	}

	return guildsCache[guild.id] = guildLanguage;
}

export async function forceGuildEnforceUpdate(guild: Guild): Promise<boolean> {
	const enforcingStatus = await GuildPreferences.getPreferenceValue(guild, PREFERENCE_GUILD_ENFORCE, true);
	if (!enforcingStatus) {
		// no enforcing status found
		await GuildPreferences.setPreferenceValue(guild, PREFERENCE_GUILD_ENFORCE, DEFAULT_ENFORCE_STATUS);

		return guildEnforceCache[guild.id] = DEFAULT_ENFORCE_STATUS;
	}

	guildEnforceCache[guild.id] = enforcingStatus;

	return enforcingStatus;
}

export async function forceGuildTimezoneUpdate(guild: Guild): Promise<string> {
	const guildTimezone = await GuildPreferences.getPreferenceValue(guild, PREFERENCE_GUILD_TIMEZONE);
	if (!guildTimezone) {
		await GuildPreferences.setPreferenceValue(guild, PREFERENCE_GUILD_TIMEZONE, DEFAULT_TIMEZONE);

		return guildTimezonesCache[guild.id] = DEFAULT_TIMEZONE;
	}

	return guildTimezonesCache[guild.id] = guildTimezone;
}

// #endregion

// #endregion

// #region Embeds

function isCustomString(obj: any): obj is ICustomEmbedString {
	return "custom" in obj && obj["custom"] === true && "string" in obj && !("formattingOptions" in obj) && !("key" in obj);
}

export async function generateLocalizedEmbed(type: utils.EmbedType, target: UserIdentify | Guild, descriptionKey: string | ILocalizedEmbedString | ICustomEmbedString | undefined, options: utils.IEmbedOptions = {}) {
	// based on target define localize function
	const localize = target instanceof Guild ? async (key: string, formatOptions?: IFormatMessageVariables) => {
		return localizeForGuild(target, key, formatOptions);
	} : async (key: string, formatOptions?: IFormatMessageVariables) => {
		return localizeForUser(target, key, formatOptions);
	};

	switch (type) {
		case utils.EmbedType.Error: {
			if (options.errorTitle) { break; }
			options.errorTitle = await localize("EMBED_ERROR");
		} break;
		case utils.EmbedType.Information: {
			if (options.informationTitle) { break; }
			options.informationTitle = await localize("EMBED_INFORMATION");
		} break;
		case utils.EmbedType.OK: {
			if (options.okTitle) { break; }
			options.okTitle = await localize("EMBED_SUCCESS");
		} break;
		case utils.EmbedType.Tada: {
			if (options.tadaTitle) { break; }
			options.tadaTitle = await localize("EMBED_TADA");
		} break;
		case utils.EmbedType.Progress: {
			if (options.progressTitle) { break; }
			options.progressTitle = await localize("EMBED_PROGRESS");
		} break;
		case utils.EmbedType.Question: {
			if (options.questionTitle) { break; }
			options.questionTitle = await localize("EMBED_QUESTION");
		} break;
		case utils.EmbedType.Warning: {
			if (options.warningTitle) { break; }
			options.warningTitle = await localize("EMBED_WARNING");
		} break;
	}

	if (!descriptionKey) {
		return utils.generateEmbed(type, undefined, options);
	}

	if (typeof descriptionKey === "string") {
		if (descriptionKey.startsWith("custom:")) {
			descriptionKey = descriptionKey.slice("custom:".length);

			return utils.generateEmbed(type, descriptionKey, options);
		} else {
			return utils.generateEmbed(type, await localize(descriptionKey), options);
		}
	}

	if (isCustomString(descriptionKey)) {
		return utils.generateEmbed(type, descriptionKey.string, options);
	}

	return utils.generateEmbed(type, await localize(descriptionKey.key, descriptionKey.formatOptions), options);
}

// #region Localizer extending as EZPZ

/**
 * Extends all languages from the folder and assigns extended keys
 * returning function to divest and prune languages from extended keys
 * @param path Path to load language(s) from
 * @returns Function to prune languages and unbind the keys
 */
export async function extendAndAssign(path: string | string[], owner: string) : ExtendAssignReturn {
	const extendedKeys = await $localizer.extendLanguages(
		await $localizer.fileLoader.directoryToLanguagesTree(path)
	);

	$localizer.keysAssignation.assignKeys(extendedKeys, owner);

	return () => {
		$localizer.keysAssignation.divestKeys(extendedKeys, owner);

		return $localizer.pruneLanguages(extendedKeys);
	};
}

type ExtendAssignReturn = Promise<ExtensionAssignUnhandleFunction>;
export type ExtensionAssignUnhandleFunction = () => string[];

// #endregion

// #region Interfaces

interface ILocalizedEmbedString {
	key: string;
	formatOptions: IFormatMessageVariables;
}

interface ICustomEmbedString {
	custom: boolean;
	string: string;
}

// #endregion

// #endregion
