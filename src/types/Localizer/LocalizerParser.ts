import { IStringsMap } from "@sb-types/Localizer/HumanizerInterfaces";

export abstract class LocalizerParser {
	/**
	 * Returns name of the parser
	 */
	public abstract get name(): string;

	/**
	 * Returns an array of supported extensions
	 */
	public abstract get supportedExtensions(): string[];

	/**
	 * Parses provided content to a new strings map.
	 * 
	 * Note: can be async function, whenever used, check if return value is Promise or not
	 * @param content content to parse
	 */
	public abstract parse(content: string): Promise<IStringsMap> | IStringsMap;

	/**
	 * Checks if map is valid language map
	 * @param obj Map to check
	 */
	protected checkMapType(obj: any): obj is IStringsMap {
		if (typeof obj !== "object" || Array.isArray(obj)) {
			throw new Error("Invalid map type");
		}

		for (const key in obj) {
			const val = obj[key];
			
			const type = typeof val;

			if (!val || type === "object") {
				throw new Error(`Value for "${key}" has invalid type: ${type}`);
			}

			if (type !== "string") {
				// fixture for invalid types
				obj[key] = `${val}`;
			}
		}

		return true;
	}
}

export default LocalizerParser;
