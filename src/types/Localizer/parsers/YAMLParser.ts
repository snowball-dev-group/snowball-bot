import { IStringsMap } from "@sb-types/Localizer/HumanizerInterfaces";
import { LocalizerParser } from "@sb-types/Localizer/LocalizerParser";
import * as YAML from "js-yaml";

export class LocalizerYAMLParser extends LocalizerParser {
	public get name() {
		return LocalizerYAMLParser.name;
	}

	public get supportedExtensions() {
		return [".yaml", ".yml"];
	}

	public parse(content: string): IStringsMap {
		const map = YAML.safeLoad(content);

		if (!this.checkMapType(map)) {
			throw new Error("Invalid map");
		}

		return map;
	}
}

export default LocalizerYAMLParser;
