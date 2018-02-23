import "any-promise/register/bluebird";
import { Humanizer, IHumanizerLanguage, IHumanizerOptionsOverrides, IHumanizerPluralOverride, IHumanizerDefaultOptions } from "./Humanizer";
import { ISchema } from "./Typer";
import { IHashMap, INullableHashMap } from "./Types";
import { ILogFunction } from "loggy";
import * as fs from "mz/fs";
import * as path from "path";
import * as formatMessage from "format-message";
import * as getLogger from "loggy";
import * as micromatch from "micromatch";

export interface ILocalizerOptions {
	languages: string[];
	source_language: string;
	default_language: string;
	directory: string;
	disable_coverage_log: boolean | string[];
	extendOverride?: boolean;
}

export const SCHEMA_LOCALIZEROPTIONS: ISchema = {
	"languages": {
		type: "object", isArray: true,
		elementSchema: { type: "string" }
	},
	"source_language": { type: "string" },
	"default_language": { type: "string" },
	"directory": { type: "string" },
	"disable_coverage_log": { type: "boolean", optional: true }
};

export interface IStringsMap {
	[key: string]: string | undefined;
}

export interface IFormatMessageVariables {
	[name: string]: string | number | boolean | Date;
}

export interface ILanguageHashMap<T> {
	[lang: string]: T;
}

export type HumanizerUnitToConvert = "ms" | "s" | "m" | "h" | "d" | "w";

const META_KEYS = ["+NAME", "+COUNTRY"];
const DYNAMIC_META_KEYS = ["+COVERAGE"];
const PRUNE_BANNED_KEYS = [...META_KEYS, ...DYNAMIC_META_KEYS];

export class Localizer {
	private readonly _opts: ILocalizerOptions;
	private readonly _log: ILogFunction;
	private readonly _sourceLang: string;
	private readonly _fallbackQueue: string[] = [];
	private readonly _humanizersMap: ILanguageHashMap<Humanizer> = Object.create(null);
	private _langMaps: ILanguageHashMap<IStringsMap | undefined> = Object.create(null);
	private _initDone: boolean = false;
	private _loadedLanguages: string[] = [];

	/**
	 * Returns default language
	 */
	public get defaultLanguage() { return this._opts.default_language; }

	/**
	 * Returns source language
	 */
	public get sourceLanguage() { return this._sourceLang; }

	constructor(name: string, opts: ILocalizerOptions) {
		this._log = getLogger(name);

		if(!opts.default_language) {
			opts.default_language = this._sourceLang;
		} else if(opts.default_language !== opts.source_language) {
			this._fallbackQueue.push(opts.default_language);
		}

		{
			const covgLogDisabledType = typeof opts.disable_coverage_log;
			switch(covgLogDisabledType) {
				case "object": {
					if(!Array.isArray(opts.disable_coverage_log)) {
						throw new Error("`disable_coverage_log` should be either array or boolean");
					}
					const possibleLanguages = [opts.source_language];
					if(opts.default_language && opts.default_language !== opts.source_language) {
						possibleLanguages.push(opts.default_language);
					}
					opts.disable_coverage_log = opts.disable_coverage_log.filter(possibleLanguages.includes);
				} break;
				case "boolean": { this._coverageDisabledGlobally = opts.disable_coverage_log; } break;
				default: { throw new Error("`disable_coverage_log` should be either array or boolean"); }
			}

			this._coverageDisablingSet = true;
		}

		this._sourceLang = opts.source_language;
		this._fallbackQueue.push(opts.source_language);
		this._opts = opts;
	}

