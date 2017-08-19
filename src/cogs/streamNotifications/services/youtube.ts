import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError } from "../baseService";
import { IEmbed, escapeDiscordMarkdown } from "../../utils/utils";
import { default as fetch } from "node-fetch";

const MAX_STREAM_CACHE_LIFE = 180000;
const MAX_CHANNEL_CACHE_LIFE = 600000;  // ms
const YOUTUBE_ICON = "https://i.imgur.com/7Li5Iu2.png";
const YOUTUBE_COLOR = 0xCD201F;
// const YOUTUBE_ID_REGEXP = /^[a-zA-Z0-9\_\-]{23,26}$/;

interface ICacheItem<T> {
    cachedAt: number;
    value: T;
}

interface IServiceOptions {
    apiKey:string;
    fetchDifference:number;
}

class TwitchStreamingService implements IStreamingService {
    public name = "youtube";

    private apiKey: string;
    private fetchDiff = 180000;

    constructor(options: string|IServiceOptions) {
        if(typeof options !== "string") {
            this.apiKey = options.apiKey;
            this.fetchDiff = options.fetchDifference;
        } else {
            this.apiKey = options;
        }
    }

    private streamsCache = new Map<string, ICacheItem<IYouTubeVideo>>();
    private oldStreamsCache = new Map<string, ICacheItem<IYouTubeVideo>>();

    private channelCache = new Map<string, ICacheItem<IYouTubeChannel>>();

    private previousFetchTime = 0;

    public async fetch(streamers: IStreamingServiceStreamer[]) {
        // don't updating for cached streams
        let currentTime = Date.now();

        if((currentTime - this.previousFetchTime) < this.fetchDiff) {
            // ratelimited, not going to bother API
            // it's made to not go over quota of YouTube API :FeelsBadMan:
            return [];
        }

        let result: IStreamStatus[] = [];

        for(let streamer of streamers) {
            let resp = await fetch(this.getAPIURL_Stream(streamer.uid));
            if(resp.status !== 200) { continue; }
            let vids = (await resp.json()) as IYouTubeListResponse<IYouTubeVideo>;
            if(vids.items.length === 0) {
                // probably we had stream before
                let cachedStream = this.streamsCache.get(streamer.uid);
                if(cachedStream) {
                    this.oldStreamsCache.set(streamer.uid, cachedStream);
                    // deleting old copy
                    this.streamsCache.delete(streamer.uid);
                    result.push({
                        status: "offline",
                        streamer,
                        id: cachedStream.value.id.videoId
                    });
                }
            } else if(vids.items.length === 1) {
                // what if we had old version?
                let cachedVersion = this.streamsCache.get(streamer.uid);
                let newStream = vids.items[0];
                if(cachedVersion) {
                    let oldStream = cachedVersion.value;

                    let updated = false;
                    
                    if(newStream.id.videoId !== oldStream.id.videoId) { updated = true; }
                    if(newStream.snippet.title !== oldStream.snippet.title) { updated = true; }

                    if(updated) {
                        result.push({
                            status: "online",
                            streamer,
                            id: newStream.id.videoId,
                            updated: true,
                            oldId: oldStream.id.videoId
                        });
                    }
                } else {
                    result.push({
                        status: "online",
                        streamer,
                        id: newStream.id.videoId
                    });
                }

                this.streamsCache.set(streamer.uid, {
                    cachedAt: Date.now(),
                    value: newStream
                });
            } else if(vids.items.length > 1) {
                continue;
            }
        }

        this.previousFetchTime = currentTime;
        return result;
    }

