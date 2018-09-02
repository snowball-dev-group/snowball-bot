import * as Interfaces from "@sb-types/Localizer/HumanizerInterfaces";
import LocalizerParser from "@sb-types/Localizer/LocalizerParser";
import LocalizerParsersCollection from "@sb-types/Localizer/LocalizerParsersCollection";
import LocalizerJSONParser from "@sb-types/Localizer/parsers/JSONParser";
import * as Types from "@sb-types/Types";
import * as logger from "loggy";
import * as micromatch from "micromatch";
import * as fs from "mz/fs";
import * as path from "path";

const PATH_SEP_LENGTH = path.sep.length;

export class LocalizerFileLoader {
	private readonly _log: logger.ILogFunction;
	private readonly _parsersCollection: LocalizerParsersCollection;

	public get parsersCollection(): LocalizerParsersCollection {
		return this._parsersCollection;
	}

	constructor(name: string, parsersPreset?: LocalizerParser[]) {
		this._log = logger(name);

		this._parsersCollection = new LocalizerParsersCollection(
			`${name}:Parsers`
		);

		if (parsersPreset != null) {
			for (let i = 0, l = parsersPreset.length; i < l; i++) {
				const parser = parsersPreset[i];

				this._log("info", `Adding a preset parser "${parser.name}" to collection...`);

				this._parsersCollection.addParser(parser);
			}
		} else {
			this._log("warn", "No preset parsers provided, using default preset of JSON parser");

			this._parsersCollection.addParser(
				new LocalizerJSONParser()
			);
		}
	}

	/**
	 * Loads strings map from specified file
	 * @param fileName File name to load
	 * @returns Strings map
	 */
	public async loadStringsMap(fileName: string | string[]) {
		if (Array.isArray(fileName)) { fileName = path.join(...fileName); }

		const ext = path.extname(fileName);

		// finding parser for extension
		const parser = this._parsersCollection.getParser(ext);

		if (!parser) {
			throw new Error(`None of the current parsers accepts extension "${ext}"`);
		}

		const content = await fs.readFile(fileName, { "encoding": "utf8" });

		this._log("info", `Parsing "${fileName}" with "${parser.name}"...`);

		const parsed = parser.parse(content);

		if (typeof parsed !== "object") {
			throw new Error(`Invalid type for the strings map in file "${fileName}"`);
		}

		return parsed;
	}

	/**
	 * Creates languages hash map using directory (not extends current languages!)
	 * @param directory Path to directory with files
	 * @param toLangCode Function to convert strings map to language name, takes two arguments - filename and map itself. By default uses file basename
	 * @param filter Glob patterns or function that takes list of files and returns only true
	 * @param throwOnError Throw error if reading of file in directory fails
	 */
	public async directoryToLanguagesTree(directory: string | string[], toLangCode?: LangFileToCodeFunction, filter?: FilterType, throwOnError = false) {
		if (Array.isArray(directory)) {
			directory = path.join(...directory);
		}

		let fileNames = await this.recursiveReadDirectory(directory);

		if (filter) {
			fileNames = typeof filter === "string" ||
				Array.isArray(filter) ?
					micromatch(fileNames, filter) :
					filter(fileNames);
		}

		if (!toLangCode) {
			toLangCode = fileName => path.basename(
				fileName,
				path.extname(fileName)
			);
		}

		const tree: Types.IHashMap<Interfaces.IStringsMap> = Object.create(null);

		for (const fileName of fileNames) {
			let stringsMap: Interfaces.IStringsMap;
			try {
				stringsMap = await this.loadStringsMap(
					path.join(
						directory,
						fileName
					)
				);
			} catch (err) {
				this._log("err", `[Load Strings Map by Tree] Failed to load ${fileName}`);

				if (throwOnError) { throw err; }

				continue;
			}

			tree[toLangCode(fileName, stringsMap)] = stringsMap;
		}

		return tree;
	}

	/**
	 * Recursively browses folder and returns all files from it and subdirectories
	 * @param dirName Directory path to browse in
	 * @param recursiveCall Is this recursive call? If you set this to true, you'll get `dirName` included
	 */
	private async recursiveReadDirectory(dirName: string | string[], recursiveCall = false): Promise<string[]> {
		if (Array.isArray(dirName)) {
			dirName = path.join(...dirName);
		}

		const result: string[] = [];

		const files = await fs.readdir(dirName);

		for (const rawFilePath of files) {
			const filePath = path.join(dirName, rawFilePath);
			const stat = await fs.stat(filePath);

			if (stat.isFile()) {
				result.push(
					recursiveCall ?
						filePath :
						this._sliceWithSeparator(
							filePath, dirName
						)
				);
			} else if (stat.isDirectory()) {
				const files = await this.recursiveReadDirectory(
					filePath,
					true
				);

				for (const filePath of files) {
					result.push(recursiveCall ?
						filePath :
						this._sliceWithSeparator(
							filePath, dirName
						)
					);
				}
			}
		}

		return result;
	}

	private _sliceWithSeparator(filePath: string, dirName: string) {
		return filePath.slice(dirName.length + PATH_SEP_LENGTH);
	}

}

export type LangFileToCodeFunction = (filename: string, map: Interfaces.IStringsMap) => string;
export type FilterType = ((filenames: string[]) => string[]) | string | string[];

export default LocalizerFileLoader;
