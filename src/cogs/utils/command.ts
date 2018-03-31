import { stripEmptyChars, escapeRegExp } from "./text";
import { INullableHashMap } from "../../types/Types";

export const CMDPARSER_ARGUMENTS_SEPARATOR = ",";

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
		args: args != null ? argsGenerator(args, argsStr!) : null,
		content: subCmd != null ? `${subCmd}${argsStr ? ` ${argsStr}` : ""}` : ""
	};
}

export function argsGenerator(args: ICommandParseResultArg[], original: string): ICommandParseResultArgs {
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
		only: (type: "value" | "raw") => (type === "value" ? normal : raw).slice(),
		original
	});
}

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

export function commandRedirect(parsed: ICommandParseResult, redirects: INullableHashMap<(parsed: ICommandParseResult) => any>) {
	const commands = Object.keys(redirects);
	const command = parsed.command;

	for (let i = 0, l = commands.length; i < l; i++) {
		const currentCommand = command[i];
		if (command !== currentCommand) { return; }

		const callback = redirects[currentCommand];
		if (!callback) { break; }

		return callback(parsed);
	}
}

export interface ICommandParseResult {
	command: string;
	subCommand: string | null;
	args: ICommandParseResultArgs | null;
}

export interface ICommandParseResultArgs extends Array<ICommandParseResultArg> {
	only(type: "value" | "raw"): string[];
	original: string;
}

export interface ICommandParseResultArg {
	value: string;
	raw: string;
}

