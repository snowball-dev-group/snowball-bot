import { IProfilesPlugin, AddedProfilePluginType } from "../plugin";
import { GuildMember } from "discord.js";
import { IEmbedOptionsField, escapeDiscordMarkdown, getLogger } from "../../../utils/utils";
import { getOrFetchRecents } from "./lastfm";
import { IRecentTracksResponse } from "./lastfmInterfaces";
import { localizeForUser } from "../../../utils/ez-i18n";
import { replaceAll } from "../../../utils/text";

const LOG = getLogger("LastFMPlugin");

export interface ILastFMInfo {
    username: string;
}

export class LastFMRecentProfilePlugin implements IProfilesPlugin {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async getSetupArgs(caller: GuildMember) {
        return await localizeForUser(caller, "LASTFMPROFILEPLUGIN_ARGS");
    }

    async setup(str: string) {
        let js: ILastFMInfo = {
            username: str
        };

        let logPrefix = `${js.username} (setup)|`;

        try {
            LOG("info", logPrefix, "Getting recent tracks...");
            await getOrFetchRecents(js.username, this.apiKey);
        } catch(err) {
            LOG("err", logPrefix, "Failed to get recent tracks", err);
            throw new Error("Can't get recent tracks.");
        }

        return {
            json: JSON.stringify(js),
            type: AddedProfilePluginType.Embed
        };
    }

    async getEmbed(info: ILastFMInfo | string, caller: GuildMember): Promise<IEmbedOptionsField> {
        if(typeof info !== "object") {
            info = JSON.parse(info) as ILastFMInfo;
        }

        let logPrefix = `${info.username} (getEmbed)|`;
        let profile: IRecentTracksResponse | undefined = undefined;
        try {
            LOG("info", logPrefix, "Getting recent tracks...");
            profile = await getOrFetchRecents(info.username, this.apiKey);
        } catch(err) {
            LOG("err", logPrefix, "Failed to get recent tracks", err);
            return {
                inline: true,
                name: "<:lastfm:306344550744457217> Last.FM",
                value: `❌ ${err.message}`
            };
        }

        if(!profile) {
            LOG("err", logPrefix, "No 'profile' variable!");
            return {
                inline: true,
                name: "<:lastfm:306344550744457217> Last.FM",
                value: "❌ " + await localizeForUser(caller, "LASTFMPROFILEPLUGIN_ERR_INVALIDRESP")
            };
        }

        LOG("ok", logPrefix, "Generating embed...");

        try {
            const recentTrack = profile.recenttracks.track[0];

            const fixedUrl = recentTrack ? replaceAll(replaceAll(recentTrack.url, "(", "%28"), ")", "%29") : "";

            const str = `${recentTrack ? `🎵 [${escapeDiscordMarkdown(`${recentTrack.artist["#text"]} - ${recentTrack.name}`, true)}](${fixedUrl})` : "no recent track"}`;

            return {
                inline: true,
                name: "<:lastfm:306344550744457217> Last.FM",
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