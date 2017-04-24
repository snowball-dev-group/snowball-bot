import { IProfilesPlugin } from "../plugin";
import { Message, GuildMember } from "discord.js";
import { generateEmbed, EmbedType, IEmbedOptionsField } from "../../../utils/utils";
import { IBlobResponse, IRegionalProfile } from "./owApiInterfaces";
import { getProfile, IOverwatchProfilePluginInfo } from "./overwatch";

const ACCEPTED_REGIONS = ["eu", "kr", "us"];
const ACCEPTED_PLATFORMS = ["pc", "xbl", "psn"];

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

        let info = {
            platform: args[2],
            region: args[1].toLowerCase() || "eu",
            battletag: args[0].replace(/\#/i, "-"),
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
            profile = getProfile(info.battletag, info.region, info.platform);
        } catch (err) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, err.message)
            });
            throw err;
        }

        if(!profile) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, "Вы не играете на этом регионе!")
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

        let profile:IRegionalProfile = await getProfile(info.battletag, info.region, info.platform);

        if(!profile) {
            throw new Error("Can't get profile");
        }

        return {
            inline: true,
            name: info.platform ? `<:ow:306134976670466050> ${info.platform} Rating` : "<:ow:306134976670466050> Rating",
            value: `${profile.stats.competitive.overall_stats.comprank}\n${profile.stats.competitive.game_stats.games_won} won (${profile.stats.competitive.overall_stats.games} total)`
        };
    }

    async unload() { return true; }
}

module.exports = RatingProfilePlugin;