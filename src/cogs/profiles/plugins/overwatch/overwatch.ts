import { getLogger } from "../../../utils/utils";
import { default as fetch, Response } from "node-fetch";
import { IBlobResponse, IRegionalProfile } from "./owApiInterfaces";
import { getFromCache, clearCache, cache, ICachedRow } from "../../../utils/cacheResponse";
import { timeDiff } from "../../../utils/time";

const CACHE_OWNER = "profileplug:ow";
const LOG = getLogger("OWApi");

export async function fetchBlobProfile(battletag:string, platform?:string) : Promise<IBlobResponse> {
    let resp:Response|undefined = undefined;
    let logPrefix = `fetching (${battletag}, ${platform})`;
    let uri = `https://owapi.net/api/v3/u/${battletag}/blob${platform ? `?platform=${platform}` : ""}`;
    try {
        LOG("info", logPrefix, "Fetching URL", uri);
        resp = await fetch(uri);
    } catch (err) {
        LOG("err", logPrefix, "Errored response", err);
        if(err.status === 404) {
            throw new Error("Профиль не найден");
        }
        throw new Error("Профиль не найден или API сервер недоступен.");
    }

    if(!resp) {
        LOG("err", logPrefix, "Got response, but no `resp` variable, wth...");
        throw new Error("Нет ответа API сервера.");
    }

    let parsed:IBlobResponse|undefined = undefined;
    try {
        LOG("info", logPrefix, "Parsing JSON...");
        parsed = await resp.json();
    } catch (err) {
        LOG("info", logPrefix, "Parsing failed", err, await resp.text());
        throw new Error("Невозможно загрузить ответ сервера.");
    }

    if(!parsed) {
        LOG("err", logPrefix, "Parsed response, but no `parsed` variable, wth...");
        throw new Error("Что-то пошло не так");
    }

    LOG("info", logPrefix, "Caching...");
    await cache(CACHE_OWNER, battletag, JSON.stringify(parsed), true);

    return parsed;
}

export async function getProfile(battletag:string, region:string = "eu", platform:string = "pc") : Promise<IRegionalProfile> {
    let logPrefix = `${battletag}(${region}, ${platform}): `;
    let cached:ICachedRow|undefined = undefined;
    try {
        cached = await getFromCache(CACHE_OWNER, battletag)
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