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

    private clientId: string;
    private log = getLogger("TwitchStreamingService");

    constructor(clientId: string) {
        this.clientId = clientId;
    }

    private streamsMap = new Map<string, {
        fetchedAt: number,
        value: ITwitchStream
    }>();

    public async fetch(streamers: IStreamingServiceStreamer[]) {
        let cDate = Date.now();
        let notFetchedYet = streamers.filter(s => {
            let cached = this.streamsMap.get(s.uid);
            if(!cached) { return true; }
            if((cDate - cached.fetchedAt) > MAX_STREAM_CACHE_LIFE) { return true; }
            return false;
        });

        let result: IStreamStatus[] = [];

        if(notFetchedYet.length > 0) {
            let processChunk = async (toFetch: IStreamingServiceStreamer[]) => {
                let streamsResp = (await this.makeRequest(this.getAPIURL_Streams(toFetch.map(s => s.uid)))) as {
                    streams: ITwitchStream[]
                };

                for(let stream of streamsResp.streams) {
                    this.streamsMap.set(stream.channel._id + "", {
                        fetchedAt: Date.now(),
                        value: stream
                    });
                }
            };
            let chunks = chunk(notFetchedYet, 50);
            for(let chunk of chunks) {
                await processChunk(chunk);
            }
        }

        for(let streamer of streamers) {
            let cached = this.streamsMap.get(streamer.uid);
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

    public async getEmbed(streamStatus: IStreamStatus, lang: string): Promise<IEmbed> {
        let stream = this.streamsMap.get(streamStatus.streamer.uid);
        if(!stream) { throw new StreamingServiceError("TWITCH_CACHEFAULT", "Failure"); }
        return {
            footer: {
                icon_url: TWITCH_ICON,
                text: "Twitch"
            },
            description: localizer.getFormattedString(lang, "STREAMING_DESCRIPTION_TWITCH", {
                username: escapeDiscordMarkdown(stream.value.channel.display_name || stream.value.channel.name, true),
                type: stream.value.stream_type
            }),
            timestamp: stream.value.created_at,
            thumbnail: {
                url: stream.value.channel.logo,
                width: 128,
                height: 128
            },
            author: {
                icon_url: stream.value.channel.logo,
                name: stream.value.channel.display_name || stream.value.channel.name,
                url: stream.value.channel.url
            },
            title: stream.value.channel.status,
            url: stream.value.channel.url,
            color: TWITCH_COLOR,
            image: {
                url: stream.value.preview.template.replace("{width}", "1280").replace("{height}", "720") + `?ts=${Date.now()}`
            },
            fields: [{
                inline: true,
                name: localizer.getString(lang, "STREAMING_GAME_NAME"),
                value: stream.value.game ? stream.value.game : localizer.getString(lang, "STREAMING_GAME_VALUE_UNKNOWN")
            }, {
                inline: true,
                name: localizer.getString(lang, "STREAMING_MATURE_NAME"),
                value: localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_TWITCH", {
                    mature: stream.value.channel.mature + ""
                })
            }]
        };
    }

    private getAPIURL_Streams(ids: string[]) {
        return `https://api.twitch.tv/kraken/streams/?channel=${ids.join(",")}&client_id=${this.clientId}&api_version=5`;
    }

    private getAPIURL_User(username: string | string[]) {
        let uidsStr = username instanceof Array ? username.join(",") : username;
        return `https://api.twitch.tv/kraken/users?login=${uidsStr}&client_id=${this.clientId}&api_version=5`;
    }

    public freed(uid: string) {
        this.streamsMap.delete(uid);
    }

    public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
        if(!TWITCH_USERNAME_REGEXP.test(username)) {
            throw new StreamingServiceError("TWITCH_INVALIDUSERNAME", "Invalid username.");
        }

        let foundUsers = (await this.makeRequest(this.getAPIURL_User(username)) as {
            users: ITwitchUser[]
        }).users;

        if(foundUsers.length === 0) {
            throw new StreamingServiceError("TWITCH_USERNOTFOUND", "User not found.");
        } else if(foundUsers.length > 1) {
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

    private async makeRequest(uri: string): Promise<any> {
        let loop = async (attempt: number = 0) => {
            if(attempt > 3) {
                throw new StreamingServiceError("TWITCH_TOOMANYATTEMPTS", "Too many attempts. Please, try again later.");
            }
            let resp = await fetch(uri);
            if(resp.status === 429) {
                let delay = parseInt(resp.headers.get("retry-after") || "5000", 10);
                this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
                await sleep(delay);
                return await loop(attempt + 1);
            }
            return await resp.json();
        };
        return await loop();
    }

    async unload() {
        this.streamsMap.clear();
        return true;
    }
}

interface ITwitchUser {
    /** Username with saved cAsE (to display) */
    display_name: string;
    /** ID */
    _id: string;
    /** Username */
    name: string;
}

interface ITwitchChannel extends ITwitchUser {
    /** Mature? */
    mature: boolean;
    /** Game name */
    game: string;
    /** Language */
    language?: string;
    /** Channel owner avy */
    logo: string;
    /** Url to stream */
    url: string;
    /** Current name of stream */
    status: string;
    /** Broadcaster language */
    broadcaster_language?: string;
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
    "stream_type": "live" | "playlist" | "all";
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