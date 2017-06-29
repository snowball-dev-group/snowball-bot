import { IProfilesPlugin, AddedProfilePluginType } from "../plugin";
import { Message, GuildMember } from "discord.js";
import { generateEmbed, EmbedType, IEmbedOptionsField, getLogger } from "../../../utils/utils";
import { localizeForUser } from "../../../utils/ez-i18n";
import { IRegionalProfile, Tier } from "./owApiInterfaces";
import { getProfile, IOverwatchProfilePluginInfo } from "./overwatch";
import * as humanizeDuration from "humanize-duration";

const ACCEPTED_REGIONS = ["eu", "kr", "us"];
const ACCEPTED_PLATFORMS = ["pc", "xbl", "psn"];
const ACCEPTED_SORTS = ["playtime", "winrate"];
const LOG = getLogger("OWRatingPlugin");

type Hero = "reinhardt"|"tracer"|"zenyatta"|"junkrat"|"mccree"|"winston"|"orisa"|"hanzo"|"pharah"|"roadhog"|"zarya"|"torbjorn"|"mercy"|"mei"|"ana"|"widowmaker"|"genji"|"reaper"|"soldier76"|"bastion"|"symmetra"|"dva"|"sombra"|"lucio";
type Sorts = "playtime"|"winrate";
type HeroStats = Array<{
        hero: Hero,
        stat: string
    }>;

interface IOverwatchHeroesProfilePluginInfo extends IOverwatchProfilePluginInfo {
    sortBy:Sorts;
}

export class OWHeroesProfilePlugin implements IProfilesPlugin {
    async getSetupArgs(caller:GuildMember) {
        return await localizeForUser(caller, "OWPROFILEPLUGIN_HEROES_ARGS");
    }

