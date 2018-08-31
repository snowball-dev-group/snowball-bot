import LocalizerParser from "@sb-types/Localizer/LocalizerParser";
import { IHashMap } from "@sb-types/Types";
import * as logger from "loggy";
import * as shortid from "shortid";

/**
 * Options for a new instance of Localizer Parsers Collection
 */
interface ICollectionOptions {
	/**
	 * Name that will be used in logger
	 */
	name: string;
}

/**
 * A collection of parsers for Localizers.
 * 
 * Parsers used to read files of different formats
 */
export class LocalizerParsersCollection {
	private readonly _parsers: IHashMap<LocalizerParser> = Object.create(null);
	private readonly _parserExtensions: WeakMap<LocalizerParser, string[]> = new WeakMap();
	private readonly _log: logger.ILogFunction;

	constructor(option: ICollectionOptions) {
		if (!option.name) {
			option.name = `${LocalizerParsersCollection.name}-${shortid()}`;
		}

		this._log = logger(option.name);
	}

	/**
	 * Adds (register) a new parser to the collection for later use
	 * @param parser Parser which being registered
	 * @param strict Set to `true` whenever function should throw an exception if handling fails
	 */
	public addParser(parser: LocalizerParser, strict: boolean = false) {
		const extensions = parser.supportedExtensions.slice();

		if (extensions.length === 0) {
			throw new Error("This parser doesn't support any extensions");
		}

		const parsers = this._parsers;
		const handlesExtensions: string[] = [];

		for (let i = 0, l = extensions.length; i < l; i++) {
			const extension = extensions[i];
			const currentParser = parsers[extension];

			if (currentParser === parser) {
				this._log("info_trace", `This parser (${currentParser.name}) is already registered to handle this extension`);

				continue;
			} else if (currentParser) {
				const msg = `Extension "${extension}" is already handled by the other parser - ${currentParser.name}`;

				this._log("warn_trace", msg);

				if (strict) {
					throw new Error(msg);
				}

				extensions.splice(i, 1);

				continue;
			}

			handlesExtensions.push(extension);
		}

		for (let i = 0, l = handlesExtensions.length; i < l; i++) {
			const extension = handlesExtensions[i];

			parsers[extension] = parser;

			this._log("ok", `Extension "${extension}" is now being handled by ${parser.name}`);
		}

		this._parserExtensions.set(parser, handlesExtensions);

		this._log("ok", `Successfully added a new parser - ${parser.name} for ${handlesExtensions.join(", ")}`);

		return this;
	}

	/**
	 * Removes (unregisters) parser from the collection
	 * @param parser Parser which being removed from the collection
	 * @param strict Set to `true` whenever function should throw an exception if unhandling fails
	 */
	public removeParser(parser: LocalizerParser, strict: boolean = false) {
		const extensions = this._parserExtensions.get(parser);
		const parserName = parser.name;

		if (!extensions) {
			throw new Error("Cannot find a list of extensions this parser handles. Perhaps it was never loaded?");
		}

		const parsers = this._parsers;
		const handlesExtensions: string[] = [];

		for (let i = 0, l = extensions.length; i < l; i++) {
			const extension = extensions[i];

			const currentParser = parsers[extension];

			if (!currentParser) {
				const msg = `No parser handles extension "${extension}"`;

				this._log("warn_trace", msg);

				if (strict) {
					throw new Error(msg);
				}

				continue;
			} else if (currentParser !== parser) {
				const msg = `Other parser (${currentParser.name}) handles extension`;

				this._log("warn_trace", msg);

				if (strict) {
					throw new Error(msg);
				}

				continue;
			}

			handlesExtensions.push(extension);
		}

		for (let i = 0, l = handlesExtensions.length; i < l; i++) {
			const extension = handlesExtensions[i];

			delete parsers[i];

			this._log("ok", `Extension "${extension}" is not anymore handled by ${parserName}`);
		}

		this._log("ok", `Successfully unregistered parser "${parserName}" from ${handlesExtensions.join(", ")}`);

		return this;
	}

	/**
	 * Finds a parser for the selected extension
	 * @param extension Extension name
	 */
	public getParser(extension: string) {
		return this._parsers[extension] || undefined;
	}
}

export default LocalizerParsersCollection;
