import { IProfilesPlugin, AddedProfilePluginType } from "../plugin";
import { GuildMember } from "discord.js";
import { IEmbedOptionsField, escapeDiscordMarkdown, getLogger } from "../../../utils/utils";
import { getOrFetchRecents } from "./lastfm";
import { IRecentTracksResponse } from "./lastfmInterfaces";
import { localizeForUser } from "../../../utils/ez-i18n";
import { replaceAll } from "../../../utils/text";
import { DetailedError } from "../../../../types/Types";

const LOG = getLogger("LastFMPlugin");

export interface ILastFMInfo {
	username: string;
}

export interface ILastFMPluginConfig {
	apiKey: string;
	emojiIconID: string;
}

export class LastFMRecentProfilePlugin implements IProfilesPlugin {
	public get signature() {
		return "snowball.features.profile.plugins.lastfm";
	}

	private readonly config: ILastFMPluginConfig;
	private readonly _emoji: string;

	constructor(config: ILastFMPluginConfig) {
		this.config = config;
		const _emojiErr = new Error("Emoji not found");
		if(!this.config.emojiIconID) {
			throw _emojiErr;
		}
		const emoji = $discordBot.emojis.find("id", this.config.emojiIconID);
		if(!emoji) { throw _emojiErr; }
		this._emoji = emoji.toString();
	}

	async getSetupArgs(caller: GuildMember) {
		return localizeForUser(caller, "LASTFMPROFILEPLUGIN_ARGS");
	}

	async setup(str: string) {
		const info: ILastFMInfo = { username: str };

		try {
			await getOrFetchRecents(info.username, this.config.apiKey);
		} catch(err) {
			LOG("err", `setup(${info.username}): Failed to get recent tracks`, err);
			throw new Error(`Failed to fetch recent tracks of "${info.username}"`);
		}

		return {
			json: JSON.stringify(info),
			type: AddedProfilePluginType.Embed
		};
	}

	async getEmbed(info: ILastFMInfo | string, caller: GuildMember): Promise<IEmbedOptionsField> {
		if(typeof info !== "object") { info = JSON.parse(info) as ILastFMInfo; }

		const logPrefix = `getEmbed(${info.username}):`;
		let profile: IRecentTracksResponse | undefined = undefined;
		try {
			LOG("info", logPrefix, "Getting recent tracks...");
			profile = await getOrFetchRecents(info.username, this.config.apiKey);
		} catch(err) {
			LOG("err", logPrefix, "Failed to get recent tracks", err);

			let errKey = "LASTFMPROFILEPLUGIN_ERR_UNKNOWN@NOERROR";
			if(err instanceof DetailedError) {
				switch(err.code) {
					case "LASTFM_GETRECENTS_ERR_NOTFOUND": {
						errKey = "LASTFMPROFILEPLUGIN_ERR_NOTFOUND";
					} break;
					case "LASTFM_GETRECENTS_ERR_SERVERERROR": {
						errKey = "LASTFMPROFILEPLUGIN_ERR_SERVERERROR";
					} break;
					default: {
						errKey = "LASTFMPROFILEPLUGIN_ERR_UNKNOWN";
					} break;
				}
			}

			return {
				inline: true,
				name: `${this.config.emojiIconID} Last.FM`,
				value: `❌ ${await localizeForUser(caller, errKey)}`
			};
		}

		if(!profile) {
			LOG("err", logPrefix, "No 'profile' variable!");
			return {
				inline: true,
				name: `${this._emoji} Last.FM`,
				value: "❌ " + await localizeForUser(caller, "LASTFMPROFILEPLUGIN_ERR_INVALIDRESP")
			};
		}


		try {
			const recentTrack = profile.recenttracks.track[0];

			const fixedUrl = recentTrack ? replaceAll(replaceAll(recentTrack.url, "(", "%28"), ")", "%29") : "";

			const str = `${recentTrack ? `🎵 [${escapeDiscordMarkdown(`${recentTrack.artist["#text"]} - ${recentTrack.name}`, true)}](${fixedUrl})` : "no recent track"}`;

			return {
				inline: true,
				name: `${this._emoji} Last.FM`,
				value: str
			};
		} catch(err) {
			LOG("err", logPrefix, "Failed to generate embed", err);
			throw new Error("Failed to generate embed");
		}
	}

	async unload() { return true; }
}

module.exports = LastFMRecentProfilePlugin;