    public async getEmbed(stream: IStreamStatus, lang: string): Promise<IEmbed> {
        let cachedStream = stream.status === "online" ? this.streamsCache.get(stream.streamer.uid) : this.oldStreamsCache.get(stream.streamer.uid);
        if(!cachedStream) {
            throw new StreamingServiceError("YOUTUBE_CACHENOTFOUND", `Stream cache for channel with ID "${stream.streamer.uid}" not found`);
        }

        let cachedChannel = this.channelCache.get(stream.streamer.uid);
        if(!cachedChannel || ((Date.now() - cachedChannel.cachedAt) > MAX_CHANNEL_CACHE_LIFE)) {
            let resp = await fetch(this.getAPIURL_Channels(stream.streamer.uid, false));
            if(resp.status !== 200) {
                throw new StreamingServiceError("YOUTUBE_CHANNELFETCH_FAILED", "Fething failed");
            }
            let channels = ((await resp.json()) as IYouTubeListResponse<IYouTubeChannel>).items;
            if(channels.length !== 1) {
                throw new StreamingServiceError("YOUTUBE_CHANNELNOTFOUND", "Channel not found");
            }
            this.channelCache.set(stream.streamer.uid, {
                cachedAt: Date.now(),
                value: channels[0]
            });
            cachedChannel = this.channelCache.get(stream.streamer.uid) as {
                cachedAt: number,
                value: IYouTubeChannel
            };
        }

        if(!cachedChannel) { throw new StreamingServiceError("YOUTUBE_CODEERROR", "Error in caching code. Something went wrong"); }

        let channel = cachedChannel.value;

        return {
            footer: {
                icon_url: YOUTUBE_ICON,
                text: "YouTube"
            },
            thumbnail: {
                url: channel.snippet.thumbnails.high.url,
                width: 128,
                height: 128
            },
            timestamp: cachedStream.value.snippet.publishedAt,
            author: {
                icon_url: channel.snippet.thumbnails.default.url,
                name: channel.snippet.title,
                url: `https://youtube.com/channel/${channel.id}`
            },
            title: cachedStream.value.snippet.title,
            url: `https://youtu.be/${cachedStream.value.id.videoId}`,
            description: localizer.getFormattedString(lang, stream.status === "online" ? "STREAMING_DESCRIPTION" : "STREAMING_DESCRIPTION_OFFLINE", {
                username: escapeDiscordMarkdown(channel.snippet.title, true)
            }),
            color: YOUTUBE_COLOR,
            image: {
                url: cachedStream.value.snippet.thumbnails.high.url
            }
        };
    }

    private getAPIURL_Stream(channelId: string) {
        let str = "https://www.googleapis.com/youtube/v3/search";
        str += "?part=snippet";
        str += `&channelId=${channelId}`;
        str += "&type=video";
        str += "&eventType=live";
        str += `&key=${this.apiKey}`;
        return str;
    }

    private getAPIURL_Channels(id: string, isUsername = false) {
        let str = "https://www.googleapis.com/youtube/v3/channels";
        str += isUsername ? `?forUsername=${id}` : `?id=${id}`;
        str += "&part=snippet";
        str += `&key=${this.apiKey}`;
        return str;
    }

    public async getStreamer(username: string): Promise<IStreamingServiceStreamer> {
        let isId = username.startsWith("channel/");
        if(isId) {
            username = username.slice("channel/".length);
        }

        let resp = await fetch(this.getAPIURL_Channels(username, !isId));

        if(resp.status !== 200) {
            throw new StreamingServiceError("YOUTUBE_UNSUCCESSFUL_RESP", "YouTube respond with wrong code, means");
        }

        let channels = ((await resp.json()) as IYouTubeListResponse<IYouTubeChannel>).items;

        if(channels.length !== 1) {
            throw new StreamingServiceError("YOUTUBE_USERNOTFOUND", "User not found.");
        }
        let channel = channels[0];

        this.channelCache.set(channel.id, {
            cachedAt: Date.now(),
            value: channel
        });

        return {
            serviceName: this.name,
            uid: channel.id,
            username: channel.snippet.title
        };
    }

    public flushOfflineStream(uid: string) {
        this.oldStreamsCache.delete(uid);
    }

    public freed(uid: string) {
        this.streamsCache.delete(uid);
        this.channelCache.delete(uid);
    }

    async unload() {
        this.channelCache.clear();
        this.streamsCache.clear();
        return true;
    }
}

interface IYouTubeChannel {
    "kind": string;
    "etag": string;
    "id": string;
    "snippet": {
        "title": string;
        "description": string;
        "customUrl": string;
        "publishedAt": string;
        "thumbnails": {
            "default": {
                "url": string;
            };
            "medium": {
                "url": string;
            };
            "high": {
                "url": string;
            };
        };
        "localized": {
            "title": string;
            "description": string;
        };
    };
}

interface IYouTubeListResponse<T> {
    "kind": string;
    "pageInfo": {
        "totalResults": number;
        "resultsPerPage": number;
    };
    "items": T[];
}

interface IYouTubeVideo {
    "kind": string;
    "id": {
        "kind": string;
        "videoId": string;
    };
    "snippet": {
        "publishedAt": string;
        "channelId": string;
        "title": string;
        "description": string;
        "thumbnails": {
            "default": {
                "url": string;
                "width": number;
                "height": number;
            };
            "medium": {
                "url": string;
                "width": number;
                "height": number;
            };
            "high": {
                "url": string;
                "width": number;
                "height": number;
            };
        };
        "channelTitle": string;
        "liveBroadcastContent": string;
    };
}

module.exports = TwitchStreamingService;