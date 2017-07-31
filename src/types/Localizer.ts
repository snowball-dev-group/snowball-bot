import "any-promise/register/bluebird";
import * as fs from "mz/fs";
import { join as pathJoin } from "path";
import * as formatMsg from "format-message";
import { getLogger, ILoggerFunction } from "../cogs/utils/utils";

export interface ILocalizerOptions {
    languages:string[];
    default_language:string;
    directory:string;
}

export class Localizer {
    private opts:ILocalizerOptions;
    private langMaps:Map<string, any>;
    private initDone:boolean = false;
    private log:ILoggerFunction;
    private _defaultLang:string;
    
    get defaultLanguage() {
        return this._defaultLang;
    }

    constructor(name:string, opts:ILocalizerOptions) {
        this.opts = opts;
        this.log = getLogger(name);
        this._defaultLang = opts.default_language;
    }

    public async init() {
        if(this.initDone) { return; }
        try {
            this.langMaps = new Map<string, any>();
            this.log("info", "Started loading of language files");
            for(let lang of this.opts.languages) {
                if(this.langMaps.has(lang)) {
                    throw new Error(`Language "${lang}" is already registered`);
                }
                let content = await fs.readFile(pathJoin(this.opts.directory, `${lang}.json`), { "encoding": "utf8" });
                let z = JSON.parse(content);
                this.langMaps.set(lang, z);
            }

            this.log("info", "Requesting default language");
            let defLang = this.langMaps.get(this.opts.default_language);
            if(!defLang) {
                throw new Error("Default language not found");
            }

            this.log("info", "Calculating language files coverages");
            for(let [langName, langFile] of this.langMaps) {
                if(langName === this.opts.default_language) { 
                    langFile["+COVERAGE"] = 100;
                    this.langMaps.set(langName, langFile);
                    continue;
                }
                langFile["+COVERAGE"] = await this.testCoverage(langFile, defLang);
                langFile["+COMMUNITY_MANAGED"] = langFile["+COMMUNITY_MANAGED"] === "true" ? true : false;
                this.langMaps.set(langName, langFile);
                this.log("ok", `- ${langName} ${langFile["+NAME"]} (${langFile["+COUNTRY"]}) - ${langFile["+COVERAGE"]}`);
            }
        } catch (err) {
            this.log("err", "Error at initializing localizer", err);
            return;
        }

        this.initDone = true;
    }

    private async testCoverage(langFile, defLang = this.langMaps.get(this.opts.default_language)) {
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
        return Math.round(coverage * 1e2 ) / 1e2; // 99.99%
    }

    public get loadedLanguages() {
        return Array.from(this.langMaps.keys());
    }

    public languageExists(lang:string) {
        return this.langMaps.has(lang);
    }

    public getString(lang:string = this.opts.default_language, str:string) {
        let l = this.langMaps.get(lang)[str];
        if((!l || l === "") && lang !== this.opts.default_language) {
            l = this.langMaps.get(this.opts.default_language)[str];
            if(!l) {
                let estr = `String "${str}" not found nor in prefered language nor in language by default.`;
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

    public getFormattedString(lang:string = this.opts.default_language, str:string, defs:any) {
        let ns = this.getString(lang, str);
        return formatMsg(ns, defs, lang);
    }
}