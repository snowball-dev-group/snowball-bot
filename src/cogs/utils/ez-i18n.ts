import { GuildMember, User, Guild } from "discord.js";
import { getPreferenceValue as getUserPreferenceValue, setPreferenceValue as setUserPreferenceValue } from "./userPrefs";
import { getPreferenceValue as getGuildPreferenceValue, setPreferenceValue as setGuildPreferenceValue } from "./guildPrefs";
import { EmbedType, IEmbedOptions, generateEmbed } from "./utils";

export type identify = User | GuildMember;
const languagePref = ":language";
const guildLangPref = ":language";
const guildEnforcePref = ":enforce_lang";
const defLanguage = "ru-RU";

// <uid, language>
let uCache = new Map<string, string>();
// <gid, enforcing>
let gECache = new Map<string, boolean>();
// <gid, language>
let gCache = new Map<string, string>();

export function getPrefsNames() {
    return {
        guild: guildLangPref,
        guildEnforce: guildEnforcePref,
        user: languagePref
    };
}

export async function getUserLanguage(u:identify) {
    let lang:string|undefined = undefined;
    if(u instanceof GuildMember) {
        // let's check if guild enforces language
        let guildEnforcing = gECache.get(u.guild.id);
        if(guildEnforcing === undefined) {
            // guild enforcing status not cached yet, updating!
            guildEnforcing = await forceGuildEnforceUpdate(u.guild);
        }
        // now it should be tru boolean value
        if(guildEnforcing) {
            // yh, guild enforces language
            // getting guild lang
            let gLang = gCache.get(u.guild.id);
            if(gLang === undefined) {
                // guild language is unknown, fetching from db
                gLang = await forceGuildLanguageUpdate(u.guild);
            }
            if(gLang) {
                lang = gLang;
            }
        }
    } 
    if(!lang) {
        // no guild / lang not set / guild not enforces language
        lang = uCache.get(u.id) || await forceUserLanguageUpdate(u);
    }
    return lang;
}

export async function localizeForUser(u:identify, str:string, formatOpts?:any) {
    let lang = await getUserLanguage(u);
    return formatOpts ? localizer.getFormattedString(lang, str, formatOpts) : localizer.getString(lang, str);
}

export async function forceGuildEnforceUpdate(guild:Guild) {
    let enforcingSt = await getGuildPreferenceValue(guild, guildEnforcePref, true);
    if(enforcingSt === undefined) {
        // no enforcing status, fixing it...
        await setGuildPreferenceValue(guild, guildEnforcePref, false);
        gECache.set(guild.id, false);
        return false;
    } else {
        gECache.set(guild.id, enforcingSt);
        return enforcingSt;
    }
}

export async function forceUserLanguageUpdate(u:identify) {
    let preferableLang:string|undefined = await getUserPreferenceValue(u, languagePref);
    if(preferableLang === undefined) {
        if(u instanceof GuildMember) {
            let gLang = gCache.get(u.guild.id);
            if(gLang === undefined) {
                gLang = await forceGuildLanguageUpdate(u.guild);
            }
            await setUserPreferenceValue(u, languagePref, gLang);
            return gLang;
        } else {
            await setUserPreferenceValue(u, languagePref, defLanguage);
            return defLanguage;
        }
    }
    uCache.set(u.id, preferableLang);
    return uCache.get(u.id);
}

export async function forceGuildLanguageUpdate(guild:Guild) {
    let gLang = await getGuildPreferenceValue(guild, guildLangPref);
    if(gLang === undefined) {
        await setGuildPreferenceValue(guild, guildLangPref, defLanguage);
        gCache.set(guild.id, defLanguage);
        return defLanguage;
    } else {
        gCache.set(guild.id, gLang);
        return gLang;
    }
}

interface ILocalizedEmbedString {
    key:string;
    formatOptions:any;
}

interface ICustomString {
    custom:boolean;
    string:string;
}

function isCustomString(objCt: any): objCt is ICustomString {
    return objCt["custom"] !== undefined;
}

export async function generateLocalizedEmbed(type:EmbedType, user:identify, descriptionKey:string|ILocalizedEmbedString|ICustomString, options:IEmbedOptions = {}) {
    // EMBED_ERROR
    // EMBED_INFORMATION
    // EMBED_SUCCESS
    // EMBED_TADA
    // EMBED_PROGRESS
    // EMBED_QUESTION
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