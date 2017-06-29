import { GuildMember, User, Guild } from "discord.js";
import { getPreferenceValue as getUserPreferenceValue, setPreferenceValue as setUserPreferenceValue } from "./userPrefs";
import { getPreferenceValue as getGuildPreferenceValue, setPreferenceValue as setGuildPreferenceValue } from "./guildPrefs";

type ind = User | GuildMember;
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

export async function localizeForUser(u:ind, str:string, formatOpts?:any) {
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

export async function forceUserLanguageUpdate(u:ind) {
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