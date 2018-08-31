import * as SharedTypes from "@cogs/profiles/plugins/overwatch/shared";
import * as ProfilePlugin from "@cogs/profiles/plugins/plugin";
import { DetailedError } from "@sb-types/Types";
import * as i18n from "@utils/ez-i18n";
import * as utils from "@utils/utils";
import { GuildMember, Message } from "discord.js";
import * as getLogger from "loggy";
import * as API from "./overwatch";
import * as OWAPIInterfaces from "./owApiInterfaces";

export interface IOWStatsPluginConfig {
	emojis: {
		competitive: string;
		quickplay: string;
		overwatchIcon: string;
		bronze: string;
		silver: string;
		gold: string;
		platinum: string;
		diamond: string;
		master: string;
		grandmaster: string;
		norating: string;
	};
}

export class OWStatsProfilePlugin implements ProfilePlugin.IProfilesPlugin {
	public get signature() {
		return "snowball.features.profile.plugins.overwatch.stats";
	}

	private readonly _config: IOWStatsPluginConfig;
	private static readonly _log = getLogger("OWStatsProfilePlugin");

	constructor(config: IOWStatsPluginConfig) {
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
		return i18n.localizeForUser(caller, "OWPROFILEPLUGIN_DEFAULT_ARGS");
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
					`${statusMsg.content}`
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
			platform: (args[2] || "pc").toLowerCase(),
			region: (args[1] || "eu").toLowerCase(),
			battletag: args[0].replace(/\#/i, () => "-"),
			verifed: false
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
								"OWPROFILEPLUGIN_AVAILABLE_PLATFORMS"
							),
							value: SharedTypes.ACCEPTED_PLATFORMS.join("\n")
						}]
					}
				)
			});

			throw new Error("The platform argument doesn't contain any valid platform");
		}

		if (!info.battletag) {
			await statusMsg.edit({
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
			msg.member,
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

	public async getEmbed(info: string | API.IOverwatchProfilePluginInfo, caller: GuildMember): Promise<utils.IEmbedOptionsField> {
		if (typeof info !== "object") {
			info = <API.IOverwatchProfilePluginInfo> JSON.parse(info);
		}

		let profile: OWAPIInterfaces.IRegionalProfile | undefined = undefined;
		try {
			profile = await API.getProfile(
				info.battletag,
				info.region,
				info.platform
			);
		} catch (err) {
			OWStatsProfilePlugin._log(
				"err", "Error during getting profile",
				err, info
			);

			throw new Error("Cannot fetch the profile, API is possibly offline or did not respond at time");
		}

		if (!profile) {
			OWStatsProfilePlugin._log(
				"err", "Failed to fetch the profile: ",
				info
			);

			throw new Error("Unexpected behaviour while trying to get the profile");
		}

		let str = "";

		str += `**${await i18n.localizeForUser(
			caller,
			"OWPROFILEPLUGIN_LEVEL", {
				level: (100 * profile.stats.quickplay.overall_stats.prestige) + profile.stats.quickplay.overall_stats.level
			}
		)}**\n`;

		const matchResultStr = {
			win: await i18n.localizeForUser(caller, "OWPROFILEPLUGIN_STAT_WIN"),
			loss: await i18n.localizeForUser(caller, "OWPROFILEPLUGIN_STAT_LOSS"),
			tie: await i18n.localizeForUser(caller, "OWPROFILEPLUGIN_STAT_TIE")
		};

		str += `${this._config.emojis.norating}`;
		str += ` __**${await i18n.localizeForUser(
			caller,
			"OWPROFILEPLUGIN_COMPETITIVE"
		)}**__\n`;

		if (
			!profile.stats.competitive || !profile.stats.competitive.overall_stats.comprank
		) {
			str += this._getTierEmoji(null);
			str += await i18n.localizeForUser(
				caller,
				"OWPROFILEPLUGIN_PLACEHOLDER"
			);
		} else {
			const compOveral = profile.stats.competitive.overall_stats;
			str += `${await i18n.localizeForUser(
				caller, "OWPROFILEPLUGIN_RATING", {
					tier_emoji: this._getTierEmoji(compOveral.tier),
					rank: compOveral.comprank
				}
			)}\n`;

			str += `${await i18n.localizeForUser(
				caller, "OWPROFILEPLUGIN_GAMESPLAYED", {
					games: compOveral.games
				}
			)}\n`;

			str += ` ${matchResultStr.win}: ${compOveral.wins}.\n`;
			str += ` ${matchResultStr.loss}: ${compOveral.losses}.\n`;
			str += ` ${matchResultStr.tie}: ${compOveral.ties}.\n`;

			str += `  (${await i18n.localizeForUser(
				caller, "OWPROFILEPLUGIN_WINRATE", {
					winrate: compOveral.win_rate
				}
			)})`;
		}

		str += `\n${this._config.emojis.quickplay}`;
		str += ` __**${await i18n.localizeForUser(
			caller,
			"OWPROFILEPLUGIN_QUICKPLAY"
		)}**__\n`;

		if (!profile.stats.quickplay) {
			str += await i18n.localizeForUser(caller, "OWPROFILEPLUGIN_PLACEHOLDER");
		} else {
			const qpOveral = profile.stats.quickplay.overall_stats;

			// str += (await localizeForUser(caller, "OWPROFILEPLUGIN_GAMESPLAYED", {
			// 	games: qpOveral.games
			// })) + "\n";
			// str += ` ${atStrs.win}: ${qpOveral.wins}.\n ${atStrs.loss}: ${qpOveral.losses}.\n`;
			// str += `  (`;
			// str += (await localizeForUser(caller, "OWPROFILEPLUGIN_WINRATE", {
			// 	winrate: qpOveral.win_rate
			// })) + ")";

			str += `${await i18n.localizeForUser(
				caller,
				"OWPROFILEPLUGIN_HOURSPLAYED", {
					hours: profile.stats.quickplay.game_stats.time_played
				}
			)}\n`;

			str += await i18n.localizeForUser(
				caller,
				"OWPROFILEPLUGIN_GAMESWON", {
					gamesWon: qpOveral.wins
				}
			);
		}

		return {
			inline: true,
			name: `${this._config.emojis.overwatchIcon} Overwatch`,
			value: str
		};
	}

	private _getTierEmoji(tier: SharedTypes.Tier | null) {
		if (!tier) { return this._config.emojis.norating; }

		return this._config.emojis[tier];
	}

	public async unload() { return true; }
}

module.exports = OWStatsProfilePlugin;
