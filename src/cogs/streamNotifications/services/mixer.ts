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

interface ICacheItem {
    startedAt: number;
    channel: IMixerChannel;
}

class MixerStreamingService implements IStreamingService {
    public name = "mixer";
    private log = getLogger("MixerStreamingService");

    // bad bad dafri
    private onlineStreams = new Map<string, ICacheItem>();
    private updatedRegistry = new Map<string, boolean>();
    private newRegistry = new Map<string, boolean>();
    private deadStreams = new Map<string, ICacheItem>();

    // Carina
    // ( ͡° ͜ʖ ͡°)
    private ca: Carina;

    constructor(apiKey) {
        this.ca = new Carina({
            isBot: true,
            authToken: apiKey,
            autoReconnect: true
        }).open();
    }

    private listeners = new Map<string, (data) => void>();

    private async _standardCheck(uid: string) {
        // fetching channel to see if it online
        let channel = await this.fetchChannel(uid);
        if(channel.online) {
            this.onlineStreams.set(uid, {
                startedAt: await this.getStreamStartTime(channel.id),
                channel: channel
            });
        }
        return channel;
    }

    public async subscribeTo(uid: string) {
        let listener = async (data: IMixerChannel) => {
            let cached = this.onlineStreams.get(uid);
            // checking data updates
            if(data.online === true) {
                // fetching channel, stream has begun
                await this._standardCheck(uid);
                this.newRegistry.set(uid, true);
            } else if(cached) {
                if(data.online === false) {
                    // moving from new to old cache
                    this.deadStreams.set(uid, cached);
                    this.onlineStreams.delete(uid);
                } else {
                    let oldStreamData = cached.channel;
                    let updated = false;

                    if(data.name && data.name !== oldStreamData.name) { updated = true; }
                    if(data.type && oldStreamData.type && data.type.name !== oldStreamData.type.name) {
                        updated = true;
                    } else if(!data.type && oldStreamData.type) {
                        updated = true;
                    } else if(data.type && !oldStreamData.type) {
                        updated = true;
                    }

                    if(updated) {
                        await this._standardCheck(uid);
                        this.updatedRegistry.set(uid, true);
                    }
                }
            }
        };
        this.listeners.set(uid, listener);
        this.ca.subscribe<IMixerChannel>(`channel:${uid}:update`, listener);
        let chan = await this._standardCheck(uid);
        if(chan.online) { this.newRegistry.set(uid, true); }
    }

    private async makeRequest(uri: string, attempt: number = 0): Promise<any> {
        let resp = await fetch(uri);
        if(resp.status === 429) {
            let delay = parseInt(resp.headers.get("retry-after"), 10);
            this.log("info", `Ratelimited: waiting ${delay / 1000}sec.`);
            await sleep(delay);
            return await this.makeRequest(uri, attempt + 1);
        } else if(resp.status === 404) {
            throw new StreamingServiceError("MIXER_NOTFOUND", "Resource not found");
        }
        return (await resp.json());
    }

    public async fetchChannel(uid: string): Promise<IMixerChannel> {
        return (await this.makeRequest(this.getAPIURL_Channel(uid))) as IMixerChannel;
    }

    public async getStreamStartTime(uid: string): Promise<number> {
        return new Date(((await this.makeRequest(`${this.getAPIURL_Channel(uid)}/manifest.light2`)) as {
            now: string,
            startedAt: string
        }).startedAt).getTime();
    }

