import "any-promise/register/bluebird";
import { join as pathJoin, basename, extname } from "path";
import { Humanizer, IHumanizerLanguage, IHumanizerOptionsOverrides, IHumanizerPluralOverride, IHumanizerDefaultOptions } from "./Humanizer";
import { ISchema } from "./Typer";
import { IHashMap } from "./Types";
import { ILogFunction } from "loggy";
import * as fs from "mz/fs";
import * as formatMessage from "format-message";
import * as getLogger from "loggy";
import * as minimatch from "minimatch";

export interface ILocalizerOptions {
	languages: string[];
	source_language: string;
	default_language: string;
	directory: string;
	disable_coverage_log: boolean;
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

const REQUIRED_META_KEYS = ["+NAME", "+COUNTRY"];
const IGNORED_KEYS = ["+COVERAGE", "$schema"];

export class Localizer {
	private readonly _opts: ILocalizerOptions;
	private readonly _log: ILogFunction;
	private readonly _sourceLang: string;
	private readonly _fallbackQueue: string[] = [];
	private readonly _humanizersMap: ILanguageHashMap<Humanizer> = Object.create(null);
	private _langMaps: ILanguageHashMap<IStringsMap> = Object.create(null);
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
		this._opts = opts;
		this._log = getLogger(name);
		this._sourceLang = opts.source_language;
		if(!opts.default_language) {
			opts.default_language = this._sourceLang;
		} else if(opts.default_language !== opts.source_language) {
			this._fallbackQueue.push(opts.default_language);
		}
		this._fallbackQueue.push(opts.source_language);
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
				if(this._langMaps[lang]) {
					throw new Error(`Language "${lang}" is already registered`);
				}

				let langStrings: IStringsMap = Object.create(null);
				try {
					langStrings = await this.loadStringsMap(pathJoin(this._opts.directory, `${lang}.json`));
				} catch(err) {
					this._log("err", "Could not read", lang, "language file");
					continue;
				}

				let rejectLoading = false, requiredMetaKey = "";
				for(requiredMetaKey of REQUIRED_META_KEYS) {
					if(!langStrings[requiredMetaKey]) {
						rejectLoading = true;
						break;
					}
				}

				if(rejectLoading) {
					this._log("err", "Could not load", lang, " language file. It misses", requiredMetaKey, "meta key, which is required");
					continue;
				}

				this._langMaps[lang] = langStrings;

				// Creating humanizer
				this._humanizersMap[lang] = this.createCustomHumanizer(lang);
			}

			this._log("info", "Requesting source language");
			const defaultLanguage = this._langMaps[this._opts.source_language];
			if(!defaultLanguage) {
				throw new Error("Source language not found");
			}

			this._log("info", "Calculating language files coverages");
			for(const langName in this._langMaps) {
				const langFile = this._langMaps[langName];
				if(!langFile) { continue; }
				if(langName === this._opts.source_language) {
					langFile["+COVERAGE"] = "100";
					langFile["+DEFAULT"] = "true";
					this._langMaps[langName] = langFile;
					continue;
				}
				langFile["+COVERAGE"] = `${await this.testCoverage(langFile, defaultLanguage as IStringsMap)}`;
				langFile["+COMMUNITY_MANAGED"] = langFile["+COMMUNITY_MANAGED"] === "true" ? "true" : "false";
				this._langMaps[langName] = langFile;
				this._log("ok", `- ${langName} ${langFile["+NAME"]} (${langFile["+COUNTRY"]}) - ${langFile["+COVERAGE"]}`);
			}
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
	 * Checks converage of default language by selected language's dictionary
	 * @param langFile Dictionary of strings
	 * @param defaultLanguage Default language
	 */
	private async testCoverage(langFile: IStringsMap, defaultLanguage = this._langMaps[this._opts.source_language] as IStringsMap) {
		let unique = 0;
		for(const key in defaultLanguage) {
			// ignored keys
			if(IGNORED_KEYS.includes(key)) { unique += 1; continue; }
			// "" for empty crowdin translations
			if(typeof langFile[key] === "string" && langFile[key] !== "") {
				unique += +1;
			} else if(!this._opts.disable_coverage_log) {
				this._log("warn", `String "${key}" not translated in lang ${langFile["+NAME"]}`);
			}
		}
		const coverage = (100 * (unique / Object.keys(defaultLanguage).length));
		return Math.round(coverage * 1e2) / 1e2; // 99.99%
	}

	/**
	 * Extends selected language with strings
	 * @param langName Language name
	 * @param langFile Language file or filename
	 */
	public async extendLanguage(langName: string, langFile: string | IStringsMap) {
		const langMap = this._loadedLanguages[langName];
		if(!langMap) { throw new Error(`Language "${langName}" is not loaded yet`); }

		switch(typeof langFile) {
			case "string": { langFile = await this.loadStringsMap(<string>langFile); } break;
			case "object": break;
			default: { throw new Error("Invalid type of strings map"); }
		}

		for(const key in <IStringsMap>langFile) {
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

			if(langMap[key] && !this._opts.extendOverride) {
				this._log("info", `Don't override "${key}" in "${langName}" as override is set to \`false\``);
				continue;
			}

			langMap[key] = value;
		}

		return langMap;
	}

	/**
	 * Extends language using hash map
	 * @param languagesTree KVPs where key is language name and value is strings map or filename
	 * @param toLangCode Function to convert strings map to language name, takes two arguments - filename and map itself
	 * @param filter Minimatch string to filter files in directory
	 * @param throwOnError Throw error if reading of file in directory fails
	 */
	public async extendLanguages(languagesTree: IHashMap<IStringsMap | string> | string, toLangCode?: LangFileToCodeFunction, filter?: string, throwOnError = false) {
		if(typeof languagesTree !== "object") { languagesTree = await this.directoryToLanguagesTree(languagesTree, toLangCode, filter); }
		const results: IHashMap<IStringsMap> = Object.create(null);
		for(const langName in languagesTree) {
			const langFile = languagesTree[langName];
			results[langName] = await this.extendLanguage(langName, langFile);
		}
		return results;
	}

	/**
	 * Loads strings map from specified file
	 * @param fileName File name to load
	 * @returns Strings map
	 */
	public async loadStringsMap(fileName: string) {
		const content = await fs.readFile(fileName, { "encoding": "utf8" });
		const parsed = JSON.parse(content);
		if(typeof parsed !== "object") { throw new Error(`Invalid type for strings map in file "${fileName}"`); }
		return <IStringsMap>parsed;
	}

	/**
	 * Creates languages hash map using directory (not extends current languages!)
	 * @param directory Path to directory with files
	 * @param toLangCode Function to convert strings map to language name, takes two arguments - filename and map itself
	 * @param filter Minimatch string to filter files in directory
	 * @param throwOnError Throw error if reading of file in directory fails
	 */
	public async directoryToLanguagesTree(directory: string, toLangCode?: LangFileToCodeFunction, filter?: string, throwOnError = false) {
		let fileNames = await fs.readdir(directory);
		if(filter) { fileNames = fileNames.filter(minimatch.filter(filter)); }

		if(!toLangCode) { // default value
			toLangCode = (fileName) => basename(extname(fileName));
		}

		const tree: IHashMap<IStringsMap> = Object.create(null);

		for(const fileName in fileNames) {
			let stringsMap: IStringsMap;
			try {
				stringsMap = await this.loadStringsMap(pathJoin(directory, fileName));
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
