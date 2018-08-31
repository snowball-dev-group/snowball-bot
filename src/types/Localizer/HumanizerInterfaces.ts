export interface IStringsMap {
	[key: string]: string | undefined;
}
export interface IFormatMessageVariables {
	[name: string]: string | number | boolean | Date;
}
export interface ILanguageHashMap<T> {
	[lang: string]: T;
}