	/**
	 * Initiates all loading and checks
	 */
	public async init() {
		if(this._initDone) { return; }
		try {
			this._langMaps = Object.create(null);

			this._log("info", "Started loading of language files");

			for(const lang of this._opts.languages) {
				if(this._langMaps[lang]) { throw new Error(`Language "${lang}" is already registered`); }

				let stringsMap: IStringsMap = Object.create(null);
				try {
					stringsMap = await this.loadStringsMap(path.join(this._opts.directory, `${lang}.json`));
				} catch(err) {
					this._log("err", "Could not read", lang, "language file");
					continue;
				}

				let rejectLoading = false, requiredMetaKey = "";
				for(requiredMetaKey of META_KEYS) {
					if(!stringsMap[requiredMetaKey]) {
						rejectLoading = true;
						break;
					}
				}

				if(rejectLoading) {
					this._log("err", "Could not load", lang, " language file. It misses", requiredMetaKey, "meta key, which is required");
					continue;
				}

				this._langMaps[lang] = stringsMap;

				// Creating humanizer
				this._humanizersMap[lang] = this.createCustomHumanizer(lang);
			}

			this._log("info", "Requesting source language");
			const defaultLanguage = this._langMaps[this._opts.source_language];
			if(!defaultLanguage) {
				throw new Error("Source language not found");
			}

			this._log("info", "Calculating language files coverages");
			await this.calculateCoverages();
		} catch(err) {
			this._log("err", "Error at initializing localizer", err);
			return;
		}

		if(!this._langMaps[this._opts.source_language]) {
			const errorStr = "Could not find source (fallback) language";
			this._log("err", errorStr);
			throw new Error(errorStr);
		}

		this._loadedLanguages = Object.keys(this._langMaps);
		this._initDone = true;
	}

	/**
	 * Calculates coverages for languages
	 * 
	 * 'Coverage' means how many strings were translated
	 * @param langNames Names of languages. By default all languages
	 * @param log Should it log to console the results of calculation
	 * @returns Hash map where key is language name and value is percentage of 'coverage'
	 */
	public async calculateCoverages(langNames?: string[], log = false) {
		const results: INullableHashMap<number> = Object.create(null);
		const sourceLanguage = this._langMaps[this._sourceLang];

		const keys = (langNames || this._langMaps);

		for(const langName in keys) {
			const langFile = this._langMaps[langName]!;

			if(langName === this._sourceLang) {
				langFile["+COVERAGE"] = "100";
				results[langName] = 100;
				continue;
			}

			if(!langFile) { continue; }

			results[langName] = await this.calculateCoverage(langFile, sourceLanguage, log);
		}

		return results;
	}

	private async calculateCoverage(langFile: string | IStringsMap, sourceLanguage?: IStringsMap, log = false, _langName?: string): Promise<number> {
		let isSourceLanguage = false;
		let knownName: string | undefined;

		if(typeof langFile === "string") {
			if(_langName) {
				if(_langName !== langFile) {
					// someone is trying to fool us?
					throw new Error("Wrong language specified");
				}
				knownName = _langName;
			} else { knownName = langFile; }

			isSourceLanguage = langFile === this.sourceLanguage;
			langFile = this._langMaps[langFile]!;

			if(!langFile) { throw new Error("Language name with this name is not found"); }
		}

		if(!isSourceLanguage && sourceLanguage) {
			isSourceLanguage = langFile === sourceLanguage;
		}

		if(isSourceLanguage) {
			langFile["+COVERAGE"] = "100";
			return 100;
		}

		const coverage = await this.testCoverage(langFile, (sourceLanguage || this._langMaps[this.sourceLanguage]), knownName);

		langFile["+COVERAGE"] = `${coverage}`;
		if(langFile["+COMMUNITY_MANAGED"] !== "true") { langFile["+COMMUNITY_MANAGED"] = "false"; }

		if(log) { this._log("ok", `- ${langFile} ${langFile["+NAME"]} (${langFile["+COUNTRY"]}) - ${langFile["+COVERAGE"]}`); }

		return coverage;
	}

