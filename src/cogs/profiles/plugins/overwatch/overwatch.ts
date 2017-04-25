import { IProfilesPlugin } from "../plugin";
import { IEmbedOptionsField, getLogger, EmbedType, generateEmbed } from "../../../utils/utils";
import { GuildMember, Message } from "discord.js";
import { default as fetch, Response } from "node-fetch";
import { IBlobResponse, IRegionalProfile } from "./owApiInterfaces";
import { getFromCache, clearCache, cache } from "../../../utils/cacheResponse";
import { timeDiff } from "../../../utils/time";

const CACHE_OWNER = "profileplug:ow";

export async function fetchBlobProfile(battletag:string, platform?:string) : Promise<IBlobResponse> {
    let resp:Response|undefined = undefined;
    try {
        resp = await fetch(`https://owapi.net/api/v3/u/${battletag}/blob${platform ? `?platform=${platform}` : ""}`);
    } catch (err) {
        if(err.status === 404) {
            throw new Error("Профиль не найден");
        }
        throw new Error("Профиль не найден или API сервер недоступен.");
    }

    if(!resp) {
        throw new Error("Нет ответа API сервера.");
    }

    let parsed:IBlobResponse|undefined = undefined;
    try {
        parsed = await resp.json();
    } catch (err) {
        throw new Error("Невозможно загрузить ответ сервера.");
    }

    if(!parsed) {
        throw new Error("Что-то пошло не так");
    }

    cache(CACHE_OWNER, battletag, JSON.stringify(parsed));

    return parsed;
}

export async function getProfile(battletag:string, region:string = "eu", platform:string) : Promise<IRegionalProfile> {
    let cached = await getFromCache(CACHE_OWNER, battletag);
    if(!cached) {
        return (await fetchBlobProfile(battletag, platform))[region];
    } else {
        if(timeDiff(cached.timestamp, Date.now(), "s") > 60) {
            await clearCache(CACHE_OWNER, battletag);
            return (await fetchBlobProfile(battletag, platform))[region];
        } else {
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