    public async fetch(streamers: IStreamingServiceStreamer[]) {
        let result: IStreamStatus[] = [];

        for(let streamer of streamers) {
            if(!this.listeners.has(streamer.uid)) {
                await this.subscribeTo(streamer.uid);
            }
            let cached = this.onlineStreams.get(streamer.uid);
            if(!cached) {
                let offlineStream = this.deadStreams.get(streamer.uid);
                if(offlineStream) {
                    result.push({
                        status: "offline",
                        streamer,
                        id: getUUIDByString(`mixer::${streamer.uid}::${offlineStream.startedAt}`),
                        payload: offlineStream
                    });
                }
                continue;
            } else {
                let stream = this.onlineStreams.get(streamer.uid);
                if(!stream) { continue; }

                if(!!this.updatedRegistry.get(streamer.uid)) {
                    result.push({
                        status: "online",
                        streamer,
                        id: getUUIDByString(`mixer::${streamer.uid}::${cached.startedAt}`),
                        payload: stream
                    });
                    this.updatedRegistry.delete(streamer.uid);
                } else if(!!this.newRegistry.get(streamer.uid)) {
                    result.push({
                        status: "online",
                        streamer,
                        id: getUUIDByString(`mixer::${streamer.uid}::${cached.startedAt}`),
                        payload: stream
                    });
                    this.newRegistry.delete(streamer.uid);
                }
            }
        }

        return result;
    }

    public async getEmbed(stream: IStreamStatus, lang: string): Promise<IEmbed> {
        let cache = stream.payload as ICacheItem;
        if(!cache) {
            throw new StreamingServiceError("MIXER_CACHEFAULT", "Failure: payload not found");
        }
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
            description: localizer.getFormattedString(lang, stream.status === "online" ? "STREAMING_DESCRIPTION" : "STREAMING_DESCRIPTION_OFFLINE", {
                username: escapeDiscordMarkdown(cache.channel.user.username, true)
            }),
            title: cache.channel.name,
            url: `https://mixer.com/${cache.channel.token}`,
            color: MIXER_COLOR,
            image: {
                url: `https://thumbs.beam.pro/channel/${cache.channel.id}.big.jpg?ts=${Date.now()}`
            },
            fields: [{
                inline: true,
                name: localizer.getString(lang, "STREAMING_GAME_NAME"),
                value: cache.channel.type ? cache.channel.type.name : localizer.getString(lang, "STREAMING_GAME_VALUE_UNKNOWN")
            }, {
                inline: true,
                name: localizer.getString(lang, "STREAMING_MATURE_NAME"),
                value: localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_MIXER", {
                    audience: cache.channel.audience
                })
            }]
        };
    }

    public getAPIURL_Channel(username: string) {
        return `https://mixer.com/api/v1/channels/${username}`;
    }

    public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
        let json = (await this.makeRequest(this.getAPIURL_Channel(username))) as IMixerChannel;
        return {
            serviceName: this.name,
            uid: json.id + "",
            username: json.token
        };
    }

    public flushOfflineStream(uid: string) {
        this.deadStreams.delete(uid);
    }

    public freed(uid: string) {
        let listener = this.listeners.get(uid);
        if(listener) {
            this.ca.unsubscribe(`channel:${uid}:update`);
            this.listeners.delete(uid);
        }
    }

    async unload() {
        for(let [uid, listener] of this.listeners) {
            this.ca.unsubscribe(`channel:${uid}:update`, listener);
        }
        this.onlineStreams.clear();
        return true;
    }
}

interface IMixerChannel {
    /**
     * Channel ID
     */
    id: string;
    /**
     * Channel name
     */
    token: string;
    /**
     * Name of the stream
     */
    name: string;
    /**
     * Viewers (current)
     */
    viewersCurrent: number;
    /**
     * Viewers (total)
     */
    viewersTotal: number;
    /**
     * Followers
     */
    numFollowers: number;
    /**
     * Latest time channel was updated (streaming also updates it)
     */
    updatedAt: string;
    /**
     * Details about game
     */
    type: {
        /**
         * Name of game
         */
        name: string
    }|null;
    /**
     * Online?
     */
    online: boolean;
    /**
     * User info
     */
    user: {
        /**
         * Avy url
         */
        avatarUrl?: string;
        /**
         * Username
         */
        username: string;
    };
    /**
     * Audience of stream
     */
    audience: "teen" | "18+" | "family";
}

module.exports = MixerStreamingService;