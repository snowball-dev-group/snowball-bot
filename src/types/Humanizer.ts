/**
 * Unit
 */
export type Unit = "y" | "mo" | "w" | "d" | "h" | "m" | "s" | "ms";

/**
 * Overrides for default options
 * If not set, value from default options will be used
 */
export interface IHumanizerOptionsOverrides {
	/**
	 * Boolean value. Use `true` to round the smallest unit displayed (can be combined with `largest` and `units`).
	 */
	round?: boolean;
	/**
	 * String to include before the final unit.
	 */
	conjunction?: string;
	/**
	 * Boolean value. Used with `conjunction`. Set this to `false` to eliminate the final comma
	 */
	serialComma?: boolean;
	/**
	 * String to display between the previous unit and the next value.
	 */
	delimiter?: string;
	/**
	 * Number representing the maximum number of units to display for the duration.
	 */
	largest?: number;
	/**
	 * Customize the value used to calculate each unit of time.
	 */
	unitMeasures?: {
		/**
		 * How many units year contains
		 */
		y?: number;
		/**
		 * How many units month contains
		 */
		mo?: number;
		/**
		 * How many units week contains
		 */
		w?: number;
		/**
		 * How many units day contains
		 */
		d?: number;
		/**
		 * How many units hour contains
		 */
		h?: number;
		/**
		 * How many units minute contains
		 */
		m?: number;
		/**
		 * How many units second contains
		 */
		s?: number;
		/**
		 * How many units millisecond contains
		 */
		ms?: number;
	};
	/**
	 * Array of strings to define which units are used to display the duration (if needed). Can be one, or a combination of any, of the {Unit}
	 */
	units?: Unit[];
}

/**
 * Options that used by default
 * They will be merged with overrides if they'll be passed to `humanize` function
 */
export interface IHumanizerDefaultOptions {
	/**
	 * Boolean value. Use `true` to round the smallest unit displayed (can be combined with `largest` and `units`).
	 */
	round: boolean;
	/**
	 * String to include before the final unit.
	 */
	conjunction: string;
	/**
	 * Boolean value. Used with `conjunction`. Set this to `false` to eliminate the final comma
	 */
	serialComma: boolean;
	/**
	 * String to display between the previous unit and the next value.
	 */
	delimiter: string;
	/**
	 * Number representing the maximum number of units to display for the duration.
	 */
	largest: number;
	/**
	 * Customize the value used to calculate each unit of time.
	 */
	unitMeasures: {
		/**
		 * How many units year contains
		 */
		y: number;
		/**
		 * How many units month contains
		 */
		mo: number;
		/**
		 * How many units week contains
		 */
		w: number;
		/**
		 * How many units day contains
		 */
		d: number;
		/**
		 * How many units hour contains
		 */
		h: number;
		/**
		 * How many units minute contains
		 */
		m: number;
		/**
		 * How many units second contains
		 */
		s: number;
		/**
		 * How many units millisecond contains
		 */
		ms: number;
	};
		/**
	 * Array of strings to define which units are used to display the duration (if needed). Can be one, or a combination of any, of the {Unit}
	 */
	units: Unit[];
}

export type IHumanizerPluralOverride = (val: number) => string;

/**
 * A set of functions to convert raw numbers to strings
 * Better to use with ICU plurals
 */
export interface IHumanizerLanguage {
	/**
	 * Function that will be used to convert years to string
	 * Use ICU plurals for better experience
	 */
	y: IHumanizerPluralOverride;
	/**
	 * Function that will be used to convert months to string
	 * Use ICU plurals for better experience
	 */
	mo: IHumanizerPluralOverride;
	/**
	 * Function that will be used to convert weeks to string
	 * Use ICU plurals for better experience
	 */
	w: IHumanizerPluralOverride;
	/**
	 * Function that will be used to convert days to string
	 * Use ICU plurals for better experience
	 */
	d: IHumanizerPluralOverride;
	/**
	 * Function that will be used to convert hours to string
	 * Use ICU plurals for better experience
	 */
	h: IHumanizerPluralOverride;
	/**
	 * Function that will be used to convert months to string
	 * Use ICU plurals for better experience
	 */
	m: IHumanizerPluralOverride;
	/**
	 * Function that will be used to convert seconds to string
	 * Use ICU plurals for better experience
	 */
	s: IHumanizerPluralOverride;
	/**
	 * Function that will be used to convert milliseconds to string
	 * Use ICU plurals for better experience
	 */
	ms: IHumanizerPluralOverride;
}

