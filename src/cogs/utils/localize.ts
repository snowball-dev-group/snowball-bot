import "any-promise/register/bluebird";
import * as fs from "mz/fs";
import { join as pathJoin } from "path";
import * as formatMsg from "format-message";
import { getLogger, ILoggerFunction } from "./utils";

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

    constructor(name:string, opts:ILocalizerOptions) {
        this.opts = opts;
        this.log = getLogger(name);
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
        return ((Object.keys(langFile).length / Object.keys(defLang).length) * 100).toFixed(2);
    }

    public get loadedLanguages() {
        return Array.from(this.langMaps.keys());
    }

    public languageExists(lang:string) {
        return this.langMaps.has(lang);
    }

    public getString(lang:string = this.opts.default_language, str:string) {
        let l = this.langMaps.get(lang)[str];
        if(!l && lang !== this.opts.default_language) {
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