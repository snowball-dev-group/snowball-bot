import { IEmbed } from "@utils/utils";
import { IModule } from "@sb-types/ModuleLoader/ModuleLoader";
import { EventEmitter } from "events";

export class StreamingServiceError extends Error {
	public stringKey: string;
	public additionalData: any;
	constructor(stringKey: string, message: string, additionalData?: any) {
		super(message);
		this.stringKey = stringKey;
		this.additionalData = additionalData;
		Object.freeze(this);
	}
}

export interface IStreamingService extends IModule, EventEmitter {
	/**
	* Stream service name
	*/
	name: string;

	/**
	* Get embed style for stream
	*/
	getEmbed(stream: IStreamStatus, language: string): Promise<IEmbed>;

	/**
	* Adds subscription to check rotation
	*/
	addSubscription(uid: IStreamingServiceStreamer): void;

	/**
	* Removes subscription from check rotation
	*/
	removeSubscription(uid: string): void;

	/**
	* Checks if subscribed to streamer
	*/
	isSubscribed(uid: string): boolean;

	/**
	* Get streamer info
	*/
	getStreamer(username: string): Promise<IStreamingServiceStreamer>;

	/**
	* Once stream status getting updated
	*/
	on(action: StreamStatusChangedAction, handler: StreamStatusChangedHandler);

	/**
	* Emit online event
	*/
	emit(action: StreamStatusChangedAction, status: IStreamStatus);

	/**
	 * Starts fetch cycle
	 */
	start?(delayed?: number): Promise<void>;

	/**
	 * Stops fetch cycle
	 */
	stop?(): Promise<void>;
}

export type StreamStatusString = "online" | "offline";

export type StreamStatusChangedAction = "online" | "updated" | "offline";
export type StreamStatusChangedHandler = ((status: IStreamStatus) => void);

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
	updated?: boolean;

	/**
	* If stream updated, provide new ID!
	*/
	oldId?: string;

	/**
	* Payload
	* Working in clusters means communication
	*/
	payload: object;

	/**
	 * Force Steam Notifications module to disable everyone
	 */
	noEveryone?: boolean;
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
