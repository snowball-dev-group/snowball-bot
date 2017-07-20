import { IStreamingService, IStreamingServiceStreamer, IStreamStatus, StreamingServiceError } from "../baseService";
import { IEmbed, sleep, getLogger, escapeDiscordMarkdown } from "../../utils/utils";
import { getUUIDByString } from "../../utils/text";
import { default as fetch } from "node-fetch";

const MAX_CACHE_LIFE = 180000; // ms
const MIXER_ICON = "https://i.imgur.com/fQsQPkd.png";
const MIXER_COLOR = 0x1FBAED;

class MixerStreamingService implements IStreamingService {
    public name = "mixer";

    private log = getLogger("MixerStreamingService");

    private cache = new Map<string, {
        cachedAt:number,
        value: IMixerChannel
    }>();

    public async fetch(streamers:IStreamingServiceStreamer[]) {
        // should return only online streams
        
        // don't updating for cached streams
        let reqDate = Date.now();
        let notCachedYet = streamers.filter(s => {
            // {} is not cached?
            let cached = this.cache.get(s.uid);
            if(!cached) { return true; }
            if((reqDate - cached.cachedAt) > MAX_CACHE_LIFE) { return true; }
            return false;
        });
        
        let result:IStreamStatus[] = [];
        
        if(notCachedYet.length > 0) {
            let loop = async (attempt) => { 
                if(attempt > 3) {
                    throw new StreamingServiceError("MIXER_TOOMANYATTEMPTS", "Too many attempts. Please, try again later");
                }

                let resp = await fetch(this.getAPIURL_Channels(notCachedYet.map(c => c.uid)));
                if(resp.status === 429) {
                    await sleep(parseInt(resp.headers.get("retry-after"), 10));
                    return await loop(attempt++);
                } else if(resp.status !== 200) {
                    throw new StreamingServiceError("MIXER_SOMETHINGWRONG", "Something wrong with Mixer. Please, try again later");
                }
                
                let arr = (await resp.json()) as IMixerChannel[];

                for(let ch of arr) {
                    this.cache.set(ch.id + "", {
                        cachedAt: Date.now(),
                        value: ch
                    });
                }
            };
            await loop(0);
        }

        for(let streamer of streamers) {
            let cached = this.cache.get(streamer.uid);
            if(!cached || !cached.value.online) {
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
                id: getUUIDByString(`${this.name}::${cached.value.token}::{{${cached.value.name}}, {${cached.value.updatedAt}}}`)
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
            timestamp: cache.value.updatedAt,
            author: {
                icon_url: cache.value.user.avatarUrl,
                name: cache.value.user.username,
                url: `https://mixer.com/${cache.value.token}`
            },
            thumbnail: {
                width: 128,
                height: 128,
                url: cache.value.user.avatarUrl || MIXER_ICON
            },
            description: localizer.getFormattedString(lang, "STREAMING_DESCRIPTION", {
                username: escapeDiscordMarkdown(cache.value.user.username, true)
            }),
            color: MIXER_COLOR,
            image: {
                url: `https://thumbs.beam.pro/channel/${cache.value.id}.big.jpg?ts=${Date.now()}`
            },
            fields: [{
                inline: true,
                name: localizer.getString(lang, "STREAMING_VIEWERS_NAME"),
                value: localizer.getFormattedString(lang, "STREAMING_VIEWERS_VALUE", {
                    viewers: cache.value.viewersCurrent
                })
            }, {
                inline: true,
                name: localizer.getString(lang, "STREAMING_MATURE_NAME"),
                value: localizer.getFormattedString(lang, "STREAMING_MATURE_VALUE_MIXER", {
                    audience: cache.value.audience
                })
            }]
        };
    }

    private getAPIURL_Channels(ids:string[]) {
        return `https://beam.pro/api/v1/channels?where=online:eq:true,id:in:${ids.join(";")}`;
    }

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