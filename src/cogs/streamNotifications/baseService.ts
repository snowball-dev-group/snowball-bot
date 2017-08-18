import { IEmbed } from "../utils/utils";
import { IModule } from "../../types/ModuleLoader";

export class StreamingServiceError extends Error {
    public stringKey: string;
    constructor(stringKey: string, message: string) {
        super(message);
        this.stringKey = stringKey;
    }
}

export interface IStreamingService extends IModule {
    /**
    * Stream service name
    */
    name: string;

    /**
    * Batch fetching
    */
    fetch(streams: IStreamingServiceStreamer[]): Promise<IStreamStatus[]>;

    /**
    * Get embed style for stream
    */
    getEmbed(stream: IStreamStatus, language: string): Promise<IEmbed>;

    /**
    * Get streamer info
    */
    getStreamer(username: string): Promise<IStreamingServiceStreamer>;

    /**
     * Free cache if streamer got deleted
     * All possible cache should be cleaned
     */
    freed?(uid: string): void;

    /**
     * Flush stream from streams cache
     * All stream cache from this user should be cleaned
     */
    flushOfflineStream(id:string): void;
}

export type StreamStatusString = "online" | "offline";

/**
 * Used to generate embed
 */
export interface IStreamStatus {
    /**
    * Current status of streamer
    */
    status: StreamStatusString;

    /**
    * Info about streamer
    */
    streamer: IStreamingServiceStreamer;

    /**
     * Stream ID
     */
    id: string;

    /**
     * If stream not new, but updated
     */
    updated?:boolean;

    /**
     * If stream updated, provide new ID!
     */
    oldId?: string;
}

export interface IStreamingServiceStreamer {
    /**
    * Name of streaming service
    * Should be equal to name of IStreamingService
    */
    serviceName: string;
    /**
    * Username
    */
    username: string;
    /**
    * ID (probably gonna be used for next calls)
    */
    uid: string;
}