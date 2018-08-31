import * as SharedTypes from "@cogs/profiles/plugins/overwatch/shared";
import * as ProfilePlugin from "@cogs/profiles/plugins/plugin";
import { DetailedError } from "@sb-types/Types";
import * as i18n from "@utils/ez-i18n";
import * as utils from "@utils/utils";
import { GuildMember, Message } from "discord.js";
import * as getLogger from "loggy";
import * as API from "./overwatch";
import * as OWAPIInterfaces from "./owApiInterfaces";

const HEROES_TO_SHOW = 3;

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
		moira: string;
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

export class OWHeroesProfilePlugin implements ProfilePlugin.IProfilesPlugin {
	public get signature() {
		return "snowball.features.profile.plugins.overwatch.heroes";
	}

	private readonly _config: IOWHeroesPluginConfig;
	private static readonly _log = getLogger("OWHeroesProfilePlugin");

	constructor(config: IOWHeroesPluginConfig) {
		if (!config) {
			throw new Error("No config passed");
		}

		config.emojis = <any> utils.resolveEmojiMap(
			config.emojis,
			$discordBot.emojis,
			true
		);

		this._config = Object.freeze(config);
	}

	public async getSetupArgs(caller: GuildMember) {
		return i18n.localizeForUser(caller, "OWPROFILEPLUGIN_HEROES_ARGS");
	}

