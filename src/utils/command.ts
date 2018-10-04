import { stripEmptyChars, escapeRegExp } from "@utils/text";
import { INullableHashMap } from "../types/Types";
import { slice } from "lodash";

/**
 * Default separator for the arguments
 */
export const CMDPARSER_ARGUMENTS_SEPARATOR = ",";

/**
 * Parses command into delicious pieces
 * @param str String to parse
 * @param options Options for the parsing
 */
export function parse(str: string, options?: IParseOptions): ICommandParseResult {
	options = {
		separator: CMDPARSER_ARGUMENTS_SEPARATOR,
		enableQuotes: true,
		lowercase: false,
		...options
	};

	const parts = str.split(" ");

	let cmd = parts.shift()!;
	let subCmd = parts.shift() || null; // subcmd / null

	let args: ICommandParseResultArg[] | null = null;

	let argsStr: string | undefined = undefined;

	const { separator, enableQuotes } = options;

	if (parts.length > 0) {
		args = [];

		const cmdStr = `${cmd}${subCmd ? ` ${subCmd} ` : " "}`;

		argsStr = str.substring(cmdStr.length);

		const argSplitResult = argumentSplit(
			argsStr,
			separator,
			enableQuotes
		);

		for (let i = 0, l = argSplitResult.length; i < l; i++) {
			const arg = argSplitResult[i];

			const value = stripEmptyChars(arg)
				.trim()
				.replace(/\\\,/g, ",");

			args.push({
				raw: arg,
				value
			});
		}
	}

	const { lowercase } = options;

	if (lowercase != null) {
		if (lowercase === true || lowercase === "command") {
			cmd = cmd.toLowerCase();
		}

		if (subCmd != null) {
			if (lowercase === true || lowercase === "subcommand") {
				subCmd = subCmd.toLowerCase();
			}
		}
	}

	return {
		command: cmd,
		subCommand: subCmd,
		arguments: args
			? argsGenerator(args, argsStr!)
			: null,
		content: subCmd
			? `${subCmd}${argsStr || ""}`
			: ""
	};
}

export interface IParseOptions {
	/**
	 * Separator for the arguments.
	 * 
	 * Sets the characters used to separate arguments from each other.
	 * For example, for `|` it will split "arg1 | arg2" to `["arg1", "arg2"]`
	 * and for `-` it will not: `["arg1 | arg2"]`.
	 * 
	 * It is recommended to not use complex separators.
	 * 
	 * Separators can be escaped by placing `\` before them:
	 * `"arg1 \\| arg2"` ⇒ `["arg1 | arg2"]`.
	 * 
	 * **This is set to `,` by default.**
	 */
	separator?: string;
	/**
	 * Enable quotations marks in arguments?
	 * 
	 * This will allow users to use arguments like `"Hello, world!"`
	 * without worrying about the separation of the arguments after `Hello`.
	 * 
	 * Quotation marks can also be escaped using the `\` before them.
	 * 
	 * **This is enabled by default.**
	 */
	enableQuotes?: boolean;
	/**
	 * Convert command or subcommand to lowercase?
	 * 
	 * If set to `true`, both command and subcommand will be
	 * converted to the lowercase. You can also provide string
	 * of either "command" or  "subcommand" to convert only one
	 * of them. Value of `false` will disable conversion.
	 * 
	 * **This is disabled by default.**
	 */
	lowercase?: boolean | ("command" | "subcommand");
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
		only(type: "value" | "raw") {
			return slice(type === "value" ? normal : raw);
		},
		original
	});
}

/**
 * RegExp to find next quotation mark without the escape
 */
const QUOTE_MARK_REGEXP = /(?<=([^\\\\]))"/;

/**
 * Works speedy than `String#split()` and has separator escaping
 * @param str Arguments string
 * @param separator Separator
 */
export function argumentSplit(str: string, separator = ",", enableQuotes = true) {
	if (separator.length === 0) {
		throw new Error("`separator` can't be empty string");
	}

	const args: string[] = [];

	separator = escapeRegExp(separator);

	// \\ for separator escape, in Discord would look like "hello\, world!" ("hello\\, world!")
	const separatorRegexp = RegExp(`(?<=(^|[^\\\\]))${separator}`);

	let nextIndex = 0;

	while (nextIndex !== -1) {
		str = str.substr(nextIndex);

		if (enableQuotes && str[0] === "\"") {
			// try to find second one

			const quoteEnd = QUOTE_MARK_REGEXP.exec(str);

			if (quoteEnd) {
				nextIndex = quoteEnd.index + quoteEnd[0].length;

				args.push(
					str
						.substring(1, quoteEnd.index)
						.replace("\\\"", "\"")
				);

				continue;
			}
		}

		const separatorMatch = separatorRegexp.exec(str);

		let argEndIndex: number | undefined;

		if (separatorMatch) {
			nextIndex = separatorMatch.index + separatorMatch[0].length;

			argEndIndex = separatorMatch.index;
		} else {
			nextIndex = -1;
		}

		args.push(
			str.substring(0, argEndIndex)
		);
	}

	return args;
}

/**
 * "Redirects" command from message to needed handler
 * @param parsed Parsed message
 * @param redirects Handlers for the commands
 * @example
 * commandRedirect(parsed, { "ping": () => this._pingHandler(parsed) })
 * @deprecated This API will be removed soon, use `createRedirector` instead
 */
export function commandRedirect(
	parsed: ICommandParseResult,
	redirects: RedirectsMap<ICommandParseResult>
) {
	const command = parsed.command;

	const callback = redirects[command];

	if (callback) {
		return callback(parsed);
	}
}

/**
 * RegExp to check if the command is valid
 */
const COMMAND_REGEX = /^[^ ]+$/i;

/**
 * Check if there any uppercase character in the command
 */
const UPPERCASE_REGEXP = /[A-Z]/;

/**
 * Creates a command redirector
 * @param redirects Redirects for the commands
 * @param options Options for the redirector
 * @example
 * ```
 * this._redirector = commands.createRedirector({
 *   "ping": (ctx) => this._onPing(ctx),
 * });
 * 
 * // ...
 * 
 * this._redirector(commands.parse(msg));
 * ```
 */
export function createRedirector<T = ICommandParseResult>(
	redirects: RedirectsMap<T>,
	options?: IRedirectorOptions
): Redirector<T> {
	options = {
		ignoreCase: true,
		...options
	};

	for (const command in redirects) {
		if (!COMMAND_REGEX.test(command)) {
			throw new Error(`Invalid command: ${command}`);
		}

		if (!options.ignoreCase || !UPPERCASE_REGEXP.test(command)) {
			continue;
		}

		const redirect = redirects[command];

		delete redirects[command];

		redirects[command.toLowerCase()] = redirect;
	}

	return (ctx) => {
		let { command } = ctx;

		if (options && options.ignoreCase) {
			command = command.toLowerCase();
		}

		const callback = redirects[command];

		if (callback) {
			return callback(ctx);
		}
	};
}

export type RedirectsMap<T> = INullableHashMap<RedirectorCallback<T>>;
export type RedirectorCallback<T> = (ctx: RedirectorContext<T>) => any;
export type RedirectorContext<T> = T & ICommandParseResult;
export type Redirector<T> = (ctx: RedirectorContext<T>) => void;

export interface IRedirectorOptions {
	/**
	 * What happens on the fail
	 * @param ctx Context
	 */
	onFail?(ctx): any;
	/**
	 * Ignore case of the commands
	 */
	ignoreCase?: boolean;
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

