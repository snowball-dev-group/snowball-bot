import { getLogger } from "../../../utils/utils";
import { default as fetch, Response } from "node-fetch";
import { IBlobResponse, IRegionalProfile } from "./owApiInterfaces";
import { getFromCache, clearCache, cache, ICachedRow } from "../../../utils/cacheResponse";
import { timeDiff } from "../../../utils/time";

const CACHE_OWNER = "profileplug:ow";
const LOG = getLogger("OWApi");

let alreadyFetching = new Map<string, Promise<IBlobResponse>>();

export async function fetchBlobProfile(battletag:string, platform?:string) : Promise<IBlobResponse> {
    let context = `${battletag}//${platform}`;
    if(alreadyFetching.has(context)) {
        let previousContextPromise = alreadyFetching.get(context);
        if(previousContextPromise) {
            return await previousContextPromise;
        }
    }
    let contextFunction: {
        resolve?:(obj:IBlobResponse) => void;
        reject?:(obj:any) => void
    } = { };
    let contextPromise = new Promise<IBlobResponse>((res, rej) => {
        contextFunction.resolve = res;
        contextFunction.reject = rej;
    });
    alreadyFetching.set(context, contextPromise);

    let resp:Response|undefined = undefined;
    let logPrefix = `fetching (${battletag}, ${platform})`;
    let uri = `https://owapi.net/api/v3/u/${battletag}/blob${platform ? `?platform=${platform}` : ""}`;
    try {
        LOG("info", logPrefix, "Fetching URL", uri);
        resp = await fetch(uri);
    } catch (err) {
        LOG("err", logPrefix, "Errored response", err);
        if(err.status === 404) {
            let _err = new Error("Profile not found.");
            if(contextFunction.reject) { contextFunction.reject(_err); }
            throw _err;
        }
        let _err = new Error("API error");
        if(contextFunction.reject) { contextFunction.reject(_err); }
        throw _err;
    }

    if(!resp) {
        LOG("err", logPrefix, "Got response, but no `resp` variable, wth...");
        let _err = new Error("No API response");
        if(contextFunction.reject) { contextFunction.reject(_err); }
        throw _err;
    }

    let parsed:IBlobResponse|undefined = undefined;
    try {
        LOG("info", logPrefix, "Parsing JSON...");
        parsed = await resp.json();
    } catch (err) {
        LOG("info", logPrefix, "Parsing failed", err, await resp.text());
        let _err = new Error("Can't parse API response");
        if(contextFunction.reject) { contextFunction.reject(_err); }
        throw _err;
    }

    if(!parsed) {
        LOG("err", logPrefix, "Parsed response, but no `parsed` variable, wth...");
        let _err = new Error("Something went wrong (parsing)");
        if(contextFunction.reject) { contextFunction.reject(_err); }
        alreadyFetching.delete(context);
        throw _err;
    }

    if(parsed.retry) {
        let _delayedResp = (await new Promise((res, rej) => {
            setTimeout(() => {
                fetchBlobProfile(battletag, platform).then(res, rej);
            }, parsed ? parsed.retry * 1000 : 5000);
        })) as IBlobResponse;
        if(contextFunction.resolve) { contextFunction.resolve(_delayedResp); }
        alreadyFetching.delete(context);
        return _delayedResp;
    }

    LOG("info", logPrefix, "Caching...");
    await cache(CACHE_OWNER, battletag, JSON.stringify(parsed), true);

    if(contextFunction.resolve) { contextFunction.resolve(parsed); }
    alreadyFetching.delete(context);
    return parsed;
}

export async function getProfile(battletag:string, region:string = "eu", platform:string = "pc") : Promise<IRegionalProfile> {
    let logPrefix = `${battletag}(${region}, ${platform}): `;
    let cached:ICachedRow|undefined = undefined;
    try {
        cached = await getFromCache(CACHE_OWNER, battletag);
    } catch (err) {
        LOG("warn", "Failed to get cache for profile:", ...arguments);
    }
    if(!cached) {
        let p:IBlobResponse|undefined = undefined;
        try {
            LOG("info", logPrefix, "There's no cache version, fetching profile");
            p = await fetchBlobProfile(battletag, platform);
        } catch (err) {
            LOG("err", logPrefix, "Failed to fetch profile (no cache):");
            throw new Error("Failed to fetch profile (without cache)");
        }
        return p[region];
    } else {
        if(timeDiff(cached.timestamp, Date.now(), "s") > 60) {
            LOG("warn", logPrefix, "Can't use cached version");
            try {
                LOG("info", logPrefix, "Clearing old cache record");
                await clearCache(CACHE_OWNER, battletag);
            } catch (err) {
                LOG("warn", "Failed to clear old cache", ...arguments);
            }
            
            let p:IBlobResponse|undefined = undefined;
            try {
                LOG("info", logPrefix, "Fetching profile");
                p = await fetchBlobProfile(battletag, platform);
            } catch (err) {
                LOG("err", logPrefix, "Failed to fetch profile:");
                throw new Error("Failed to fetch profile");
            }
            return p[region];
        } else {
            LOG("info", logPrefix, "Used cached version.");
            return (JSON.parse(cached.value))[region];
        }
    }
}

export interface IOverwatchProfilePluginInfo {
    platform:string;
    region:string;
    battletag:string;
    verifed:boolean;
}