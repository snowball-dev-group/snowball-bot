import { default as fetch } from "node-fetch";
import { IRecentTracksResponse } from "./lastfmInterfaces";
import { get, storeValue } from "../../../utils/cache";
import { DetailedError } from "../../../../types/Types";
import * as getLogger from "loggy";

const CACHE_OWNER = "lastfm:recents";
const LOG = getLogger("LastFMPlugin");

export async function getRecents(username: string, apiKey: string): Promise<IRecentTracksResponse> {
	const logPrefix = `getRecents(${username}):`;
	const uri = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${apiKey}&limit=3&format=json`;
	const resp = await fetch(uri);

	if (resp.status !== 200) {
		switch (resp.status) {
			case 404: throw new DetailedError("LASTFM_GETRECENTS_ERR_NOTFOUND");
			case 500: throw new DetailedError("LASTFM_GETRECENTS_ERR_SERVERERROR");
			default: throw new DetailedError("LASTFM_GETRECENTS_ERR_UNKNOWN");
		}
	}

	const parsedRecents: IRecentTracksResponse | undefined = await (async () => {
		try {
			return await resp.json();
		} catch (err) {
			LOG("err", logPrefix, "JSON parsing failed", err);
			return undefined;
		}
	})();

	if (!parsedRecents) { throw new DetailedError("LASTFM_GETRECENTS_ERR_PARSING"); }

	return parsedRecents;
}

export async function getOrFetchRecents(username: string, apiKey: string): Promise<IRecentTracksResponse> {
	const logPrefix = `getOrFetchRecents(${username}):`;

	let cached : IRecentTracksResponse | null = null;

	try {
		cached = await get<IRecentTracksResponse>(CACHE_OWNER, username, true);
	} catch (err) {
		LOG("warn", logPrefix, "Cache failed", err);
	}

	if (cached) { return cached; }

	let recents: IRecentTracksResponse | undefined = undefined;
	try {
		recents = await getRecents(username, apiKey);
	} catch (err) {
		LOG("err", logPrefix, "Fetching failed", err);
		throw new DetailedError("LASTFM_GETORFETCH_ERR", undefined, err);
	}

	try {
		await storeValue(CACHE_OWNER, username, recents, 60);
	} catch (err) {
		LOG("err", logPrefix, "Caching failed");
	}

	return recents;
}