export class Humanizer {
	static get DEFAULT_OPTIONS(): IHumanizerDefaultOptions {
		return {
			delimiter: ", ",
			conjunction: "",
			serialComma: true,
			units: ["y", "mo", "w", "d", "h", "m", "s"],
			round: false,
			unitMeasures: {
				y: 31557600000,
				mo: 2629800000,
				w: 604800000,
				d: 86400000,
				h: 3600000,
				m: 60000,
				s: 1000,
				ms: 1
			},
			largest: 3
		};
	}

	locale: IHumanizerLanguage;
	defaultOptions: IHumanizerDefaultOptions;

	constructor(locale: IHumanizerLanguage, options?: IHumanizerDefaultOptions) {
		if (!locale) {
			throw new Error("Humanizer locale is not specified");
		}

		this.locale = locale;
		if (options) {
			this.defaultOptions = options;
		} else {
			this.defaultOptions = Humanizer.DEFAULT_OPTIONS;
		}
	}

	humanize(milliseconds: number, optionsOverrides?: IHumanizerOptionsOverrides) {
		let ms = Math.abs(milliseconds);

		const dictionary = this.locale;

		const options = optionsOverrides ? <IHumanizerDefaultOptions & IHumanizerOptionsOverrides> { ...this.defaultOptions, ...optionsOverrides } : this.defaultOptions;

		const pieces: Array<{
			unitCount: number;
			unitName: Unit;
		}> = [];

		for (let i = 0; i < options.units.length; i++) {
			const unitName = options.units[i];
			const unitMS = options.unitMeasures[unitName];

			if (!unitMS) {
				continue; // unit always SHOULD BE assigned
			}

			let unitCount: number;

			// What's the number of full units we can fit?
			if (i + 1 === options.units.length) {
				unitCount = ms / unitMS;
			} else {
				unitCount = Math.floor(ms / unitMS);
			}

			// Add the string.
			pieces.push({
				unitCount,
				unitName,
			});

			// Remove what we just figured out.
			ms -= unitCount * unitMS;
		}

		let firstOccupiedUnitIndex = 0;
		pieces.some((piece, i) => {
			if (piece.unitCount) {
				firstOccupiedUnitIndex = i;
			}

			return !!piece.unitCount;
		});

		if (options.round) {
			let previousPiece;
			let i = pieces.length - 1;

			while (i >= 0) {
				const piece = pieces[i];
				piece.unitCount = Math.round(piece.unitCount);

				if (i === 0) {
					break;
				}

				previousPiece = pieces[i - 1];

				const prevUnitMeasures = options.unitMeasures[previousPiece.unitName];
				const currentUnitMeasures = options.unitMeasures[piece.unitName] || Humanizer.DEFAULT_OPTIONS.unitMeasures[piece.unitName];
				const ratioToLargerUnit = prevUnitMeasures / currentUnitMeasures;

				if (
					((piece.unitCount % ratioToLargerUnit) === 0) ||
					(options.largest && ((options.largest - 1) < (i - firstOccupiedUnitIndex)))
				) {
					previousPiece.unitCount += piece.unitCount / ratioToLargerUnit;
					piece.unitCount = 0;
				}

				i -= 1;
			}
		}

		const result: string[] = [];
		pieces.some((piece) => {
			if (piece.unitCount) {
				result.push(Humanizer.render(piece.unitCount, piece.unitName, dictionary));
			}

			return (result.length === options.largest);
		});

		let renderedResult: string = "";
		if (result.length) {
			if (!options.conjunction || result.length === 1) {
				renderedResult = result.join(options.delimiter);
			} else if (result.length === 2) {
				renderedResult = result.join(options.conjunction);
			} else if (result.length > 2) {
				renderedResult = result.slice(0, -1).join(options.delimiter) +
					(options.serialComma ? "," : "") + options.conjunction + result.slice(-1);
			}
		} else {
			const type = options.units[options.units.length - 1];
			renderedResult = Humanizer.render(0, type, dictionary);
		}

		return renderedResult;
	}

	static render(count: number, type: Unit, dictionary: IHumanizerLanguage) {
		const dictionaryValue = dictionary[type];
		if (!dictionaryValue) {
			throw new Error("Humanizer locale formatter is not specified");
		}

		const word = (typeof dictionaryValue === "function")
			? dictionaryValue(count)
			: dictionaryValue;

		return word;
	}
}

export default Humanizer;
