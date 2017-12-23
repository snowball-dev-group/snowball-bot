import "any-promise/register/bluebird";
import * as fs from "mz/fs";
import { join as pathJoin } from "path";
import * as formatMessage from "format-message";
import { getLogger, ILoggerFunction } from "../cogs/utils/utils";
import { Humanizer, IHumanizerLanguage, IHumanizerOptionsOverrides, IHumanizerPluralOverride, IHumanizerDefaultOptions } from "./Humanizer";
import { ISchema } from "./Typer";

export interface ILocalizerOptions {
	languages: string[];
	source_language: string;
	default_language: string;
	directory: string;
	disable_coverage_log: boolean;
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

export class Localizer {
	private opts: ILocalizerOptions;
	private langMaps: ILanguageHashMap<IStringsMap | undefined> = {};
	private initDone: boolean = false;
	private log: ILoggerFunction;
	private _sourceLang: string;
	private _loadedLanguages: string[] = [];
	private humanizersMap: ILanguageHashMap<Humanizer> = {};

	/**
	 * Returns default language
	 */
	public get defaultLanguage() {
		return this.opts.default_language;
	}

	/**
	 * Returns source language
	 */
	public get sourceLanguage() {
		return this._sourceLang;
	}

	constructor(name: string, opts: ILocalizerOptions) {
		this.opts = opts;
		this.log = getLogger(name);
		this._sourceLang = opts.source_language;
		if(!opts.default_language) {
			opts.default_language = this._sourceLang;
		}
	}

	/**
	 * Initiates all loading and checks
	 */
	public async init() {
		if(this.initDone) { return; }
		try {
			this.langMaps = {};
			this.log("info", "Started loading of language files");
			for(const lang of this.opts.languages) {
				if(!!this.langMaps[lang]) {
					throw new Error(`Language "${lang}" is already registered`);
				}

				let langStrings: IStringsMap = {};
				try {
					const content = await fs.readFile(pathJoin(this.opts.directory, `${lang}.json`), { "encoding": "utf8" });
					langStrings = JSON.parse(content);
				} catch(err) {
					this.log("err", "Could not read", lang, "language file");
				}

				let rejectLoading = false, requiredMetaKey = "";
				for(requiredMetaKey of REQUIRED_META_KEYS) {
					if(!langStrings[requiredMetaKey]) {
						rejectLoading = true;
						break;
					}
				}

				if(rejectLoading) {
					this.log("err", "Could not load", lang, " language file. It misses", requiredMetaKey, "meta key, which is required");
					continue;
				}

				this.langMaps[lang] = langStrings;

				// Creating humanizer
				this.humanizersMap[lang] = this.createCustomHumanizer(lang);
			}

			this.log("info", "Requesting source language");
			const defaultLanguage = this.langMaps[this.opts.source_language];
			if(!defaultLanguage) {
				throw new Error("Source language not found");
			}

			this.log("info", "Calculating language files coverages");
			for(const langName of Object.keys(this.langMaps)) {
				const langFile = this.langMaps[langName];
				if(!langFile) { continue; }
				if(langName === this.opts.source_language) {
					langFile["+COVERAGE"] = "100";
					langFile["+DEFAULT"] = "true";
					this.langMaps[langName] = langFile;
					continue;
				}
				langFile["+COVERAGE"] = (await this.testCoverage(langFile, defaultLanguage as IStringsMap)) + "";
				langFile["+COMMUNITY_MANAGED"] = langFile["+COMMUNITY_MANAGED"] === "true" ? "true" : "false";
				this.langMaps[langName] = langFile;
				this.log("ok", `- ${langName} ${langFile["+NAME"]} (${langFile["+COUNTRY"]}) - ${langFile["+COVERAGE"]}`);
			}
		} catch(err) {
			this.log("err", "Error at initializing localizer", err);
			return;
		}

		if(!this.langMaps[this.opts.source_language]) {
			const errorStr = "Could not find source (fallback) language";
			this.log("err", errorStr);
			throw new Error(errorStr);
		}

		this._loadedLanguages = Object.keys(this.langMaps);
		this.initDone = true;
	}

	/**
	 * Checks converage of default language by selected language's dictionary
	 * @param langFile {object} Dictionary of strings
	 * @param defaultLanguage {object} Default language
	 */
	private async testCoverage(langFile: IStringsMap, defaultLanguage = this.langMaps[this.opts.source_language] as IStringsMap) {
		let unique = 0;
		for(const key of Object.keys(defaultLanguage)) {
			// ignored keys
			if(["+COVERAGE", "$schema"].includes(key)) { unique += 1; continue; }
			// "" for empty crowdin translations
			if(typeof langFile[key] === "string" && langFile[key] !== "") {
				unique += +1;
			} else if(!this.opts.disable_coverage_log) {
				this.log("warn", `String "${key}" not translated in lang ${langFile["+NAME"]}`);
			}
		}
		const coverage = (100 * (unique / Object.keys(defaultLanguage).length));
		return Math.round(coverage * 1e2) / 1e2; // 99.99%
	}

	/**
	 * Returns list of all loaded languages
	 */
	public get loadedLanguages() {
		return this._loadedLanguages.slice(0);
	}

	/**
	 * Checks if dictionary of selected language exists
	 * @param lang Language to check
	 */
	public languageExists(lang: string) {
		return !!this.langMaps[lang];
	}

	/**
	 * Returns string from dictionary of translated strings of selected language
	 * @param lang {string} Language to get string from
	 * @param key {string} Key in language dictionary
	 * @param fallback {boolean} true if should use string from default language as fallback
	 */
	public getString(lang: string = this.opts.source_language, key: string, fallback: boolean = true) {
		const langMap = this.langMaps[lang];
		if(!langMap) {
			const errorStr = "Could not find required language";
			this.log("err", errorStr);
			throw new Error(errorStr);
		}
		let str = langMap[key];
		if((!str || str === "") && fallback && lang !== this.opts.source_language) {
			// we already know that source language exists
			str = (this.langMaps[this.opts.source_language] as IStringsMap)[key];
			if(!str) {
				let errStr = `String "${key}" not found nor in prefered language nor in source language.`;
				this.log("err", errStr);
				throw new Error(errStr);
			}
		} else if(!str) {
			const errorStr = `String "${key}" not found.`;
			this.log("err", errorStr);
			throw new Error(errorStr);
		}
		return str;
	}

	/**
	 * Returns formatted string in selected language using ICU formatting
	 * @param lang {string} Language to get string from
	 * @param key {string} Key in language translations
	 * @param variables {object} Variables for selected key and futher formatting
	 * @param fallback {boolean} true if should use string from default language as fallback
	 */
	public getFormattedString(lang: string = this.sourceLanguage, key: string, variables: IFormatMessageVariables, fallback: boolean = true) {
		const str = this.getString(lang, key, fallback);
		return formatMessage(str, variables, lang);
	}

	/**
	 * Returns humanized string for time in selected unit
	 * @param lang {string} Which language's Humanizer to use
	 * @param time {number} Time to humanize
	 * @param unit {string} Unit of time
	 */
	public humanizeDuration(lang: string = this.sourceLanguage, time: number, unit: HumanizerUnitToConvert = "ms", options?: IHumanizerOptionsOverrides) {
		const humanizer = this.humanizersMap[lang];
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
	 * @param lang {string} Language to use in Humanizer
	 * @param overrides {object} Custom language overrides for Humanizer
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
		decimal?: string;
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
		if(languageOverride) {
			defaultDefinition = Object.freeze(Object.assign({}, defaultDefinition, languageOverride));
		}
		return new Humanizer(defaultDefinition, defaultOptions);
	}
}
