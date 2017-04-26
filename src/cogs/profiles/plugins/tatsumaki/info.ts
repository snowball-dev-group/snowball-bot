import { IProfilesPlugin } from "../plugin";
import { GuildMember } from "discord.js";
import { IEmbedOptionsField, escapeDiscordMarkdown, getLogger } from "../../../utils/utils";
import { getTatsuProfile, IUserInfo } from "./tatsumaki";

const LOG = getLogger("TatsuPlugin");

export interface ITatsumakiInfo {
    uid:string;
}

export class TatsumakiProfilePlugin implements IProfilesPlugin {
    public name = "tatsumaki_info";
    private apiKey:string;

    constructor(apiKey:string) {
        this.apiKey = apiKey;
    }

    async setup(str:string, member:GuildMember) {
        let js:ITatsumakiInfo = {
            uid: member.id
        };

        try {
            await getTatsuProfile(js.uid, this.apiKey);
        } catch (err) {
            LOG("err", `${js.uid} (setup)| Can't get Tatsumaki profile`, err);
            throw new Error("Failed to get Tatsumaki profile!");
        }

        return {
            json: JSON.stringify(js),
            example: await this.getEmbed(js)
        };
    }

    async getEmbed(info:ITatsumakiInfo|string) : Promise<IEmbedOptionsField> {
        if(typeof info !== "object") {
            info = JSON.parse(info) as ITatsumakiInfo;
        }

        let logPrefix = `${info.uid} (getEmbed)|`;
        let profile:IUserInfo|undefined = undefined;

        try {
            LOG("info", "Getting Tatsumaki profile...");
            profile = await getTatsuProfile(info.uid, this.apiKey);
            LOG("ok", logPrefix, "Got Tatsumaki profile!");
        } catch (err) {
            LOG("err", logPrefix, "Error", err);
            throw new Error("Failed to get Tatsumaki profile.");
        }

        if(!profile) {
            LOG("err", logPrefix, "No 'profile' variable!");
            throw new Error("Internal Error");
        }

        LOG("ok", logPrefix, "Generating embed");

        try {
            return {
                inline: true,
                name: "<:tatsu:306223189628026881> Tatsumaki",
                value: `**${escapeDiscordMarkdown(profile.name)}**\n**+${profile.reputation}rep**\nУровень: ${profile.level} (${profile.total_xp}XP)\nКредиты: ${profile.credits}\nГлоб. ранк: #${profile.rank}`
            };
        } catch (err) {
            LOG("err", logPrefix, "Failed to generate embed", err);
            throw new Error("Failed to generate embed");
        }
    }

    async unload() { return true; }
}

module.exports = TatsumakiProfilePlugin;