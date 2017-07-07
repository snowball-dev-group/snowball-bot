import { IProfilesPlugin, AddedProfilePluginType } from "../plugin";
import { Message, GuildMember } from "discord.js";
import { generateEmbed, EmbedType, IEmbedOptionsField, getLogger } from "../../../utils/utils";
import { localizeForUser } from "../../../utils/ez-i18n";
import { IRegionalProfile } from "./owApiInterfaces";
import { getProfile, IOverwatchProfilePluginInfo } from "./overwatch";

const ACCEPTED_REGIONS = ["eu", "kr", "us"];
const ACCEPTED_PLATFORMS = ["pc", "xbl", "psn"];
const LOG = getLogger("OWRatingPlugin");

export class OWStatsProfilePlugin implements IProfilesPlugin {

    async getSetupArgs(caller:GuildMember) {
        return await localizeForUser(caller, "OWPROFILEPLUGIN_DEFAULT_ARGS");
    }

    async setup(str:string, member:GuildMember, msg:Message) {
        let status = await localizeForUser(member, "OWPROFILEPLUGIN_LOADING"), prevStatus = status;

        let statusMsg = await msg.channel.sendMessage("", {
            embed: generateEmbed(EmbedType.Progress, status)
        }) as Message;

        let postStatus = async () => {
            statusMsg = await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Progress, prevStatus + "\n" + status)
            });
            prevStatus = statusMsg.content;
        };

        let args = str.split(";").map(arg => arg.trim());

        if(args.length === 0) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_ARGS"))
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
                embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGREGION"), {
                    fields: [{
                        inline: false,
                        name: await localizeForUser(member, "OWPROFILEPLUGIN_AVAILABLE_REGIONS"),
                        value: ACCEPTED_REGIONS.join("\n")
                    }]
                })
            });
            throw new Error("Invalid argumentation");
        }

        if(ACCEPTED_PLATFORMS.indexOf(info.platform)) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGPLATFORM"), {
                    fields: [{
                        inline: false,
                        name: await localizeForUser(member, "OWPROFILEPLUGIN_AVAILABLE_PLATFORMS"),
                        value: ACCEPTED_PLATFORMS.join("\n")
                    }]
                })
            });
            throw new Error("Invalid argumentantion");
        }

        if(!info.battletag) {
            throw new Error("Invalid argumentation");
        }

        status = await localizeForUser(member, "OWPROFILEPLUGIN_FETCHINGPROFILE");
        postStatus();
        let profile:IRegionalProfile|null = null;
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
                embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_FETCHINGFAILED"))
            });
            throw new Error("Player not registered on this region.");
        }

        info.verifed = true;

        let json = JSON.stringify(info);

        await statusMsg.delete();

        return {
            json: json,
            type: AddedProfilePluginType.Embed
        };
    }

    async getEmbed(info:string|IOverwatchProfilePluginInfo, caller:GuildMember) : Promise<IEmbedOptionsField> {
        if(typeof info !== "object") {
            info = JSON.parse(info) as IOverwatchProfilePluginInfo;
        }

        let profile:IRegionalProfile|undefined = undefined;
        try {
            profile = await getProfile(info.battletag, info.region, info.platform);
        } catch (err) {
            LOG("err", "Error during getting profile", err, info);
            throw new Error("Can't get profile");
        }

        if(!profile) {
            LOG("err", "Can't get profile: ", info);
            throw new Error("Exception not catched, but value not present.");
        }

        let str = "";

        let tStrs = {
            competitive: await localizeForUser(caller, "OWPROFILEPLUGIN_COMPETITIVE"),
            quickplay: await localizeForUser(caller, "OWPROFILEPLUGIN_QUICKPLAY"),
        };

        str += `**${(100 * profile.stats.quickplay.overall_stats.prestige) + profile.stats.quickplay.overall_stats.level}LVL**\n`;
        
        let atStrs = {
            win: await localizeForUser(caller, "OWPROFILEPLUGIN_STAT_WIN"),
            loss: await localizeForUser(caller, "OWPROFILEPLUGIN_STAT_LOSS"),
            tie: await localizeForUser(caller, "OWPROFILEPLUGIN_STAT_TIE")
        };

        str += `<:competitive:322781963943673866> __**${tStrs.competitive}**__\n`;
        if(!profile.stats.competitive || !profile.stats.competitive.overall_stats.comprank) {
            str += this.getTierEmoji(null);
            str += await localizeForUser(caller, "OWPROFILEPLUGIN_PLACEHOLDER");
        } else {
            let compOveral = profile.stats.competitive.overall_stats;
            str += `${this.getTierEmoji(compOveral.tier)} ${compOveral.comprank} SR\n`;
            str += (await localizeForUser(caller, "OWPROFILEPLUGIN_GAMESPLAYED", {
                games: compOveral.games
            })) + "\n";

            str += ` ${atStrs.win}: ${compOveral.wins}.\n ${atStrs.loss}: ${compOveral.losses}.\n ${atStrs.tie}: ${compOveral.ties}.\n`;
            str += `  (`;
            str += (await localizeForUser(caller, "OWPROFILEPLUGIN_WINRATE", {
                winrate: compOveral.win_rate
            })) + ")";
        }

        str += `\n<:quick:322781693205282816> __**${tStrs.quickplay}**__\n`;
        
        if(!profile.stats.quickplay || !profile.stats.quickplay.overall_stats.games) {
            str += await localizeForUser(caller, "OWPROFILEPLUGIN_PLACEHOLDER");
        } else {
            let qpOveral = profile.stats.quickplay.overall_stats;
            str += (await localizeForUser(caller, "OWPROFILEPLUGIN_GAMESPLAYED", {
                games: qpOveral.games
            })) + "\n";

            str += ` ${atStrs.win}: ${qpOveral.wins}.\n ${atStrs.loss}: ${qpOveral.losses}.\n`;
            str += `  (`;
            str += (await localizeForUser(caller, "OWPROFILEPLUGIN_WINRATE", {
                winrate: qpOveral.win_rate
            })) + ")";
            // str += (await localizeForUser(caller, "OWPROFILEPLUGIN_HOURSPLAYED", {
            //     hours: profile.stats.quickplay.game_stats.time_played
            // })) + "\n";
            // str += await localizeForUser(caller, "OWPROFILEPLUGIN_GAMESWON", {
            //     gamesWon: qpOveral.wins
            // });
        }

        return {
            inline: true,
            name: "<:ow:306134976670466050> Overwatch",
            value: str
        };
    }

    getTierEmoji(tier:"bronze"|"silver"|"gold"|"platinum"|"diamond"|"master"|"grandmaster"|null) {
        switch(tier) {
            default: return "<:bronze:306194850796273665>";
            case null: return "<:no_rating:322361682460672000>";
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

module.exports = OWStatsProfilePlugin;