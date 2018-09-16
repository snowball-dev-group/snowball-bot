import { IHashMap } from "@sb-types/Types";

// Human Arguments

function previousWas(str: string, before: number, char: string) {
	return before > 0 && str[before - 1] === char;
}

export function parse(str: string, commiter = ":") : IHashMap<string> {
	const parsed = Object.create(null);

	let quote: Nullable<number> = null;
	let currentName: Nullable<string> = null;
	let currentStr = "";
	let pendingQuote = false;

	const length = str.length;

	function commit() {
		if (quote != null) {
			throw new Error(`Not finished quotation starting at "${quote}"`);
		}

		if (currentName) {
			parsed[currentName] = currentStr;
		} else if (currentStr.length > 0) {
			parsed[currentStr] = true;
		}

		currentName = null;
		currentStr = "";
		pendingQuote = false;
	}

	for (let pos = 0; pos <= length; pos++) {
		if (pos === length) {
			commit();
			break;
		}

		const letter = str[pos];

		if (quote != null) {
			if (letter === "\"" && !previousWas(str, pos, "\\")) {
				quote = null;
				pendingQuote = true;

				continue;
			}
			// tslint:disable-next-line:no-collapsible-if
		} else {
			if (letter === " " && !previousWas(str, pos, commiter)) {
				commit();
				continue;
			} else if (pendingQuote) {
				throw new Error(`Unexpected "${letter}" at position ${pos}`);
			} else if (letter === commiter) {
				if (currentStr.length === 0) {
					throw new Error(`Unexpected "${letter}" at position ${pos}`);
				} else {
					currentName = currentStr;
					currentStr = "";
					pendingQuote = false;

					continue;
				}
			} else if (letter === "\"" && !previousWas(str, pos, "\\")) {
				quote = pos;

				continue;
			}
		}

		if (letter === "\\" && !previousWas(str, pos, "\\")) {
			continue;
		}

		currentStr += letter;
	}

	return parsed;
}

type Nullable<T> = T | null;
