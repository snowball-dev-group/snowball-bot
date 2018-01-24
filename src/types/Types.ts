// #region Hashmaps

/**
 * Raw Javascript object based hash map.
 * BE AWARE! Use `Object.create(null)` or `createHashMap` form this file to insure you create valid map.
 */
export interface IHashMap<T> {
	[key: string]: T;
}

/**
 * It's shortcut to IHashMap<T|T1|...|undefined|null>.
 * The general use is to be sure, that your script does checks if property is exists in map, before using it.
 * As example this could be used to identify if object from your map was checked (`null`) and not (`undefined`).
 * Imrprovise while checking, never do such thing as `map["prop"] === undefined`
 */
export type INullableHashMap<T> = IHashMap<T|undefined|null>;

export interface ISnowballIPCMessage<T> {
	type: string;
	payload: T;
}

/**
 * Creates empty hashmap or from object (only own properies).
 * The main difference that it uses `Object.create(null)` to create an actual map, it doesn't has a prototype, so your map will not return anything by `toString` or something.
 * @param entries 
 */
export function createHashMap<T>(entries?: Array<[string, T]> | IHashMap<T>) : IHashMap<T> {
	const hashMap = Object.create(null);
	if(entries) {
		if(Array.isArray(entries)) {
			for(const entry of entries) {
				if(!Array.isArray(entry)) {
					throw new Error("Invalid entry");
				}
				hashMap[entry[0]] = entry[1];
			}
		} else if(typeof entries === "object") {
			for(const property of Object.getOwnPropertyNames(entries)) {
				hashMap[property] = entries[property];
			}
		} else {
			throw new Error("Unknown type of object");
		}
	}
	return hashMap;
}

// #endregion

// #region Dynamic types

export type Possible<T> = T | undefined | null;
export type IPCMessage<T> = string | ISnowballIPCMessage<T>;

// #endregion

// #region Errors

// I don't sure about the name
// This is just mix of "error" and "code"
export class DetailedError extends Error {
	private readonly _code: string;
	private readonly _subError?: Error;

	public get code() { return this._code; }
	public get subError() { return this._subError; }

	constructor(code: string, message?: string, subError?: Error) {
		super(message);

		this._code = code;
		this._subError = subError;
	}
}

// #endregion
