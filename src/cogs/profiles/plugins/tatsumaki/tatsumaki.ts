import { default as fetch, Response } from "node-fetch";
import { getFromCache, clearCache, cache, ICachedRow } from "../../../utils/cacheResponse";
import { timeDiff } from "../../../utils/time";
import { getLogger } from "../../../utils/utils";

export interface IUserInfo {
	/**
	 * Background the user is using
	 */
	background: string;
	/**
	 * URL to the user's avatar, if they have one
	 */
	avatar_url: string;
	/**
	 * Username of the user
	 */
	name: string;
	/**
	 * Discriminator of the user
	 */
	discriminator: string;
	/**
	 * What the user has in their title
	 */
	title: string;
	/**	
	 * How much reputation the user has
	 */
	reputation: number;
	/**
	 * Badges the user has equipped
	 */
	badgeSlots: string[];
	/**
	 * First number is their current xp, second is how much xp is needed to progress to the next level
	 */
	xp:number[];
	/**
	 * User's xp level
	 */
	level:number;
	/**
	 * Total amount of XP the user has gained
	 */
	total_xp:number;
	/**
	 * User's global rank
	 */
	rank:number;
	/**
	 * Amount of credits the user has
	 */
	credits:number;
	/**
	 * What the user has in their info box
	 */
	info_box:string;
}

const CACHE_OWNER = "tatskumaki:profile";
const LOG = getLogger("TatsuPlugin");

export async function fetchTatsuProfile(uid:string, apiKey:string) : Promise<IUserInfo> {
	let resp:Response|undefined = undefined;
	let logPrefix = `${uid} (fetchTatsuProfile)|`;
	try {
		let uri = `https://api.tatsumaki.xyz/users/${uid}`;
		LOG("info", logPrefix, "Fetching URL", uri);
		resp = await fetch(uri, {
			headers: {
				Authorization: apiKey
			}
		});
	} catch(err) {
		LOG("err", logPrefix, "Error catched!", err);
		if(err.status && err.status === 404) {
			throw new Error("Profile not found");
		}
		throw new Error("Profile not found or Tatsumaki API server not available.");
	}

	if(!resp) {
		LOG("err", logPrefix, "No `resp` at middle of FETCH operation!");
		throw new Error("No response.");
	}

	let uObject:IUserInfo|undefined = undefined;
	try {
		LOG("info", logPrefix, "Parsing JSON response");
		uObject = await resp.json() as IUserInfo;
	} catch(err) {
		LOG("err", logPrefix, "JSON parsing failed", err);
		throw new Error("Error retrieving information from the API.");
	}

	if(!uObject) {
		LOG("err", logPrefix, "No `uObject` at final state of FETCH operation!");
		throw new Error("No user info");
	}

	try {
		LOG("info", logPrefix, "Caching response");
		await cache(CACHE_OWNER, uid, JSON.stringify(uObject), true);
	} catch(err) {
		LOG("err", logPrefix, "Caching failed", err);
	}

	return uObject;
}

export async function getTatsuProfile(uid:string, apiKey:string) : Promise<IUserInfo> {
	let cached:ICachedRow|undefined = undefined;
	let logPrefix = `${uid} (getTatsuProfile)|`;

	try {
		cached = await getFromCache(CACHE_OWNER, uid);
		LOG("ok", logPrefix, "Got element from cache");
	} catch(err) {
		LOG("err", logPrefix, "Failed to get element from cache.", err);
		throw err;
	}

	if(cached) {
		LOG("info", logPrefix, "There's cached version, checking difference");
		if(timeDiff(cached.timestamp, Date.now(), "s") < 60) {
			LOG("ok", logPrefix, "We can use cached version");

			LOG("info", "Parsing cached JSON...");
			let obj:IUserInfo|undefined = undefined;
			try {
				obj = JSON.parse(cached.value) as IUserInfo;
				LOG("ok", logPrefix, "Cached JSON parsed!");
			} catch(err) {
				LOG("err", logPrefix, "Failed to parse cached JSON", cached.value);
			}
			
			if(obj) {
				LOG("ok", logPrefix, "Returning parsed cached version");
				return obj;
			}
		} else {
			LOG("warn", logPrefix, "Old cache detected, removing...");
			try {
				await clearCache(CACHE_OWNER, uid);
			} catch(err) {
				LOG("err", logPrefix, "Caching removal failed", err);
			}
		}
	}

	LOG("info", logPrefix, "Fetching profile...", uid);
	let profile:IUserInfo|undefined = undefined;
	try {
		profile = await fetchTatsuProfile(uid, apiKey);
		LOG("ok", logPrefix, "Fetching done.");
	} catch(err) {
		LOG("err", logPrefix, "Fetching failed", err);
	}

	if(!profile) {
		LOG("err", logPrefix, "No profile at final of GET operation!");
		throw new Error("Got no profile");
	}

	return profile;
}