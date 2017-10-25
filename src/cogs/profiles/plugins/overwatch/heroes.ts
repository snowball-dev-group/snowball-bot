import { IProfilesPlugin, AddedProfilePluginType } from "../plugin";
import { Message, GuildMember } from "discord.js";
import { generateEmbed, EmbedType, IEmbedOptionsField, getLogger } from "../../../utils/utils";
import { localizeForUser, getUserLanguage } from "../../../utils/ez-i18n";
import { IRegionalProfile, Tier } from "./owApiInterfaces";
import { getProfile, IOverwatchProfilePluginInfo } from "./overwatch";

const ACCEPTED_REGIONS = ["eu", "kr", "us"];
const ACCEPTED_PLATFORMS = ["pc", "xbl", "psn"];
const ACCEPTED_SORTS = ["playtime", "winrate"];
const LOG = getLogger("OWRatingPlugin");
const HEROES_TO_SHOW = 3;

type Hero = "reinhardt" | "tracer" | "zenyatta" | "junkrat" | "mccree" | "winston" | "orisa" | "hanzo" | "pharah" | "roadhog" | "zarya" | "torbjorn" | "mercy" | "mei" | "ana" | "widowmaker" | "genji" | "reaper" | "soldier76" | "bastion" | "symmetra" | "dva" | "sombra" | "lucio" | "doomfist";
type Sorts = "playtime" | "winrate";
type HeroStats = Array<{
	hero: Hero,
	stat: string
}>;

interface IOverwatchHeroesProfilePluginInfo extends IOverwatchProfilePluginInfo {
	sortBy: Sorts;
}

interface IOWHeroesPluginConfig {
	emojis: {
		quickplay: string;
		competitive: string;
		overwatchIcon: string;
		ana: string;
		zenyatta: string;
		zarya: string;
		winston: string;
		widowmaker: string;
		torbjorn: string;
		tracer: string;
		symmetra: string;
		sombra: string;
		soldier76: string;
		reinhardt: string;
		reaper: string;
		pharah: string;
		orisa: string;
		mercy: string;
		mei: string;
		mccree: string;
		lucio: string;
		junkrat: string;
		roadhog: string;
		hanzo: string;
		genji: string;
		dva: string;
		bastion: string;
		doomfist: string;
		bronze: string;
		silver: string;
		gold: string;
		platinum: string;
		diamond: string;
		master: string;
		grandmaster: string;
	};
}

export class OWHeroesProfilePlugin implements IProfilesPlugin {
	public get signature() {
		return "snowball.features.profile.plugins.overwatch.heroes";
	}

	config: IOWHeroesPluginConfig;

	constructor(config: IOWHeroesPluginConfig) {
		if(!config) {
			throw new Error("No config passed");
		}

		for(const emojiName of Object.keys(config.emojis)) {
			const emojiId = config.emojis[emojiName];
			const emoji = $discordBot.emojis.get(emojiId);
			if(!emoji) { throw new Error(`Emoji "${emojiName}" by ID "${emojiId}" wasn't found`); }
			config.emojis[emojiName] = emoji.toString();
		}

		this.config = Object.freeze(config);
	}

	async getSetupArgs(caller: GuildMember) {
		return await localizeForUser(caller, "OWPROFILEPLUGIN_HEROES_ARGS");
	}

