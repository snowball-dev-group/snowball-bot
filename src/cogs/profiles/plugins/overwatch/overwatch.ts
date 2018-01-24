import { getLogger } from "../../../utils/utils";
import { default as fetch } from "node-fetch";
import { IBlobResponse, IRegionalProfile } from "./owApiInterfaces";
import { INullableHashMap, DetailedError } from "../../../../types/Types";
import { get, storeValue } from "../../../utils/cache_new";

const CACHE_OWNER = "owapi-profile";
const LOG = getLogger("OWApi");

const fetchingPromisesStore: INullableHashMap<Promise<IBlobResponse>> = Object.create(null);

export async function fetchBlobProfile(battletag: string, platform?: string): Promise<IBlobResponse> {
	const context = `${battletag}//${platform}`;

	const currentPromise = fetchingPromisesStore[context];
	if(currentPromise) { return currentPromise; }

	const contextFunction: {
		resolve?: (obj: IBlobResponse) => void;
		reject?: (obj: any) => void
	} = Object.create(null);

	fetchingPromisesStore[context] = new Promise<IBlobResponse>((res, rej) => {
		contextFunction.resolve = res;
		contextFunction.reject = rej;
	});

	const logPrefix = `fetchBlobProfile(${battletag}, ${platform}):`;
	const uri = `https://owapi.net/api/v3/u/${battletag}/blob${platform ? `?platform=${platform}` : ""}`;
	const resp = await fetch(uri);

	if(resp.status !== 200) {
		switch(resp.status) {
			case 404: throw new DetailedError("OWAPI_FETCH_ERR_PROFILE_NOTFOUND");
			case 500: throw new DetailedError("OWAPI_FETCH_ERR_SERVICE_UNAVAIABLE");
			default: throw new DetailedError("OWAPI_FETCH_ERR_OTHER", resp.statusText);
		}
	}

	const parsed: IBlobResponse | undefined = await (async () => {
		try {
			return <IBlobResponse> await resp.json();
		} catch (err) {
			LOG("err", logPrefix, "Failed to parse response", err);
			return undefined;
		}
	})();

	if(!parsed) {
		throw new DetailedError("OWAPI_FETCH_ERR_JSONFAILED");
	}

	if(parsed.retry != null) {
		const _delayedResp = <IBlobResponse>await new Promise((res, rej) => {
			setTimeout(() => {
				fetchBlobProfile(battletag, platform).then(res, rej);
			}, parsed!.retry! * 1000);
		});

		if(contextFunction.resolve) { contextFunction.resolve(_delayedResp); }

		delete fetchingPromisesStore[context];

		return _delayedResp;
	}

	if(contextFunction.resolve) { contextFunction.resolve(parsed); }

	delete fetchingPromisesStore[context];

	return parsed;
}

export async function getProfile(battletag: string, region: string = "eu", platform: string = "pc"): Promise<IRegionalProfile> {
	const logPrefix = `${battletag}(${region}, ${platform}): `;

	let cached: null | IBlobResponse = null;

	try {
		cached = await get<IBlobResponse>(CACHE_OWNER, battletag, true);
	} catch(err) {
		LOG("warn", logPrefix, "Failed to get cache", err);
	}

	if(cached != null) { return cached[region]; }

	let fetchedData: undefined | IBlobResponse = undefined;
	try {
		fetchedData = await fetchBlobProfile(battletag, platform);
	} catch(err) {
		throw new DetailedError("OWAPI_GETPROFILE_ERR_FETCHING", undefined, fetchedData);
	}

	try {
		await storeValue(CACHE_OWNER, battletag, JSON.stringify(fetchedData), 300);
	} catch(err) {
		LOG("warn", logPrefix, "Failed to store cache", err);
	}

	return fetchedData[region];
}

export interface IOverwatchProfilePluginInfo {
	platform: string;
	region: string;
	battletag: string;
	verifed: boolean;
}
