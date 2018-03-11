import { default as fetch, Response } from "node-fetch";
import * as getLogger from "loggy";
import { DetailedError } from "../../../../types/Types";
import { get, storeValue } from "../../../utils/cache";

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
	xp: number[];
	/**
	 * User's xp level
	 */
	level: number;
	/**
	 * Total amount of XP the user has gained
	 */
	total_xp: number;
	/**
	 * User's global rank
	 */
	rank: number;
	/**
	 * Amount of credits the user has
	 */
	credits: number;
	/**
	 * What the user has in their info box
	 */
	info_box: string;
}

const CACHE_OWNER = "tatskumaki:profile";
const LOG = getLogger("TatsuPlugin");

export async function fetchTatsuProfile(uid: string, apiKey: string): Promise<IUserInfo> {
	const uri = `https://api.tatsumaki.xyz/users/${uid}`;
	const resp: Response = await fetch(uri, { headers: { Authorization: apiKey } });
	const logPrefix = `fetchTatsuProfile(${uid}):`;

	if (resp.status !== 200) {
		switch (resp.status) {
			case 404: { throw new DetailedError("TATSUMAKI_FETCH_NOTFOUND"); }
			case 500: { throw new DetailedError("TATSUMAKI_FETCH_SERVERERROR"); }
			default: { throw new DetailedError("TATSUMAKI_UNKNOWN_ERROR"); }
		}
	}

	const userInfo: IUserInfo | undefined = await (async () => {
		try {
			return await resp.json();
		} catch (err) {
			LOG("err", logPrefix, "Could not parse JSON", err);
			return undefined;
		}
	})();

	if (!userInfo) { throw new DetailedError("TATSUMAKI_NO_PROFILE"); }

	return userInfo;
}

export async function getTatsuProfile(uid: string, apiKey: string): Promise<IUserInfo> {
	const logPrefix = `getTatsuProfile(${uid}):`;
	let cached: null | IUserInfo = null;

	try {
		cached = await get<IUserInfo>(CACHE_OWNER, uid, true);
	} catch (err) {
		LOG("warn", logPrefix, "Cache failed", err);
	}

	if (cached) { return cached; }

	let profile: IUserInfo | undefined = undefined;
	try {
		profile = await fetchTatsuProfile(uid, apiKey);
	} catch (err) {
		LOG("err", logPrefix, "Fetching failed", err);
		throw new DetailedError("TATSUMAKI_FETCH_FAILED", undefined, err);
	}

	try {
		await storeValue(CACHE_OWNER, uid, profile, 60);
	} catch (err) {
		LOG("warn", logPrefix, "Caching failed", err);
	}

	return profile;
}
