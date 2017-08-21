import "any-promise/register/bluebird";
import * as fs from "mz/fs";
import { join as pathJoin } from "path";
import * as formatMsg from "format-message";
import { getLogger, ILoggerFunction } from "../cogs/utils/utils";

export interface ILocalizerOptions {
    languages: string[];
    source_language: string;
    default_language: string;
    directory: string;
}

export interface IStringsMap {
    [key: string]: string | undefined;
}

export interface IStringsMapsMap {
    [langCode: string]: IStringsMap | undefined;
}

const REQUIRED_META_KEYS = ["+NAME", "+COUNTRY"];

export class Localizer {
    private opts: ILocalizerOptions;
    private langMaps: IStringsMapsMap = {};
    private initDone: boolean = false;
    private log: ILoggerFunction;
    private _sourceLang: string;
    private _loadedLanguages: string[] = [];

    get defaultLanguage() {
        return this.opts.default_language;
    }

    get sourceLanguage() {
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

    public async init() {
        if(this.initDone) { return; }
        try {
            this.langMaps = {};
            this.log("info", "Started loading of language files");
            for(let lang of this.opts.languages) {
                if(!!this.langMaps[lang]) {
                    throw new Error(`Language "${lang}" is already registered`);
                }

                let z: IStringsMap = {};
                try {
                    let content = await fs.readFile(pathJoin(this.opts.directory, `${lang}.json`), { "encoding": "utf8" });
                    z = JSON.parse(content);
                } catch(err) {
                    this.log("err", "Could not read", lang, "language file");
                }

                let shouldNotLoad = false, requiredMetaKey = "";
                for(requiredMetaKey of REQUIRED_META_KEYS) {
                    if(!z[requiredMetaKey]) {
                        shouldNotLoad = true;
                        break;
                    }
                }

                if(shouldNotLoad) {
                    this.log("err", "Could not load", lang, " language file. It misses", requiredMetaKey, "meta key, which is required");
                    continue;
                }

                this.langMaps[lang] = z;
            }

            this.log("info", "Requesting source language");
            let defLang = this.langMaps[this.opts.source_language];
            if(!defLang) {
                throw new Error("Source language not found");
            }

            this.log("info", "Calculating language files coverages");
            for(let langName of Object.keys(this.langMaps)) {
                let langFile = this.langMaps[langName];
                if(!langFile) { continue; }
                if(langName === this.opts.source_language) {
                    langFile["+COVERAGE"] = "100";
                    this.langMaps[langName] = langFile;
                    continue;
                }
                langFile["+COVERAGE"] = (await this.testCoverage(langFile, defLang as IStringsMapsMap)) + "";
                langFile["+COMMUNITY_MANAGED"] = langFile["+COMMUNITY_MANAGED"] === "true" ? "true" : "false";
                this.langMaps[langName] = langFile;
                this.log("ok", `- ${langName} ${langFile["+NAME"]} (${langFile["+COUNTRY"]}) - ${langFile["+COVERAGE"]}`);
            }
        } catch(err) {
            this.log("err", "Error at initializing localizer", err);
            return;
        }

        if(!this.langMaps[this.opts.source_language]) {
            let estr = "Could not find source (fallback) language";
            this.log("err", estr);
            throw new Error(estr);
        }

        this._loadedLanguages = Object.keys(this.langMaps);
        this.initDone = true;
    }

    private async testCoverage(langFile, defLang = this.langMaps[this.opts.source_language] as IStringsMapsMap) {
        let unique = 0;
        for(let key of Object.keys(defLang)) {
            // ignored keys
            if(["+COVERAGE", "$schema"].includes(key)) { unique += 1; continue; }
            // "" for empty crowdin translations
            if(typeof langFile[key] === "string" && langFile[key] !== "") {
                unique += +1;
            } else {
                this.log("warn", `String "${key}" not translated in lang ${langFile["+NAME"]}`);
            }
        }
        let coverage = (100 * (unique / Object.keys(defLang).length));
        return Math.round(coverage * 1e2) / 1e2; // 99.99%
    }

    public get loadedLanguages() {
        return this._loadedLanguages.slice(0);
    }

    public languageExists(lang: string) {
        return !!this.langMaps[lang];
    }

    public getString(lang: string = this.opts.source_language, str: string) {
        let lf = this.langMaps[lang];
        if(!lf) {
            let estr = "Could not find required language";
            this.log("err", estr);
            throw new Error(estr);
        }
        let l = lf[str];
        if((!l || l === "") && lang !== this.opts.source_language) {
            // we already know that source language exists
            l = (this.langMaps[this.opts.source_language] as IStringsMap)[str];
            if(!l) {
                let estr = `String "${str}" not found nor in prefered language nor in source language.`;
                this.log("err", estr);
                throw new Error(estr);
            }
        } else if(!l) {
            let estr = `String "${str}" not found.`;
            this.log("err", estr);
            throw new Error(estr);
        }
        return l;
    }

    public getFormattedString(lang: string = this.opts.source_language, str: string, defs: any) {
        let ns = this.getString(lang, str);
        return formatMsg(ns, defs, lang);
    }
}