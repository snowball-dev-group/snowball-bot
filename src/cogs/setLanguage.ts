import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js";
import { command, Category, IArgumentInfo } from "./utils/help";
import { localizeForUser, getPrefsNames, forceUserLanguageUpdate } from "./utils/ez-i18n";
import { startsOrEqual, slice } from "./utils/text";
import { generateLocalizedEmbed, EmbedType } from "./utils/utils";
import { setPreferenceValue as setUserPref } from "./utils/userPrefs";

const BASE_PREFIX = "!sb_lang";
const CMD = {
    SWITCH: `${BASE_PREFIX} switch`,
    CODES: `${BASE_PREFIX} codes`
};

@command(Category.Language, slice(BASE_PREFIX, 1), "loc:LANGUAGE_META_DEFAULT")
@command(Category.Language, slice(CMD.SWITCH, 1), "loc:LANGUAGE_META_SWITCH", new Map<string, IArgumentInfo>([
    ["loc:LANGUAGE_META_SWITCH_ARG0", {
        optional: false,
        description: "loc:LANGUAGE_META_SWITCH_ARG0_DESC"
    }]
]))
class HelpfulCommand extends Plugin implements IModule {
    prefs = getPrefsNames();

    constructor() {
        super({
            "message": (msg:Message) => this.onMessage(msg)
        });
    }

    async onMessage(msg:Message) {
        if(msg.channel.type !== "dm" && msg.channel.type !== "text") {
            return;
        }
        if(msg.content === BASE_PREFIX) {
            return this.getCurrentLang(msg);
        } else if(startsOrEqual(CMD.SWITCH, msg.content)) {
            await this.switchLanguage(msg);
        } else if(startsOrEqual(CMD.CODES, msg.content)) {
            await this.getCodes(msg);
        }
    }

    async getCurrentLang(msg:Message) {
        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.Information, msg.member || msg.author, {
                key: "LANGUAGE_CURRENTLANG",
                formatOptions: {
                    lang: `${await localizeForUser(msg.member, "+NAME")} (${await localizeForUser(msg.member, "+COUNTRY")})`,
                    coverage: await localizeForUser(msg.member, "+COVERAGE")
                }
            })
        });
    }

    async switchLanguage(msg:Message) {
        let u = msg.member || msg.author;
        if(msg.content === CMD.SWITCH) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Information, u, "LANGUAGE_SWITCH_USAGE")
            });
            return;
        }
        let lang = msg.content.slice(CMD.SWITCH.length).trim();
        if(!localizer.languageExists(lang)) {
            msg.channel.send("", {
                embed: await generateLocalizedEmbed(EmbedType.Error, u, "LANGUAGE_SWITCH_ERRLANGNOTFOUND")
            });
            return;
        }
        await setUserPref(msg.member, this.prefs.user, lang);
        await forceUserLanguageUpdate(msg.member);
        msg.channel.send("", {
            embed: await generateLocalizedEmbed(EmbedType.OK, u, {
                key: "LANGUAGE_SWITCH_DONE",
                formatOptions: {
                    lang: `${await localizeForUser(msg.member, "+NAME")} (${await localizeForUser(msg.member, "+COUNTRY")})`
                }
            })
        });
    }

    async getCodes(msg:Message) {
        let str = `# ${await localizeForUser(msg.member, "LANGUAGE_CODES_HEADER")}\n\n`;
        let langs = localizer.loadedLanguages;
        for(let lang of langs) {
            str += `* ${lang}: `;
            str += await localizer.getString(lang, "+NAME");
            str += ` (${await localizer.getString(lang, "+COUNTRY")})`;
            str += ` - ${(await localizer.getString(lang, "+COVERAGE"))}%\n`;
        }
        msg.channel.send(str, {
            code: "md",
            split: true
        });
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = HelpfulCommand;