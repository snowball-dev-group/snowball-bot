import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError } from "../baseService";
import { IEmbed, sleep, getLogger, escapeDiscordMarkdown } from "../../utils/utils";
import { default as fetch } from "node-fetch";
import { chunk } from "lodash";

const MAX_STREAM_CACHE_LIFE = 180000; // ms
const TWITCH_ICON = "https://i.imgur.com/2JHEBZk.png";
const TWITCH_COLOR = 0x6441A4;
const TWITCH_USERNAME_REGEXP = /^[a-zA-Z0-9_]{3,24}$/;

class TwitchStreamingService implements IStreamingService {
    public name = "twitch";

    private clientId:string;
    private log = getLogger("TwitchStreamingService");

    constructor(clientId:string) {
        this.clientId = clientId;
    }

    private streamsCache = new Map<string, {
        cachedAt:number,
        value: ITwitchStream
    }>();

    public async fetch(streamers:IStreamingServiceStreamer[]) {
        // should return only online streams
        
        // don't updating for cached streams
        let reqDate = Date.now();
        let notCachedYet = streamers.filter(s => {
            // is not cached?
            let cached = this.streamsCache.get(s.uid);
            if(!cached) { return true; }
            if((reqDate - cached.cachedAt) > MAX_STREAM_CACHE_LIFE) { return true; }
            return false;
        });
        
        let result:IStreamStatus[] = [];
        
        if(notCachedYet.length > 0) {
            let loop = async (toFetch:IStreamingServiceStreamer[], attempt:number) => { 
                if(attempt > 3) {
                    throw new StreamingServiceError("TWITCH_TOOMANYATTEMPTS", "Too many attempts. Please, try again later");
                }

                let resp = await fetch(this.getAPIURL_Streams(toFetch.map(s => s.uid)));
                if(resp.status === 429) {
                    await sleep(parseInt(resp.headers.get("retry-after"), 10));
                    return await loop(toFetch, attempt++);
                } else if(resp.status !== 200) {
                    throw new StreamingServiceError("TWITCH_SOMETHINGWRONG", "Something wrong with Twitch. Please, try again later");
                }
                
                let streamsResp = (await resp.json()) as {
                    streams: ITwitchStream[]
                };

                for(let stream of streamsResp.streams) {
                    this.streamsCache.set(stream.channel._id + "", {
                        cachedAt: Date.now(),
                        value: stream
                    });
                }
            };
            let chunks = chunk(notCachedYet, 50);
            for(let chunk of chunks) {
                await loop(chunk, 0);
            }
        }

        for(let streamer of streamers) {
            let cached = this.streamsCache.get(streamer.uid);
            if(!cached || !cached.value) {
                result.push({
                    status: "offline",
                    id: "",
                    streamer
                });
                continue;
            }
            result.push({
                status: "online",
                streamer,
                id: cached.value._id + ""
            });
        }

        return result;
    }

