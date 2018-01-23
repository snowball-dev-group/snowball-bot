import { getRedisClient } from "./redis";

const DEFAULT_TTL = 30*60; // 30 min?

type AllowedTypes = string | number | object;

interface IPushResults<T> {
	/**
	 * Returned value by redis
	 */
	value: T;
	/**
	 * Was it array pushed as list to the redis?
	 */
	isArray: boolean;
	/**
	 * If `JSON.stringify` was called at least one time to store the value, it will be `true`
	 */
	stringifyTriggered: boolean;
	/**
	 * If you passed an object to the array, this will identify the index of this element in redis list.
	 * Will be undefined if none objects were converted to the JSON
	 */
	stringifyTriggeredAt?: number[];
	/**
	 * We trying to built specific key in redis, so your data won't be messed up.
	 * Keys are clean from many specific characters
	 */
	builtKey: string;
}

/**
 * **Stores value for some time by special key.**
 * Special key is generated based on owner and key. By default we strip many special characters, this can result an empty string (we check for it), so be smart picking the key and owner names :)
 * @param {string} owner **Cache owner identifier**
 * @param {string} key **Key which will be used next to the owner**, so this owner could have multiple valeus store.
 * @param value **Value to store in the database**. For JS objects `JSON.stringify` will be used, be aware
 * @param {number} ttl **Time for what cache lives** in the Redis DB (seconds)
 */
export async function storeValue<T>(owner: string, key: string, value: AllowedTypes|AllowedTypes[], ttl = DEFAULT_TTL) : Promise<IPushResults<T>> {
	const redisClient = await getRedisClient();

	const builtKey = buildCacheKey(owner, key);

	if(Array.isArray(value)) {
		const stringifyTriggeredAt: number[] = [];

		let pipeline = redisClient.pipeline();
		// tbh I still unsure if I need to reassign pipeline var
		// if nope, pls report an issue or make merge request
		// thanx <3
		for(let i =0; i < value.length; i++) {
			let val = value[i];
			if(typeof val === "object") {
				val = JSON.stringify(val);
				stringifyTriggeredAt.push(i);
			}
			pipeline = pipeline.rpush(builtKey, );
		}
		pipeline = pipeline.expire(builtKey, ttl);

		const stringifyCalled = stringifyTriggeredAt.length > 0;

		return {
			builtKey,
			isArray: true,
			value: await redisClient.lrange(builtKey, 0, -1),
			stringifyTriggered: stringifyCalled,
			stringifyTriggeredAt: stringifyCalled ? stringifyTriggeredAt : undefined
		};
	} else {
		let stringifyCalled = false;
		if(typeof value === "object") {
			stringifyCalled = true;
			value = JSON.stringify(value);
		}

		return {
			builtKey,
			isArray: false,
			stringifyTriggered: stringifyCalled,
			value: await redisClient.pipeline().set(builtKey, value, "EX", ttl).get(builtKey).exec()
		};
	}
}

export async function get<T>(owner: string, key: string, isJson = false, pop = false) : Promise<T|null> {
	const redisClient = await getRedisClient();

	const builtKey = buildCacheKey(owner, key);
	const res = await redisClient.get(builtKey);
	if(pop) { await redisClient.del(builtKey); }

	return isJson && res != null ? JSON.parse(res) : res;
}

export async function getArray<T>(owner: string, key: string, jsonParse: boolean|number = false, pop = false) : Promise<T[]> {
	const redisClient = await getRedisClient();

	const builtKey = buildCacheKey(owner, key);
	let res = <any[]>await redisClient.lrange(builtKey, 0, -1);

	if(!!jsonParse) {
		if(Array.isArray(jsonParse)) {
			res = parseByIndexes<T>(res, jsonParse);
		} else {
			res = parseArrayElements<T>(res);
		}
	}

	if(pop) { await redisClient.del(builtKey); }

	return res;
}

export async function deleteKeys(owner: string, keys: string|string[]) {
	const redisClient = await getRedisClient();

	if(Array.isArray(keys)) {
		for(let i = 0; i < keys.length; i++){
			keys[i] = buildCacheKey(owner, keys[i]);
		}
	} else {
		keys = [buildCacheKey(owner, keys)];
	}

	return await redisClient.del(...keys);
}

function parseByIndexes<T>(arr: any[], parseIndexes: number[]) {
	for(const index of parseIndexes) {
		const elem = arr[index];
		if(elem == null) { continue; }
		arr[index] = JSON.parse(elem);
	}
	return <T[]>arr;
}

function parseArrayElements<T>(arr: any[]) {
	for(let i = 0; i < arr.length; i++) {
		arr[i] = JSON.parse(arr[i]);
	}
	return <T[]>arr;
}

function stripUnnecessaryChars(str: string) {
	return str.replace(/[^A-Z0-9\-\.\_\ \:]/ig, "").trim();
}

function lengthCheck(key: string, val: string) {
	if(val.length < 1) { throw new Error(`Invalid-Length \`${key}\` provided: '${val}'`); }
	return val;
}

function buildCacheKey(owner: string, key: string) {
	owner = lengthCheck("owner", stripUnnecessaryChars(owner));
	key = lengthCheck("key", stripUnnecessaryChars(key));

	return `sb_cache:${owner}[${owner}]`;
}
