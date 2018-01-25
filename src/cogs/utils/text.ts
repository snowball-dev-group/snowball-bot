export function startsOrEqual(source: string, changed: string) {
	return changed.startsWith(source) || changed === source;
}

export function endsOrEqual(source: string, changed: string) {
	return changed.endsWith(source) || changed === source;
}

export function slice(source: string, start?: number, end?: number) {
	return source.slice(start, end);
}

export function escapeRegExp(str: string) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function replaceAll(str: string, search: string, replacement: string) {
	search = escapeRegExp(search);
	return str.replace(new RegExp(search, "g"), replacement);
}

export function simpleCmdParse(str: string) : ISimpleCmdParseResult {
	let args = str.split(" ");
	const cmd = args.shift(); // !cmd
	const subCmd = args.shift(); // subcmd / undefined
	args = args.join(" ").split(",").map(arg => arg.trim()).filter(arg => arg.trim() !== "");
	return {
		command: cmd,
		subCommand: subCmd,
		args: args.length > 0 ? args : undefined
	};
}

export interface ISimpleCmdParseResult {
    command?: string;
    subCommand?: string;
    args?: string[];
}

export function canBeSnowflake(str: string) {
	return /[0-9]{16,20}/.test(str);
}

export function stripSpaces(str: string) {
	return str.trim().replace(/ {2,}/g, " ");
}

// from https://github.com/danakt/uuid-by-string/blob/master/uuid-by-string.js

function _getHex(str: string, key: number, maxlen: number): string {
	let n: number, i: number, count: number;
	n = i = count = 1;
	str = str.trim();
	// NOTE: 14-digit number in hex is 16-digit in base-10,
	// In turn, the js rounds everything that comes after the 16th sign among
	maxlen = Math.min(maxlen || 14, 14);
	// tslint:disable-next-line:no-constant-condition
	for(; true; i++) {
		if(count++ >= str.length && n.toString(16).length >= maxlen) { break; }
		if(str[i] === undefined) { i = 0; }
		n *= (str.charCodeAt(i) + (i * str.length)) * key;
		n = Number(String(n).replace(/0+$/g, ""));
		while(n.toString(16).length > maxlen) { n = Math.floor(n / 10); }
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

export function getUUIDByString(str: string) {
	return _makeUUID([
		_getHex(str, 0xf6, 8),
		_getHex(str, 0x51c, 11),
		_getHex(str, 0xd7a, 12)
	]);
}

// from https://stackoverflow.com/questions/11305797/remove-zero-width-space-characters-from-a-javascript-string/11305926
// may improve in time
export function stripEmptyChars(str: string) {
	return str.replace(/[\u200B-\u200D\uFEFF]/g, "");
}
