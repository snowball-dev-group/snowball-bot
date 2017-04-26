import { default as fetch, Response } from "node-fetch";
import { getFromCache, clearCache, cache } from "../../../utils/cacheResponse";
import { timeDiff } from "../../../utils/time";
import { IRecentTracksResponse } from "./lastfmInterfaces";

const CACHE_OWNER = "lastfm:recents";

export async function getRecents(username:string, apiKey:string) : Promise<IRecentTracksResponse> {
    let resp:Response|undefined = undefined;
    try {
        resp = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${username}&api_key=${apiKey}&format=json`);
    } catch (err) {
        if(err.status === 404) {
            throw new Error("Профиль не найден");
        }
        throw new Error("Профиль не найден или API сервер недоступен.");
    }

    if(!resp) {
        throw new Error("API сервер не ответил.");
    }

    let parsedRecents:IRecentTracksResponse|undefined = undefined;
    try {
        parsedRecents = await resp.json();
    } catch (err) {
        throw new Error("Ошибка получения информации из ответа.");
    }

    if(!parsedRecents) {
        throw new Error("Ошибка сервера");
    }

    await cache(CACHE_OWNER, username, JSON.stringify(parsedRecents), true);

    return parsedRecents;
}

export async function getOrFetchRecents(username:string, apiKey:string) : Promise<IRecentTracksResponse> {
    let cached = await getFromCache(CACHE_OWNER, username);
    if(!cached) {
        return (await getRecents(username, apiKey));
    } else {
        if(timeDiff(cached.timestamp, Date.now(), "s") > 60) {
            await clearCache(CACHE_OWNER, username);
            return (await getRecents(username, apiKey));
        } else {
            return (JSON.parse(cached.value));
        }
    }
}