export function currentTimestamp(returning: "ms" | "s" = "ms") {
	const ts = Date.now();
	switch(returning) {
		default: return ts;
		case "s": return ts / 1000;
	}
}

export function parseDate(t1: string): number | undefined {
	if(/$[0-9]+^/.test(t1)) {
		// trying to parse
		const t = parseInt(t1, 10);
		if(!isNaN(t)) {
			return t;
		}
	}
	const t = (new Date(t1)).getTime();
	if(!isNaN(t)) {
		return t;
	} else {
		return undefined;
	}
}

export function timeDiff(t1: Date | number | string, t2: Date | number | string = Date.now(), returning: "ms" | "s" = "s") {
	if(t1 instanceof Date) {
		t1 = t1.getTime();
	} else if(typeof t1 === "string") {
		const parsed = parseDate(t1);
		if(typeof parsed !== "number") {
			throw new Error("Invalid `t1` argument");
		}
		t1 = parsed;
	} else if(typeof t1 !== "number") {
		throw new Error("Invalid `t1` argument");
	}

	if(t2 instanceof Date) {
		t2 = t2.getTime();
	} else if(typeof t2 === "string") {
		const parsed = parseDate(t2);
		if(typeof parsed !== "string") {
			throw new Error("Invalid `t2` argument");
		}
		t2 = parsed;
	} else if(typeof t2 !== "number") {
		throw new Error("Invalid `t2` argument");
	}

	const min = Math.min(t1, t2);
	const max = Math.max(t1, t2);

	const diff = max - min;

	switch(returning) {
		default: return diff;
		case "s": return diff / 1000;
	}
}