	/**
	 * Checks converage of default language by selected language's dictionary
	 * @param langFile Dictionary of strings
	 * @param defaultLanguage Default language
	 */
	private async testCoverage(langFile: IStringsMap, defaultLanguage = this._langMaps[this._opts.source_language]!, _langName?: string) {
		let unique = 0;
		for(const key in defaultLanguage) {
			// ignored keys
			if(DYNAMIC_META_KEYS.includes(key)) { unique += 1; continue; }
			// "" for empty crowdin translations
			if(typeof langFile[key] === "string" && langFile[key] !== "") {
				unique += +1;
			} else if(!this._isCoverageDisabledFor(_langName)) {
				this._log("warn", `String "${key}" not translated in lang ${langFile["+NAME"]}`);
			}
		}
		const coverage = (100 * (unique / Object.keys(defaultLanguage).length));
		return Math.round(coverage * 1e2) / 1e2; // 99.99%
	}

	private readonly _coverageDisabledGlobally;
	private readonly _coverageDisablingSet;

	private _isCoverageDisabledFor(langName?: string) {
		return this._coverageDisabledGlobally || (this._coverageDisablingSet ? ( // is set?
			langName ? ( // do we at all have lang name?
				this._opts.disable_coverage_log && // it may be set as false here
				// if not false - searching in array
				((<string[]>this._opts.disable_coverage_log).includes(langName))
			) : false // if not - we don't need to log it
		) : false); // if not set - false
	}

	/**
	 * Extends selected language with strings
	 * @param langName Language name to extend
	 * @param langFile Language file or filename
	 * @returns List of imported keys to language
	 */
	public async extendLanguage(langName: string, langFile: string | string[] | IStringsMap) {
		const importedKeys: string[] = [];
		const langMap = this._langMaps[langName];
		const sourceLanguage = langName !== this._sourceLang ? this._langMaps[this._sourceLang] : undefined;

		if(!langMap) { throw new Error(`Language "${langName}" is not loaded yet`); }

		if(typeof langFile !== "object" || Array.isArray(langFile)) {
			langFile = await this.loadStringsMap(langFile);
		}

		for(const key in langFile) {
			let value = langFile[key];
			const valueType = typeof value;

			if(valueType !== "string") {
				if(valueType === "number" || valueType === "boolean") {
					value = String(value);
				} else {
					this._log("info", `Invalid type of "${key}" - "${valueType}"`);
					continue;
				}
			}

			if(sourceLanguage && !sourceLanguage[key]) {
				this._log("warn", `"${key}" is not found in source language yet.`);
			}

			if(langMap[key] && !this._opts.extendOverride) {
				this._log("info", `Don't override "${key}" in "${langName}" as override is set to \`false\``);
				continue;
			}

			langMap[key] = value;
			importedKeys.push(key);
		}

		return importedKeys;
	}

	/**
	 * Extends language using hash map
	 * @param languagesTree Hash map where key is language name and value is strings map or filename
	 * @param toLangCode Function to convert strings map to language name, takes two arguments - filename and map itself
	 * @param filter Glob string(s) to filter files in directory or function
	 * @param throwOnError Throw error if reading of file in directory fails
	 * @returns List of all imported keys to all languages
	 */
	public async extendLanguages(languagesTree: IHashMap<IStringsMap | string> | string, toLangCode?: LangFileToCodeFunction, filter?: FilterType, throwOnError = false) {
		if(typeof languagesTree !== "object") { languagesTree = await this.directoryToLanguagesTree(languagesTree, toLangCode, filter, throwOnError); }
		const importedKeys: string[] = [];

		const sourceLangInTree = languagesTree[this._sourceLang];
		if(sourceLangInTree) {
			// if we have source language, loading it right before others
			for(const key of await this.extendLanguage(this._sourceLang, sourceLangInTree)) {
				if(!importedKeys.includes(key)) { importedKeys.push(key); }
			}
		}

		for(const langName in languagesTree) {
			if(langName === this._sourceLang) { continue; } // ↖ we extended it already
			const langFile = languagesTree[langName];
			for(const key of await this.extendLanguage(langName, langFile)) {
				if(!importedKeys.includes(key)) { importedKeys.push(key); }
			}
		}

		return importedKeys;
	}