    public async getEmbed(stream:IStreamStatus, lang:string) : Promise<IEmbed> {
        let cachedStream = this.streamsCache.get(stream.streamer.uid);
        if(!cachedStream) { throw new StreamingServiceError("TWITCH_CACHEFAULT", "Failure"); }
        return {
            footer: {
                icon_url: TWITCH_ICON,
                text: "Twitch"
            },
            description: localizer.getFormattedString(lang, "STREAMING_DESCRIPTION_TWITCH", {
                username: escapeDiscordMarkdown(cachedStream.value.channel.display_name || cachedStream.value.channel.name, true),
                type: cachedStream.value.stream_type
            }),
            timestamp: cachedStream.value.created_at,
            thumbnail: {
                url: cachedStream.value.channel.logo,
                width: 128,
                height: 128
            },
            author: {
                icon_url: cachedStream.value.channel.logo,
                name: cachedStream.value.channel.display_name || cachedStream.value.channel.name,
                url: cachedStream.value.channel.url
            },
            color: TWITCH_COLOR,
            image: {
                url: cachedStream.value.preview.template.replace("{width}", "1280").replace("{height}", "720") + `?ts=${Date.now()}`
            },
            fields: [{
                inline: true,
                name: localizer.getString(lang, "STREAMING_VIEWERS_NAME"),
                value: localizer.getFormattedString(lang, "STREAMING_VIEWERS_VALUE", {
                    viewers: cachedStream.value.viewers
                })
            }, {
                inline: true,
                name: localizer.getString(lang, "STREAMING_MATURE_NAME"),
                value: localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_TWITCH", {
                    mature: cachedStream.value.channel.mature
                })
            }]
        };
    }

    private getAPIURL_Streams(ids:string[]) {
        return `https://api.twitch.tv/kraken/streams/?channel=${ids.join(",")}&client_id=${this.clientId}&api_version=5`;
    }

    // private getAPIURL_Channel(id:string) {
    //     return `https://api.twitch.tv/kraken/streams/?channel=34711476&client_id=${this.clientId}1&api_version=5}`;
    // }

    private getAPIURL_User(username:string|string[]) {
        let uidsStr = username instanceof Array ? username.join(",") : username;
        return `https://api.twitch.tv/kraken/users?login=${uidsStr}&client_id=${this.clientId}&api_version=5`;
    }

    public freed(uid:string) {
        this.streamsCache.delete(uid);
    }

    public async getStreamer(username:string, attempt=0) : Promise<IStreamingServiceStreamer> {
        if(attempt > 3) {
            throw new StreamingServiceError("TWITCH_TOOMANYATTEMPTS", "Too many attempts. Please, try again later.");
        }

        if(!TWITCH_USERNAME_REGEXP.test(username)) {
            throw new StreamingServiceError("TWITCH_INVALIDUSERNAME", "Invalid username.");
        }

        let resp = await fetch(this.getAPIURL_User(username));
        if(resp.status === 429) {
            let delay = parseInt(resp.headers.get("retry-after") || "5000", 10);
            this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
            await sleep(delay);
            return await this.getStreamer(username, attempt++);
        }

        // it returns us an array with found usernames
        let foundUsers = ((await resp.json()) as {
            users: ITwitchUser[]
        }).users;

        if(foundUsers.length === 0) {
            // not found
            throw new StreamingServiceError("TWITCH_USERNOTFOUND", "User not found.");
        } else if(foundUsers.length > 1) {
            // what the heck... ?
            // whatever
            throw new StreamingServiceError("TWITCH_INVALIDRESPONSE", "Invalid response received.");
        }

        // this one is amazing <3
        let user = foundUsers[0];

        return {
            serviceName: this.name,
            uid: user._id,
            username: user.name
        };
    }

    async unload() {
        this.streamsCache.clear();
        return true;
    }
}

interface ITwitchUser {
    /** Username with saved cAsE (to display) */
    display_name:string;
    /** ID */
    _id:string;
    /** Username */
    name:string;
}

interface ITwitchChannel extends ITwitchUser {
    /** Mature? */
    mature:boolean;
    /** Game name */
    game:string;
    /** Language */
    language?:string;
    /** Channel owner avy */
    logo:string;
    /** Url to stream */
    url:string;
    /** Current name of stream */
    status:string;
    /** Broadcaster language */
    broadcaster_language?:string;
}

interface ITwitchStream {
    /** Stream ID */
    "_id": number;
    /** Current game name */
    "game": string;
    /** Platform broadcaster streams at */
    "broadcast_platform": string;
    /** Current number of viewers */
    "viewers": number;
    /** Video height */
    "video_height": number;
    /** Average FPS */
    "average_fps": number;
    /** If streamer uses delay it would be here */
    "delay": number;
    /** ISO Date when stream started */
    "created_at": string;
    /** It's vodcast? */
    "is_playlist": boolean;
    /** Type of stream */
    "stream_type": "live"|"playlist"|"all";
    /** Previews */
	"preview": {
		"small": string;
		"medium": string;
		"large": string;
		"template": string;
    };
    /** Channel, lol */
	"channel": ITwitchChannel;
}

module.exports = TwitchStreamingService;