import { IProfilesPlugin } from "../plugin";
import { GuildMember } from "discord.js";
import { IEmbedOptionsField, escapeDiscordMarkdown, replaceAll } from "../../../utils/utils";
import { getOrFetchRecents } from "./lastfm";
import { IRecentTracksResponse } from "./lastfmInterfaces";

export interface ILastFMInfo {
    username:string;
}

export class LastFMRecentProfilePlugin implements IProfilesPlugin {
    public name = "lastfm_recentrack";
    private apiKey:string;
    
    constructor(apiKey:string) {
        this.apiKey = apiKey;
    }
    
    async setup(str:string, member:GuildMember) {
        let js:ILastFMInfo = {
            username: str
        };
        
        try {
            await getOrFetchRecents(js.username, this.apiKey);
        } catch (err) {
            throw new Error("API error");
        }
        
        return {
            json: JSON.stringify(js),
            example: await this.getEmbed(js)
        };
    }
    
    async getEmbed(info:ILastFMInfo|string) : Promise<IEmbedOptionsField> {
        if(typeof info !== "object") {
            info = JSON.parse(info) as ILastFMInfo;
        }
        
        let profile:IRecentTracksResponse|undefined = undefined;
        try {
            profile = await getOrFetchRecents(info.username, this.apiKey);
        } catch (err) {
            return {
                inline: true,
                name: "<:lastfm:306344550744457217> Last.FM",
                value: `❌ ${err.message}`
            };
        }
        
        if(!profile) {
            return {
                inline: true,
                name: "<:lastfm:306344550744457217> Last.FM",
                value: `❌ Invalid response.`
            };
        }
        
        const recentTrack = profile.recenttracks.track[0];
        
        const fixedUrl = recentTrack ? replaceAll(replaceAll(recentTrack.url, "(", "%28"), ")", "%29") : "";

        const str = `${recentTrack ? `🎵 [${escapeDiscordMarkdown(`${recentTrack.artist["#text"]} - ${recentTrack.name}`, true)}](${fixedUrl})` : "no recent track"}`;
        
        return {
            inline: true,
            name: "<:lastfm:306344550744457217> Last.FM",
            value: str
        };
    }
    
    async unload() { return true; }
}

module.exports = LastFMRecentProfilePlugin;