	/**
	 * Removes specified keys from all languages
	 * @param keys Keys to remove
	 * @example $localizer.pruneLanguages(["8BALL_ANSWER_CERTAIN", ...])
	 */
	public async pruneLanguages(keys: string[]) {
		keys = keys.filter(key => !PRUNE_BANNED_KEYS.includes(key));
		for(const langName in this._langMaps) {
			const langFile = this._langMaps[langName];
			if(!langFile) { continue; }
			for(const key of keys) { langFile[key] = undefined; }
		}
	}

	/**
	 * Loads strings map from specified file
	 * @param fileName File name to load
	 * @returns Strings map
	 */
	public async loadStringsMap(fileName: string | string[]) {
		if(Array.isArray(fileName)) { fileName = path.join(...fileName); }
		const content = await fs.readFile(fileName, { "encoding": "utf8" });
		const parsed = JSON.parse(content);
		if(typeof parsed !== "object") { throw new Error(`Invalid type for strings map in file "${fileName}"`); }
		return <IStringsMap>parsed;
	}

	/**
	 * Creates languages hash map using directory (not extends current languages!)
	 * @param directory Path to directory with files
	 * @param toLangCode Function to convert strings map to language name, takes two arguments - filename and map itself. By default uses file basename
	 * @param filter Glob patterns or function that takes list of files and returns only true
	 * @param throwOnError Throw error if reading of file in directory fails
	 */
	public async directoryToLanguagesTree(directory: string | string[], toLangCode?: LangFileToCodeFunction, filter?: FilterType, throwOnError = false) {
		if(Array.isArray(directory)) { directory = path.join(...directory); }

		let fileNames = await this.recursiveReadDirectory(directory);
		if(filter) { fileNames = typeof filter === "string" || Array.isArray(filter) ? micromatch(fileNames, filter) : filter(fileNames); }

		if(!toLangCode) { toLangCode = filename => path.basename(filename, path.extname(filename)); }

		const tree: IHashMap<IStringsMap> = Object.create(null);

		for(const fileName of fileNames) {
			let stringsMap: IStringsMap;
			try {
				stringsMap = await this.loadStringsMap(path.join(directory, fileName));
			} catch(err) {
				if(throwOnError) { throw err; }
				this._log("err", `[Load Strings Map by Tree] Failed to load ${fileName}`);
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
		if(Array.isArray(dirName)) { dirName = path.join(...dirName); }

		const result: string[] = [];

		const files = await fs.readdir(dirName);

		for(const rawFilePath of files) {
			const filePath = path.join(dirName, rawFilePath);
			const stat = await fs.stat(filePath);
			if(stat.isFile()) {
				result.push(recursiveCall ? filePath : this._sliceWithSeparator(filePath, dirName));
			} else if(stat.isDirectory()) {
				const files = await this.recursiveReadDirectory(filePath, true);
				for(const file of files) { result.push(recursiveCall ? file : this._sliceWithSeparator(file, dirName)); }
			}
		}

		return result;
	}

	private _sliceWithSeparator(filePath: string, dirName: string) {
		return filePath.slice(dirName.length + path.sep.length);
	}

	/**
	 * Returns list of all loaded languages
	 */
	public get loadedLanguages() { return this._loadedLanguages.slice(0); }

	/**
	 * Checks if dictionary of selected language exists
	 * @param lang Language to check
	 */
	public languageExists(lang: string) { return !!this._langMaps[lang]; }

	/**
	 * Returns string from dictionary of translated strings of selected language
	 * @param preferedLang Language to get string from
	 * @param key Key in language dictionary
	 * @param fallback true if should try to find the fallback string in default and source languages
	 */
	public getString(preferedLang: string = this._opts.source_language, key: string, fallback: boolean = true): string {
		const queue = fallback ? [preferedLang].concat(this._fallbackQueue) : [preferedLang];
		for(const lang of queue) {
			const langMap = this._langMaps[lang];
			if(!langMap) { throw new Error(`Language "${lang}" not found`); }
			const foundStr = langMap[key];
			if(foundStr && foundStr !== "") { return foundStr; }
		}
		const errStr = fallback ? `String "${key}" not found nor in "${preferedLang}", nor in default & source languages` : `String "${key}" not found in "${preferedLang}"`;
		this._log("err", errStr);
		throw new Error(errStr);
	}

	/**
	 * Returns formatted string in selected language using ICU formatting
	 * @param lang Language to get string from
	 * @param key Key in language translations
	 * @param variables Variables for selected key and futher formatting
	 * @param fallback true if should use string from default language as fallback
	 */
	public getFormattedString(lang: string = this.sourceLanguage, key: string, variables: IFormatMessageVariables, fallback: boolean = true) {
		const str = this.getString(lang, key, fallback);
		return <string>formatMessage(str, variables, lang);
	}

	/**
	 * Returns humanized string for time in selected unit
	 * @param lang Which language's Humanizer to use
	 * @param time Time to humanize
	 * @param unit Unit of time
	 */
	public humanizeDuration(lang: string = this.sourceLanguage, time: number, unit: HumanizerUnitToConvert = "ms", options?: IHumanizerOptionsOverrides) {
		const humanizer = this._humanizersMap[lang];
		if(!humanizer) { throw new Error("Could not find humanizer in selected language"); }

		if(unit !== "ms") {
			switch(unit) {
				// these only units convertable
				// others are dynamic
				case "s": { time *= 1000; } break;
				case "m": { time *= 60000; } break;
				case "h": { time *= 3600000; } break;
				case "d": { time *= 86400000; } break;
				case "w": { time *= 604800000; } break;
				default: throw new Error("Invalid unit selected");
			}
		}

		return humanizer.humanize(time, options);
	}

	/**
	 * Creates custom humanizer with choosen overrides
	 * @param lang Language to use in Humanizer
	 * @param overrides Custom language overrides for Humanizer
	 */
	public createCustomHumanizer(lang: string = this.sourceLanguage, languageOverride?: {
		// it's overrides, so we gonna create anotha inline-interface?
		y?: IHumanizerPluralOverride;
		mo?: IHumanizerPluralOverride;
		w?: IHumanizerPluralOverride;
		d?: IHumanizerPluralOverride;
		h?: IHumanizerPluralOverride;
		m?: IHumanizerPluralOverride;
		s?: IHumanizerPluralOverride;
		ms?: IHumanizerPluralOverride;
	}, defaultOptions?: IHumanizerDefaultOptions) {
		let defaultDefinition: IHumanizerLanguage = {
			y: (years: number) => this.getFormattedString(lang, "@HUMANIZE:DURATION:YEARS", { years }),
			mo: (months: number) => this.getFormattedString(lang, "@HUMANIZE:DURATION:MONTHS", { months }),
			w: (weeks: number) => this.getFormattedString(lang, "@HUMANIZE:DURATION:WEEKS", { weeks }),
			d: (days: number) => this.getFormattedString(lang, "@HUMANIZE:DURATION:DAYS", { days }),
			h: (hours: number) => this.getFormattedString(lang, "@HUMANIZE:DURATION:HOURS", { hours }),
			m: (minutes: number) => this.getFormattedString(lang, "@HUMANIZE:DURATION:MINUTES", { minutes }),
			s: (seconds: number) => this.getFormattedString(lang, "@HUMANIZE:DURATION:SECONDS", { seconds }),
			ms: (milliseconds: number) => this.getFormattedString(lang, "@HUMANIZE:DURATION:MILLISECONDS", { milliseconds })
		};
		if(languageOverride) { defaultDefinition = { ...defaultDefinition, ...languageOverride }; }
		return new Humanizer(defaultDefinition, defaultOptions);
	}
}

type LangFileToCodeFunction = (filename: string, map: IStringsMap) => string;
type FilterType = ((filenames: string[]) => string[]) | string | string[];