	async setup(str: string, member: GuildMember, msg: Message) {
		let status = await localizeForUser(member, "OWPROFILEPLUGIN_LOADING"), prevStatus = status;

		let statusMsg = await msg.channel.send("", {
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

	async getEmbed(info: string | IOverwatchHeroesProfilePluginInfo, caller: GuildMember): Promise<IEmbedOptionsField> {
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

		const tStrs = {
			competitive: await localizeForUser(caller, "OWPROFILEPLUGIN_COMPETITIVE"),
			quickplay: await localizeForUser(caller, "OWPROFILEPLUGIN_QUICKPLAY"),
			title: await localizeForUser(caller, "OWPROFILEPLUGIN_HEROES_EMBED_TITLE")
		};

		if(!profile.stats.competitive || !profile.stats.competitive.overall_stats.comprank) {
			str += `${this.config.emojis.competitive} __**${tStrs.competitive}**__\n`;
			str += (await localizeForUser(caller, "OWPROFILEPLUGIN_PLACEHOLDER")) + "\n";
		} else {
			const compOveral = profile.stats.competitive.overall_stats;
			str += `${this.getTierEmoji(compOveral.tier)} __**${tStrs.competitive}**__\n`;
			const stats: HeroStats = [];
			if(info.sortBy === "playtime") {
				const heroesStats = profile.heroes.stats.competitive;
				const sorted = Object.keys(heroesStats).map((heroName: Hero) => {
					return {
						hero: heroName,
						playtime: heroesStats[heroName].general_stats.time_played
					};
				}).sort((a, b) => {
					return b.playtime - a.playtime;
				});
				for(const heroPlaytime of sorted) {
					if(heroPlaytime.playtime > 0 && stats.length < HEROES_TO_SHOW) {
						stats.push({
							hero: heroPlaytime.hero,
							stat: this.getPlaytimeStr(heroPlaytime.playtime, await getUserLanguage(caller))
						});
					}
				}
			} else if(info.sortBy === "winrate") {
				const heroesStats = profile.heroes.stats.competitive;
				const sorted = Object.keys(heroesStats).map((heroName: Hero) => {
					return {
						hero: heroName,
						games_won: heroesStats[heroName].general_stats.games_won
					};
				}).sort((a, b) => {
					return b.games_won - a.games_won;
				});
				for(const heroWins of sorted) {
					if(heroWins.games_won > 0 && stats.length < HEROES_TO_SHOW) {
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

		str += `\n${this.config.emojis.quickplay} __**${tStrs.quickplay}**__\n`;

		if(!profile.stats.quickplay) {
			str += (await localizeForUser(caller, "OWPROFILEPLUGIN_PLACEHOLDER")) + "\n";
		} else {
			const stats: HeroStats = [];
			const heroesStats = profile.heroes.stats.quickplay;
			if(info.sortBy === "playtime") {
				const sorted = Object.keys(heroesStats).map((heroName: Hero) => {
					return {
						hero: heroName,
						playtime: heroesStats[heroName].general_stats.time_played
					};
				}).sort((a, b) => {
					return b.playtime - a.playtime;
				});
				for(const heroPlaytime of sorted) {
					if(heroPlaytime.playtime > 0 && stats.length < HEROES_TO_SHOW) {
						stats.push({
							hero: heroPlaytime.hero,
							stat: this.getPlaytimeStr(heroPlaytime.playtime, await getUserLanguage(caller))
						});
					}
				}
			} else if(info.sortBy === "winrate") {
				const sorted = Object.keys(heroesStats).map((heroName: Hero) => {
					return {
						hero: heroName,
						games_won: heroesStats[heroName].general_stats.games_won
					};
				}).sort((a, b) => {
					return b.games_won - a.games_won;
				});
				for(const heroWins of sorted) {
					if(heroWins.games_won > 0 && stats.length < HEROES_TO_SHOW) {
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
			name: `${this.config.emojis.overwatchIcon} ${tStrs.title}`,
			value: str
		};
	}

	getTierEmoji(tier: Tier) {
		switch(tier) {
			case null: return this.config.emojis.bronze;
			default: return this.config.emojis[tier];
		}
	}

	async getString(heroesStats: HeroStats, caller: GuildMember) {
		let str = "";
		for(const stat of heroesStats) {
			str += `${this.getHeroIcon(stat.hero)} `;
			str += await this.getHeroString(stat.hero, caller);
			str += ` - ${stat.stat}\n`;
		}
		return str;
	}

	getHeroIcon(hero: Hero): string {
		return this.config.emojis[hero] || "?";
	}

	getPlaytimeStr(playtime: number, language: string) {
		let ms = ((playtime * 60) * 60) * 1000;
		return $localizer.humanizeDuration(language, ms, undefined, {
			largest: 2,
			units: ["h", "m", "s"],
			serialComma: false
		});
	}

	async getHeroString(hero: Hero, caller: GuildMember) {
		try {
			return await localizeForUser(caller, `OWPROFILEPLUGIN_HERO_${hero}`.toUpperCase());
		} catch(err) {
			return this.getFallbackHeroString(hero);
		}
	}

	getFallbackHeroString(hero: Hero) {
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