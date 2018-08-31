export function startsWith(source: string, search: string) {
	return search.length > source.length ? false : source.indexOf(search) === 0;
}

export function endsWith(source: string, search: string) {
	return search.length > source.length ? false : source.indexOf(search) === source.length - search.length;
}

export function escapeRegExp(str: string) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function replaceAll(str: string, search: string, replacement: string) {
	search = escapeRegExp(search);

	return str.replace(new RegExp(search, "g"), replacement);
}

/**
 * Reverse the string
 * @param str String to reverse
 */
export function reverseString(str: string) {
	let o = "";
	for (let i = str.length; i > -1; i--) { o += str[i]; }

	return o;
}

/**
 * Can string be the snowflake ID (string contains 16-20 digits only)
 * @param str String to check for snowflake
 */
export function canBeSnowflake(str: string) {
	return /[0-9]{16,20}/.test(str);
}

/**
 * Strip multiple empty characters from the string
 * @param str String to strip spaces from
 */
export function stripSpaces(str: string) {
	return str.trim().replace(/ {2,}/g, " ");
}

/**
 * Break important Discord mentions such as @everyone and @here
 * @param str String to break mentions in
 * @param breaker String used to break mentions (inserted between "@" and "everyone")
 */
export function removeEveryoneMention(str: string, breaker = "\u200B") {
	return str
		.replace("@everyone", `@${breaker}everyone`)
		.replace("@here", `@${breaker}here`);
}

// #region UUID Generation

function _getHex(str: string, key: number, maxlen: number): string {
	let n: number, i: number, count: number;
	n = i = count = 1;
	str = str.trim();
	// NOTE: 14-digit number in hex is 16-digit in base-10,
	// In turn, the js rounds everything that comes after the 16th sign among
	maxlen = Math.min(maxlen || 14, 14);
	// tslint:disable-next-line:no-constant-condition
	for (; true; i++) {
		if (count++ >= str.length && n.toString(16).length >= maxlen) { break; }
		if (str[i] === undefined) { i = 0; }
		n *= (str.charCodeAt(i) + (i * str.length)) * key;
		n = Number(String(n).replace(/0+$/g, ""));
		while (n.toString(16).length > maxlen) { n = Math.floor(n / 10); }
	}

	return n.toString(16);
}

function _makeUUID(p: string[]) {
	const s = [
		p[0],
		p[1].substr(0, 4),
		4 + p[1].substr(4, 3), (Number(`"0x"${p[1][7]}`) & 0x3 | 0x8).toString(16) + p[1].substr(8, 3),
		p[2]
	];

	return s.join("-").toUpperCase();
}

/**
 * Generate UUID using the string
 * @param str String that used to generate UUID
 * @link https://github.com/danakt/uuid-by-string/blob/master/uuid-by-string.js
 */
export function getUUIDByString(str: string) {
	return _makeUUID([
		_getHex(str, 0xf6, 8),
		_getHex(str, 0x51c, 11),
		_getHex(str, 0xd7a, 12)
	]);
}

// #endregion

/**
 * Strip zero width spaces from the string
 * @param str String to strip empty characters from\
 * @link https://stackoverflow.com/questions/11305797/remove-zero-width-space-characters-from-a-javascript-string/11305926
 */
export function stripEmptyChars(str: string) {
	return str.replace(/[\u200B-\u200D\uFEFF]/g, "");
}
