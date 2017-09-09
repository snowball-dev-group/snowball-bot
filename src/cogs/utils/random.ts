import * as Random from "random-js";

export function getRandom(seed?:string) {
	return new Random((() => {
		let engine = Random.engines.mt19937();
		
		if(seed) {
			engine.seedWithArray(seed.split("").map(c => c.charCodeAt(0)));
		} else {
			engine.autoSeed();
		}

		return engine;
	})());
}

export function randomString(length: number, pool?:string, seed?:string) {
	let random = getRandom(seed);
	return random.string(length, pool);
}

export function randomPick<T>(array:T[], begin?:number, end?:number, seed?:string) : T {
	let random = getRandom(seed);
	return random.pick<T>(array, begin, end);
}