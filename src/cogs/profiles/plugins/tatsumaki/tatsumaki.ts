import { IProfilesPlugin } from "../plugin";
import { default as fetch, Response } from "node-fetch";
import { getFromCache, clearCache, cache } from "../../../utils/cacheResponse";
import { timeDiff } from "../../../utils/time";

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

export async function fetchTatsuProfile(uid:string, apiKey:string) : Promise<IUserInfo> {
    let resp:Response|undefined = undefined;
    try {
        resp = await fetch(`https://api.tatsumaki.xyz/users/${uid}`, {
            headers: {
                Authorization: apiKey
            }
        });
    } catch (err) {
        if(err.status === 404) {
            throw new Error("Профиль не найден");
        }
        throw new Error("Профиль не найден или API сервер недоступен.");
    }

    if(!resp) {
        throw new Error("API сервер не ответил.");
    }

    let uObject:IUserInfo|undefined = undefined;
    try {
        uObject = await resp.json();
    } catch (err) {
        throw new Error("Ошибка получения информации из ответа.");
    }

    if(!uObject) {
        throw new Error("Ошибка сервера");
    }

    cache(CACHE_OWNER, uid, JSON.stringify(uObject));

    return uObject;
}

export async function getTatsuProfile(uid:string, apiKey:string) : Promise<IUserInfo> {
    let cached = await getFromCache(CACHE_OWNER, uid);
    if(!cached) {
        return (await fetchTatsuProfile(uid, apiKey));
    } else {
        if(timeDiff(cached.timestamp) > 60) {
            await clearCache(CACHE_OWNER, uid);
            return (await fetchTatsuProfile(uid, apiKey));
        } else {
            return (JSON.parse(cached.value));
        }
    }
}