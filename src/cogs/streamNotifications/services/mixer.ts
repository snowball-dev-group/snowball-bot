import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError } from "../baseService";
import { IEmbed, sleep, getLogger, escapeDiscordMarkdown } from "../../utils/utils";
import { getUUIDByString } from "../../utils/text";
import { default as fetch } from "node-fetch";
import { Carina } from "carina";
import * as ws from "ws";

Carina.WebSocket = ws;

// const MAX_CACHE_LIFE = 180000; // ms
const MIXER_ICON = "https://i.imgur.com/fQsQPkd.png";
const MIXER_COLOR = 0x1FBAED;

class MixerStreamingService implements IStreamingService {
    public name = "mixer";
    private log = getLogger("MixerStreamingService");
    private cache = new Map<string, {
        startedAt:number,
        channel: IMixerChannel
    }>();
    private ca:Carina;

    constructor(apiKey) {
        this.ca = new Carina({
            isBot: true,
            authToken: apiKey,
            autoReconnect: true
        }).open();
    }

    private listeners = new Map<string, (data) => void>();

    public async subscribeTo(uid:string) {
        let listener = async (data:IMixerChannel) => {
            if(data.online === true) {
                // fetching channel, stream has begun
                let channel = await this.fetchChannel(uid);
                this.cache.set(uid, {
                    startedAt: await this.getStreamStartTime(channel.id),
                    channel: channel
                });
            } else if (data.online === false) {
                this.cache.delete(uid);
            }
        };
        this.listeners.set(uid, listener);
        this.ca.subscribe(`channel:${uid}:update`, listener);
        // fetching channel to see if it online
        let channel = await this.fetchChannel(uid);
        if(channel.online) {
            this.cache.set(uid, {
                startedAt: await this.getStreamStartTime(channel.id),
                channel: channel
            });
        }
    }

    async fetchChannel(uid:string, attempt:number = 0) : Promise<IMixerChannel> {
        if(attempt > 3) {
            throw new StreamingServiceError("MIXER_TOOMANYATTEMPTS", "Too many attempts. Please, try again later.");
        }
        let resp = await fetch(this.getAPIURL_Channel(uid));
        if(resp.status === 429) {
            let delay = parseInt(resp.headers.get("retry-after"), 10);
            this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
            await sleep(delay);
            return await this.fetchChannel(uid, attempt + 1);
        } else if(resp.status === 404) {
            throw new StreamingServiceError("MIXER_NOTFOUND", "Channel with this name not found");
        }
        return (await resp.json()) as IMixerChannel;
    };

    async getStreamStartTime(uid:string, attempt:number = 0) : Promise<number> {
        if(attempt > 3) {
            throw new StreamingServiceError("MIXER_TOOMANYATTEMPTS", "Too many attempts. Please, try again later.");
        }

        let resp = await fetch(`${this.getAPIURL_Channel(uid)}/manifest.light2`);
        if(resp.status === 429) {
            let delay = parseInt(resp.headers.get("retry-after"), 10);
            this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
            await sleep(delay);
            return await this.getStreamStartTime(uid, attempt + 1);
        } else if(resp.status === 404) {
            throw new StreamingServiceError("MIXER_NOTFOUND", "Channel with this name not found");
        }
        
        return new Date(((await resp.json()) as {
            now: string,
            startedAt: string
        }).startedAt).getTime();
    }

    public async fetch(streamers:IStreamingServiceStreamer[]) {
        // should return only online streams

        let result:IStreamStatus[] = [];

        for(let streamer of streamers) {
            if(!this.listeners.has(streamer.uid)) {
                await this.subscribeTo(streamer.uid);
            }
            let cached = this.cache.get(streamer.uid);
            if(!cached || !cached.channel.online) {
                result.push({
                    status: "offline",
                    streamer,
                    id: ""
                });
                continue;
            }
            result.push({
                status: "online",
                streamer,
                id: getUUIDByString(`mixer::${streamer.uid}::${cached.startedAt}`)
            });
        }

        return result;
    }