	public async setup(str: string, member: GuildMember, msg: Message) {
		let status = await i18n.localizeForUser(member, "OWPROFILEPLUGIN_LOADING");

		let statusMsg = <Message> await msg.channel.send({
			embed: utils.generateEmbed(utils.EmbedType.Progress, status)
		});

		const postStatus = async () => {
			statusMsg = await statusMsg.edit({
				embed: utils.generateEmbed(
					utils.EmbedType.Progress,
					`${statusMsg.content}\n${status}`
				)
			});
		};

		const args = str
			.split(";")
			.map(arg => arg.trim());

		if (args.length === 0) {
			await statusMsg.edit({
				embed: utils.generateEmbed(
					utils.EmbedType.Error,
					await i18n.localizeForUser(
						member,
						"OWPROFILEPLUGIN_ERR_ARGS"
					)
				)
			});

			throw new Error("No arguments were provided");
		}

		const info = {
			sortBy: (args[3] || "playtime").toLowerCase(),
			platform: (args[2] || "pc").toLowerCase(),
			region: (args[1] || "eu").toLowerCase(),
			battletag: args[0].replace(/\#/i, "-")
		};

		if (!SharedTypes.ACCEPTED_REGIONS.includes(info.region)) {
			await statusMsg.edit({
				embed: utils.generateEmbed(
					utils.EmbedType.Error,
					await i18n.localizeForUser(
						member,
						"OWPROFILEPLUGIN_ERR_WRONGREGION"
					), {
						fields: [{
							inline: false,
							name: await i18n.localizeForUser(
								member,
								"OWPROFILEPLUGIN_AVAILABLE_REGIONS"
							),
							value: SharedTypes.ACCEPTED_REGIONS.join("\n")
						}]
					}
				)
			});

			throw new Error("The region argument doesn't contain any valid region");
		}

		if (!SharedTypes.ACCEPTED_PLATFORMS.includes(info.platform)) {
			await statusMsg.edit({
				embed: utils.generateEmbed(
					utils.EmbedType.Error,
					await i18n.localizeForUser(
						member,
						"OWPROFILEPLUGIN_ERR_WRONGPLATFORM"
					), {
						fields: [{
							inline: false,
							name: await i18n.localizeForUser(
								member,
								"OWPROFILEPLUGIN_ERR_WRONGPLATFORM"
							),
							value: SharedTypes.ACCEPTED_PLATFORMS.join("\n")
						}]
					}
				)
			});

			throw new Error("The platform argument doesn't contain any valid platform");
		}

		if (!SharedTypes.ACCEPTED_SORTS.includes(info.sortBy)) {
			await statusMsg.edit("", {
				embed: utils.generateEmbed(
					utils.EmbedType.Error,
					await i18n.localizeForUser(
						member,
						"OWPROFILEPLUGIN_ERR_WRONGSORTMETHOD"
					), {
						fields: [{
							inline: true,
							name: await i18n.localizeForUser(
								member,
								"OWPROFILEPLUGIN_AVAILABLE_METHODS"
							),
							value: 
								SharedTypes.ACCEPTED_SORTS
									.map(sort => `\`${sort}\``)
									.join()
						}]
					}
				)
			});

			throw new Error("Unknown sort method is specified");
		}

		if (!info.battletag) {
			await statusMsg.edit("", {
				embed: utils.generateEmbed(
					utils.EmbedType.Error,
					await i18n.localizeForUser(
						member,
						"OWPROFILEPLUGIN_ERR_NOBTAG"
					)
				)
			});

			throw new Error("No BattleTag provided");
		}

		status = await i18n.localizeForUser(
			member,
			"OWPROFILEPLUGIN_FETCHINGPROFILE"
		);

		await postStatus();

		try {
			await API.getProfile(
				info.battletag,
				info.region,
				info.platform
			);
		} catch (err) {
			if (err instanceof DetailedError) {
				if (err.code === "OWAPI_FETCH_ERR_PROFILE_NOTFOUND") {
					await statusMsg.edit({
						embed: utils.generateEmbed(
							utils.EmbedType.Error,
							await i18n.localizeForUser(
								member,
								"OWPROFILEPLUGIN_ERR_FETCHINGFAILED"
							)
						)
					});
				} else {
					await statusMsg.edit({
						embed: utils.generateEmbed(
							utils.EmbedType.Error,
							await i18n.localizeForUser(
								member,
								"OWPROFILEPLUGIN_ERR_FETCHINGFAILED_API"
							)
						)
					});
				}
			}

			throw new Error("Could not get the profile");
		}

		const json = JSON.stringify(info);

		await statusMsg.delete();

		return {
			json: json,
			type: ProfilePlugin.AddedProfilePluginType.Embed
		};
	}

	public async getEmbed(info: string | IOverwatchHeroesProfilePluginInfo, caller: GuildMember): Promise<utils.IEmbedOptionsField> {
		if (typeof info !== "object") {
			info = <IOverwatchHeroesProfilePluginInfo> JSON.parse(info);
		}

		let profile: OWAPIInterfaces.IRegionalProfile;
		try {
			profile = await API.getProfile(
				info.battletag,
				info.region,
				info.platform
			);
		} catch (err) {
			OWHeroesProfilePlugin._log(
				"err", "Error during fetching the profile",
				err, info
			);

			throw new Error("Cannot fetch the profile, API is possibly offline or did not respond at time");
		}

		if (!profile) {
			OWHeroesProfilePlugin._log(
				"err", "Failed to fetch the profile: ",
				info
			);

			throw new Error("Unexpected behaviour while trying to get the profile");
		}

		let str = "";

		const tStrs = {
			competitive: await i18n.localizeForUser(
				caller,
				"OWPROFILEPLUGIN_COMPETITIVE"
			),

			quickplay: await i18n.localizeForUser(
				caller,
				"OWPROFILEPLUGIN_QUICKPLAY"
			),

			title: await i18n.localizeForUser(
				caller,
				"OWPROFILEPLUGIN_HEROES_EMBED_TITLE"
			)
		};

		if (
			!profile.stats.competitive || !profile.stats.competitive.overall_stats.comprank
		) {
			str += `${this._config.emojis.competitive}`;
			str += ` __**${tStrs.competitive}**__\n`;

			str += `${await i18n.localizeForUser(
				caller,
				"OWPROFILEPLUGIN_PLACEHOLDER"
			)}\n`;
		} else {
			const compOveral = profile.stats.competitive.overall_stats;

			str += `${OWHeroesProfilePlugin._getTierEmoji(
				compOveral.tier,
				this._config
			)}`;

			str += `__**${tStrs.competitive}**__\n`;

			str += await OWHeroesProfilePlugin._getString(
				await OWHeroesProfilePlugin._bestStats(
					profile.heroes.stats.competitive,
					info,
					caller
				),
				caller,
				this._config
			);
		}

		str += `\n${this._config.emojis.quickplay} __**${tStrs.quickplay}**__\n`;

		if (!profile.stats.quickplay) {
			str += `${await i18n.localizeForUser(
				caller,
				"OWPROFILEPLUGIN_PLACEHOLDER"
			)}\n`;
		} else {
			str += await OWHeroesProfilePlugin._getString(
				await OWHeroesProfilePlugin._bestStats(
					profile.heroes.stats.quickplay,
					info,
					caller
				),
				caller,
				this._config
			);
		}

		return {
			inline: true,
			name: `${this._config.emojis.overwatchIcon} ${tStrs.title}`,
			value: str
		};
	}

	private static _getTierEmoji(tier: OWAPIInterfaces.Tier, config: IOWHeroesPluginConfig) {
		if (!tier) { return config.emojis.bronze; }

		return config.emojis[tier];
	}

	private static async _getString(
		stats: SharedTypes.HeroStats,
		caller: GuildMember,
		config: IOWHeroesPluginConfig
	) {
		let str = "";

		for (let i = 0, l = stats.length; i < l; i++) {
			const stat = stats[i];
			str += `${OWHeroesProfilePlugin._getHeroIcon(
				stat.hero,
				config
			)} `;

			str += await OWHeroesProfilePlugin._getHeroString(
				stat.hero,
				caller
			);

			str += ` — ${stat.stat}\n`;
		}

		return str;
	}

	private static _getHeroIcon(hero: SharedTypes.Hero, config: IOWHeroesPluginConfig): string {
		return config.emojis[hero] || "?";
	}

	private static _getPlaytimeStr(playtime: number, language: string) {
		const ms = ((playtime * 60) * 60) * 1000;

		return $localizer.humanizeDuration(
			language,
			ms, undefined, {
				largest: 2,
				units: ["h", "m", "s"],
				serialComma: false
			}
		);
	}

	private static async _getHeroString(hero: SharedTypes.Hero, caller: GuildMember) {
		try {
			return await i18n.localizeForUser(
				caller, 
				`OVERWATCH_HERO_${hero}`.toUpperCase()
			);
		} catch (err) {
			return OWHeroesProfilePlugin._getFallbackHeroString(hero);
		}
	}

	private static _getFallbackHeroString(hero: SharedTypes.Hero) {
		switch (hero) {
			case "lucio": return "Lúcio";
			case "torbjorn": return "Torbjörn";
			case "soldier76": return "Soldier: 76";
			case "dva": return "D.Va";
			default: return hero.charAt(0).toUpperCase() + hero.slice(1);
		}
	}

	private static _toGeneralDetails(heroesStats: OWAPIInterfaces.IHeroesStats) : ILightPlayDetails[] {
		return Object.keys(heroesStats)
			.map(
				(heroName: SharedTypes.Hero) => {
					return {
						hero: heroName,
						playtime:
							heroesStats[heroName].general_stats.time_played,
						wins:
							heroesStats[heroName].general_stats.games_won
					};
				}
			);
	}

	private static _sortDetails(playDetails: ILightPlayDetails[], sortMethod: SharedTypes.Sorts) {
		return playDetails.sort(
			sortMethod === "playtime" ?
				this._playTimeComporator :
				this._winsComportator
		);
	}

	private static _playTimeComporator(detailsA: ILightPlayDetails, detailsB: ILightPlayDetails) {
		return detailsB.playtime - detailsA.playtime;
	}

	private static _winsComportator(detailsA: ILightPlayDetails, detailsB: ILightPlayDetails) {
		return detailsB.wins - detailsA.wins;
	}

	private static _shouldShowInPlaytimes(details: ILightPlayDetails) {
		return details.playtime > 1;
	}

	private static _shouldShowInWins(details: ILightPlayDetails) {
		return details.wins > 1;
	}

	private static async _bestStats(
		stats: OWAPIInterfaces.IHeroesStats,
		info: IOverwatchHeroesProfilePluginInfo,
		caller: GuildMember
	) {
		const bestStats: SharedTypes.HeroStats = [];

		const heroesStats = 
			OWHeroesProfilePlugin
				._toGeneralDetails(stats);

		const _sorted = 
			OWHeroesProfilePlugin
				._sortDetails(
					heroesStats,
					info.sortBy
				);

		const meetsCriteria =
				info.sortBy === "playtime" ? 
					OWHeroesProfilePlugin._shouldShowInPlaytimes :
					OWHeroesProfilePlugin._shouldShowInWins;

		const convertToStat: (detail: ILightPlayDetails) => Promise<string> = 
				info.sortBy === "playtime" ?
					async (d) => this._getPlaytimeStr(
						d.playtime,
						await i18n.getUserLanguage(caller)
					) : 
					async (d) => i18n.localizeForUser(
						caller, 
						"OWPROFILEPLUGIN_GAMESWON", {
							gamesWon: d.wins
						}
					);

		let addedStats = 0;

		for (let i = 0, l = _sorted.length; i < l; i++) {
			const details = _sorted[i];

			if (addedStats > HEROES_TO_SHOW) { break; }
			if (!meetsCriteria(details)) { continue; }

			bestStats.push({
				hero: details.hero,
				stat: await convertToStat(details)
			});

			addedStats++;
		}

		return bestStats;
	}

	public async unload() { return true; }
}

interface IOverwatchHeroesProfilePluginInfo extends API.IOverwatchProfilePluginInfo {
	sortBy: SharedTypes.Sorts;
}

interface ILightPlayDetails {
	hero: SharedTypes.Hero;
	playtime: number;
	wins: number;
}

module.exports = OWHeroesProfilePlugin;
