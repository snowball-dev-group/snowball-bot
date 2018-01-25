const REGIONAL_CHAR = String.fromCharCode(0xD83C);
const KEYCAP_SUBCHAR = String.fromCharCode(0x20E3);

const REGIONAL_SUBCHAR_START = 56806;

export enum Stances {
	NoCaseSwitching = 2,
	ConvertNumbers = 4
}

export function toRegionalIndicators(str: string, stances?: Stances, unknownCharReplacer?: (s: string) => string): string {
	let arr = str.split("");
	let allowCaseSwitching = false;
	let numbersConversion = true;
	if(stances && stances > 0) {
		allowCaseSwitching = !((stances & Stances.NoCaseSwitching) === Stances.NoCaseSwitching);
		numbersConversion = ((stances & Stances.ConvertNumbers) === Stances.ConvertNumbers);
	}
	arr = arr.map((s) => {
		const oS = s;
		if(allowCaseSwitching) {
			s = s.toLowerCase();
		}
		if(/^[a-z]{1}$/.test(s)) {
			const letPos = s.charCodeAt(0) - 97;
			return `${REGIONAL_CHAR}${String.fromCharCode(REGIONAL_SUBCHAR_START + letPos)}`;
		} else if(numbersConversion && /^[0-9]{1}$/.test(s)) {
			return convertNumbers(s);
		} else if(unknownCharReplacer) {
			return unknownCharReplacer(s);
		}
		return oS;
	});
	return arr.join("");
}

export function convertNumbers(num: string | number, unknownCharReplacer?: (s: string) => string) {
	let str = `${num}`;
	str = str.replace(/([0-9])/ig, (s) => {
		if(/^[0-9]{1}$/.test(s)) {
			return `${s}${KEYCAP_SUBCHAR}`;
		} else if(unknownCharReplacer) {
			return unknownCharReplacer(s);
		}
		return s;
	});
	return str;
}
