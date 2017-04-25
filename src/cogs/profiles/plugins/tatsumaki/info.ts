import { IProfilesPlugin } from "../plugin";
import { GuildMember } from "discord.js";
import { IEmbedOptionsField, escapeDiscordMarkdown } from "../../../utils/utils";
import { getTatsuProfile } from "./tatsumaki";

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
        return {
            json: JSON.stringify(js),
            example: await this.getEmbed(js)
        };
    }

    async getEmbed(info:ITatsumakiInfo|string) : Promise<IEmbedOptionsField> {
        if(typeof info !== "object") {
            info = JSON.parse(info) as ITatsumakiInfo;
        }

        let profile = await getTatsuProfile(info.uid, this.apiKey);

        return {
            inline: true,
            name: "<:tatsu:306223189628026881> Tatsumaki",
            value: `**${escapeDiscordMarkdown(profile.name)}**\n**+${profile.reputation}rep**\nУровень: ${profile.level} (${profile.total_xp}XP)\nКредиты: ${profile.credits}\nГлоб. ранк: #${profile.rank}`
        };
    }

    async unload() { return true; }
}

module.exports = TatsumakiProfilePlugin;