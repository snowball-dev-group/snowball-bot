import { stripEmptyChars, escapeRegExp } from "./text";
import { INullableHashMap } from "../../types/Types";
import { slice } from "lodash";

export const CMDPARSER_ARGUMENTS_SEPARATOR = ",";

/**
 * Parses command into delicious pieces
 * @param str String to parse
 * @param argsSeparator Separator for arguments
 */
export function parse(str: string, argsSeparator = CMDPARSER_ARGUMENTS_SEPARATOR): ICommandParseResult {
	const parts = str.split(" ");

	const cmd = parts.shift()!;
	const subCmd = parts.shift() || null; // subcmd / null

	let args: ICommandParseResultArg[] | null = null;

	let argsStr: string | undefined = undefined;

	if (parts.length > 0) {
		args = [];

		const cmdStr = `${cmd}${subCmd != null ? ` ${subCmd} ` : " "}`;
		argsStr = str.substring(cmdStr.length);

		const argSplitResult = argumentSplit(argsStr, argsSeparator);
		for (let i = 0, l = argSplitResult.length; i < l; i++) {
			const arg = argSplitResult[i];
			args.push({
				raw: arg,
				value: stripEmptyChars(arg).trim().replace(/\\\,/g, ",")
			});
		}
	}

	return {
		command: cmd,
		subCommand: subCmd,
		arguments: args != null ? argsGenerator(args, argsStr!) : null,
		content: subCmd != null ? `${subCmd}${argsStr ? ` ${argsStr}` : ""}` : ""
	};
}

function argsGenerator(args: ICommandParseResultArg[], original: string): ICommandParseResultArgs {
	const normal: string[] = [];
	const raw: string[] = [];

	for (let i = 0, l = args.length; i < l; i++) {
		const arg = args[i];
		if (arg.value.length > 0) {
			normal.push(arg.value);
		}
		raw.push(arg.raw);
	}

	// tslint:disable-next-line:prefer-object-spread
	return Object.assign(args, {
		only: (type: "value" | "raw") => slice(type === "value" ? normal : raw),
		original
	});
}

/**
 * Works speedy than `String#split()` and has separator escaping
 * @param argStr Arguments string
 * @param separator Separator
 */
export function argumentSplit(argStr: string, separator = ",") {
	if (separator.length === 0) {
		throw new Error("`separator` can't be empty string");
	}

	const args: string[] = [];

	separator = escapeRegExp(separator);

	// \\ for separator escape, in Discord would look like "hello\, world!" ("hello\\, world!")
	const separatorRegexp = RegExp(`(?<=(^|[^\\\\]))${separator}`);

	let nPos = 0;
	while (nPos !== -1) {
		argStr = argStr.substr(nPos);

		const separatorMatch = separatorRegexp.exec(argStr);

		let curArgEndPos: null | number = null;
		if (separatorMatch) {
			nPos = separatorMatch.index + separatorMatch[0].length;
			curArgEndPos = separatorMatch.index;
		} else { nPos = -1; }

		args.push(argStr.substring(0, curArgEndPos === null ? undefined : curArgEndPos));
	}

	return args;
}

/**
 * "Redirects" command from message to needed handler
 * @param parsed Parsed message
 * @param redirects Handlers for these commands
 * @example
 * commandRedirect(parsed, { "ping": () => this._pingHandler(parsed) })
 */
export function commandRedirect(parsed: ICommandParseResult, redirects: INullableHashMap<(parsed: ICommandParseResult) => any>) {
	const command = parsed.command;

	// parsed.command → "!hello"
	// commands → { "!hello" }

	const callback = redirects[command];

	if (callback) {
		return callback(parsed);
	}
}

export interface ICommandParseResult {
	/**
	 * Command
	 * 
	 * May be empty string if original string was empty
	 * @example
	 * "!cmd"
	 */
	command: string;
	/**
	 * Found subcommand
	 * @example
	 * "subcmd"
	 */
	subCommand: string | null;
	/**
	 * An special array of arguments
	 */
	arguments: ICommandParseResultArgs | null;
	/**
	 * Content of command
	 * 
	 * Includes both subcommand and arguments
	 * @example
	 * "subcmd arg1, arg2"
	 */
	content: string;
}

export interface ICommandParseResultArgs extends Array<ICommandParseResultArg> {
	/**
	 * Returns only specified type of arguments
	 * @param type Type of returning arguments
	 */
	only(type: "value" | "raw"): string[];
	/**
	 * Original arguments string
	 * 
	 * @example
	 * "arg1, arg2"
	 */
	original: string;
}

export interface ICommandParseResultArg {
	/**
	 * Cleaned value of argument
	 * 
	 * - Removed comma-escapes
	 * - Removed zero-width spaces
	 * - Trimmed
	 * @example
	 * "arg2, still arg2"
	 */
	value: string;
	/**
	 * Raw value of argument
	 * @example
	 * " arg2\\, still arg2"
	 */
	raw: string;
}

