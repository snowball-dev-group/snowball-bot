import { IStringsMap } from "@sb-types/Localizer/HumanizerInterfaces";
import { LocalizerParser } from "@sb-types/Localizer/LocalizerParser";

export class LocalizerJSONParser extends LocalizerParser {
	public get name() {
		return LocalizerJSONParser.name;
	}

	public get supportedExtensions() {
		return [".json"];
	}

	public parse(content: string): IStringsMap {
		const map = JSON.parse(content);

		if (!this.checkMapType(map)) {
			throw new Error("Invalid map");
		}

		return map;
	}
}

export default LocalizerJSONParser;
