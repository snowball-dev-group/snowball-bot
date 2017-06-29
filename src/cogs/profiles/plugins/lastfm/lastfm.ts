import { default as fetch, Response } from "node-fetch";
import { getFromCache, clearCache, cache, ICachedRow } from "../../../utils/cacheResponse";
import { timeDiff } from "../../../utils/time";
import { IRecentTracksResponse } from "./lastfmInterfaces";
import { getLogger } from "../../../utils/utils";

const CACHE_OWNER = "lastfm:recents";
const LOG = getLogger("LastFMPlugin");

export async function getRecents(username:string, apiKey:string) : Promise<IRecentTracksResponse> {
    let resp:Response|undefined = undefined;
    let logPrefix = `${username} (getRecents)|`;
    try {
        let uri = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${apiKey}&format=json`;
        LOG("info", logPrefix, "Fetching", uri.replace(apiKey, "{{API_KEY}}"));
        resp = await fetch(uri);
    } catch (err) {
        LOG("err", logPrefix, "Failed to fetch URI");
        if(err && err.status === 404) {
            throw new Error("Profile not found");
        }
        throw new Error("Profile not found or API server is not available.");
    }

    if(!resp) {
        LOG("err", logPrefix, "Got no `resp` variable");
        throw new Error("No response");
    }

    let parsedRecents:IRecentTracksResponse|undefined = undefined;
    try {
        LOG("info", logPrefix, "Parsing JSON response");
        parsedRecents = await resp.json();
    } catch (err) {
        LOG("err", logPrefix, "Failed to parse API response");
        throw new Error("Failed to parse API response.");
    }

    if(!parsedRecents) {
        LOG("err", logPrefix, "Got no `parsedRecents` variable");
        throw new Error("Internal error");
    }

    try {
        LOG("info", logPrefix, "Caching response");
        await cache(CACHE_OWNER, username, JSON.stringify(parsedRecents), true);
    } catch (err) {
        LOG("err", logPrefix, "Failed to cache response");
    }

    return parsedRecents;
}

export async function getOrFetchRecents(uid:string, apiKey:string) : Promise<IRecentTracksResponse> {
    let cached:ICachedRow|undefined = undefined;
    let logPrefix = `${uid} (getOrFetchRecents)|`;

    try {
        cached = await getFromCache(CACHE_OWNER, uid);
        LOG("ok", logPrefix, "Got element from cache");
    } catch (err) {
        LOG("err", logPrefix, "Failed to get element from cache.", err);
        throw err;
    }

    if(cached) {
        LOG("info", logPrefix, "There's cached version, checking difference");
        if(timeDiff(cached.timestamp, Date.now(), "s") < 60) {
            LOG("ok", logPrefix, "We can use cached version");
            
            LOG("info", logPrefix, "Parsing cached JSON...");
            let obj:IRecentTracksResponse|undefined = undefined;
            try {
                obj = JSON.parse(cached.value) as IRecentTracksResponse;
                LOG("ok", logPrefix, "Cached JSON parsed!");
            } catch (err) {
                LOG("err", logPrefix, "Failed to parse cached JSON!", cached.value);
            }

            if(obj) {
                LOG("ok", logPrefix, "Returning parsed cached version");
                return obj;
            }
        } else {
            LOG("warn", logPrefix, "Old cache detected, removing...");
            try {
                await clearCache(CACHE_OWNER, uid);
            } catch (err) {
                LOG("err", logPrefix, "Caching removal failed", err);
            }
        }
    }

    LOG("info", logPrefix, "Fetching profile...", uid);
    let recents:IRecentTracksResponse|undefined = undefined;
    try {
        recents = await getRecents(uid, apiKey);
        LOG("ok", logPrefix, "Fetching done.");
    } catch (err) {
        LOG("err", logPrefix, "Fetching failed", err);
    }

    if(!recents) {
        LOG("err", logPrefix, "No profile at final of GET operation!");
        throw new Error("Got no profile");
    }

    return recents;
}