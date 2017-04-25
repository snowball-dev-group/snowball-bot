import { IProfilesPlugin } from "../plugin";
import { Message, GuildMember } from "discord.js";
import { generateEmbed, EmbedType, IEmbedOptionsField, getLogger } from "../../../utils/utils";
import { IBlobResponse, IRegionalProfile } from "./owApiInterfaces";
import { getProfile, IOverwatchProfilePluginInfo } from "./overwatch";

const ACCEPTED_REGIONS = ["eu", "kr", "us"];
const ACCEPTED_PLATFORMS = ["pc", "xbl", "psn"];
const LOG = getLogger("OWRatingPlugin");

export class RatingProfilePlugin implements IProfilesPlugin {
    public name = "ow_rating";

    async setup(str:string, member:GuildMember, msg:Message) {
        let status = "**Загрузка...**", prevStatus = status;

        let statusMsg = await msg.channel.sendMessage("", {
            embed: generateEmbed(EmbedType.Progress, status)
        }) as Message;

        let postStatus = async () => {
            statusMsg = await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Progress, prevStatus + "\n" + status)
            });
            prevStatus = statusMsg.content;
        }

        let args = str.split(";").map(arg => arg.trim());

        if(args.length === 0) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Аргументы не предоставлены.")
            });
            throw new Error("Invalid argumentation");
        }

        let info = {
            platform: (args[2] || "pc").toLowerCase(),
            region: (args[1] || "eu").toLowerCase(),
            battletag: args[0].replace(/\#/i, () => "-"),
            verifed: false
        };

        if(ACCEPTED_REGIONS.indexOf(info.region) === -1) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Неправильный регион введен.", {
                    fields: [{
                        inline: false,
                        name: "Доступные регионы",
                        value: ACCEPTED_REGIONS.join("\n")
                    }]
                })
            });
            throw new Error("Invalid argumentation");
        }

        if(ACCEPTED_PLATFORMS.indexOf(info.platform)) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Неправильная платформа введена.", {
                    fields: [{
                        inline: false,
                        name: "Доступные платформы:",
                        value: ACCEPTED_PLATFORMS.join("\n")
                    }]
                })
            });
            throw new Error("Invalid argumentantion");
        }

        if(!info.battletag) {
            throw new Error("Invalid argumentation");
        }

        status = "Получение профиля...";
        postStatus();
        let profile:IBlobResponse|null = null;
        try {
            profile = await getProfile(info.battletag, info.region, info.platform);
        } catch (err) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, err.message)
            });
            throw err;
        }

        if(!profile) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Вы не играете на этом регионе или профиль не найден.")
            });
            throw new Error("Player not registered on this region.");
        }

        info.verifed = true;

        let json = JSON.stringify(info);

        return {
            json: json,
            example: await this.getEmbed(json)
        }
    }

    async getEmbed(info:string|IOverwatchProfilePluginInfo) : Promise<IEmbedOptionsField> {
        if(typeof info !== "object") {
            info = JSON.parse(info) as IOverwatchProfilePluginInfo;
        }

        let profile:IRegionalProfile|undefined = undefined;
        try {
            profile = await getProfile(info.battletag, info.region, info.platform);
        } catch (err) {
            LOG("err", "Error during getting profile", err, info);
            throw new Error("Can't get profile")
        }

        if(!profile) {
            LOG("err", "Can't get profile: ", info);
            throw new Error("Exception not catched, but value not present.");
        }

        return {
            inline: true,
            name: "<:ow:306134976670466050> Overwatch",
            value: `**${(100 * profile.stats.quickplay.overall_stats.prestige) + profile.stats.competitive.overall_stats.level}LVL**\n${this.getTierEmoji(profile.stats.competitive.overall_stats.tier)} ${profile.stats.competitive ? `${profile.stats.competitive.overall_stats.comprank}\n${profile.stats.competitive.game_stats.games_won} games won (${profile.stats.competitive.overall_stats.games} total)` : "not ranked" }`
        };
    }

    getTierEmoji(tier:"bronze"|"silver"|"gold"|"platinum"|"diamond"|"master"|"grandmaster") {
        switch(tier) {
            default: return "<:bronze:306194850796273665>";
            case "silver": return "<:silver:306194903464148992>";
            case "gold": return "<:gold:306194951568621568>";
            case "platinum": return "<:platinum:306195013929533441>";
            case "diamond": return "<:diamond:306195127226073089>";
            case "master": return "<:master:306195210348527626>";
            case "grandmaster": return "<:grandmaster:306195240568487936>";
        }
    }

    async unload() { return true; }
}

module.exports = RatingProfilePlugin;