    public async getEmbed(stream:IStreamStatus, lang:string) : Promise<IEmbed> {
        let cache = this.cache.get(stream.streamer.uid);
        if(!cache) { throw new StreamingServiceError("MIXER_CACHEFAULT", "Failure"); }
        return {
            footer: {
                icon_url: MIXER_ICON,
                text: "Mixer"
            },
            timestamp: cache.channel.updatedAt,
            author: {
                icon_url: cache.channel.user.avatarUrl,
                name: cache.channel.user.username,
                url: `https://mixer.com/${cache.channel.token}`
            },
            thumbnail: {
                width: 128,
                height: 128,
                url: cache.channel.user.avatarUrl || MIXER_ICON
            },
            description: localizer.getFormattedString(lang, "STREAMING_DESCRIPTION", {
                username: escapeDiscordMarkdown(cache.channel.user.username, true)
            }),
            color: MIXER_COLOR,
            image: {
                url: `https://thumbs.beam.pro/channel/${cache.channel.id}.big.jpg?ts=${Date.now()}`
            },
            fields: [{
                inline: true,
                name: localizer.getString(lang, "STREAMING_VIEWERS_NAME"),
                value: localizer.getFormattedString(lang, "STREAMING_VIEWERS_VALUE", {
                    viewers: cache.channel.viewersCurrent
                })
            }, {
                inline: true,
                name: localizer.getString(lang, "STREAMING_MATURE_NAME"),
                value: localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_MIXER", {
                    audience: cache.channel.audience
                })
            }]
        };
    }

    freed(uid:string) {
        let listener = this.listeners.get(uid);
        if(listener) {
            this.ca.unsubscribe(`channel:${uid}:update`);
            this.listeners.delete(uid);
        }
    }

    // private getAPIURL_Channels(ids:string[]) {
    //     return `https://beam.pro/api/v1/channels?where=online:eq:true,id:in:${ids.join(";")}`;
    // }

    private getAPIURL_Channel(username:string) {
        return `https://mixer.com/api/v1/channels/${username}`;
    }

    public async getStreamer(username:string, attempt=0) : Promise<IStreamingServiceStreamer> {
        if(attempt > 3) {
            throw new StreamingServiceError("MIXER_TOOMANYATTEMPTS", "Too many attempts. Please, try again later.");
        }
        let resp = await fetch(this.getAPIURL_Channel(username));
        if(resp.status === 429) {
            let delay = parseInt(resp.headers.get("retry-after"), 10);
            this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
            await sleep(delay);
            return await this.getStreamer(username, attempt++);
        } else if(resp.status === 404) {
            throw new StreamingServiceError("MIXER_NOTFOUND", "Channel with this name not found");
        }
        let json = (await resp.json()) as IMixerChannel;
        return {
            serviceName: this.name,
            uid: json.id + "",
            username: json.token
        };
    }

    async unload() {
        for(let [uid, listener] of this.listeners) {
            this.ca.unsubscribe(`channel:${uid}:update`, listener);
        }
        this.cache.clear();
        return true;
    }
}

interface IMixerChannel {
    /**
     * Channel ID
     */
    id:string;
    /**
     * Channel name
     */
    token:string;
    /**
     * Name of the stream
     */
    name:string;
    /**
     * Viewers (current)
     */
    viewersCurrent:number;
    /**
     * Viewers (total)
     */
    viewersTotal:number;
    /**
     * Followers
     */
    numFollowers:number;
    /**
     * Latest time channel was updated (streaming also updates it)
     */
    updatedAt:string;
    /**
     * Details about game
     */
    type: {
        /**
         * Name of game
         */
        name:string
    };
    /**
     * Online?
     */
    online:boolean;
    /**
     * User info
     */
    user: {
        /**
         * Avy url
         */
        avatarUrl?:string;
        /**
         * Username
         */
        username:string;
    };
    /**
     * Audience of stream
     */
    audience:"teen"|"18+"|"family";
}

module.exports = MixerStreamingService;