    async setup(str: string, member: GuildMember, msg: Message) {
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
            sortBy: (args[3] || "playtime").toLowerCase(),
            platform: (args[2] || "pc").toLowerCase(),
            region: (args[1] || "eu").toLowerCase(),
            battletag: args[0].replace(/\#/i, () => "-"),
            verifed: false
        };

        if(!ACCEPTED_REGIONS.includes(info.region)) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGREGION"), {
                    fields: [{
                        inline: false,
                        name: await localizeForUser(member, await localizeForUser(member, "OWPROFILEPLUGIN_AVAILABLE_REGIONS")),
                        value: ACCEPTED_REGIONS.join("\n")
                    }]
                })
            });
            throw new Error("Invalid argumentation");
        }

        if(!ACCEPTED_PLATFORMS.includes(info.platform)) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGPLATFORM"), {
                    fields: [{
                        inline: false,
                        name: await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGPLATFORM"),
                        value: ACCEPTED_PLATFORMS.join("\n")
                    }]
                })
            });
            throw new Error("Invalid argumentantion");
        }

        if(!ACCEPTED_SORTS.includes(info.sortBy)) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_WRONGSORTMETHOD"), {
                    fields: [{
                        inline: true,
                        name: await localizeForUser(member, "OWPROFILEPLUGIN_AVAILABLE_METHODS"),
                        value: ACCEPTED_SORTS.map(sort => `\`${sort}\``).join()
                    }]
                })
            });
            throw new Error("Invalid argumentation");
        }

        if(!info.battletag) {
            await statusMsg.edit("", {
                embed: generateEmbed(EmbedType.Error, await localizeForUser(member, "OWPROFILEPLUGIN_ERR_NOBTAG"))
            });
            throw new Error("Invalid argumentation");
        }

        status = await localizeForUser(msg.member, "OWPROFILEPLUGIN_FETCHINGPROFILE");
        postStatus();
        let profile: IRegionalProfile | null = null;
        try {
            profile = await getProfile(info.battletag, info.region, info.platform);
        } catch(err) {
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

    async getEmbed(info: string | IOverwatchHeroesProfilePluginInfo, caller:GuildMember): Promise<IEmbedOptionsField> {
        if(typeof info !== "object") {
            info = JSON.parse(info) as IOverwatchHeroesProfilePluginInfo;
        }

        let profile: IRegionalProfile | undefined = undefined;
        try {
            profile = await getProfile(info.battletag, info.region, info.platform);
        } catch(err) {
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
            title: await localizeForUser(caller, "OWPROFILEPLUGIN_HEROES_EMBED_TITLE")
        };

        if(!profile.stats.competitive || !profile.stats.competitive.overall_stats.comprank) {
            str += `<:competitive:322781963943673866> __**${tStrs.competitive}**__\n`;
            str += " - no stats -\n";
        } else {
            let compOveral = profile.stats.competitive.overall_stats;
            str += `${this.getTierEmoji(compOveral.tier)} __**${tStrs.competitive}**__\n`;
            let stats:HeroStats = [];
            if(info.sortBy === "playtime") {
                let heroesStats = profile.heroes.stats.competitive;
                let sorted = Object.keys(heroesStats).map((heroName:Hero) => {
                    return {
                        hero: heroName,
                        playtime: heroesStats[heroName].general_stats.time_played
                    };
                }).sort((a,b) => {
                    return b.playtime - a.playtime;
                });
                for(let heroPlaytime of sorted) {
                    if(heroPlaytime.playtime > 0 && stats.length < 3) {
                        stats.push({
                            hero: heroPlaytime.hero, 
                            stat: this.getPlaytimeStr(heroPlaytime.playtime, await localizeForUser(caller, "+SHORT_CODE"))
                        });
                    }
                }
            } else if(info.sortBy === "winrate") {
                let heroesStats = profile.heroes.stats.competitive;
                let sorted = Object.keys(heroesStats).map((heroName:Hero) => {
                    return {
                        hero: heroName,
                        games_won: heroesStats[heroName].general_stats.games_won
                    };
                }).sort((a,b) => {
                    return b.games_won - a.games_won;
                });
                for(let heroWins of sorted) {
                    if(heroWins.games_won > 0 && stats.length < 3) {
                        stats.push({
                            hero: heroWins.hero, 
                            stat: await localizeForUser(caller, "OWPROFILEPLUGIN_GAMESWON", {
                                gamesWon: heroWins.games_won
                            })
                        });
                    }
                }
            }
            str += await this.getString(stats, caller);
        }

        str += `\n<:quick:322781693205282816> __**${tStrs.quickplay}**__\n`;

        if(!profile.stats.quickplay || !profile.stats.quickplay.overall_stats.games) {
            str += "- no stats -\n";
        } else {
            let stats:HeroStats = [];
            if(info.sortBy === "playtime") {
                let heroesStats = profile.heroes.stats.quickplay;
                let sorted = Object.keys(heroesStats).map((heroName:Hero) => {
                    return {
                        hero: heroName,
                        playtime: heroesStats[heroName].general_stats.time_played
                    };
                }).sort((a,b) => {
                    return b.playtime - a.playtime;
                });
                for(let heroPlaytime of sorted) {
                    if(heroPlaytime.playtime > 0 && stats.length < 3) {
                        stats.push({
                            hero: heroPlaytime.hero, 
                            stat: this.getPlaytimeStr(heroPlaytime.playtime, await localizeForUser(caller, "+SHORT_CODE"))
                        });
                    }
                }
            } else if(info.sortBy === "winrate") {
                let heroesStats = profile.heroes.stats.quickplay;
                let sorted = Object.keys(heroesStats).map((heroName:Hero) => {
                    return {
                        hero: heroName,
                        games_won: heroesStats[heroName].general_stats.games_won
                    };
                }).sort((a,b) => {
                    return b.games_won - a.games_won;
                });
                for(let heroWins of sorted) {
                    if(heroWins.games_won > 0 && stats.length < 3) {
                        stats.push({
                            hero: heroWins.hero, 
                            stat: await localizeForUser(caller, "OWPROFILEPLUGIN_GAMESWON", {
                                gamesWon: heroWins.games_won
                            })
                        });
                    }
                }
            }
            str += await this.getString(stats, caller);
        }

        return {
            inline: true,
            name: `<:ow:306134976670466050> ${tStrs.title}`,
            value: str
        };
    }

    getTierEmoji(tier: Tier) {
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

    async getString(heroesStats:HeroStats, caller:GuildMember) {
        let str = "";
        for(let stat of heroesStats) {
            str += `${this.getHeroIcon(stat.hero)} `;
            str += await this.getHeroString(stat.hero, caller);
            str += ` - ${stat.stat}\n`;
        }
        return str;
    }

    getHeroIcon(hero:Hero) : string {
        switch (hero) {
            case "ana": return "<:ana:322800139402084352>";
            case "zenyatta": return "<:zen:322800138168827905>";
            case "zarya": return "<:zarya:322800138944774144>";
            case "winston": return "<:winston:322800138768613378>";
            case "widowmaker": return "<:widow:322800138932191232>";
            case "torbjorn": return "<:torb:322800138974396425>";
            case "tracer": return "<:tracer:322800138789847040>";
            case "symmetra": return "<:sym:322800138747772928>";
            case "sombra": return "<:sombra:322800138823139339>";
            case "soldier76": return "<:soldier:322800138370416640>";
            case "reinhardt": return "<:rh:322800140819890176>";
            case "reaper": return "<:reaper:322800138412359682>";
            case "pharah": return "<:pharah:322800139096031242>";
            case "orisa": return "<:orisa:322800139112808459>";
            case "mercy": return "<:mercy:322800138596777984>";
            case "mei": return "<:mei:322800139851005953>";
            case "mccree": return "<:mcree:322800138693115904>";
            case "lucio": return "<:lucio:322800138177347595>";
            case "junkrat": return "<:junk:322800139578376192>";
            case "roadhog": return "<:hog:322800138559029268>";
            case "hanzo": return "<:hanzo:322800138873602058>";
            case "genji": return "<:genji:322800138550771713>";
            case "dva": return "<:dva:322800138391257099>";
            case "bastion": return "<:bast:322800138630201355>";
            default: return "?";
        }
    }

    getPlaytimeStr(playtime:number, lang:string) {
        let ms = ((playtime * 60) * 60) * 1000;
        return humanizeDuration(ms, {
            largest: 2,
            units: ["h", "m", "s"],
            serialComma: false,
            language: lang
        });
    }

    async getHeroString(hero:Hero, caller:GuildMember) {
        try {
            return await localizeForUser(caller, `OWPROFILEPLUGIN_HERO_${hero}`.toUpperCase());
        } catch (err) {
            return this.getFallbackHeroString(hero);
        }
    }

    getFallbackHeroString(hero:Hero) {
        switch(hero) {
            default: return hero.charAt(0).toUpperCase() + hero.slice(1);
            case "lucio": return "Lúcio";
            case "torbjorn": return "Torbjörn";
            case "soldier76": return "Soldier: 76";
            case "dva": return "D.Va";
        }
    }

    async unload() { return true; }
}

module.exports = OWHeroesProfilePlugin;