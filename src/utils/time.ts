export function currentTimestamp(returning: "ms" | "s" = "ms") {
	const ts = Date.now();
	if (returning === "s") {
		return ts / 1000;
	}

	return ts;
}

export function toTimestamp(t1: string): number | undefined {
	if (/$[0-9]+^/.test(t1)) {
		// trying to parse
		const t = parseInt(t1, 10);
		if (!isNaN(t)) {
			return t;
		}
	}

	const t = (new Date(t1)).getTime();

	if (!isNaN(t)) {
		return t;
	} else {
		return undefined;
	}
}

function convertArg(arg: TimeArgument, name: string) {
	if (arg instanceof Date) {
		arg = arg.getTime();
	} else if (typeof arg === "string") {
		const parsed = toTimestamp(arg);
		if (typeof parsed !== "number") {
			throw new Error(`Invalid \`${name}\` argument`);
		}

		arg = parsed;
	} else if (typeof arg !== "number") {
		throw new Error(`Invalid \`${name}\` argument`);
	}

	return arg;
}

export function timeDiff(t1: TimeArgument, t2: TimeArgument = Date.now(), returning: "ms" | "s" = "s", noNegative = false) {
	t1 = convertArg(t1, "t1");
	t2 = convertArg(t2, "t2");

	// const min = Math.min(t1, t2);
	// const max = Math.max(t1, t2);

	const diff = t1 - t2;

	if (noNegative && diff < 0) {
		throw new Error(`Negative time difference of ${diff}ms`);
	}

	if (returning === "s") {
		return diff / 1000;
	}

	return diff;
}

type TimeArgument = Date | number | string;
