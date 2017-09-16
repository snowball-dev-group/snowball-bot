// shared interfaces

export interface IHashMap<T> {
	[key: string]: T;
}

export interface INullableHashMap<T> {
	[key: string]: T|undefined;
}

export interface ISnowballIPCMessage<T> {
	type: string;
	payload: T;
}